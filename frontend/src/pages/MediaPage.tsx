import { useEffect, useMemo, useState } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthenticatedMediaImage } from "@/components/media/AuthenticatedMediaImage";

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

export default function MediaPage() {
  const [status, setStatus] = useState<any>();
  const [assets, setAssets] = useState<any[]>([]);
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

  const load = async () => {
    try {
      const [nextStatus, nextAssets] = await Promise.all([
        callResource("media", { action: "status" }),
        callResource("media", { action: "listAssets", limit: 50 }),
      ]);
      setStatus(nextStatus);
      setAssets(nextAssets.assets ?? []);
      setProfileId((current) =>
        nextStatus.enabled ? current || nextStatus.activeProfileId || "" : ""
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load Media Library",
      );
    }
  };

  useEffect(() => {
    load();
  }, []);

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

  const analyze = async () => {
    setBusy(true);
    try {
      const result = await callResource("media", {
        action: "analyzeSource",
        relativePath: path,
        ...(profileId ? { profileId } : {}),
        ...(profileId ? { requestedTasks: selectedTasks } : {}),
      });
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
    if (files.length === 0) return;
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
        queueRecognition && profileId && selectedTasks.length > 0,
      );
      const result = await callResource("media", {
        action: "confirmImport",
        importId: String(preview.importId),
        consent: true,
        queueRecognition: shouldQueue,
      });
      toast.success(
        shouldQueue
          ? `Imported and queued ${result.created.length} media item(s)`
          : `Imported ${result.created.length} media item(s) without cloud processing`,
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

  const processSelected = async () => {
    if (!selectedAssetId || !profileId) return;
    setBusy(true);
    try {
      await callResource("media", {
        action: "retry",
        assetId: selectedAssetId,
        profileId,
        requestedTasks: selectedTasks,
      });
      toast.success(`Queued with ${profile?.name ?? profileId}`);
      await Promise.all([load(), openAsset(selectedAssetId)]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to queue recognition",
      );
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
        <Button variant="outline" onClick={load}>
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

      <Card>
        <CardHeader>
          <CardTitle>Import photos and PDFs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Relative folder or file path</Label>
              <Input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="2026/photos"
              />
            </div>
            <div className="space-y-2">
              <Label>Recognition provider</Label>
              <select
                className="w-full rounded-md border bg-background p-2"
                value={profileId}
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
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
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
                          <Badge
                            className="mt-2"
                            variant={disabled ? "secondary" : "destructive"}
                          >
                            {disabled ? "Disabled in profile" : "Global Google"}
                          </Badge>
                        )}
                      </div>
                      <Switch
                        aria-label={taskCopy[task].title}
                        checked={selectedTasks.includes(task)}
                        disabled={disabled}
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
            className="rounded-md border-2 border-dashed p-6 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void analyzeUploads(Array.from(event.dataTransfer.files));
            }}
          >
            <Upload className="mx-auto mb-2 h-6 w-6" />
            <div className="font-medium">Upload managed originals</div>
            <p className="mb-3 text-sm text-muted-foreground">
              JPEG, PNG, WebP, or PDF. Mycelia checks the real file type,
              deduplicates by SHA-256, and creates metadata-free WebP previews.
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
                disabled={busy ||
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
              <div className="font-medium">Mounted read-only source</div>
              <p className="text-xs text-muted-foreground">
                Stores only a checked reference to the original; the source file
                is never copied or deleted.
              </p>
            </div>
            <Button
              onClick={analyze}
              variant="outline"
              disabled={busy ||
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
                checked={queueRecognition}
                disabled={!profileId || selectedTasks.length === 0}
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
                ? "Confirmation promotes staged originals into the separate media_originals store. You can later delete each original through a second preview-and-confirm step while retaining WebP previews, metadata, analysis, and search data."
                : "Confirmation stores checked external references and compact previews. The referenced source files are never copied or deleted."}
              {" "}
              A provider receives content only when recognition is explicitly
              queued; paths and EXIF are not included in image requests.
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
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && search()}
              placeholder="Фотографии с людьми у моря…"
            />
            <Button onClick={search}>
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
                <div>
                  <div className="mb-1 font-medium">Local metadata</div>
                  <pre className="max-h-56 overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(detail.asset.metadata ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            </div>

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {assets.map((asset) => (
          <Card key={String(asset._id)} className="overflow-hidden">
            <AuthenticatedMediaImage
              path={asset.thumbnailUrl}
              alt={asset.fileName}
              className="h-44 w-full object-cover"
            />
            <CardContent className="space-y-2 p-4">
              <div className="truncate font-medium">{asset.fileName}</div>
              <div className="flex flex-wrap gap-1">
                <Badge
                  variant={asset.status === "ready"
                    ? "default"
                    : asset.status === "failed"
                    ? "destructive"
                    : "secondary"}
                >
                  {asset.status}
                </Badge>
                <Badge variant="outline">{asset.kind}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {asset.source?.relativePath ?? "Managed copy"}
              </div>
              {asset.safeError && (
                <div className="text-xs text-destructive">
                  {asset.safeError}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  openAsset(String(asset._id))}
              >
                <Eye className="mr-2 h-4 w-4" />Open details
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
