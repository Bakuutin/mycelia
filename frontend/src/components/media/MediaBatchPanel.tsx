import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderSearch, Loader2, Play, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FOLDER_CAMPAIGN_KEY = "mycelia.media.folder-campaign";
const RECOGNITION_BATCH_KEY = "mycelia.media.recognition-batch";

function browserStorage(): Storage | undefined {
  try {
    return globalThis.document?.defaultView?.localStorage;
  } catch {
    return undefined;
  }
}

function storageGet(key: string): string | null {
  try {
    return browserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    browserStorage()?.setItem(key, value);
  } catch {
    // The durable campaign lives in Mongo; browser storage is only a shortcut.
  }
}

function storageRemove(key: string): void {
  try {
    browserStorage()?.removeItem(key);
  } catch {
    // Ignore an unavailable browser storage implementation.
  }
}

function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "$oid" in value) {
    return String((value as { $oid: unknown }).$oid);
  }
  return String(value ?? "");
}

function countLine(counts: Record<string, number> | undefined) {
  if (!counts) return "Waiting for progress…";
  return [
    ["total", counts.total],
    ["imported", counts.imported],
    ["duplicate", counts.duplicate],
    ["unsupported", counts.unsupported],
    ["changed", counts.changed],
    ["pending", counts.pending],
    ["queued", counts.queued],
    ["processing", counts.processing],
    ["ready", counts.ready],
    ["failed", counts.failed],
    ["cancelled", counts.cancelled],
  ].filter(([, value]) => Number(value) > 0).map(([key, value]) =>
    `${key} ${value}`
  ).join(" · ") || "No items";
}

export function MediaBatchPanel({
  status,
  onInventoryChanged,
}: {
  status: any;
  onInventoryChanged: () => void | Promise<void>;
}) {
  const [relativePath, setRelativePath] = useState("900-photos");
  const [folderCampaign, setFolderCampaign] = useState<any>();
  const [recognitionPreview, setRecognitionPreview] = useState<any>();
  const [recognitionBatch, setRecognitionBatch] = useState<any>();
  const [busy, setBusy] = useState(false);

  const googleProfile = useMemo(() => {
    const profiles = status?.profiles ?? [];
    return profiles.find((profile: any) =>
      profile.id === status?.activeProfileId && profile.enabled &&
      profile.providerType === "google-cloud"
    ) ?? profiles.find((profile: any) =>
      profile.enabled && profile.providerType === "google-cloud"
    );
  }, [status]);

  const loadFolderCampaign = useCallback(async (campaignId: string) => {
    const result = await callResource("media-library", {
      action: "getFolderCampaign",
      campaignId,
    });
    setFolderCampaign(result.campaign);
    return result.campaign;
  }, []);

  const loadRecognitionBatch = useCallback(async (batchId: string) => {
    const result = await callResource("media-library", {
      action: "getRecognitionBatch",
      batchId,
    });
    setRecognitionBatch({
      ...result.batch,
      recentFailures: result.recentFailures ?? [],
    });
    return result.batch;
  }, []);

  useEffect(() => {
    const folderId = storageGet(FOLDER_CAMPAIGN_KEY);
    const batchId = storageGet(RECOGNITION_BATCH_KEY);
    if (folderId) {
      void loadFolderCampaign(folderId).catch(() =>
        storageRemove(FOLDER_CAMPAIGN_KEY)
      );
    }
    if (batchId) {
      void loadRecognitionBatch(batchId).catch(() =>
        storageRemove(RECOGNITION_BATCH_KEY)
      );
    }
  }, [loadFolderCampaign, loadRecognitionBatch]);

  useEffect(() => {
    const activeFolder = folderCampaign && [
      "queued",
      "scanning",
      "importing",
    ].includes(folderCampaign.status);
    const activeBatch = recognitionBatch && ["queued", "running", "paused"]
      .includes(recognitionBatch.status);
    if (!activeFolder && !activeBatch) return;
    const timer = globalThis.setInterval(() => {
      if (activeFolder) void loadFolderCampaign(idOf(folderCampaign._id));
      if (activeBatch) void loadRecognitionBatch(idOf(recognitionBatch._id));
    }, 3_000);
    return () => globalThis.clearInterval(timer);
  }, [
    folderCampaign,
    loadFolderCampaign,
    loadRecognitionBatch,
    recognitionBatch,
  ]);

  const startFolderScan = async () => {
    setBusy(true);
    try {
      const result = await callResource("media-library", {
        action: "startFolderScan",
        relativePath: relativePath.trim() || ".",
      });
      const campaignId = idOf(result.campaign._id);
      storageSet(FOLDER_CAMPAIGN_KEY, campaignId);
      setFolderCampaign(result.campaign);
      toast.success("Folder scan started; Google is not used during import");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Folder scan failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmFolderImport = async () => {
    if (!folderCampaign) return;
    if (
      !globalThis.confirm(
        `Import ${
          folderCampaign.counts?.total ?? 0
        } scanned entries as read-only references? Originals will not be copied or deleted.`,
      )
    ) return;
    setBusy(true);
    try {
      const result = await callResource("media-library", {
        action: "confirmFolderCampaign",
        campaignId: idOf(folderCampaign._id),
        confirm: true,
      });
      setFolderCampaign(result.campaign);
      toast.success("Background folder import started");
      await onInventoryChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Import confirmation failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const previewRecognition = async () => {
    if (!googleProfile) return;
    setBusy(true);
    try {
      const result = await callResource("media-library", {
        action: "previewRecognitionBatch",
        profileId: googleProfile.id,
        requestedTasks: ["visual-understanding", "ocr"],
      });
      setRecognitionPreview(result);
      toast.success(
        `Prepared an exact ${result.eligibleCount}-photo batch; no Google call yet`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Batch preview failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmRecognition = async () => {
    if (!recognitionPreview) return;
    if (
      !globalThis.confirm(
        `Send ${recognitionPreview.eligibleCount} compact previews to Google Cloud for visual understanding + EU OCR? Maximum gross list-price ceiling: $${
          Number(recognitionPreview.authorizedGrossUsd).toFixed(2)
        }.`,
      )
    ) return;
    setBusy(true);
    try {
      const result = await callResource("media-library", {
        action: "confirmRecognitionBatch",
        previewId: idOf(recognitionPreview.previewId),
        consent: true,
      });
      const batchId = idOf(result.batch._id);
      storageSet(RECOGNITION_BATCH_KEY, batchId);
      setRecognitionBatch(result.batch);
      setRecognitionPreview(undefined);
      toast.success(
        "Recognition batch accepted; progress continues in background",
      );
      await onInventoryChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Batch confirmation failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelRecognition = async () => {
    if (!recognitionBatch) return;
    setBusy(true);
    try {
      const result = await callResource("media-library", {
        action: "cancelRecognitionBatch",
        batchId: idOf(recognitionBatch._id),
        confirm: true,
      });
      setRecognitionBatch(result.batch);
      toast.success(
        "No new photo jobs will be queued; started calls may finish",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  const retryFailures = async () => {
    if (!recognitionBatch) return;
    setBusy(true);
    try {
      const result = await callResource("media-library", {
        action: "retryRecognitionBatchFailures",
        batchId: idOf(recognitionBatch._id),
        confirm: true,
      });
      toast.success(`Reset ${result.reset} failed batch item(s)`);
      await loadRecognitionBatch(idOf(recognitionBatch._id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>Large photo folder and Google batch</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-3 rounded-md border p-4">
          <div>
            <h3 className="font-semibold">1. Sync mounted folder locally</h3>
            <p className="text-sm text-muted-foreground">
              Put originals under the configured host folder. For this import
              use
              <code className="mx-1">900-photos</code>. Mycelia walks
              subfolders, ignores symlinks, hashes files, and processes 25
              entries at a time.
            </p>
          </div>
          <Label htmlFor="media-folder-campaign-path">
            Mounted relative path
          </Label>
          <div className="flex gap-2">
            <Input
              id="media-folder-campaign-path"
              value={relativePath}
              onChange={(event) => setRelativePath(event.target.value)}
              disabled={busy}
            />
            <Button onClick={startFolderScan} disabled={busy} variant="outline">
              {busy
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <FolderSearch className="mr-2 h-4 w-4" />}
              Scan
            </Button>
          </div>
          {folderCampaign && (
            <div className="space-y-2 rounded bg-muted p-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge>{folderCampaign.status}</Badge>
                <span>{folderCampaign.relativePath}</span>
              </div>
              <div>{countLine(folderCampaign.counts)}</div>
              {folderCampaign.safeError && (
                <div className="text-destructive">
                  {folderCampaign.safeError}
                </div>
              )}
              {folderCampaign.status === "preview_ready" && (
                <Button onClick={confirmFolderImport} disabled={busy}>
                  Confirm local import
                </Button>
              )}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-md border p-4">
          <div>
            <h3 className="font-semibold">2. Process all unprocessed photos</h3>
            <p className="text-sm text-muted-foreground">
              Server-side selection skips ready, queued, and processing photos.
              It sends compact previews for Vertex visual understanding and EU
              Vision OCR only; global labels/objects stay off.
            </p>
          </div>
          <Button
            onClick={previewRecognition}
            disabled={busy || !googleProfile}
            className="w-full"
          >
            {busy
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Play className="mr-2 h-4 w-4" />}
            Process all with Google Cloud EU Photo Knowledge
          </Button>
          {!googleProfile && (
            <p className="text-sm text-destructive">
              Enable a Google Cloud media profile in Settings first.
            </p>
          )}
          {recognitionPreview && (
            <div className="space-y-2 rounded bg-muted p-3 text-sm">
              <div>
                Exact selection:{" "}
                <strong>{recognitionPreview.eligibleCount}</strong>{" "}
                photo(s); unavailable originals:{" "}
                {recognitionPreview.missingOriginalCount}
              </div>
              <div>
                Visual + OCR ceiling: ${Number(
                  recognitionPreview.authorizedGrossUsd,
                ).toFixed(2)}{" "}
                (${Number(recognitionPreview.perAssetGrossUsd).toFixed(
                  4,
                )}/photo)
              </div>
              <Button onClick={confirmRecognition} disabled={busy}>
                Confirm this exact batch
              </Button>
            </div>
          )}
          {recognitionBatch && (
            <div className="space-y-2 rounded bg-muted p-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge>{recognitionBatch.status}</Badge>
                <span>
                  ceiling ${Number(recognitionBatch.authorizedGrossUsd).toFixed(
                    2,
                  )}
                </span>
              </div>
              <div>{countLine(recognitionBatch.counts)}</div>
              <div className="flex flex-wrap gap-2">
                {["queued", "running", "paused"].includes(
                  recognitionBatch.status,
                ) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={cancelRecognition}
                  >
                    <Square className="mr-2 h-3 w-3" />Stop new jobs
                  </Button>
                )}
                {Number(recognitionBatch.counts?.failed ?? 0) > 0 && (
                  <Button size="sm" variant="outline" onClick={retryFailures}>
                    <RotateCcw className="mr-2 h-3 w-3" />Retry failures
                  </Button>
                )}
              </div>
              {(recognitionBatch.recentFailures ?? []).slice(0, 3).map((
                item: any,
              ) => (
                <div
                  key={idOf(item.assetId)}
                  className="text-xs text-destructive"
                >
                  {idOf(item.assetId)}: {item.safeError ?? item.state}
                </div>
              ))}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
