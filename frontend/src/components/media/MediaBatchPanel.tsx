import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronRight,
  Folder,
  FolderSearch,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const FOLDER_CAMPAIGN_KEY = "mycelia.media.folder-campaign";

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

function durationLabel(seconds: number | undefined) {
  if (!Number.isFinite(seconds) || Number(seconds) < 0) return undefined;
  const rounded = Math.ceil(Number(seconds));
  if (rounded < 60) return `${rounded}s`;
  if (rounded < 3_600) return `${Math.ceil(rounded / 60)} min`;
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.ceil((rounded % 3_600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function timeAgo(value: unknown) {
  if (!value) return undefined;
  const elapsed = Math.max(0, Date.now() - new Date(String(value)).getTime());
  if (!Number.isFinite(elapsed)) return undefined;
  if (elapsed < 5_000) return "just now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  return `${Math.floor(elapsed / 3_600_000)}h ago`;
}

function campaignStageLabel(stage: string | undefined, status: string) {
  const labels: Record<string, string> = {
    inventory: "Building inventory",
    metadata_scan: "Scanning metadata",
    awaiting_confirmation: "Ready to review",
    creating_previews: "Importing locally",
    completed: "Finished",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[stage ?? ""] ?? status.replaceAll("_", " ");
}

export function MediaBatchPanel({
  onInventoryChanged,
}: {
  status: any;
  onInventoryChanged: () => void | Promise<void>;
}) {
  const [relativePath, setRelativePath] = useState(".");
  const [folderListing, setFolderListing] = useState<any>({
    currentPath: ".",
    folders: [],
  });
  const [folderBrowserLoading, setFolderBrowserLoading] = useState(false);
  const [folderBrowserError, setFolderBrowserError] = useState<string>();
  const [folderCampaign, setFolderCampaign] = useState<any>();
  const [busy, setBusy] = useState(false);
  const inventoryFingerprintRef = useRef<string | undefined>(undefined);

  const loadFolderCampaign = useCallback(async (campaignId: string) => {
    const result = await callResource("media-library", {
      action: "getFolderCampaign",
      campaignId,
    });
    setFolderCampaign(result.campaign);
    return result.campaign;
  }, []);

  const loadActiveFolderCampaign = useCallback(async () => {
    const result = await callResource("media-library", {
      action: "getActiveFolderCampaign",
    });
    if (result.campaign) {
      const campaignId = idOf(result.campaign._id);
      storageSet(FOLDER_CAMPAIGN_KEY, campaignId);
      setFolderCampaign(result.campaign);
    }
    return result.campaign;
  }, []);

  const browseMountedFolder = useCallback(async (path: string) => {
    setFolderBrowserLoading(true);
    setFolderBrowserError(undefined);
    try {
      const result = await callResource("media-library", {
        action: "listMountedFolders",
        relativePath: path,
      });
      if (result?.listing?.currentPath) {
        setFolderListing(result.listing);
        setRelativePath(result.listing.currentPath);
      }
    } catch (error) {
      setFolderBrowserError(
        error instanceof Error
          ? error.message
          : "Mounted folders could not be listed",
      );
    } finally {
      setFolderBrowserLoading(false);
    }
  }, []);

  useEffect(() => {
    void browseMountedFolder(".");
  }, [browseMountedFolder]);

  useEffect(() => {
    const folderId = storageGet(FOLDER_CAMPAIGN_KEY);
    void (async () => {
      if (folderId) {
        try {
          await loadFolderCampaign(folderId);
          return;
        } catch {
          // A backend reload can make one request fail transiently. Recover the
          // durable campaign by owner instead of hiding its progress forever.
        }
      }
      try {
        const active = await loadActiveFolderCampaign();
        if (!active) storageRemove(FOLDER_CAMPAIGN_KEY);
      } catch {
        // Keep the existing shortcut and retry on the next page load.
      }
    })();
  }, [loadActiveFolderCampaign, loadFolderCampaign]);

  useEffect(() => {
    const activeFolder = folderCampaign && [
      "queued",
      "scanning",
      "importing",
    ].includes(folderCampaign.status);
    if (!activeFolder) return;
    const timer = globalThis.setInterval(() => {
      void loadFolderCampaign(idOf(folderCampaign._id));
    }, 3_000);
    return () => globalThis.clearInterval(timer);
  }, [folderCampaign, loadFolderCampaign]);

  useEffect(() => {
    if (!folderCampaign) return;
    const fingerprint = JSON.stringify({
      id: idOf(folderCampaign._id),
      status: folderCampaign.status,
      updatedAt: folderCampaign.updatedAt,
      counts: folderCampaign.counts ?? {},
      progress: folderCampaign.progress
        ? {
          stage: folderCampaign.progress.stage,
          processed: folderCampaign.progress.processed,
          total: folderCampaign.progress.total,
          remaining: folderCampaign.progress.remaining,
          percent: folderCampaign.progress.percent,
        }
        : null,
    });
    if (inventoryFingerprintRef.current === fingerprint) return;
    inventoryFingerprintRef.current = fingerprint;
    void Promise.resolve(onInventoryChanged()).catch(() => {
      // A later durable campaign update retries a transient inventory refresh.
    });
  }, [folderCampaign, onInventoryChanged]);

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
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Import confirmation failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>Mounted folder sync</CardTitle>
      </CardHeader>
      <CardContent>
        <section className="space-y-3 rounded-md border p-4">
          <div>
            <h3 className="font-semibold">Sync mounted folder locally</h3>
            <p className="text-sm text-muted-foreground">
              Choose the mounted root or any visible subfolder below. The root
              is selected by default. Mycelia walks subfolders, ignores
              symlinks, and commits progress every 25 entries. Unchanged files
              reuse their previously verified SHA-256; new or changed files are
              hashed again.
            </p>
          </div>
          <div className="space-y-3 rounded-md border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">
                  Mounted folder browser
                </div>
                <div className="text-xs text-muted-foreground">
                  Root is{" "}
                  <code>/media-source</code>. Scans are recursive; symlinks are
                  ignored.
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Refresh mounted folders"
                onClick={() =>
                  browseMountedFolder(folderListing.currentPath ?? ".")}
                disabled={folderBrowserLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${
                    folderBrowserLoading ? "animate-spin" : ""
                  }`}
                />
              </Button>
            </div>
            <div
              className="flex flex-wrap items-center gap-1 text-sm"
              aria-label="Selected mounted folder"
            >
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => browseMountedFolder(".")}
                disabled={folderBrowserLoading}
              >
                <Folder className="mr-1 h-4 w-4" /> Root
              </Button>
              {(folderListing.currentPath === "."
                ? []
                : String(folderListing.currentPath).split("/"))
                .map((part: string, index: number, parts: string[]) => {
                  const path = parts.slice(0, index + 1).join("/");
                  return (
                    <span className="flex items-center" key={path}>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => browseMountedFolder(path)}
                        disabled={folderBrowserLoading}
                      >
                        {part}
                      </Button>
                    </span>
                  );
                })}
            </div>
            {folderListing.parentPath && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => browseMountedFolder(folderListing.parentPath)}
                disabled={folderBrowserLoading}
              >
                <ArrowUp className="mr-2 h-4 w-4" /> Parent folder
              </Button>
            )}
            <div
              className="max-h-44 space-y-1 overflow-y-auto"
              aria-label="Mounted subfolders"
            >
              {(folderListing.folders ?? []).map((folder: any) => (
                <Button
                  key={folder.relativePath}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => browseMountedFolder(folder.relativePath)}
                  disabled={folderBrowserLoading}
                >
                  <Folder className="mr-2 h-4 w-4 text-primary" />
                  {folder.name}
                </Button>
              ))}
              {!folderBrowserLoading &&
                (folderListing.folders ?? []).length === 0 && (
                <div className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
                  No child folders. You can scan this folder itself.
                </div>
              )}
            </div>
            {folderBrowserError && (
              <div className="text-sm text-destructive">
                {folderBrowserError}
              </div>
            )}
            <div className="rounded bg-muted px-3 py-2 text-xs">
              Selected: <code>{relativePath}</code>
              {relativePath === "." && " — all folders under the mounted root"}
            </div>
            <Button
              onClick={startFolderScan}
              disabled={busy || folderBrowserLoading}
              className="w-full"
              variant="outline"
            >
              {busy
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <FolderSearch className="mr-2 h-4 w-4" />}
              Scan selected folder recursively
            </Button>
          </div>
          {folderCampaign && (
            <div className="space-y-3 rounded bg-muted p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>
                  {folderCampaign.progress?.waitingForRecovery
                    ? "Waiting for recovery"
                    : campaignStageLabel(
                      folderCampaign.progress?.stage,
                      folderCampaign.status,
                    )}
                </Badge>
                <code>{folderCampaign.relativePath}</code>
              </div>
              {folderCampaign.progress
                ? (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex justify-between gap-3 text-xs">
                        <span>{folderCampaign.progress.message}</span>
                        <strong>
                          {folderCampaign.progress.percent.toFixed(1)}%
                        </strong>
                      </div>
                      <Progress
                        value={folderCampaign.progress.percent}
                        className="h-2"
                      />
                      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {folderCampaign.progress.processed} of{" "}
                          {folderCampaign.progress.total}{" "}
                          {folderCampaign.progress.stage === "creating_previews"
                            ? "photos imported"
                            : "supported files checked"}
                        </span>
                        {folderCampaign.progress.remaining > 0 && (
                          <span>
                            {folderCampaign.progress.remaining} remaining
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {folderCampaign.progress.filesPerSecond != null && (
                        <span>
                          {Number(folderCampaign.progress.filesPerSecond)
                            .toFixed(2)} files/sec
                        </span>
                      )}
                      {folderCampaign.progress.etaSeconds != null && (
                        <span>
                          about{" "}
                          {durationLabel(folderCampaign.progress.etaSeconds)}
                          {" "}
                          remaining
                        </span>
                      )}
                      {folderCampaign.progress.lastProgressAt && (
                        <span>
                          last progress{" "}
                          {timeAgo(folderCampaign.progress.lastProgressAt)}
                        </span>
                      )}
                      <span>
                        {folderCampaign.progress.chunkSize}{" "}
                        files per durable step
                      </span>
                    </div>
                    <div className="rounded border bg-background/70 px-3 py-2 text-xs">
                      <strong>Next:</strong> {folderCampaign.progress.nextStep}
                    </div>
                  </>
                )
                : <div>{countLine(folderCampaign.counts)}</div>}
              <div className="text-xs text-muted-foreground">
                {countLine(folderCampaign.counts)}
                {Number(folderCampaign.reusedHashCount ?? 0) > 0 && (
                  <>· reused SHA {folderCampaign.reusedHashCount}</>
                )}
              </div>
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
      </CardContent>
    </Card>
  );
}
