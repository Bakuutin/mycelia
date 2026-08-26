import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Images,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getMediaRecognitionBatchProgress } from "@/lib/mediaRecognitionBatchProgress";
import { AuthenticatedMediaImage } from "@/components/media/AuthenticatedMediaImage";
import { MediaSectionNav } from "@/components/media/MediaSectionNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type InventoryFilter =
  | "all"
  | "unprocessed"
  | "processing"
  | "ready"
  | "needs_attention";
type PlacementFilter = "all" | "missing_time" | "missing_location";
type RecognitionTask = "visual-understanding" | "ocr";
type SelectionMode = "explicit" | "all_matching";
const RECOGNITION_TASKS: RecognitionTask[] = [
  "visual-understanding",
  "ocr",
];

interface Filters {
  inventoryFilter: InventoryFilter;
  placement: PlacementFilter;
  query: string;
  capturedFrom: string;
  capturedTo: string;
}

interface Asset {
  _id: unknown;
  fileName: string;
  status: string;
  byteLength?: number;
  thumbnailUrl?: string;
  previewUrl?: string;
  capturedAt?: string | Date;
  location?: { latitude: number; longitude: number };
  safeError?: string;
  source?: { relativePath?: string };
  storageMode?: string;
  managedOriginal?: { fileId?: unknown };
  metadata?: Record<string, unknown>;
  inventory?: {
    shortCaption?: string;
    ocrPageCount?: number;
    annotationCount?: number;
  };
}

interface Batch {
  _id: unknown;
  status: string;
  profileName?: string;
  requestedTasks?: RecognitionTask[];
  counts?: Record<string, number>;
  progress?: Record<string, unknown>;
  coordinatorJobId?: unknown;
  updatedAt?: string | Date;
  createdAt?: string | Date;
}

const PAGE_SIZE = 100;
const ACTIVE_BATCH_STATES = new Set(["queued", "running", "paused"]);
const PROCESSABLE_STATES = new Set([
  "staged",
  "failed",
  "budget_blocked",
  "recognition_disabled",
]);

interface SingleAssetEligibility {
  eligible: boolean;
  title: string;
  description: string;
}

function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "$oid" in value) {
    return String((value as { $oid: unknown }).$oid);
  }
  return String(value ?? "");
}

function parsedInventoryFilter(value: string | null): InventoryFilter {
  if (
    value === "unprocessed" || value === "processing" || value === "ready" ||
    value === "needs_attention"
  ) return value;
  return "all";
}

function parsedPlacement(value: string | null): PlacementFilter {
  if (value === "missing_time" || value === "missing_location") return value;
  return "all";
}

function isoDate(value: string, end = false): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(
    value + (end ? "T23:59:59.999Z" : "T00:00:00.000Z"),
  ).toISOString();
}

function filterRequest(filters: Filters) {
  return {
    inventoryFilter: filters.inventoryFilter,
    placement: filters.placement,
    kind: "image",
    ...(filters.query ? { query: filters.query } : {}),
    ...(isoDate(filters.capturedFrom)
      ? { capturedFrom: isoDate(filters.capturedFrom) }
      : {}),
    ...(isoDate(filters.capturedTo, true)
      ? { capturedTo: isoDate(filters.capturedTo, true) }
      : {}),
  };
}

function formattedDate(value: unknown): string {
  if (!value) return "Time not set";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "Time not set";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusTone(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ready" || status === "completed") return "default";
  if (
    status === "failed" || status === "budget_blocked" ||
    status === "source_missing" || status === "source_changed" ||
    status === "completed_with_errors"
  ) return "destructive";
  if (
    status === "queued" || status === "running" ||
    status === "processing" || status === "paused"
  ) return "secondary";
  return "outline";
}

function resultCopy(asset: Asset): string {
  return asset.inventory?.shortCaption ?? asset.safeError ??
    (asset.status === "ready"
      ? "Analysis is ready"
      : "No visual description yet");
}

function singleAssetEligibility(asset: Asset): SingleAssetEligibility {
  if (asset.status === "ready") {
    return {
      eligible: false,
      title: "Photo analysis is already ready",
      description:
        "Ready photos are skipped by recognition batches. Stored provider results and history are shown below; a missing visual description is not queued again while this photo remains ready.",
    };
  }
  if (asset.status === "queued" || asset.status === "processing") {
    return {
      eligible: false,
      title: "Description is already in progress",
      description:
        "This photo is already queued or processing, so it cannot be added to another recognition batch.",
    };
  }
  if (asset.status === "source_missing") {
    return {
      eligible: false,
      title: "Original photo is unavailable",
      description: asset.safeError ??
        "The mounted original cannot be found. Restore it at the imported path before requesting a description.",
    };
  }
  if (asset.status === "source_changed") {
    return {
      eligible: false,
      title: "Original photo changed",
      description: asset.safeError ??
        "The file at the mounted path no longer matches the imported photo. Sync the folder again before requesting a description.",
    };
  }
  if (!PROCESSABLE_STATES.has(asset.status)) {
    return {
      eligible: false,
      title: "Photo is not eligible for analysis",
      description:
        "Its current state is not accepted by a new recognition batch.",
    };
  }
  const hasOriginalReference = (asset.storageMode === "managed_original" &&
    Boolean(asset.managedOriginal?.fileId)) ||
    (asset.storageMode === "external_reference" &&
      Boolean(asset.source?.relativePath));
  if (!hasOriginalReference) {
    return {
      eligible: false,
      title: "No retained original is available",
      description:
        "This record has a preview but no managed original or mounted-file reference that recognition can read.",
    };
  }
  return {
    eligible: true,
    title: "Ready to review one photo",
    description:
      "Only this photo is selected. Reviewing creates a local receipt and verifies the original; it does not call the provider.",
  };
}

export default function MediaAnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const inventoryFilterParam = searchParams.get("status");
  const placementParam = searchParams.get("placement");
  const queryParam = searchParams.get("query");
  const capturedFromParam = searchParams.get("from");
  const capturedToParam = searchParams.get("to");
  const filters = useMemo<Filters>(() => ({
    inventoryFilter: parsedInventoryFilter(inventoryFilterParam),
    placement: parsedPlacement(placementParam),
    query: queryParam?.trim() ?? "",
    capturedFrom: capturedFromParam ?? "",
    capturedTo: capturedToParam ?? "",
  }), [
    capturedFromParam,
    capturedToParam,
    inventoryFilterParam,
    placementParam,
    queryParam,
  ]);
  const viewMode = searchParams.get("view") === "table" ? "table" : "grid";
  const selectedAssetId = searchParams.get("assetId") ?? "";
  const selectRequested = searchParams.get("select") === "1";

  const [queryDraft, setQueryDraft] = useState(filters.query);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string>();
  const cursorRef = useRef<string | undefined>(undefined);
  const loadedAssetCountRef = useRef(0);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const requestActiveRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  const [status, setStatus] = useState<any>();
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [batches, setBatches] = useState<Batch[]>([]);
  const batchSignatureRef = useRef("");
  const [batchError, setBatchError] = useState<string>();

  const [selectionMode, setSelectionMode] = useState<SelectionMode>("explicit");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [profileId, setProfileId] = useState("");
  const [preview, setPreview] = useState<any>();
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [batchAction, setBatchAction] = useState("");
  const [detail, setDetail] = useState<any>();
  const [detailLoading, setDetailLoading] = useState(false);
  const autoSelectionRef = useRef("");
  const reviewBatchButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setQueryDraft(filters.query), [filters.query]);

  const updateParams = useCallback((changes: Record<string, string>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        const defaultValue = key === "status" || key === "placement"
          ? "all"
          : key === "view"
          ? "grid"
          : "";
        if (!value || value === defaultValue) next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const loadAssets = useCallback(async (
    options: { append?: boolean; background?: boolean } = {},
  ) => {
    const append = Boolean(options.append);
    if (options.background && requestActiveRef.current) return;
    const cursor = append ? cursorRef.current : undefined;
    if (append && !cursor) return;
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    requestActiveRef.current = true;
    if (!options.background) {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setLoadError(undefined);
    }
    try {
      const loadAssetPage = (pageCursor?: string, limit = PAGE_SIZE) =>
        callResource("media", {
          action: "listAssets",
          limit,
          ...filterRequest(filters),
          ...(pageCursor ? { cursor: pageCursor } : {}),
        }, { signal: controller.signal });
      const loadRefreshedPrefix = async () => {
        const target = loadedAssetCountRef.current > 0
          ? loadedAssetCountRef.current
          : PAGE_SIZE;
        const refreshed: Asset[] = [];
        let refreshCursor: string | undefined;
        let total = 0;
        do {
          const page = await loadAssetPage(
            refreshCursor,
            Math.min(500, Math.max(1, target - refreshed.length)),
          );
          refreshed.push(...((page.assets ?? []) as Asset[]));
          total = Number(page.total ?? total);
          refreshCursor = page.nextCursor ? String(page.nextCursor) : undefined;
        } while (refreshCursor && refreshed.length < target);
        return { assets: refreshed, total, nextCursor: refreshCursor };
      };
      const result = options.background
        ? await loadRefreshedPrefix()
        : await loadAssetPage(cursor);
      if (generation !== generationRef.current) return;
      const page = (result.assets ?? []) as Asset[];
      if (append) loadedAssetCountRef.current += page.length;
      else loadedAssetCountRef.current = page.length;
      setAssets((current) => {
        if (!append) {
          return page;
        }
        const merged = new Map<string, Asset>();
        for (const asset of current.concat(page)) {
          merged.set(idOf(asset._id), asset);
        }
        const next = Array.from(merged.values());
        return next;
      });
      const next = result.nextCursor ? String(result.nextCursor) : undefined;
      cursorRef.current = next;
      setNextCursor(next);
      setTotal(Number(result.total ?? page.length));
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) return;
      if (generation !== generationRef.current) return;
      if (!options.background) {
        setLoadError(
          error instanceof Error ? error.message : "Photo inventory failed",
        );
      }
    } finally {
      if (generation === generationRef.current) {
        requestActiveRef.current = false;
        if (!options.background) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }
  }, [filters]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(
        await callResource("media-library", { action: "summary" }) ?? {},
      );
    } catch {
      // The filtered list remains useful without optional summary counters.
    }
  }, []);

  const loadBatches = useCallback(async () => {
    try {
      const result = await callResource("media-library", {
        action: "listRecognitionBatches",
        limit: 8,
      });
      const next = (result.batches ?? []) as Batch[];
      setBatches(next);
      setBatchError(undefined);
      const signature = JSON.stringify(next.map((batch) => ({
        id: idOf(batch._id),
        status: batch.status,
        counts: batch.counts,
        updatedAt: batch.updatedAt,
      })));
      if (
        batchSignatureRef.current && batchSignatureRef.current !== signature
      ) {
        void loadAssets({ background: true });
        void loadSummary();
      }
      batchSignatureRef.current = signature;
    } catch (error) {
      setBatchError(
        error instanceof Error ? error.message : "Batch status unavailable",
      );
    }
  }, [loadAssets, loadSummary]);

  useEffect(() => {
    cursorRef.current = undefined;
    loadedAssetCountRef.current = 0;
    setNextCursor(undefined);
    setSelectionMode("explicit");
    setSelectedIds(new Set());
    setPreview(undefined);
    void loadAssets();
    return () => abortRef.current?.abort();
  }, [loadAssets]);

  useEffect(() => {
    void callResource("media", { action: "status" }).then(setStatus).catch(
      (error) =>
        toast.error(
          error instanceof Error ? error.message : "Media settings failed",
        ),
    );
    void loadSummary();
    void loadBatches();
  }, [loadBatches, loadSummary]);

  const hasActiveBatch = batches.some((batch) =>
    ACTIVE_BATCH_STATES.has(batch.status)
  );
  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      if (globalThis.document?.visibilityState === "hidden") return;
      void loadBatches();
      if (!hasActiveBatch) {
        void loadAssets({ background: true });
        void loadSummary();
      }
    }, hasActiveBatch ? 3_000 : 15_000);
    return () => globalThis.clearInterval(timer);
  }, [hasActiveBatch, loadAssets, loadBatches, loadSummary]);

  const profiles = useMemo(
    () =>
      status?.enabled
        ? (status.profiles ?? []).filter((entry: any) => entry.enabled)
        : [],
    [status],
  );
  useEffect(() => {
    setProfileId((current) => {
      if (profiles.some((entry: any) => entry.id === current)) return current;
      const active = profiles.find((entry: any) =>
        entry.id === status?.activeProfileId
      );
      return String(active?.id ?? profiles[0]?.id ?? "");
    });
  }, [profiles, status?.activeProfileId]);
  const selectedProfile = profiles.find((entry: any) => entry.id === profileId);

  useEffect(() => {
    if (!selectedAssetId) {
      setDetail(undefined);
      return;
    }
    let current = true;
    setDetail(undefined);
    setDetailLoading(true);
    callResource("media", { action: "getAsset", assetId: selectedAssetId })
      .then((result) => current && setDetail(result))
      .catch((error) => {
        if (current) {
          toast.error(
            error instanceof Error ? error.message : "Photo details failed",
          );
        }
      })
      .finally(() => current && setDetailLoading(false));
    return () => {
      current = false;
    };
  }, [selectedAssetId]);

  useEffect(() => {
    if (!selectRequested || !selectedAssetId) {
      autoSelectionRef.current = "";
      return;
    }
    setSelectionMode("explicit");
    setSelectedIds(new Set());
    setPreview(undefined);
    autoSelectionRef.current = "";
  }, [selectRequested, selectedAssetId]);

  useEffect(() => {
    if (!selectRequested || !selectedAssetId || !detail?.asset) return;
    if (idOf(detail.asset._id) !== selectedAssetId) return;
    const selectionKey = `${selectedAssetId}:select=1`;
    if (autoSelectionRef.current === selectionKey) return;
    autoSelectionRef.current = selectionKey;
    const eligibility = singleAssetEligibility(detail.asset as Asset);
    setSelectionMode("explicit");
    setSelectedIds(
      eligibility.eligible ? new Set([selectedAssetId]) : new Set(),
    );
    setPreview(undefined);
  }, [detail, selectRequested, selectedAssetId]);

  const processableAssets = assets.filter((asset) =>
    PROCESSABLE_STATES.has(asset.status)
  );
  const selectedCount = selectionMode === "all_matching"
    ? total
    : selectedIds.size;

  const clearSelection = () => {
    setSelectionMode("explicit");
    setSelectedIds(new Set());
    setPreview(undefined);
  };

  const toggleAsset = (assetId: string, checked: boolean) => {
    setSelectionMode("explicit");
    setPreview(undefined);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(assetId);
      else next.delete(assetId);
      return next;
    });
  };

  const previewBatch = async () => {
    if (!profileId || selectedCount === 0) return;
    setPreviewing(true);
    try {
      const shared = {
        inventoryFilter: filters.inventoryFilter,
        placement: filters.placement,
        ...(filters.query ? { query: filters.query } : {}),
        ...(isoDate(filters.capturedFrom)
          ? { capturedFrom: isoDate(filters.capturedFrom) }
          : {}),
        ...(isoDate(filters.capturedTo, true)
          ? { capturedTo: isoDate(filters.capturedTo, true) }
          : {}),
      };
      const selection = selectionMode === "all_matching"
        ? { mode: "all_matching", ...shared }
        : { mode: "explicit", ...shared, assetIds: Array.from(selectedIds) };
      const result = await callResource("media-library", {
        action: "previewRecognitionBatch",
        profileId,
        requestedTasks: RECOGNITION_TASKS,
        selection,
      });
      setPreview(result);
      const reserved = Number(result.reservedByActiveBatchCount ?? 0);
      toast.success(
        "Prepared " + Number(result.eligibleCount ?? 0) +
          " exact photo(s); no provider call yet" +
          (reserved > 0 ? ` · ${reserved} already in another batch` : ""),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Analysis preview failed",
      );
    } finally {
      setPreviewing(false);
    }
  };

  const confirmBatch = async () => {
    if (!preview?.previewId) return;
    setConfirming(true);
    try {
      const result = await callResource("media-library", {
        action: "confirmRecognitionBatch",
        previewId: idOf(preview.previewId),
        consent: true,
      });
      setPreview(undefined);
      clearSelection();
      if (result.batch) {
        setBatches((current) =>
          [
            result.batch,
            ...current.filter((entry) =>
              idOf(entry._id) !== idOf(result.batch._id)
            ),
          ].slice(0, 8)
        );
      }
      toast.success("Analysis batch queued; the library stays available");
      await Promise.all([loadAssets(), loadSummary(), loadBatches()]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Batch confirmation failed",
      );
    } finally {
      setConfirming(false);
    }
  };

  const changeBatch = async (
    batch: Batch,
    action: "cancelRecognitionBatch",
  ) => {
    const key = idOf(batch._id) + ":" + action;
    setBatchAction(key);
    try {
      await callResource("media-library", {
        action,
        batchId: idOf(batch._id),
        confirm: true,
      });
      await loadBatches();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Batch action failed",
      );
    } finally {
      setBatchAction("");
    }
  };

  const openAsset = (assetId: string) => updateParams({ assetId, select: "" });
  const closeAsset = () => updateParams({ assetId: "", select: "" });
  const selectedIndex = assets.findIndex((asset) =>
    idOf(asset._id) === selectedAssetId
  );
  const detailEligibility = detail?.asset
    ? singleAssetEligibility(detail.asset as Asset)
    : undefined;

  const continueToBatchReview = () => {
    closeAsset();
    globalThis.setTimeout(() => {
      reviewBatchButtonRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
      reviewBatchButtonRef.current?.focus();
    }, 0);
  };

  const assetCheckbox = (asset: Asset) => {
    const assetId = idOf(asset._id);
    return (
      <Checkbox
        aria-label={"Select " + asset.fileName}
        checked={selectionMode === "all_matching" || selectedIds.has(assetId)}
        disabled={!PROCESSABLE_STATES.has(asset.status) ||
          selectionMode === "all_matching"}
        onCheckedChange={(checked) => toggleAsset(assetId, checked === true)}
      />
    );
  };

  const metrics = [
    ["Photos", summary.all ?? total, Images],
    ["Ready", summary.ready ?? 0, CheckCircle2],
    ["Needs attention", summary.needsAttention ?? 0, AlertTriangle],
    ["Missing location", summary.missingLocation ?? 0, MapPin],
  ] as const;

  return (
    <div className="container mx-auto space-y-6 p-4">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Sparkles className="h-7 w-7 text-primary" />Photo analysis
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Filter every imported photo, inspect stored results, and prepare one
            durable provider batch for an exact selection.
          </p>
          <MediaSectionNav />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void loadAssets();
              void loadSummary();
              void loadBatches();
            }}
          >
            <RefreshCw
              className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
            />Refresh
          </Button>
          <Button asChild variant="outline">
            <Link to="/timeline">Timeline</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/map">Map</Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, Icon]) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-2xl font-semibold">{Number(value)}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
              <Icon className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Photos and analysis</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Filters are stored in the URL and can be bookmarked.
              </p>
            </div>
            <div className="inline-flex rounded-md border p-1">
              <Button
                size="sm"
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
                onClick={() => updateParams({ view: "grid" })}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant={viewMode === "table" ? "secondary" : "ghost"}
                aria-label="Table view"
                aria-pressed={viewMode === "table"}
                onClick={() => updateParams({ view: "table" })}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.3fr_repeat(4,minmax(0,0.7fr))]">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                updateParams({ query: queryDraft.trim() });
              }}
            >
              <Input
                aria-label="Search imported photos"
                value={queryDraft}
                onChange={(event) => setQueryDraft(event.target.value)}
                placeholder="Filename or imported source path"
              />
              <Button type="submit" size="icon" aria-label="Apply photo search">
                <Search className="h-4 w-4" />
              </Button>
            </form>
            <div>
              <Label htmlFor="analysis-status" className="sr-only">
                Status
              </Label>
              <select
                id="analysis-status"
                aria-label="Status"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={filters.inventoryFilter}
                onChange={(event) =>
                  updateParams({ status: event.target.value })}
              >
                <option value="all">Any status</option>
                <option value="unprocessed">Unprocessed</option>
                <option value="processing">Queued / processing</option>
                <option value="ready">Ready</option>
                <option value="needs_attention">Needs attention</option>
              </select>
            </div>
            <div>
              <Label htmlFor="analysis-placement" className="sr-only">
                Placement
              </Label>
              <select
                id="analysis-placement"
                aria-label="Placement"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={filters.placement}
                onChange={(event) =>
                  updateParams({ placement: event.target.value })}
              >
                <option value="all">Any placement</option>
                <option value="missing_time">Missing time</option>
                <option value="missing_location">Missing location</option>
              </select>
            </div>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                aria-label="Captured from"
                className="pl-9"
                value={filters.capturedFrom}
                onChange={(event) => updateParams({ from: event.target.value })}
              />
            </div>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                aria-label="Captured to"
                className="pl-9"
                value={filters.capturedTo}
                onChange={(event) => updateParams({ to: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/25 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={processableAssets.length === 0}
                onClick={() => {
                  setSelectionMode("explicit");
                  setSelectedIds(
                    new Set(
                      processableAssets.map((asset) => idOf(asset._id)),
                    ),
                  );
                  setPreview(undefined);
                }}
              >
                Select loaded ({processableAssets.length})
              </Button>
              <Button
                size="sm"
                variant={selectionMode === "all_matching"
                  ? "default"
                  : "outline"}
                disabled={total === 0}
                onClick={() => {
                  setSelectionMode("all_matching");
                  setSelectedIds(new Set());
                  setPreview(undefined);
                }}
              >
                Select all {total} matching
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={selectedCount === 0}
                onClick={clearSelection}
              >
                Clear
              </Button>
              <span className="text-sm text-muted-foreground">
                {selectionMode === "all_matching"
                  ? "All " + total + " matching photos selected"
                  : selectedIds.size + " explicit photo(s) selected"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Analysis provider"
                className="h-9 min-w-[220px] rounded-md border bg-background px-3 text-sm"
                value={profileId}
                onChange={(event) => {
                  setProfileId(event.target.value);
                  setPreview(undefined);
                }}
              >
                <option value="">Choose provider</option>
                {profiles.map((entry: any) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
              <Button
                ref={reviewBatchButtonRef}
                size="sm"
                disabled={previewing || !profileId || selectedCount === 0}
                onClick={previewBatch}
              >
                {previewing
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Sparkles className="mr-2 h-4 w-4" />}
                Review analysis batch ({selectedCount})
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-sm">
            <span className="text-muted-foreground">
              {selectedProfile?.providerType === "self-hosted"
                ? `Fixed bulk package: visual understanding + OCR on ${selectedProfile.name}. Google is not called.`
                : "Fixed Google package: Vertex visual understanding + embedding and strict-EU Vision OCR. Global Vision labels/objects stay off."}
            </span>
            {hasActiveBatch && (
              <span className="text-xs text-muted-foreground">
                Existing batches continue in the background; browsing and a new
                exact selection remain available.
              </span>
            )}
          </div>

          {preview && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="font-medium">Exact provider preview</div>
                <div className="text-sm text-muted-foreground">
                  {Number(preview.eligibleCount ?? 0)}{" "}
                  eligible photo(s) · maximum
                  {" $"}
                  {Number(preview.authorizedGrossUsd ?? 0).toFixed(2)}{" "}
                  · no provider call yet
                </div>
                {Number(preview.missingOriginalCount ?? 0) > 0 && (
                  <div className="text-sm text-amber-700 dark:text-amber-300">
                    {Number(preview.missingOriginalCount)} selected original(s)
                    {" "}
                    could not be read and were excluded. No provider call was
                    made.
                  </div>
                )}
                {Number(preview.reservedByActiveBatchCount ?? 0) > 0 && (
                  <div className="text-sm text-amber-700 dark:text-amber-300">
                    {Number(preview.reservedByActiveBatchCount)}{" "}
                    matching photo(s){" "}
                    are already reserved by another active batch and were
                    excluded.
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPreview(undefined)}>
                  Cancel
                </Button>
                <Button
                  disabled={confirming ||
                    Number(preview.eligibleCount ?? 0) === 0}
                  onClick={confirmBatch}
                >
                  {confirming && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}Confirm exact batch
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Showing {assets.length} of {total} matching photo(s)</span>
            {loading && assets.length > 0 && (
              <span>
                <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />
                Updating…
              </span>
            )}
          </div>

          {loadError && (
            <div className="flex items-center justify-between rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
              <span>{loadError}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadAssets()}
              >
                Retry
              </Button>
            </div>
          )}

          {loading && assets.length === 0
            ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-60 animate-pulse rounded-xl bg-muted"
                  />
                ))}
              </div>
            )
            : assets.length === 0
            ? (
              <div className="rounded-xl border border-dashed p-10 text-center">
                <Images className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <div className="font-medium">No photos match these filters</div>
                <Button asChild variant="outline" className="mt-4">
                  <Link to="/media">Open import & library</Link>
                </Button>
              </div>
            )
            : viewMode === "grid"
            ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {assets.map((asset) => {
                  const assetId = idOf(asset._id);
                  return (
                    <article
                      key={assetId}
                      className={cn(
                        "group overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md",
                        selectionMode === "explicit" &&
                          selectedIds.has(assetId) &&
                          "border-primary ring-1 ring-primary",
                      )}
                    >
                      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                        <button
                          type="button"
                          className="h-full w-full"
                          aria-label={"Open " + asset.fileName}
                          onClick={() => openAsset(assetId)}
                        >
                          <AuthenticatedMediaImage
                            path={asset.thumbnailUrl}
                            alt={asset.fileName}
                            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                          />
                        </button>
                        <div className="absolute left-3 top-3 rounded bg-background/90 p-1 shadow">
                          {assetCheckbox(asset)}
                        </div>
                        <Badge
                          className="absolute right-3 top-3"
                          variant={statusTone(asset.status)}
                        >
                          {asset.status}
                        </Badge>
                      </div>
                      <div className="space-y-2 p-4">
                        <div className="truncate font-medium">
                          {asset.fileName}
                        </div>
                        <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                          {resultCopy(asset)}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>{formattedDate(asset.capturedAt)}</span>
                          <span>{asset.location ? "GPS" : "No GPS"}</span>
                          {Number(asset.inventory?.ocrPageCount ?? 0) > 0 && (
                            <span>OCR {asset.inventory?.ocrPageCount}</span>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )
            : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Select</TableHead>
                      <TableHead>Photo</TableHead>
                      <TableHead>Captured</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Analysis result</TableHead>
                      <TableHead className="text-right">View</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset) => {
                      const assetId = idOf(asset._id);
                      return (
                        <TableRow key={assetId}>
                          <TableCell>{assetCheckbox(asset)}</TableCell>
                          <TableCell>
                            <div className="flex min-w-[220px] items-center gap-3">
                              <AuthenticatedMediaImage
                                path={asset.thumbnailUrl}
                                alt={asset.fileName}
                                className="h-14 w-14 rounded border object-cover"
                              />
                              <div>
                                <div className="max-w-[260px] truncate font-medium">
                                  {asset.fileName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {(Number(asset.byteLength ?? 0) / 1_000_000)
                                    .toFixed(2)} MB
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {formattedDate(asset.capturedAt)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusTone(asset.status)}>
                              {asset.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[360px]">
                            <div className="line-clamp-2">
                              {resultCopy(asset)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAsset(assetId)}
                            >
                              <Eye className="mr-2 h-4 w-4" />Details
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

          {nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={loadingMore}
                onClick={() => void loadAssets({ append: true })}
              >
                {loadingMore && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}Load next {PAGE_SIZE}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Analysis batches</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Active batches refresh every three seconds without locking this
                workspace.
              </p>
            </div>
            {hasActiveBatch && <Badge variant="secondary">Live</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {batchError && (
            <div className="text-sm text-destructive">{batchError}</div>
          )}
          {batches.length === 0
            ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No recognition batches yet.
              </div>
            )
            : batches.map((batch) => {
              const batchId = idOf(batch._id);
              const progress = getMediaRecognitionBatchProgress(batch);
              const coordinatorJobId = idOf(batch.coordinatorJobId);
              const failed = Number(batch.counts?.failed ?? 0);
              return (
                <div key={batchId} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={statusTone(batch.status)}>
                          {batch.status}
                        </Badge>
                        <span className="font-medium">
                          {batch.profileName ?? "Recognition provider"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {(batch.requestedTasks ?? []).join(" + ") ||
                          "Stored task selection"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {coordinatorJobId && (
                        <Button size="sm" variant="ghost" asChild>
                          <Link
                            to={`/jobs/${encodeURIComponent(coordinatorJobId)}`}
                            aria-label={`Open coordinator job for analysis batch ${batchId}`}
                          >
                            Open batch job
                          </Link>
                        </Button>
                      )}
                      {ACTIVE_BATCH_STATES.has(batch.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(batchAction)}
                          onClick={() =>
                            void changeBatch(batch, "cancelRecognitionBatch")}
                        >
                          {batchAction === batchId + ":cancelRecognitionBatch"
                            ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            )
                            : <Square className="mr-2 h-3.5 w-3.5" />}
                          Stop new calls
                        </Button>
                      )}
                      {failed > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            updateParams({
                              status: "needs_attention",
                              assetId: "",
                            });
                            clearSelection();
                            toast.info(
                              "Review the failed photos as a new exact batch with a new cost ceiling",
                            );
                          }}
                        >
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />Review{" "}
                          {failed} in a new batch
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{progress.done} terminal of {progress.total}</span>
                      <span>{progress.percent.toFixed(1)}%</span>
                    </div>
                    <Progress
                      value={progress.percent}
                      className="h-2"
                      aria-label={`Analysis batch ${batchId} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress.percent}
                      aria-valuetext={`${progress.done} of ${progress.total} photos complete`}
                    />
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {Object.entries(batch.counts ?? {})
                        .filter(([, count]) =>
                          Number(count) > 0
                        )
                        .map(([label, count]) => (
                          <span key={label}>{label} {count}</span>
                        ))}
                    </div>
                  </div>
                </div>
              );
            })}
        </CardContent>
      </Card>

      <Sheet
        open={Boolean(selectedAssetId)}
        onOpenChange={(open) => !open && closeAsset()}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl lg:max-w-2xl">
          <SheetHeader
            className={detail?.asset && !detailLoading ? "pr-8" : "sr-only"}
          >
            <SheetTitle>
              {detail?.asset?.fileName ?? "Photo details"}
            </SheetTitle>
            <SheetDescription>
              {detail?.asset?.source?.relativePath ??
                detail?.asset?.storageMode ??
                "Loading imported photo details"}
            </SheetDescription>
          </SheetHeader>
          {detailLoading
            ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin" />
              </div>
            )
            : detail?.asset
            ? (
              <div className="space-y-5">
                <AuthenticatedMediaImage
                  path={detail.asset.previewUrl ?? detail.asset.thumbnailUrl}
                  alt={detail.asset.fileName}
                  className="max-h-[52vh] w-full rounded-xl border bg-muted object-contain"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={statusTone(detail.asset.status)}>
                      {detail.asset.status}
                    </Badge>
                    <Badge variant="outline">
                      {formattedDate(detail.asset.capturedAt)}
                    </Badge>
                    <Badge variant="outline">
                      {detail.asset.location ? "GPS available" : "No GPS"}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    {PROCESSABLE_STATES.has(detail.asset.status) && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectionMode("explicit");
                          setSelectedIds((current) =>
                            new Set(current).add(idOf(detail.asset._id))
                          );
                          setPreview(undefined);
                          closeAsset();
                        }}
                      >
                        Select this photo
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label="Previous loaded photo"
                      disabled={selectedIndex <= 0}
                      onClick={() =>
                        openAsset(idOf(assets[selectedIndex - 1]?._id))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label="Next loaded photo"
                      disabled={selectedIndex < 0 ||
                        selectedIndex >= assets.length - 1}
                      onClick={() =>
                        openAsset(idOf(assets[selectedIndex + 1]?._id))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {selectRequested && detailEligibility && (
                  <section
                    className={cn(
                      "space-y-3 rounded-xl border p-4",
                      detailEligibility.eligible
                        ? "border-primary/40 bg-primary/5"
                        : "border-amber-500/40 bg-amber-500/5",
                    )}
                    aria-label="Single photo description request"
                  >
                    <div className="flex items-start gap-3">
                      {detailEligibility.eligible
                        ? <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
                        : (
                          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                        )}
                      <div className="space-y-1">
                        <div className="font-semibold">
                          {detailEligibility.title}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {detailEligibility.description}
                        </p>
                      </div>
                    </div>
                    {detailEligibility.eligible && (
                      <div className="space-y-2">
                        <Button
                          className="w-full sm:w-auto"
                          disabled={!profileId}
                          onClick={continueToBatchReview}
                        >
                          <Sparkles className="mr-2 h-4 w-4" />
                          Continue to Review analysis batch (1)
                        </Button>
                        {!profileId && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            Enable an analysis provider in Settings before
                            preparing the local review.
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                )}
                {detail.visual?.visualUnderstanding && (
                  <section className="space-y-3 rounded-xl border p-4">
                    <div className="font-semibold">AI analysis</div>
                    <div className="text-lg font-medium">
                      {detail.visual.visualUnderstanding.shortCaption}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {detail.visual.visualUnderstanding.description}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(detail.visual.visualUnderstanding.keywords ?? []).map(
                        (keyword: string) => (
                          <Badge key={keyword} variant="secondary">
                            {keyword}
                          </Badge>
                        ),
                      )}
                    </div>
                  </section>
                )}
                {detail.pages?.length > 0 && (
                  <section className="space-y-3 rounded-xl border p-4">
                    <div className="font-semibold">OCR text</div>
                    {detail.pages.map((page: any) => (
                      <div
                        key={idOf(page._id)}
                        className="rounded bg-muted p-3"
                      >
                        <div className="mb-2 text-xs text-muted-foreground">
                          Page {page.pageNumber}
                        </div>
                        <div className="whitespace-pre-wrap text-sm">
                          {page.text || "No text detected"}
                        </div>
                      </div>
                    ))}
                  </section>
                )}
                <details className="rounded-xl border p-4">
                  <summary className="cursor-pointer font-medium">
                    Local metadata and provenance
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify({
                      metadata: detail.asset.metadata ?? {},
                      runs: detail.runs ?? [],
                    }, null, 2)}
                  </pre>
                </details>
              </div>
            )
            : (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Photo details are unavailable.
              </div>
            )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
