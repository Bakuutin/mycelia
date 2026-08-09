import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Clock, Map as MapIcon, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDeleteLocationSegment } from "@/hooks/useLocationQueries";
import { LocationMiniMap } from "./LocationMiniMap";
import { AssignLocationDialog } from "./AssignLocationDialog";
import { formatDurationShort } from "./LocationMap";
import type { LocationSegment } from "@/types/location";
import {
  formatPlace,
  formatSources,
  segmentDurationMs,
} from "@/types/location";

const TYPE_LABEL: Record<string, string> = {
  stay: "Stay (from GPS track)",
  move: "Movement (from GPS track)",
  gap: "Assumed — no data",
  manual: "Manual assignment",
};

interface LocationSegmentDialogProps {
  segment: LocationSegment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the segment was deleted (close panels, refetch, …). */
  onDeleted?: () => void;
}

export function LocationSegmentDialog({
  segment,
  open,
  onOpenChange,
  onDeleted,
}: LocationSegmentDialogProps) {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteSegment = useDeleteLocationSegment();

  if (!segment) return null;

  const isManual = segment.type === "manual";
  const durationMs = segmentDurationMs(segment);
  const sources = formatSources(segment.sources);

  const openInMap = () => {
    const s = new Date(segment.start).getTime() - 60 * 60 * 1000;
    const e = new Date(segment.end).getTime() + 60 * 60 * 1000;
    onOpenChange(false);
    navigate(`/map?start=${s}&end=${e}`);
  };

  const handleDelete = async () => {
    try {
      const result = await deleteSegment.mutateAsync(String(segment._id));
      toast.success(
        isManual
          ? "Manual location removed; derived data for the range is restored."
          : `Geotag deleted (${
            result?.deletedPoints ?? 0
          } GPS points removed permanently).`,
      );
      setConfirmDelete(false);
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              📍 {formatPlace(segment.place)}
              {segment.timeZone && (
                <Badge variant="secondary">{segment.timeZone}</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {TYPE_LABEL[segment.type] ?? segment.type}
            </DialogDescription>
          </DialogHeader>

          <LocationMiniMap segments={[segment]} primary={segment} />

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">When</span>
              <span className="text-right">
                {new Date(segment.start).toLocaleString()} —{" "}
                {new Date(segment.end).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Duration</span>
              <span>{formatDurationShort(durationMs)}</span>
            </div>
            {segment.distanceM !== undefined && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Distance</span>
                <span>{(segment.distanceM / 1000).toFixed(1)} km</span>
              </div>
            )}
            {sources.length > 0 && (
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground">Source</span>
                <span className="flex flex-wrap justify-end gap-1">
                  {sources.map((s) => (
                    <Badge key={s} variant="outline" className="font-normal">
                      {s}
                    </Badge>
                  ))}
                </span>
              </div>
            )}
          </div>

          {confirmDelete && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {isManual
                ? "Remove this manual assignment? The derived data (if any) for this range reappears."
                : "This permanently deletes the GPS points behind this geotag. Re-importing the same file will NOT restore them. Continue?"}
              <div className="mt-2 flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleteSegment.isPending}
                >
                  Yes, delete
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2 sm:justify-start">
            <Button variant="outline" size="sm" onClick={openInMap}>
              <MapIcon className="mr-1.5 h-4 w-4" />
              Open in map
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const s = new Date(segment.start).getTime() - 60 * 60 * 1000;
                const e = new Date(segment.end).getTime() + 60 * 60 * 1000;
                onOpenChange(false);
                navigate(`/timeline?start=${s}&end=${e}`);
              }}
            >
              <Clock className="mr-1.5 h-4 w-4" />
              Timeline
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              {isManual ? "Edit" : "Override"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssignLocationDialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) onOpenChange(false);
        }}
        editSegment={segment}
      />
    </>
  );
}
