import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Clock3,
  Eye,
  FileImage,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient, callResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthenticatedMediaImage } from "@/components/media/AuthenticatedMediaImage";
import { LazyAuthenticatedMediaImage } from "@/components/media/LazyAuthenticatedMediaImage";
import { MediaEventsPanel } from "@/components/media/MediaEventsPanel";
import { MediaBatchPanel } from "@/components/media/MediaBatchPanel";
import { MediaSectionNav } from "@/components/media/MediaSectionNav";

const MAX_MANAGED_UPLOAD_FILES = 50;
const MAX_MANAGED_UPLOAD_TOTAL_BYTES = 48_000_000;
const DESCRIPTION_REQUESTABLE_STATUSES = new Set([
  "staged",
  "failed",
  "budget_blocked",
  "recognition_disabled",
]);

type InventoryFilter =
  | "all"
  | "unprocessed"
  | "processing"
  | "ready"
  | "errors";

type BoundOriginalDeletionPreview = {
  assetId: string;
  preview: any;
};

type OriginalDeletionOperation = {
  assetId: string;
  generation: number;
  action: "prepare" | "confirm" | "cancel";
};

function mediaMetadataSummary(asset: any) {
  const metadata = asset?.metadata ?? {};
  const exif = metadata.exif ?? {};
  const stream = Array.isArray(metadata.streams)
    ? metadata.streams[0] ?? {}
    : {};
  const make = String(exif.Make ?? "").trim();
  const model = String(exif.Model ?? "").trim();
  const camera =
    model && make && model.toLowerCase().startsWith(make.toLowerCase())
      ? model
      : [make, model].filter(Boolean).join(" ") || "—";
  const width = Number(
    asset?.preview?.width ?? stream.width ?? exif.ImageWidth,
  );
  const height = Number(
    asset?.preview?.height ?? stream.height ?? exif.ImageHeight,
  );
  return {
    camera,
    dimensions: width > 0 && height > 0 ? `${width} × ${height}` : "—",
    captured: asset?.capturedAt
      ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date(asset.capturedAt))
      : "No reliable capture time",
    location: asset?.location
      ? `${Number(asset.location.latitude).toFixed(5)}, ${
        Number(asset.location.longitude).toFixed(5)
      }`
      : "—",
  };
}

function MediaPlacementEditor({
  asset,
  onSaved,
}: {
  asset: any;
  onSaved: () => Promise<void>;
}) {
  const [capturedAt, setCapturedAt] = useState(
    asset.capturedAt
      ? new Date(asset.capturedAt).toISOString().slice(0, 16)
      : "",
  );
  const [timeZone, setTimeZone] = useState(asset.capturedAtTimeZone ?? "");
  const [latitude, setLatitude] = useState(
    asset.location?.latitude != null ? String(asset.location.latitude) : "",
  );
  const [longitude, setLongitude] = useState(
    asset.location?.longitude != null ? String(asset.location.longitude) : "",
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const hasLat = latitude.trim() !== "";
    const hasLng = longitude.trim() !== "";
    if (hasLat !== hasLng) {
      toast.error("Enter both latitude and longitude, or leave both empty");
      return;
    }
    setSaving(true);
    try {
      await callResource("media-library", {
        action: "updatePlacement",
        assetId: String(asset._id),
        expectedRevision: Number(asset.placementRevision ?? 0),
        capturedAt: capturedAt
          ? new Date(`${capturedAt}:00Z`).toISOString()
          : null,
        timeZone: timeZone.trim() || null,
        location: hasLat && hasLng
          ? { latitude: Number(latitude), longitude: Number(longitude) }
          : null,
      });
      toast.success("Photo time and location saved locally with audit history");
      await onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Placement update failed",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <div className="font-medium">Manual Timeline / Map placement</div>
        <p className="text-xs text-muted-foreground">
          Local edit only; Google is not called. Time is entered as a UTC
          instant.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor={`captured-${asset._id}`}>Capture time (UTC)</Label>
          <Input
            id={`captured-${asset._id}`}
            type="datetime-local"
            value={capturedAt}
            onChange={(event) => setCapturedAt(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`timezone-${asset._id}`}>Timezone / offset</Label>
          <Input
            id={`timezone-${asset._id}`}
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            placeholder="+04:00 or Asia/Yerevan"
          />
        </div>
        <div>
          <Label htmlFor={`latitude-${asset._id}`}>Latitude</Label>
          <Input
            id={`latitude-${asset._id}`}
            inputMode="decimal"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`longitude-${asset._id}`}>Longitude</Label>
          <Input
            id={`longitude-${asset._id}`}
            inputMode="decimal"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
          />
        </div>
      </div>
      <Button onClick={save} disabled={saving} variant="outline">
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save local placement
      </Button>
    </div>
  );
}

export default function MediaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<any>();
  const [assets, setAssets] = useState<any[]>([]);
  const [assetTotal, setAssetTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string>();
  const [placementFilter, setPlacementFilter] = useState<
    "all" | "missing_time" | "missing_location"
  >((searchParams.get("placement") as any) ?? "all");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>(
    "all",
  );
  const [selectedEventAssetIds, setSelectedEventAssetIds] = useState<string[]>(
    [],
  );
  const [preview, setPreview] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryRefreshing, setInventoryRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>();
  const [detailReloadVersion, setDetailReloadVersion] = useState(0);
  const [deletionPreview, setDeletionPreview] = useState<
    BoundOriginalDeletionPreview | undefined
  >();
  const [originalDeletionOperation, setOriginalDeletionOperation] = useState<
    OriginalDeletionOperation | undefined
  >();
  const [
    releasingOriginalDeletionAssetIds,
    setReleasingOriginalDeletionAssetIds,
  ] = useState<Set<string>>(() => new Set());
  const [storagePanelOpen, setStoragePanelOpen] = useState(false);
  const inventoryRequestGeneration = useRef(0);
  const inventoryRequestActive = useRef(false);
  const nextCursorRef = useRef<string | undefined>(undefined);
  const loadedAssetCountRef = useRef(0);
  const selectedAssetIdRef = useRef("");
  const originalDeletionRequestGeneration = useRef(0);
  const deletionPreviewRef = useRef<
    BoundOriginalDeletionPreview | undefined
  >(undefined);
  const originalDeletionReleasePromises = useRef(
    new Map<string, Promise<boolean>>(),
  );

  const load = useCallback(async (
    options: { append?: boolean; silent?: boolean } = {},
  ) => {
    if (options.silent && inventoryRequestActive.current) return;
    const generation = ++inventoryRequestGeneration.current;
    const cursor = options.append ? nextCursorRef.current : undefined;
    if (options.append && !cursor) return;
    inventoryRequestActive.current = true;
    if (!options.silent) setInventoryLoading(true);
    setInventoryRefreshing(true);
    try {
      const backendFilter = inventoryFilter === "errors"
        ? "needs_attention"
        : inventoryFilter;
      const loadAssetPage = (pageCursor?: string, limit = 100) =>
        callResource("media", {
          action: "listAssets",
          limit,
          inventoryFilter: backendFilter,
          placement: placementFilter,
          ...(pageCursor ? { cursor: pageCursor } : {}),
        });
      const loadRefreshedPrefix = async () => {
        const target = loadedAssetCountRef.current > 0
          ? loadedAssetCountRef.current
          : 100;
        const refreshed: any[] = [];
        let refreshCursor: string | undefined;
        let total = 0;
        do {
          const page = await loadAssetPage(
            refreshCursor,
            Math.min(500, Math.max(1, target - refreshed.length)),
          );
          refreshed.push(...(page.assets ?? []));
          total = Number(page.total ?? total);
          refreshCursor = page.nextCursor ? String(page.nextCursor) : undefined;
        } while (refreshCursor && refreshed.length < target);
        return { assets: refreshed, total, nextCursor: refreshCursor };
      };
      const [nextStatus, nextAssets] = await Promise.all([
        callResource("media", { action: "status" }),
        options.silent ? loadRefreshedPrefix() : loadAssetPage(cursor),
      ]);
      if (generation !== inventoryRequestGeneration.current) return;
      setStatus(nextStatus);
      if (options.append) {
        loadedAssetCountRef.current += (nextAssets.assets ?? []).length;
      } else {
        loadedAssetCountRef.current = (nextAssets.assets ?? []).length;
      }
      setAssets((current) => {
        if (!options.append) {
          return nextAssets.assets ?? [];
        }
        const byId = new Map(
          [...current, ...(nextAssets.assets ?? [])].map((asset: any) => [
            String(asset._id),
            asset,
          ]),
        );
        const merged = [...byId.values()];
        return merged;
      });
      nextCursorRef.current = nextAssets.nextCursor;
      setNextCursor(nextAssets.nextCursor);
      setAssetTotal(Number(nextAssets.total ?? nextAssets.assets?.length ?? 0));
      setLastUpdatedAt(new Date());
    } catch (error) {
      if (generation !== inventoryRequestGeneration.current) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to load Media Library",
      );
    } finally {
      if (generation === inventoryRequestGeneration.current) {
        inventoryRequestActive.current = false;
        setInventoryLoading(false);
        setInventoryRefreshing(false);
      }
    }
  }, [inventoryFilter, placementFilter]);

  useEffect(() => {
    nextCursorRef.current = undefined;
    loadedAssetCountRef.current = 0;
    setNextCursor(undefined);
    setSelectedEventAssetIds([]);
    void load();
  }, [load]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (globalThis.document?.visibilityState === "visible") {
        void load({ silent: true });
      }
    };
    const timer = globalThis.setInterval(refreshWhenVisible, 5_000);
    globalThis.document?.addEventListener(
      "visibilitychange",
      refreshWhenVisible,
    );
    return () => {
      globalThis.clearInterval(timer);
      globalThis.document?.removeEventListener(
        "visibilitychange",
        refreshWhenVisible,
      );
    };
  }, [load]);

  const searchProfile = useMemo(
    () =>
      status?.enabled
        ? status?.profiles?.find((entry: any) =>
          entry.id === status.activeProfileId && entry.enabled
        )
        : undefined,
    [status],
  );
  const filteredAssets = assets;
  const selectedAssetId = searchParams.get("assetId") ?? "";
  selectedAssetIdRef.current = selectedAssetId;
  deletionPreviewRef.current = deletionPreview;
  const currentDeletionPreview = deletionPreview?.assetId === selectedAssetId
    ? deletionPreview.preview
    : undefined;
  const currentOriginalDeletionBusy =
    originalDeletionOperation?.assetId === selectedAssetId;
  const currentOriginalDeletionReleasePending =
    releasingOriginalDeletionAssetIds.has(selectedAssetId);
  const storageActionsBusy = busy || currentOriginalDeletionBusy ||
    currentOriginalDeletionReleasePending;
  const recognitionRuns = Array.isArray(detail?.runs) ? detail.runs : [];
  const activeRecognitionRun = detail?.asset?.currentRunId
    ? recognitionRuns.find((run: any) =>
      String(run._id) === String(detail.asset.currentRunId)
    )
    : undefined;
  const latestRecognitionRun = recognitionRuns[0];
  const displayedRecognitionRun = activeRecognitionRun ??
    latestRecognitionRun;
  const displayedProviderType =
    displayedRecognitionRun?.providerSnapshot?.providerType ??
      displayedRecognitionRun?.provenance?.providerType;
  const displayedProviderName =
    displayedRecognitionRun?.providerSnapshot?.name ??
      (displayedProviderType === "google-cloud"
        ? "Google Cloud"
        : displayedProviderType === "self-hosted"
        ? "Self-hosted provider"
        : "Unknown provider");
  const recognitionReservation = detail?.recognitionReservation;
  const reservationState = String(
    recognitionReservation?.state ??
      recognitionReservation?.reservationState ??
      "",
  );
  const reservationItemState = String(
    recognitionReservation?.itemState ??
      recognitionReservation?.item?.state ??
      "",
  );
  const reservationBatchStatus = String(
    recognitionReservation?.batchStatus ??
      recognitionReservation?.batch?.status ??
      "",
  );
  const storageMutationLocked = Boolean(
    recognitionReservation &&
      recognitionReservation.active !== false &&
      (
        recognitionReservation.active === true ||
        ["preparing", "active"].includes(reservationState) ||
        ["pending", "claiming", "queued", "processing"].includes(
          reservationItemState,
        ) ||
        ["queued", "running", "cancelling"].includes(
          reservationBatchStatus,
        ) ||
        (!reservationState && !reservationItemState &&
          !reservationBatchStatus)
      ),
  ) || ["queued", "processing"].includes(String(detail?.asset?.status ?? ""));

  const analyzeUploads = async (files: File[]) => {
    if (files.length === 0 || busy || Boolean(preview)) return;
    if (files.length > MAX_MANAGED_UPLOAD_FILES) {
      toast.error(`Choose at most ${MAX_MANAGED_UPLOAD_FILES} files at once`);
      return;
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_MANAGED_UPLOAD_TOTAL_BYTES) {
      toast.error("The selected upload exceeds the 48 MB request limit");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const result = await apiClient.postForm<any>(
        "/api/media/imports/analyze",
        form,
      );
      setPreview(result);
      toast.success(
        `Prepared ${result.items.length} upload(s); originals are staged until confirmation`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Upload analysis failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await callResource("media", {
        action: "confirmImport",
        importId: String(preview.importId),
        consent: true,
        queueRecognition: false,
      });
      const createdCount = result.created?.length ?? 0;
      const recoveredCount = result.recovered?.length ?? 0;
      const confirmedCount = createdCount + recoveredCount;
      const recoveryCopy = recoveredCount
        ? `; restored ${recoveredCount} original(s)`
        : "";
      toast.success(
        `Imported ${confirmedCount} media item(s) locally${recoveryCopy}`,
      );
      setPreview(undefined);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Import confirmation failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const result = await callResource("media", {
        action: "search",
        query,
        limit: 30,
      });
      setResults(result.results ?? []);
      if (result.semanticWarning) toast.warning(result.semanticWarning);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Media search failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const releaseOriginalDeletionPreview = useCallback(
    async (boundPreview: BoundOriginalDeletionPreview): Promise<boolean> => {
      const assetId = boundPreview.assetId;
      const deletionPreviewId = String(
        boundPreview.preview?.deletionPreviewId ?? "",
      );
      if (!deletionPreviewId) return true;
      const releaseKey = `${assetId}:${deletionPreviewId}`;
      const existing = originalDeletionReleasePromises.current.get(
        releaseKey,
      );
      if (existing) return await existing;

      setReleasingOriginalDeletionAssetIds((current) => {
        const next = new Set(current);
        next.add(assetId);
        return next;
      });
      const release = (async () => {
        try {
          await callResource("media", {
            action: "cancelOriginalDeletionPreview",
            deletionPreviewId,
          });
          if (
            deletionPreviewRef.current?.assetId === assetId &&
            String(
                deletionPreviewRef.current.preview?.deletionPreviewId,
              ) === deletionPreviewId
          ) {
            deletionPreviewRef.current = undefined;
          }
          setDeletionPreview((current) =>
            current?.assetId === assetId &&
              String(current.preview?.deletionPreviewId) === deletionPreviewId
              ? undefined
              : current
          );
          return true;
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : "Failed to release the original deletion review";
          toast.error(
            `${message}. The reservation is bounded and will expire automatically within 10 minutes.`,
          );
          return false;
        } finally {
          originalDeletionReleasePromises.current.delete(releaseKey);
          setReleasingOriginalDeletionAssetIds((current) => {
            const stillReleasing = [...originalDeletionReleasePromises.current
              .keys()].some((key) => key.startsWith(`${assetId}:`));
            if (stillReleasing) return current;
            const next = new Set(current);
            next.delete(assetId);
            return next;
          });
        }
      })();
      originalDeletionReleasePromises.current.set(releaseKey, release);
      return await release;
    },
    [],
  );

  const openAsset = (assetId: string) => {
    if (selectedAssetIdRef.current !== assetId) {
      const currentPreview = deletionPreviewRef.current;
      if (currentPreview) void releaseOriginalDeletionPreview(currentPreview);
      originalDeletionRequestGeneration.current += 1;
      selectedAssetIdRef.current = assetId;
      setDeletionPreview(undefined);
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("assetId", assetId);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    return () => {
      const currentPreview = deletionPreviewRef.current;
      if (currentPreview?.assetId === selectedAssetId) {
        void releaseOriginalDeletionPreview(currentPreview);
      }
    };
  }, [releaseOriginalDeletionPreview, selectedAssetId]);

  useEffect(() => {
    const currentPreview = deletionPreviewRef.current;
    if (currentPreview) void releaseOriginalDeletionPreview(currentPreview);
    originalDeletionRequestGeneration.current += 1;
    setDeletionPreview(undefined);
    if (!selectedAssetId) {
      setDetail(undefined);
      return;
    }
    let current = true;
    setDetail((existing: any) =>
      String(existing?.asset?._id ?? "") === selectedAssetId
        ? existing
        : undefined
    );
    callResource("media", {
      action: "getAsset",
      assetId: selectedAssetId,
    }).then((result) => {
      if (current) setDetail(result);
    }).catch((error) => {
      if (current) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load media asset",
        );
      }
    });
    return () => {
      current = false;
    };
  }, [detailReloadVersion, releaseOriginalDeletionPreview, selectedAssetId]);

  useEffect(() => {
    setStoragePanelOpen(false);
  }, [selectedAssetId]);

  const closeAsset = useCallback(() => {
    const currentPreview = deletionPreviewRef.current;
    if (currentPreview) void releaseOriginalDeletionPreview(currentPreview);
    originalDeletionRequestGeneration.current += 1;
    selectedAssetIdRef.current = "";
    setDeletionPreview(undefined);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("assetId");
      return next;
    }, { replace: true });
  }, [releaseOriginalDeletionPreview, setSearchParams]);

  const deleteDerived = async (
    target: "previews" | "analysis" | "source_reference",
  ) => {
    if (!selectedAssetId) return;
    if (currentOriginalDeletionBusy) {
      toast.error("Another storage change is already in progress");
      return;
    }
    if (storageMutationLocked) {
      toast.error(
        "Storage changes are locked while this asset belongs to an active recognition batch",
      );
      return;
    }
    const confirmation = target === "previews"
      ? "Delete the Mycelia WebP previews? The original will not be touched. This asset will no longer have a viewable photo preview or be eligible for photo analysis."
      : target === "analysis"
      ? "Reset the derived visual/OCR analysis? The original and Mycelia previews will be retained."
      : "Forget the mounted original reference? The mounted file will not be deleted. Mycelia previews will be retained, but this asset cannot be reanalyzed.";
    if (!globalThis.confirm(confirmation)) return;
    setBusy(true);
    try {
      await callResource("media", {
        action: "deleteDerived",
        assetId: selectedAssetId,
        target,
        confirm: true,
      });
      toast.success(
        target === "source_reference"
          ? "Forgot the mounted reference; the original file was not touched"
          : target === "previews"
          ? "Deleted Mycelia previews; the original file and reference were not touched"
          : "Reset derived analysis; the original and previews were not touched",
      );
      await load();
      setDetailReloadVersion((current) => current + 1);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The requested storage change failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const prepareOriginalDeletion = async () => {
    if (!selectedAssetId) return;
    if (currentOriginalDeletionBusy) return;
    if (
      [...originalDeletionReleasePromises.current.keys()].some((key) =>
        key.startsWith(`${selectedAssetId}:`)
      )
    ) {
      toast.error("The previous deletion review is still being released");
      return;
    }
    if (storageMutationLocked) {
      toast.error(
        "Storage changes are locked while this asset belongs to an active recognition batch",
      );
      return;
    }
    const assetId = selectedAssetId;
    const generation = ++originalDeletionRequestGeneration.current;
    setDeletionPreview(undefined);
    setOriginalDeletionOperation({ assetId, generation, action: "prepare" });
    try {
      const result = await callResource("media", {
        action: "previewOriginalDeletion",
        assetId,
      });
      const boundPreview = { assetId, preview: result };
      if (
        generation !== originalDeletionRequestGeneration.current ||
        selectedAssetIdRef.current !== assetId
      ) {
        await releaseOriginalDeletionPreview(boundPreview);
        return;
      }
      if (result.assetId && String(result.assetId) !== assetId) {
        await releaseOriginalDeletionPreview(boundPreview);
        throw new Error(
          "Original deletion preview did not match the selected asset",
        );
      }
      setDeletionPreview(boundPreview);
      if (!result.canDelete) {
        toast.error(
          result.blockers?.join("; ") ?? "Original cannot be deleted",
        );
      }
    } catch (error) {
      if (
        generation !== originalDeletionRequestGeneration.current ||
        selectedAssetIdRef.current !== assetId
      ) return;
      toast.error(
        error instanceof Error ? error.message : "Deletion preview failed",
      );
    } finally {
      setOriginalDeletionOperation((current) =>
        current?.generation === generation ? undefined : current
      );
    }
  };

  const confirmOriginalDeletion = async () => {
    const boundPreview = deletionPreview;
    if (
      !boundPreview?.preview?.canDelete ||
      boundPreview.assetId !== selectedAssetId ||
      selectedAssetIdRef.current !== boundPreview.assetId
    ) return;
    if (storageMutationLocked) {
      toast.error(
        "Storage changes are locked while this asset belongs to an active recognition batch",
      );
      return;
    }
    const assetId = boundPreview.assetId;
    const deletionPreviewId = String(
      boundPreview.preview.deletionPreviewId,
    );
    const generation = ++originalDeletionRequestGeneration.current;
    setOriginalDeletionOperation({ assetId, generation, action: "confirm" });
    try {
      await callResource("media", {
        action: "confirmOriginalDeletion",
        deletionPreviewId,
        confirm: true,
      });
      toast.success(
        "Managed original deleted; preview, metadata, analysis, and search data were retained",
      );
      if (
        deletionPreviewRef.current?.assetId === assetId &&
        String(deletionPreviewRef.current.preview?.deletionPreviewId) ===
          deletionPreviewId
      ) {
        deletionPreviewRef.current = undefined;
      }
      setDeletionPreview((current) =>
        current?.assetId === assetId &&
          String(current.preview?.deletionPreviewId) === deletionPreviewId
          ? undefined
          : current
      );
      await load();
      if (selectedAssetIdRef.current === assetId) {
        setDetailReloadVersion((current) => current + 1);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Original deletion failed",
      );
    } finally {
      setOriginalDeletionOperation((current) =>
        current?.generation === generation ? undefined : current
      );
    }
  };

  const cancelOriginalDeletionPreview = async () => {
    const boundPreview = deletionPreview;
    if (
      !boundPreview?.preview?.deletionPreviewId ||
      boundPreview.assetId !== selectedAssetId ||
      selectedAssetIdRef.current !== boundPreview.assetId
    ) return;
    const assetId = boundPreview.assetId;
    const generation = ++originalDeletionRequestGeneration.current;
    setOriginalDeletionOperation({ assetId, generation, action: "cancel" });
    try {
      if (await releaseOriginalDeletionPreview(boundPreview)) {
        toast.success("Managed original deletion review cancelled");
      }
    } finally {
      setOriginalDeletionOperation((current) =>
        current?.generation === generation ? undefined : current
      );
    }
  };

  const detailIsPhoto = detail?.asset?.kind === "image";
  const detailHasRecognitionSource =
    (detail?.asset?.storageMode === "managed_original" &&
      Boolean(detail.asset.managedOriginal?.fileId)) ||
    (detail?.asset?.storageMode === "external_reference" &&
      Boolean(detail.asset.source?.relativePath));
  const detailCanRequestDescription = detailIsPhoto &&
    detailHasRecognitionSource &&
    !detail?.visual?.visualUnderstanding &&
    DESCRIPTION_REQUESTABLE_STATUSES.has(detail.asset.status);
  const detailStorageDescription = detail?.asset?.storageMode ===
      "external_reference"
    ? detail.asset.source?.relativePath ?? "mounted original"
    : detail?.asset?.storageMode === "managed_original"
    ? "Mycelia-managed original"
    : "no retained original";
  const detailAnalysisHref = detail?.asset
    ? `/media/analysis?assetId=${detail.asset._id}${
      detailCanRequestDescription ? "&select=1" : ""
    }`
    : "";

  return (
    <div className="container mx-auto space-y-6 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <FileImage /> Media Library
          </h1>
          <p className="text-muted-foreground">
            Local originals by reference; compact previews, visual meaning,
            semantic search, metadata, and provider provenance in Mycelia.
          </p>
        </div>
        <Button
          className="self-start sm:self-auto"
          variant="outline"
          onClick={() => void load()}
        >
          <RefreshCw className="mr-2 h-4 w-4" />Refresh
        </Button>
      </div>

      <MediaSectionNav />

      {!status?.enabled && (
        <Card className="border-amber-500/50">
          <CardContent className="p-4">
            Recognition is disabled. Local managed uploads, previews, EXIF/GPS,
            deduplication, and metadata-only imports remain available. Enable a
            provider in Settings → Google Cloud only when you want recognition.
          </CardContent>
        </Card>
      )}

      <MediaBatchPanel
        status={status}
        onInventoryChanged={() => load({ silent: true })}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Upload from this computer</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Import locally first, then choose what to process on the Analysis
              page.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            aria-disabled={busy || Boolean(preview)}
            className={`rounded-md border-2 border-dashed p-6 text-center ${
              busy || Boolean(preview) ? "cursor-not-allowed opacity-60" : ""
            }`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (busy || Boolean(preview)) return;
              void analyzeUploads(Array.from(event.dataTransfer.files));
            }}
          >
            <Upload className="mx-auto mb-2 h-6 w-6" />
            <div className="font-medium">Drop photos or PDFs here</div>
            <p className="mb-3 text-sm text-muted-foreground">
              JPEG, PNG, WebP, or PDF. Mycelia checks the real file type,
              deduplicates by SHA-256, and creates metadata-free WebP previews.
              Up to 50 files and 48 MB total; 20 MB per image, 32 MB per PDF,
              and 15 pages per PDF.
            </p>
            <label>
              <span className="inline-flex h-10 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                Choose files
              </span>
              <input
                className="sr-only"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={busy || Boolean(preview)}
                onChange={(event) => {
                  void analyzeUploads(Array.from(event.target.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>Review local import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge>Local only</Badge>
              <Badge variant="outline">
                {preview.storageMode === "managed_original"
                  ? "Managed original"
                  : "External reference"}
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {preview.items.map((item: any) => (
                <div
                  key={`${item.sha256 ?? item.fileName}-${
                    item.relativePath ?? "upload"
                  }`}
                  className="overflow-hidden rounded-md border"
                >
                  <AuthenticatedMediaImage
                    path={item.thumbnailUrl}
                    alt={item.fileName ?? item.relativePath}
                    className="h-36 w-full object-cover"
                  />
                  <div className="space-y-1 p-3 text-sm">
                    <div className="truncate font-medium">
                      {item.fileName ?? item.relativePath}
                    </div>
                    {item.error
                      ? <div className="text-destructive">{item.error}</div>
                      : (
                        <>
                          <div>
                            {item.kind} ·{" "}
                            {(item.byteLength / 1_000_000).toFixed(1)} MB
                          </div>
                          <div>
                            {item.pageCount}{" "}
                            unit(s) · ${Number(item.estimatedGrossUsd).toFixed(
                              4,
                            )}
                          </div>
                          {item.duplicateAssetId && (
                            <Badge variant="secondary">Duplicate</Badge>
                          )}
                        </>
                      )}
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-md bg-muted p-3 text-sm">
              <ShieldCheck className="mr-2 inline h-4 w-4" />
              {preview.storageMode === "managed_original"
                ? "Upload analysis writes originals into staging in the separate media_originals store. An untouched preview expires after one hour; confirmation makes files canonical, and an interrupted confirmation has a bounded seven-day recovery lease. You can later delete each original through a second preview-and-confirm step while retaining WebP previews, metadata, analysis, and search data."
                : "Confirmation stores checked external references and compact previews. The referenced source files are never copied or deleted."}
              {" "}
              No recognition provider is called by this import. Use Photo
              Analysis after the files appear in the library.
            </div>
            <Button onClick={confirm} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm local import
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Semantic photo search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {searchProfile
              ? searchProfile.providerType === "google-cloud"
                ? `The search text is sent to the active provider ${searchProfile.name} only when you run a search and you have owned semantic media. Mycelia reserves at most $0.0004 gross list price per query.`
                : `The search text is sent to the active provider ${searchProfile.name} only when you run a search and you have owned semantic media; it stays on your self-hosted endpoint.`
              : "No enabled active recognition provider is configured, so search uses only stored OCR text and labels."}
          </p>
          <div className="flex gap-2">
            <Input
              aria-label="Semantic photo search"
              value={query}
              maxLength={512}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && search()}
              placeholder="Фотографии с людьми у моря…"
            />
            <Button aria-label="Search media" onClick={search}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
          {results.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {results.map((result, index) => (
                <button
                  type="button"
                  key={`${result.assetId}-${index}`}
                  className="flex w-full gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openAsset(String(result.assetId))}
                  aria-label={`Open ${result.fileName}`}
                >
                  <AuthenticatedMediaImage
                    path={result.thumbnailUrl}
                    alt={result.fileName}
                    className="h-20 w-20 rounded object-cover"
                  />
                  <div>
                    <div className="font-medium">{result.fileName}</div>
                    <div className="text-sm text-muted-foreground">
                      {result.shortCaption ?? result.snippet ?? result.label}
                    </div>
                    {result.type === "semantic" && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Similarity {Math.round(
                          Number(result.semanticScore ?? 0) * 100,
                        )}%
                      </div>
                    )}
                    {result.pageNumber && (
                      <Badge variant="outline">Page {result.pageNumber}</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card id="media-inventory">
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Photo library</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Showing {assets.length} of {assetTotal} imported item(s).
            </p>
          </div>
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {inventoryRefreshing && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {inventoryLoading
              ? "Updating library…"
              : lastUpdatedAt
              ? `Updated ${lastUpdatedAt.toLocaleTimeString()}`
              : "Ready"}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">
                Individual photos also appear on the Photos track and Photos map
                layer when they have reliable EXIF time/GPS. Photo events remain
                separate explicitly published Objects on the{" "}
                <a className="underline" href="/timeline">
                  Timeline
                </a>.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "All"],
                ["unprocessed", "Unprocessed"],
                ["processing", "Queued / processing"],
                ["ready", "Ready"],
                ["errors", "Needs attention"],
              ] as Array<[InventoryFilter, string]>).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={inventoryFilter === value ? "default" : "outline"}
                  aria-pressed={inventoryFilter === value}
                  onClick={() => setInventoryFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              ["all", "All placement"],
              ["missing_time", "Missing time"],
              ["missing_location", "Missing location"],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={placementFilter === value ? "default" : "outline"}
                aria-pressed={placementFilter === value}
                onClick={() => {
                  setPlacementFilter(value);
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    if (value === "all") next.delete("placement");
                    else next.set("placement", value);
                    return next;
                  }, { replace: true });
                }}
              >
                {label}
              </Button>
            ))}
          </div>

          {selectedEventAssetIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <span className="text-sm font-medium">
                {selectedEventAssetIds.length}{" "}
                photo(s) selected for event grouping
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedEventAssetIds([])}
              >
                Clear selection
              </Button>
            </div>
          )}

          {inventoryLoading && filteredAssets.length === 0
            ? (
              <div
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                aria-label="Loading media"
              >
                {Array.from(
                  { length: 8 },
                  (_, index) => (
                    <div
                      key={index}
                      className="overflow-hidden rounded-xl border"
                    >
                      <Skeleton className="aspect-[4/3] w-full rounded-none" />
                      <div className="space-y-2 p-4">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ),
                )}
              </div>
            )
            : filteredAssets.length === 0
            ? (
              <div className="rounded-xl border border-dashed py-14 text-center text-sm text-muted-foreground">
                No media matches these filters.
              </div>
            )
            : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredAssets.map((asset) => {
                  const id = String(asset._id);
                  const metadata = mediaMetadataSummary(asset);
                  const selectedForEvent = selectedEventAssetIds.includes(id);
                  return (
                    <article
                      key={id}
                      className={`group relative overflow-hidden rounded-xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                        selectedForEvent ? "ring-2 ring-primary" : ""
                      }`}
                    >
                      {asset.kind === "image" && (
                        <label
                          htmlFor={`event-select-${id}`}
                          className="absolute left-2 top-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            id={`event-select-${id}`}
                            aria-label={`Select ${asset.fileName} for photo event`}
                            checked={selectedForEvent}
                            onCheckedChange={(checked) =>
                              setSelectedEventAssetIds((current) =>
                                checked
                                  ? [...new Set([...current, id])]
                                  : current.filter((entry) => entry !== id)
                              )}
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => openAsset(id)}
                        aria-label={`Open ${asset.fileName}`}
                      >
                        <LazyAuthenticatedMediaImage
                          path={asset.thumbnailUrl}
                          alt={asset.fileName}
                          containerClassName="aspect-[4/3] overflow-hidden bg-muted"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                        />
                        <div className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {asset.fileName}
                              </div>
                              <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                                {metadata.captured}
                              </div>
                            </div>
                            <Badge
                              variant={asset.status === "ready"
                                ? "default"
                                : asset.safeError
                                ? "destructive"
                                : "secondary"}
                              className="shrink-0"
                            >
                              {asset.status}
                            </Badge>
                          </div>
                          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                            {asset.inventory?.shortCaption ??
                              (asset.safeError
                                ? asset.safeError
                                : "No visual description yet")}
                          </p>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{asset.kind} · {metadata.dimensions}</span>
                            <span className="inline-flex items-center font-medium text-foreground">
                              <Eye className="mr-1 h-3.5 w-3.5" />Details
                            </span>
                          </div>
                        </div>
                      </button>
                    </article>
                  );
                })}
              </div>
            )}

          {nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void load({ append: true })}
                disabled={inventoryRefreshing}
              >
                {inventoryRefreshing && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <MediaEventsPanel
        status={status}
        candidateAssetIds={selectedEventAssetIds.filter((id) =>
          assets.some((asset) =>
            String(asset._id) === id && asset.kind === "image"
          )
        )}
        onOpenAsset={openAsset}
      />

      <Dialog
        open={Boolean(detail?.asset)}
        onOpenChange={(open) => {
          if (!open) closeAsset();
        }}
      >
        {detail?.asset && (
          <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-6xl">
            <DialogHeader className="sticky top-0 z-10 border-b bg-background px-6 py-4 pr-14">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <DialogTitle className="truncate">
                    {detail.asset.fileName}
                  </DialogTitle>
                  <DialogDescription className="truncate">
                    {detail.asset.storageMode} · {detailStorageDescription}
                  </DialogDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeAsset}
                >
                  Close details
                </Button>
              </div>
            </DialogHeader>
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(240px,360px)_1fr]">
                <AuthenticatedMediaImage
                  path={detail.asset.previewUrl ?? detail.asset.thumbnailUrl}
                  alt={detail.asset.fileName}
                  className="max-h-80 w-full rounded-md border object-contain"
                />
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge>{detail.asset.status}</Badge>
                    <Badge variant="outline">{detail.asset.kind}</Badge>
                    <Badge variant="outline">
                      {(Number(detail.asset.byteLength) / 1_000_000).toFixed(2)}
                      {" "}
                      MB
                    </Badge>
                    {detail.asset.pageCount && (
                      <Badge variant="outline">
                        {detail.asset.pageCount} unit(s)
                      </Badge>
                    )}
                  </div>
                  {detail.asset.safeError && (
                    <div className="rounded border border-destructive/40 p-3 text-sm text-destructive">
                      {detail.asset.safeError}
                    </div>
                  )}
                  <div
                    className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"
                    aria-label="Provider analysis status"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">Provider analysis</div>
                      <Badge
                        variant={activeRecognitionRun ? "default" : "outline"}
                      >
                        {activeRecognitionRun
                          ? displayedProviderType === "google-cloud"
                            ? "Google Cloud result"
                            : "Active result"
                          : detail.asset.status === "queued"
                          ? "Queued"
                          : detail.asset.status === "processing"
                          ? "Processing"
                          : latestRecognitionRun
                          ? "Latest attempt: " + latestRecognitionRun.state
                          : "Not processed"}
                      </Badge>
                    </div>
                    {activeRecognitionRun
                      ? (
                        <>
                          <div>
                            Active result from{" "}
                            <span className="font-medium">
                              {displayedProviderName}
                            </span>
                            .
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {activeRecognitionRun.provenance?.service ??
                              "Service not reported"} ·{" "}
                            {activeRecognitionRun.provenance?.location ??
                              "location not reported"}
                            {activeRecognitionRun.provenance?.modelVersion
                              ? " · " +
                                activeRecognitionRun.provenance.modelVersion
                              : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Visual description:{" "}
                            {detail.visual?.visualUnderstanding
                              ? "available"
                              : "not available"} · OCR pages:{" "}
                            {detail.pages?.length ?? 0} · annotations:{" "}
                            {detail.annotations?.length ?? 0}
                          </div>
                        </>
                      )
                      : detail.asset.status === "queued" ||
                          detail.asset.status === "processing"
                      ? (
                        <div>
                          Provider analysis is{" "}
                          {detail.asset.status}. No active result is stored yet.
                        </div>
                      )
                      : latestRecognitionRun
                      ? (
                        <div>
                          No active provider result is attached to this photo.
                          The latest historical attempt used{" "}
                          <span className="font-medium">
                            {displayedProviderName}
                          </span>{" "}
                          and ended as {latestRecognitionRun.state}.
                        </div>
                      )
                      : (
                        <div>
                          No stored Google Cloud or self-hosted analysis run or
                          result exists for this photo. Only the local preview
                          and EXIF/GPS metadata are stored.
                        </div>
                      )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <Link to={detailAnalysisHref}>
                        {detailCanRequestDescription
                          ? <Sparkles className="mr-2 h-4 w-4" />
                          : <Eye className="mr-2 h-4 w-4" />}
                        {!detailIsPhoto
                          ? "Open in Analysis"
                          : detailCanRequestDescription
                          ? "Get description"
                          : "Open in Photo analysis"}
                      </Link>
                    </Button>
                    {detailIsPhoto && (
                      <>
                        <Button asChild variant="outline">
                          <Link to={`/map?photoAssetId=${detail.asset._id}`}>
                            <MapPin className="mr-2 h-4 w-4" />
                            Show on Map
                          </Link>
                        </Button>
                        <Button asChild variant="outline">
                          <Link
                            to={`/timeline?photoAssetId=${detail.asset._id}`}
                          >
                            <Clock3 className="mr-2 h-4 w-4" />
                            Show on Timeline
                          </Link>
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      aria-expanded={storagePanelOpen}
                      aria-controls="media-storage-controls"
                      onClick={() => setStoragePanelOpen((open) => !open)}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Storage & deletion…
                    </Button>
                    {storageMutationLocked && (
                      <Badge variant="secondary">Locked by active batch</Badge>
                    )}
                  </div>
                  {detail.asset.storageMode === "preview_only" && (
                    <div className="rounded border border-amber-500/40 p-3 text-sm">
                      {detail.asset.sourceReferenceForgottenAt &&
                          detail.asset.originalDeletionReceipt
                        ? (
                          <>
                            The Mycelia-managed original was deleted, and the
                            mounted original reference was later forgotten. The
                            mounted file was not deleted. Compact previews,
                            metadata, analysis, and search data remain.
                          </>
                        )
                        : detail.asset.sourceReferenceForgottenAt
                        ? (
                          <>
                            The mounted original reference was forgotten. The
                            mounted file was not deleted. Compact previews,
                            metadata, analysis, and search data remain.
                          </>
                        )
                        : detail.asset.originalDeletionReceipt
                        ? (
                          <>
                            The Mycelia-managed original was permanently
                            deleted. Compact previews, metadata, analysis, and
                            search data remain.
                          </>
                        )
                        : (
                          <>
                            No original is retained or referenced by Mycelia.
                            Compact previews, metadata, analysis, and search
                            data may still remain.
                          </>
                        )}
                    </div>
                  )}
                  {storagePanelOpen && (
                    <div
                      id="media-storage-controls"
                      aria-label="Storage and deletion controls"
                      className="space-y-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
                    >
                      <div>
                        <div className="font-semibold">Storage & deletion</div>
                        <p className="mt-1 text-muted-foreground">
                          These controls do not remove the Media Library record.
                          Each action changes one retained layer only.
                        </p>
                      </div>
                      {storageMutationLocked && (
                        <div
                          role="status"
                          className="rounded-md border border-primary/40 bg-primary/5 p-3"
                        >
                          <div className="font-medium">
                            Storage changes are temporarily locked
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            This asset is reserved, queued, or processing in an
                            active recognition batch. Storage cannot change
                            until the item finishes or new provider calls are
                            stopped.
                            {(reservationBatchStatus || reservationItemState ||
                              reservationState) && (
                              <>
                                {" "}Current state: {[
                                  reservationBatchStatus,
                                  reservationItemState || reservationState,
                                ].filter(Boolean).join(" · ")}.
                              </>
                            )}
                          </p>
                          <Link
                            className="mt-2 inline-flex font-medium text-primary underline-offset-4 hover:underline"
                            to="/media/analysis"
                          >
                            View active batch and stop new calls
                          </Link>
                        </div>
                      )}

                      {detail.asset.storageMode === "external_reference" && (
                        <div className="space-y-2 rounded-md border bg-background p-3">
                          <div className="font-medium">Mounted original</div>
                          <p className="text-muted-foreground">
                            Mycelia stores a read-only reference to{" "}
                            <span className="break-all font-medium text-foreground">
                              {detail.asset.source?.relativePath ??
                                "the mounted file"}
                            </span>
                            . The external mounted original is never deleted by
                            this action. Forgetting the reference keeps existing
                            previews, metadata, and results, but prevents this
                            asset from being reanalyzed.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => deleteDerived("source_reference")}
                            disabled={storageActionsBusy ||
                              storageMutationLocked ||
                              !detail.asset.source?.relativePath}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Forget mounted original reference
                          </Button>
                        </div>
                      )}

                      {detail.asset.storageMode === "managed_original" && (
                        <div className="space-y-2 rounded-md border bg-background p-3">
                          <div className="font-medium">
                            Mycelia-managed original
                          </div>
                          <p className="text-muted-foreground">
                            This original is stored inside Mycelia. Deletion
                            remains a separate preview-and-confirm operation and
                            retains WebP previews, metadata, provider results,
                            and search data.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={prepareOriginalDeletion}
                            disabled={storageActionsBusy ||
                              storageMutationLocked}
                          >
                            {currentOriginalDeletionBusy &&
                              originalDeletionOperation?.action ===
                                "prepare" &&
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            <Trash2 className="mr-2 h-4 w-4" />
                            Review managed original deletion
                          </Button>
                        </div>
                      )}

                      <div className="space-y-2 rounded-md border bg-background p-3">
                        <div className="font-medium">Mycelia WebP previews</div>
                        <p className="text-muted-foreground">
                          Deleting previews removes only compact WebP files
                          stored by Mycelia. It never deletes an original or its
                          reference. Without previews, this item cannot be
                          viewed in the gallery{detailIsPhoto
                            ? " or sent for photo analysis"
                            : ""}.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => deleteDerived("previews")}
                          disabled={storageActionsBusy ||
                            storageMutationLocked ||
                            !(detail.asset.previewUrl ||
                              detail.asset.thumbnailUrl)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Mycelia previews
                        </Button>
                      </div>

                      {currentDeletionPreview && (
                        <div className="space-y-3 rounded border border-destructive/50 bg-background p-3">
                          <div className="font-medium">
                            Original deletion preview
                          </div>
                          <div>
                            Original size: {(
                              Number(currentDeletionPreview.byteLength ?? 0) /
                              1_000_000
                            ).toFixed(2)} MB · preview{" "}
                            {currentDeletionPreview.previewReady
                              ? "ready"
                              : "missing"} · analysis{" "}
                            {currentDeletionPreview.analysisReady
                              ? "ready"
                              : "missing"}
                          </div>
                          {currentDeletionPreview.blockers?.length > 0 && (
                            <ul className="list-disc pl-5 text-destructive">
                              {currentDeletionPreview.blockers.map(
                                (blocker: string) => (
                                  <li key={blocker}>{blocker}</li>
                                ),
                              )}
                            </ul>
                          )}
                          {currentDeletionPreview.canDelete && (
                            <>
                              <div>
                                This permanently deletes only the managed
                                original. WebP previews, local metadata,
                                provider results, and search indexes are
                                retained.
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="destructive"
                                  onClick={confirmOriginalDeletion}
                                  disabled={storageActionsBusy ||
                                    storageMutationLocked}
                                >
                                  {currentOriginalDeletionBusy &&
                                    originalDeletionOperation?.action ===
                                      "confirm" &&
                                    (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                  Permanently delete managed original
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={cancelOriginalDeletionPreview}
                                  disabled={storageActionsBusy}
                                >
                                  {currentOriginalDeletionBusy &&
                                    originalDeletionOperation?.action ===
                                      "cancel" &&
                                    (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                  Cancel original deletion review
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      <details className="rounded-md border bg-background p-3">
                        <summary className="cursor-pointer font-medium">
                          Advanced: reset provider analysis
                        </summary>
                        <div className="mt-3 space-y-2">
                          <p className="text-muted-foreground">
                            Resetting analysis removes derived visual/OCR data
                            and marks historical runs deleted. It retains the
                            original, its reference, and Mycelia previews.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => deleteDerived("analysis")}
                            disabled={storageActionsBusy ||
                              storageMutationLocked ||
                              !(detail.runs?.length > 0)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Reset derived analysis
                          </Button>
                        </div>
                      </details>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(mediaMetadataSummary(detail.asset)).map(
                      ([key, value]) => (
                        <div key={key} className="rounded bg-muted p-3 text-sm">
                          <div className="text-xs font-medium uppercase text-muted-foreground">
                            {key}
                          </div>
                          <div className="mt-1 break-words">{value}</div>
                        </div>
                      ),
                    )}
                  </div>
                  <details className="rounded border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Raw local metadata (advanced)
                    </summary>
                    <pre className="mt-3 max-h-56 overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(detail.asset.metadata ?? {}, null, 2)}
                    </pre>
                  </details>
                </div>
              </div>

              <MediaPlacementEditor
                key={`${detail.asset._id}:${
                  detail.asset.placementRevision ?? 0
                }`}
                asset={detail.asset}
                onSaved={async () => {
                  await load();
                  setDetailReloadVersion((current) => current + 1);
                }}
              />

              {detail.visual?.visualUnderstanding && (
                <div className="space-y-4 rounded-md border border-primary/30 p-4">
                  <div>
                    <div className="text-lg font-semibold">
                      {detail.visual.visualUnderstanding.shortCaption}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {detail.visual.visualUnderstanding.description}
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded bg-muted p-3 text-sm">
                      <div className="font-medium">Scene</div>
                      <div>
                        {detail.visual.visualUnderstanding.scene.summary}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {detail.visual.visualUnderstanding.scene.environment} ·
                        {" "}
                        {detail.visual.visualUnderstanding.scene.placeType} ·
                        {" "}
                        {detail.visual.visualUnderstanding.scene.timeOfDay}
                      </div>
                    </div>
                    <div className="rounded bg-muted p-3 text-sm">
                      <div className="font-medium">People</div>
                      <div>
                        Visible count:{" "}
                        {detail.visual.visualUnderstanding.peopleCount}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        No identity inference
                      </div>
                    </div>
                    <div className="rounded bg-muted p-3 text-sm">
                      <div className="font-medium">Possible event</div>
                      <div>
                        {detail.visual.visualUnderstanding.possibleEvent ??
                          "Not confidently identified"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Overall confidence {Math.round(
                          Number(detail.visual.visualUnderstanding.confidence) *
                            100,
                        )}%
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 font-medium">Objects</div>
                    <div className="flex flex-wrap gap-2">
                      {detail.visual.visualUnderstanding.objects.map(
                        (item: any, index: number) => (
                          <Badge
                            key={`${item.name}-${index}`}
                            variant="secondary"
                          >
                            {item.name}
                            {item.count ? ` ×${item.count}` : ""}
                          </Badge>
                        ),
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 font-medium">Activities</div>
                    <div className="flex flex-wrap gap-2">
                      {detail.visual.visualUnderstanding.activities.map(
                        (item: any, index: number) => (
                          <Badge
                            key={`${item.description}-${index}`}
                            variant="outline"
                          >
                            {item.description}
                          </Badge>
                        ),
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 font-medium">Keywords</div>
                    <div className="flex flex-wrap gap-2">
                      {detail.visual.visualUnderstanding.keywords.map(
                        (keyword: string) => (
                          <Badge key={keyword}>{keyword}</Badge>
                        ),
                      )}
                    </div>
                  </div>
                  {detail.visual.visualUnderstanding.warnings?.length > 0 && (
                    <div className="rounded border border-amber-500/40 p-3 text-sm">
                      {detail.visual.visualUnderstanding.warnings.join(" · ")}
                    </div>
                  )}
                </div>
              )}

              {detail.pages?.length > 0 && (
                <div className="space-y-3">
                  <div className="font-medium">OCR text</div>
                  {detail.pages.map((page: any) => (
                    <div key={page._id} className="rounded-md border p-3">
                      <Badge variant="outline">Page {page.pageNumber}</Badge>
                      <pre className="mt-2 max-h-72 whitespace-pre-wrap overflow-auto text-sm">
                      {page.text || "No text detected"}
                      </pre>
                    </div>
                  ))}
                </div>
              )}

              {detail.annotations?.length > 0 && (
                <div className="space-y-2">
                  <div className="font-medium">Annotations</div>
                  <div className="flex flex-wrap gap-2">
                    {detail.annotations.map((annotation: any) => (
                      <Badge key={annotation._id} variant="secondary">
                        {annotation.type}: {annotation.label}
                        {Number.isFinite(annotation.confidence)
                          ? ` ${Math.round(annotation.confidence * 100)}%`
                          : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {detail.runs?.length > 0 && (
                <div className="space-y-2">
                  <div className="font-medium">Recognition provenance</div>
                  {detail.runs.map((run: any) => (
                    <div
                      key={run._id}
                      className="rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          variant={run.state === "ready"
                            ? "default"
                            : "secondary"}
                        >
                          {run.state}
                        </Badge>
                        <span>
                          {run.providerSnapshot?.name ?? "Unknown provider"}
                        </span>
                      </div>
                      <div className="mt-2 text-muted-foreground">
                        {run.provenance?.service ?? "pending"} ·{" "}
                        {run.provenance?.location ??
                          "pending"}
                        {run.provenance?.modelVersion
                          ? ` · ${run.provenance.modelVersion}`
                          : ""}
                      </div>
                      {run.usage && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          input/output/reasoning/embedding tokens:{" "}
                          {run.usage.inputTokens ??
                            0}/{run.usage.outputTokens ??
                            0}/
                          {run.usage.reasoningTokens ?? 0}/
                          {run.usage.embeddingTokens ?? 0} · OCR units:{" "}
                          {run.usage.ocrUnits ?? 0}{" "}
                          · estimated list price: ${Number(
                            run.usage.grossListPriceUsd ?? 0,
                          ).toFixed(4)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
