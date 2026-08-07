import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2, Trash2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useTrackVisibilityStore } from "@/stores/trackVisibilityStore";
import {
  locationKeys,
  useDeleteLocationImport,
  useLocationImports,
} from "@/hooks/useLocationQueries";

interface ImportResult {
  filename: string;
  importId?: string;
  pointsImported: number;
  pointsDeduplicated: number;
  pointsSkipped: number;
  duplicate?: boolean;
  error?: string;
}

interface ImportTracksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportTracksDialog({
  open,
  onOpenChange,
}: ImportTracksDialogProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: imports } = useLocationImports(open);
  const deleteImport = useDeleteLocationImport();
  const { visibleTracks, toggleTrack } = useTrackVisibilityStore();

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setIsUploading(true);
    setResults([]);
    try {
      const formData = new FormData();
      for (const file of files) formData.append("files", file);
      const authHeaders = await api.getAuthHeaders();
      const response = await fetch(`${api.baseURL}/api/location/upload`, {
        method: "POST",
        body: formData,
        headers: authHeaders, // No Content-Type — browser sets the boundary
      });
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }
      const data = await response.json();
      setResults(data.results ?? []);

      const imported = (data.results ?? []).reduce(
        (sum: number, r: ImportResult) => sum + (r.pointsImported ?? 0),
        0,
      );
      if (imported > 0) {
        toast.success(
          `Imported ${imported} location points. Processing into stays and timezones…`,
        );
        // Make the result visible right away for first-time users.
        if (!visibleTracks.includes("locations")) toggleTrack("locations");
      } else if (data.results?.every((r: ImportResult) => r.duplicate)) {
        toast.info("These files were already imported.");
      }
      queryClient.invalidateQueries({ queryKey: locationKeys.all });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload tracks",
      );
    } finally {
      setIsUploading(false);
    }
  }, [queryClient, toggleTrack, visibleTracks]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import GPS tracks</DialogTitle>
          <DialogDescription>
            GPX, KML or KMZ exports from Organic Maps and other navigation
            apps. Points without timestamps are skipped; re-importing the same
            data is safe.
          </DialogDescription>
        </DialogHeader>

        <div
          className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            uploadFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <FileUp className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop .gpx / .kml / .kmz files here, or
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Upload className="mr-2 h-4 w-4" />}
            Choose files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gpx,.kml,.kmz"
            multiple
            className="hidden"
            onChange={(e) => {
              uploadFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>

        {results.length > 0 && (
          <div className="space-y-1 text-sm">
            {results.map((r) => (
              <div
                key={r.filename}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{r.filename}</span>
                {r.error
                  ? <Badge variant="destructive">{r.error}</Badge>
                  : r.duplicate
                  ? <Badge variant="secondary">already imported</Badge>
                  : (
                    <span className="shrink-0 text-muted-foreground">
                      +{r.pointsImported}
                      {r.pointsDeduplicated > 0 &&
                        ` · ${r.pointsDeduplicated} dup`}
                      {r.pointsSkipped > 0 && ` · ${r.pointsSkipped} no time`}
                    </span>
                  )}
              </div>
            ))}
          </div>
        )}

        {(imports?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Previous imports
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {imports!.map((imp) => (
                <div
                  key={String(imp._id)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">{imp.filename}</span>
                  <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                    {imp.pointCount} pts
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Delete import and its points"
                      onClick={() => deleteImport.mutate(String(imp._id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
