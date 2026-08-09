import { toast } from "sonner";
import { Crosshair, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useDeleteLocationImport,
  useLocationImports,
} from "@/hooks/useLocationQueries";
import type { LocationImport } from "@/types/location";

interface ImportsListProps {
  enabled?: boolean;
  /** Fly the map (or navigate) to the import's time range. */
  onShowOnMap?: (imp: LocationImport) => void;
  emptyText?: string;
}

export function ImportsList({
  enabled = true,
  onShowOnMap,
  emptyText = "No tracks imported yet.",
}: ImportsListProps) {
  const { data: imports, isLoading } = useLocationImports(enabled);
  const deleteImport = useDeleteLocationImport();

  const handleDelete = async (imp: LocationImport) => {
    const ok = confirm(
      `Delete import "${imp.filename}" and its ${imp.pointCount} GPS points? Segments for that period will be rebuilt without them.`,
    );
    if (!ok) return;
    try {
      const result = await deleteImport.mutateAsync(String(imp._id));
      toast.success(
        `Import deleted (${result?.deletedPoints ?? imp.pointCount} points removed).`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!imports || imports.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-1.5">
      {imports.map((imp) => (
        <div
          key={String(imp._id)}
          className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{imp.filename}</span>
              <Badge variant="secondary" className="uppercase">
                {imp.format}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {imp.pointCount} pts
              {(imp.dedupedCount ?? 0) > 0 && ` · ${imp.dedupedCount} dup`}
              {imp.skippedCount > 0 && ` · ${imp.skippedCount} no time`}
              {imp.timeRange?.start && (
                <>
                  {" · "}
                  {new Date(imp.timeRange.start).toLocaleDateString()} —{" "}
                  {new Date(imp.timeRange.end).toLocaleDateString()}
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-0.5">
            {onShowOnMap && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Show this period on the map"
                onClick={() => onShowOnMap(imp)}
              >
                <Crosshair className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              title="Delete import and its points"
              onClick={() => handleDelete(imp)}
              disabled={deleteImport.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
