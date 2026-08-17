import { toast } from "sonner";
import { Crosshair, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useDeleteLocationImport,
  useLocationImports,
} from "@/hooks/useLocationQueries";
import type { LocationImport } from "@/types/location";
import { useActionDialog } from "@/components/ActionDialogProvider";

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
  const { confirmAction } = useActionDialog();
  const number = new Intl.NumberFormat();

  const handleDelete = async (imp: LocationImport) => {
    const ok = await confirmAction({
      title: `Delete import "${imp.filename}"?`,
      description:
        "This source file and its metadata links will be removed. GPS points shared with another import will be kept.",
      actionLabel: "Delete import",
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await deleteImport.mutateAsync(String(imp._id));
      toast.success(
        `Import deleted (${
          number.format(result?.deletedPoints ?? 0)
        } source-only points removed).`,
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
              {imp.status !== "processed" && (
                <Badge
                  variant={imp.status === "failed" || imp.status === "error"
                    ? "destructive"
                    : "outline"}
                >
                  {imp.status === "parsed" ? "processing" : imp.status}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {imp.receipt
                ? (
                  <>
                    {number.format(imp.receipt.newPoints ?? imp.pointCount)} new
                    {imp.receipt.matchedPoints > 0 &&
                      ` · ${number.format(imp.receipt.matchedPoints)} linked`}
                    {imp.receipt.tracks > 0 &&
                      ` · ${number.format(imp.receipt.tracks)} tracks`}
                    {imp.receipt.bookmarks > 0 &&
                      ` · ${number.format(imp.receipt.bookmarks)} places`}
                    {imp.receipt.conflictGroups > 0 &&
                      ` · ${number.format(imp.receipt.conflictGroups)} review`}
                  </>
                )
                : (
                  <>
                    {number.format(imp.pointCount)} pts
                    {(imp.dedupedCount ?? 0) > 0 &&
                      ` · ${number.format(imp.dedupedCount ?? 0)} linked`}
                    {imp.skippedCount > 0 &&
                      ` · ${number.format(imp.skippedCount)} skipped`}
                  </>
                )}
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
                aria-label={`Show ${imp.filename} period on the map`}
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
              aria-label={`Delete import ${imp.filename}`}
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
