import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Eye,
  FileImage,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient, callResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuthenticatedMediaImage } from "@/components/media/AuthenticatedMediaImage";
import { MediaEventsPanel } from "@/components/media/MediaEventsPanel";
import { MediaBatchPanel } from "@/components/media/MediaBatchPanel";

type RecognitionTask =
  | "visual-understanding"
  | "ocr"
  | "labels"
  | "objects";

const taskCopy: Record<RecognitionTask, { title: string; detail: string }> = {
  "visual-understanding": {
    title: "Visual understanding (primary)",
    detail:
      "Russian caption, description, scene, objects, activities, tags, and a semantic-search vector.",
  },
  ocr: {
    title: "Extract text (OCR)",
    detail:
      "Google uses strict-EU Vision for images and EU Document AI for PDFs.",
  },
  labels: {
    title: "Image labels",
    detail:
      "Google runs this at its global Vision endpoint; self-hosted stays local.",
  },
  objects: {
    title: "Locate objects",
    detail:
      "Returns object names, confidence, and boxes; Google execution is global.",
  },
};

const MAX_MANAGED_UPLOAD_FILES = 50;
const MAX_MANAGED_UPLOAD_TOTAL_BYTES = 48_000_000;

type InventoryFilter =
  | "all"
  | "unprocessed"
  | "processing"
  | "ready"
  | "errors";

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

function mountedPathError(value: string): string | undefined {
  const path = value.trim();
  if (!path) return "Enter a path relative to the mounted media folder";
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.split(/[\\/]+/).includes("..")
  ) {
    return 'Use "." or a relative path such as "2026/photos"; host paths are configured outside the browser';
  }
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
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<string[]>(
    [],
  );
  const [path, setPath] = useState(".");
  const [profileId, setProfileId] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<RecognitionTask[]>([
    "visual-understanding",
  ]);
  const [queueRecognition, setQueueRecognition] = useState(false);
  const [preview, setPreview] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [detail, setDetail] = useState<any>();
  const [deletionPreview, setDeletionPreview] = useState<any>();

  const load = async (options: { append?: boolean } = {}) => {
    try {
      const backendFilter = inventoryFilter === "errors"
        ? "needs_attention"
        : inventoryFilter;
      const [nextStatus, nextAssets] = await Promise.all([
        callResource("media", { action: "status" }),
        callResource("media", {
          action: "listAssets",
          limit: 100,
          inventoryFilter: backendFilter,
          placement: placementFilter,
          ...(options.append && nextCursor ? { cursor: nextCursor } : {}),
        }),
      ]);
      setStatus(nextStatus);
      setAssets((current) => {
        if (!options.append) return nextAssets.assets ?? [];
        const byId = new Map(
          [...current, ...(nextAssets.assets ?? [])].map((asset: any) => [
            String(asset._id),
            asset,
          ]),
        );
        return [...byId.values()];
      });
      setNextCursor(nextAssets.nextCursor);
      setAssetTotal(Number(nextAssets.total ?? nextAssets.assets?.length ?? 0));
      setSelectedInventoryIds((current) => {
        const available = new Set(
          (nextAssets.assets ?? []).map((asset: any) => String(asset._id)),
        );
        return current.filter((id) => available.has(id));
      });
      setProfileId((current) => {
        if (!nextStatus.enabled) return "";
        const enabledIds = new Set(
          (nextStatus.profiles ?? []).filter((entry: any) => entry.enabled).map(
            (entry: any) => entry.id,
          ),
        );
        if (current && enabledIds.has(current)) return current;
        return enabledIds.has(nextStatus.activeProfileId)
          ? nextStatus.activeProfileId
          : "";
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load Media Library",
      );
    }
  };

  useEffect(() => {
    void load();
  }, [inventoryFilter, placementFilter]);

  useEffect(() => {
    if (
      !assets.some((asset) => ["queued", "processing"].includes(asset.status))
    ) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [assets]);

  const profile = useMemo(
    () => status?.profiles?.find((entry: any) => entry.id === profileId),
    [status, profileId],
  );
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
  const analyze = async () => {
    if (preview) return;
    const relativePath = path.trim();
    const validationError = mountedPathError(relativePath);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setBusy(true);
    try {
      const result = await callResource("media", {
        action: "analyzeSource",
        relativePath,
        ...(profileId ? { profileId } : {}),
        ...(profileId ? { requestedTasks: selectedTasks } : {}),
      });
      setQueueRecognition(false);
      setPreview(result);
      toast.success(
        `Analyzed ${result.items.length} local item(s); nothing sent to Google yet`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Import analysis failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const analyzeUploads = async (files: File[]) => {
    if (
      files.length === 0 || busy ||
      Boolean(preview) ||
      Boolean(profileId && selectedTasks.length === 0)
    ) return;
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
      if (profileId) {
        form.append("profileId", profileId);
        form.append("requestedTasks", selectedTasks.join(","));
      }
      const result = await apiClient.postForm<any>(
        "/api/media/imports/analyze",
        form,
      );
      setQueueRecognition(false);
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
      const shouldQueue = Boolean(
        queueRecognition && preview.provider?.id &&
          preview.requestedTasks?.length > 0,
      );
      const result = await callResource("media", {
        action: "confirmImport",
        importId: String(preview.importId),
        consent: true,
        queueRecognition: shouldQueue,
      });
      const createdCount = result.created?.length ?? 0;
      const recoveredCount = result.recovered?.length ?? 0;
      const confirmedCount = createdCount + recoveredCount;
      const queuedCount =
        [...(result.created ?? []), ...(result.recovered ?? [])]
          .filter((entry: any) => Boolean(entry.jobId)).length;
      const recoveryCopy = recoveredCount
        ? `; restored ${recoveredCount} original(s)`
        : "";
      if (shouldQueue && queuedCount < confirmedCount) {
        toast.warning(
          `Confirmed ${confirmedCount} media item(s), but queued ${queuedCount}; failed queue attempts remain available for Retry${recoveryCopy}`,
        );
      } else {
        toast.success(
          shouldQueue
            ? `Confirmed and queued ${queuedCount} media item(s)${recoveryCopy}`
            : `Confirmed ${confirmedCount} media item(s) without cloud processing${recoveryCopy}`,
        );
      }
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

  const openAsset = async (assetId: string) => {
    setBusy(true);
    try {
      const result = await callResource("media", {
        action: "getAsset",
        assetId,
      });
      setSelectedAssetId(assetId);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("assetId", assetId);
        return next;
      }, { replace: true });
      setDetail(result);
      setDeletionPreview(undefined);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load media asset",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const assetId = searchParams.get("assetId");
    if (assetId && assetId !== selectedAssetId) void openAsset(assetId);
  }, [searchParams, selectedAssetId]);

  const processSelected = async () => {
    if (!selectedAssetId || !profileId) return;
    setBusy(true);
    try {
      const result = await callResource("media", {
        action: "retry",
        assetId: selectedAssetId,
        profileId,
        requestedTasks: selectedTasks,
      });
      if (result.queued === false) {
        toast.error(
          "Recognition could not be queued; the asset remains available for Retry",
        );
      } else {
        toast.success(`Queued with ${profile?.name ?? profileId}`);
      }
      await Promise.all([load(), openAsset(selectedAssetId)]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to queue recognition",
      );
    } finally {
      setBusy(false);
    }
  };

  const processInventoryBatch = async () => {
    if (!profileId || selectedTasks.length === 0) return;
    const selected = assets.filter((asset) =>
      selectedInventoryIds.includes(String(asset._id)) &&
      (asset.source || asset.managedOriginal) &&
      !["queued", "processing"].includes(asset.status)
    );
    if (selected.length === 0) {
      toast.error("Select at least one processable photo or PDF");
      return;
    }
    if (
      !globalThis.confirm(
        `Queue ${selected.length} selected item(s) with ${
          profile?.name ?? profileId
        } for: ${
          selectedTasks.join(", ")
        }? Each item is submitted as its own auditable job.`,
      )
    ) return;
    setBusy(true);
    let queued = 0;
    const errors: string[] = [];
    try {
      for (const asset of selected) {
        try {
          const result = await callResource("media", {
            action: "retry",
            assetId: String(asset._id),
            profileId,
            requestedTasks: selectedTasks,
          });
          if (result.queued) queued += 1;
          else errors.push(`${asset.fileName}: queue unavailable`);
        } catch (error) {
          errors.push(
            `${asset.fileName}: ${
              error instanceof Error ? error.message : "request failed"
            }`,
          );
        }
      }
      if (errors.length > 0) {
        toast.warning(
          `Queued ${queued}/${selected.length}. ${
            errors.slice(0, 3).join("; ")
          }`,
        );
      } else {
        toast.success(`Queued ${queued} selected item(s)`);
      }
      setSelectedInventoryIds([]);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteDerived = async (
    target: "previews" | "analysis" | "source_reference",
  ) => {
    if (!selectedAssetId) return;
    const label = target === "previews"
      ? "stored previews"
      : target === "analysis"
      ? "derived visual/OCR analysis"
      : "the stored original-file reference";
    if (
      !globalThis.confirm(
        `Delete ${label}? The referenced original will not be touched.`,
      )
    ) return;
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
          ? "Forgot the stored reference; the original file was not touched"
          : `Deleted ${label}; original file and reference were not touched`,
      );
      await Promise.all([load(), openAsset(selectedAssetId)]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to delete ${label}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const prepareOriginalDeletion = async () => {
    if (!selectedAssetId) return;
    setBusy(true);
    try {
      const result = await callResource("media", {
        action: "previewOriginalDeletion",
        assetId: selectedAssetId,
      });
      setDeletionPreview(result);
      if (!result.canDelete) {
        toast.error(
          result.blockers?.join("; ") ?? "Original cannot be deleted",
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Deletion preview failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmOriginalDeletion = async () => {
    if (!deletionPreview?.canDelete) return;
    setBusy(true);
    try {
      await callResource("media", {
        action: "confirmOriginalDeletion",
        deletionPreviewId: String(deletionPreview.deletionPreviewId),
        confirm: true,
      });
      toast.success(
        "Managed original deleted; preview, metadata, analysis, and search data were retained",
      );
      setDeletionPreview(undefined);
      await Promise.all([load(), openAsset(selectedAssetId)]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Original deletion failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleTask = (task: RecognitionTask, enabled: boolean) => {
    setSelectedTasks((current) => {
      const next = enabled
        ? [...new Set([...current, task])]
        : current.filter((entry) => entry !== task);
      return ([
        "visual-understanding",
        "ocr",
        "labels",
        "objects",
      ] as RecognitionTask[]).filter(
        (entry) => next.includes(entry),
      );
    });
  };

  return (
    <div className="container mx-auto space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <FileImage /> Media Library
          </h1>
          <p className="text-muted-foreground">
            Local originals by reference; compact previews, visual meaning,
            semantic search, metadata, and provider provenance in Mycelia.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />Refresh
        </Button>
      </div>

      {!status?.enabled && (
        <Card className="border-amber-500/50">
          <CardContent className="p-4">
            Recognition is disabled. Local managed uploads, previews, EXIF/GPS,
            deduplication, and metadata-only imports remain available. Enable a
            provider in Settings → Google Cloud only when you want recognition.
          </CardContent>
        </Card>
      )}

      <MediaBatchPanel status={status} onInventoryChanged={() => load()} />

      <Card>
        <CardHeader>
          <CardTitle>Import photos and PDFs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mounted-media-relative-path">
                Relative folder or file path
              </Label>
              <Input
                id="mounted-media-relative-path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="2026/photos"
                disabled={busy || Boolean(preview)}
              />
              <p className="text-xs text-muted-foreground">
                On this Mac, place files in the folder configured as
                <code className="mx-1">MEDIA_SOURCE_HOST_PATH</code> in
                <code className="mx-1">.env.media.local</code>. Mycelia sees it
                read-only at <code>/media-source</code>. Use
                <code className="mx-1">.</code>{" "}
                for the whole mounted folder; do not paste a{" "}
                <code>/Users/…</code> host path here.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="media-recognition-provider">
                Recognition provider
              </Label>
              <select
                id="media-recognition-provider"
                className="w-full rounded-md border bg-background p-2"
                value={profileId}
                disabled={busy || Boolean(preview)}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const nextProfile = status?.profiles?.find((entry: any) =>
                    entry.id === nextId
                  );
                  setProfileId(nextId);
                  if (
                    nextProfile?.providerType === "google-cloud" &&
                    !nextProfile.allowGlobalPhotoAnalysis
                  ) {
                    setSelectedTasks((current) =>
                      current.filter((task) =>
                        task !== "labels" && task !== "objects"
                      )
                    );
                  }
                }}
              >
                <option value="">Metadata only (no cloud processing)</option>
                {status?.profiles?.map((entry: any) => (
                  <option
                    key={entry.id}
                    value={entry.id}
                    disabled={!entry.enabled}
                  >
                    {entry.name}
                    {entry.enabled ? "" : " (disabled in Settings)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {profile && (
            <div className="space-y-3 rounded-md border p-4">
              <div>
                <Label>Tasks to run</Label>
                <p className="text-xs text-muted-foreground">
                  Local metadata is always extracted before confirmation. The
                  tasks below are sent only after you explicitly queue them.
                </p>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {(Object.keys(taskCopy) as RecognitionTask[]).map((task) => {
                  const globalGoogleTask =
                    (task === "labels" || task === "objects") &&
                    profile.providerType === "google-cloud";
                  const disabled = globalGoogleTask &&
                    !profile.allowGlobalPhotoAnalysis;
                  return (
                    <div
                      key={task}
                      className="flex items-start justify-between gap-3 rounded-md border p-3"
                    >
                      <div>
                        <Label>{taskCopy[task].title}</Label>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {taskCopy[task].detail}
                        </p>
                        {globalGoogleTask && (
                          <div className="mt-2 space-y-1">
                            <Badge
                              variant={disabled ? "secondary" : "destructive"}
                            >
                              {disabled
                                ? "Disabled in Google profile"
                                : "Global Google"}
                            </Badge>
                            {disabled && (
                              <p className="text-xs text-muted-foreground">
                                Enable “Allow global labels and objects” in{" "}
                                <Link
                                  className="underline"
                                  to="/settings/google-cloud"
                                >
                                  Settings → Google Cloud
                                </Link>
                                , then Save.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <Switch
                        aria-label={taskCopy[task].title}
                        checked={selectedTasks.includes(task)}
                        disabled={disabled || busy || Boolean(preview)}
                        onCheckedChange={(enabled) => toggleTask(task, enabled)}
                      />
                    </div>
                  );
                })}
              </div>
              {selectedTasks.length === 0 && (
                <p className="text-sm text-destructive">
                  Select at least one recognition task or choose Metadata only.
                </p>
              )}
            </div>
          )}
          <div
            aria-disabled={busy ||
              Boolean(preview) ||
              Boolean(profileId && selectedTasks.length === 0)}
            className={`rounded-md border-2 border-dashed p-6 text-center ${
              busy || Boolean(preview) ||
                Boolean(profileId && selectedTasks.length === 0)
                ? "cursor-not-allowed opacity-60"
                : ""
            }`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (
                busy || Boolean(preview) ||
                Boolean(profileId && selectedTasks.length === 0)
              ) return;
              void analyzeUploads(Array.from(event.dataTransfer.files));
            }}
          >
            <Upload className="mx-auto mb-2 h-6 w-6" />
            <div className="font-medium">
              Option 1 — upload managed originals from this computer
            </div>
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
                disabled={busy || Boolean(preview) ||
                  Boolean(profileId && selectedTasks.length === 0)}
                onChange={(event) => {
                  void analyzeUploads(Array.from(event.target.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                Option 2 — mounted read-only source
              </div>
              <p className="text-xs text-muted-foreground">
                Stores only a checked reference to the original; the source file
                is never copied or deleted. Put it under your configured host
                folder, then enter <code>.</code> above to scan everything.
              </p>
            </div>
            <Button
              onClick={analyze}
              variant="outline"
              disabled={busy ||
                Boolean(preview) ||
                !status?.sourceConfigured ||
                Boolean(profileId && selectedTasks.length === 0)}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Analyze mounted path
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>Preview before transmission</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge>{preview.provider.name}</Badge>
              <Badge variant="outline">
                {preview.storageMode === "managed_original"
                  ? "Managed original"
                  : "External reference"}
              </Badge>
              <Badge variant="outline">
                Maximum list price ${Number(preview.grossEstimateUsd).toFixed(
                  4,
                )}
              </Badge>
              {preview.requestedTasks?.map((task: RecognitionTask) => (
                <Badge
                  key={task}
                  variant={task === "labels" || task === "objects"
                    ? "destructive"
                    : "outline"}
                >
                  {taskCopy[task]?.title ?? task}
                </Badge>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Queue recognition after import</Label>
                <p className="text-xs text-muted-foreground">
                  Keep this off for the first local-only import test. You can
                  process staged assets later with Google or a self-hosted
                  provider.
                </p>
              </div>
              <Switch
                aria-label="Queue recognition after import"
                checked={queueRecognition}
                disabled={!preview.provider?.id ||
                  preview.requestedTasks?.length === 0}
                onCheckedChange={setQueueRecognition}
              />
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
              During import, a provider receives image content only when
              recognition is explicitly queued; paths and EXIF are not included
              in image requests.
            </div>
            <Button onClick={confirm} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {queueRecognition && profileId
                ? "Confirm import and queue recognition"
                : "Confirm local import"}
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
                <div
                  key={`${result.assetId}-${index}`}
                  className="flex gap-3 rounded-md border p-3"
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card id="media-inventory">
        <CardHeader>
          <CardTitle>Media inventory and processing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                Showing {assets.length} of {assetTotal}{" "}
                imported item(s). Ready means provider results were accepted;
                staged means local metadata and previews exist but recognition
                has not completed.
              </p>
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

          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setSelectedInventoryIds(
                  filteredAssets.map((asset) => String(asset._id)),
                )}
              disabled={filteredAssets.length === 0}
            >
              Select visible
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelectedInventoryIds([])}
              disabled={selectedInventoryIds.length === 0}
            >
              Clear selection
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={processInventoryBatch}
              disabled={busy || !profileId || selectedTasks.length === 0 ||
                selectedInventoryIds.length === 0}
            >
              {busy
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Play className="mr-2 h-4 w-4" />}
              Process selected ({selectedInventoryIds.length})
            </Button>
            <span className="text-xs text-muted-foreground">
              Uses the provider and tasks selected in the import section; every
              photo is queued as a separate bounded job.
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">Select</TableHead>
                <TableHead>Photo / file</TableHead>
                <TableHead>Captured</TableHead>
                <TableHead>Local metadata</TableHead>
                <TableHead>Processing</TableHead>
                <TableHead>Results</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAssets.length === 0
                ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No media matches this filter.
                    </TableCell>
                  </TableRow>
                )
                : filteredAssets.map((asset) => {
                  const id = String(asset._id);
                  const metadata = mediaMetadataSummary(asset);
                  const run = asset.inventory?.run;
                  return (
                    <TableRow
                      key={id}
                      data-state={selectedInventoryIds.includes(id)
                        ? "selected"
                        : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${asset.fileName}`}
                          checked={selectedInventoryIds.includes(id)}
                          onCheckedChange={(checked) =>
                            setSelectedInventoryIds((current) =>
                              checked
                                ? [...new Set([...current, id])]
                                : current.filter((entry) => entry !== id)
                            )}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-[220px] items-center gap-3">
                          <AuthenticatedMediaImage
                            path={asset.thumbnailUrl}
                            alt={asset.fileName}
                            className="h-12 w-12 rounded border object-cover"
                          />
                          <div className="min-w-0">
                            <div className="max-w-[260px] truncate font-medium">
                              {asset.fileName}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {asset.kind} ·{" "}
                              {(Number(asset.byteLength ?? 0) / 1_000_000)
                                .toFixed(2)} MB
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[170px] text-xs">
                        <div>{metadata.captured}</div>
                        {asset.capturedAtTimeZone && (
                          <div className="text-muted-foreground">
                            {asset.capturedAtTimeZone} ·{" "}
                            {asset.capturedAtTimeZoneSource}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[180px] text-xs">
                        <div>{metadata.camera}</div>
                        <div className="text-muted-foreground">
                          {metadata.dimensions} · GPS{" "}
                          {metadata.location === "—" ? "no" : "yes"}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[180px]">
                        <div className="flex flex-wrap gap-1">
                          <Badge
                            variant={asset.status === "ready"
                              ? "default"
                              : asset.safeError
                              ? "destructive"
                              : "secondary"}
                          >
                            {asset.status}
                          </Badge>
                          {asset.inventory?.eventId && (
                            <Badge variant="outline">In photo event</Badge>
                          )}
                        </div>
                        {run && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {run.providerName ?? run.providerType ?? "provider"}
                            {run.modelVersion ? ` · ${run.modelVersion}` : ""}
                          </div>
                        )}
                        {asset.safeError && (
                          <div className="mt-1 max-w-[260px] text-xs text-destructive">
                            {asset.safeError}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[200px] text-xs">
                        <div>
                          {asset.inventory?.shortCaption ??
                            "No visual description"}
                        </div>
                        <div className="text-muted-foreground">
                          OCR {asset.inventory?.ocrPageCount ?? 0}{" "}
                          page(s) · labels/objects{" "}
                          {asset.inventory?.annotationCount ?? 0}
                        </div>
                        {Number.isFinite(Number(run?.grossListPriceUsd)) && (
                          <div className="text-muted-foreground">
                            estimated ${Number(run.grossListPriceUsd).toFixed(
                              4,
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            openAsset(id)}
                        >
                          <Eye className="mr-2 h-4 w-4" />Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
          {nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void load({ append: true })}
                disabled={busy}
              >
                Load next 100
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <MediaEventsPanel
        status={status}
        candidateAssetIds={selectedInventoryIds.filter((id) =>
          assets.some((asset) =>
            String(asset._id) === id && asset.kind === "image"
          )
        )}
        onOpenAsset={openAsset}
      />

      {detail?.asset && (
        <Card className="border-primary/50">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>{detail.asset.fileName}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {detail.asset.storageMode} ·{" "}
                {detail.asset.source?.relativePath ??
                  "managed copy"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close media details"
              onClick={() => {
                setSelectedAssetId("");
                setDetail(undefined);
                setDeletionPreview(undefined);
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.delete("assetId");
                  return next;
                }, { replace: true });
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={processSelected}
                    disabled={busy || !profileId ||
                      selectedTasks.length === 0 ||
                      !(detail.asset.source || detail.asset.managedOriginal) ||
                      ["queued", "processing"].includes(detail.asset.status)}
                  >
                    {busy
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Play className="mr-2 h-4 w-4" />}
                    Process with {profile?.name ?? "selected provider"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => deleteDerived("analysis")}
                    disabled={busy || !(detail.runs?.length > 0)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />Delete derived analysis
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => deleteDerived("previews")}
                    disabled={busy ||
                      !(detail.asset.previewUrl || detail.asset.thumbnailUrl)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />Delete previews
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => deleteDerived("source_reference")}
                    disabled={busy || !detail.asset.source}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />Forget original reference
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={prepareOriginalDeletion}
                    disabled={busy ||
                      detail.asset.storageMode !== "managed_original"}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />Review original deletion
                  </Button>
                </div>
                {detail.asset.storageMode === "preview_only" && (
                  <div className="rounded border border-amber-500/40 p-3 text-sm">
                    The managed original was deleted. Compact previews,
                    metadata, analysis, and search data remain available.
                  </div>
                )}
                {deletionPreview && (
                  <div className="space-y-3 rounded border border-destructive/50 p-3 text-sm">
                    <div className="font-medium">Original deletion preview</div>
                    <div>
                      Original size: {(
                        Number(deletionPreview.byteLength ?? 0) / 1_000_000
                      ).toFixed(2)} MB · preview{" "}
                      {deletionPreview.previewReady ? "ready" : "missing"}{" "}
                      · analysis{" "}
                      {deletionPreview.analysisReady ? "ready" : "missing"}
                    </div>
                    {deletionPreview.blockers?.length > 0 && (
                      <ul className="list-disc pl-5 text-destructive">
                        {deletionPreview.blockers.map((blocker: string) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    )}
                    {deletionPreview.canDelete && (
                      <>
                        <div>
                          This permanently deletes only the managed original.
                          WebP previews, local metadata, provider results, and
                          search indexes are retained.
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="destructive"
                            onClick={confirmOriginalDeletion}
                            disabled={busy}
                          >
                            Permanently delete managed original
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setDeletionPreview(undefined)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {!profileId && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Select an enabled recognition provider above to process this
                    staged asset.
                  </p>
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
              key={`${detail.asset._id}:${detail.asset.placementRevision ?? 0}`}
              asset={detail.asset}
              onSaved={async () => {
                await Promise.all([
                  load(),
                  openAsset(String(detail.asset._id)),
                ]);
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
                    <div>{detail.visual.visualUnderstanding.scene.summary}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {detail.visual.visualUnderstanding.scene.environment} ·
                      {" "}
                      {detail.visual.visualUnderstanding.scene.placeType} ·{" "}
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
                  <div key={run._id} className="rounded-md border p-3 text-sm">
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
                        {run.usage.inputTokens ?? 0}/{run.usage.outputTokens ??
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
