import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useLocationConflicts,
  useResolveLocationConflict,
} from "@/hooks/useLocationQueries";

function coordinate(point: { loc: { coordinates: [number, number] } }): string {
  return `${point.loc.coordinates[1].toFixed(6)}, ${
    point.loc.coordinates[0].toFixed(6)
  }`;
}

export function LocationConflictReviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useLocationConflicts("pending", open);
  const resolve = useResolveLocationConflict();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review coordinate differences</DialogTitle>
          <DialogDescription>
            Both source versions are retained. Until you decide, the existing
            coordinates remain canonical and incoming candidates do not affect
            stays, routes or timezones.
          </DialogDescription>
        </DialogHeader>
        {isLoading
          ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )
          : (data?.conflicts.length ?? 0) === 0
          ? (
            <p className="text-sm text-muted-foreground">
              Nothing needs review.
            </p>
          )
          : (
            <div className="space-y-3">
              {data!.conflicts.map((conflict) => {
                const candidate = conflict.candidates?.[0];
                return (
                  <section
                    key={String(conflict._id)}
                    className="space-y-3 rounded-md border p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">
                        {new Date(conflict.ts).toLocaleString()} ·{" "}
                        {new Date(conflict.ts).toISOString()}
                      </p>
                      <Badge variant="outline">needs review</Badge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                          Current
                        </p>
                        {(conflict.existingPoints ?? []).map((point) => (
                          <p key={point.hash} className="font-mono text-xs">
                            {coordinate(point)}
                            {point.ele !== undefined ? ` · ${point.ele} m` : ""}
                          </p>
                        ))}
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                          Incoming {candidate?.format?.toUpperCase()}
                        </p>
                        {(candidate?.points ?? []).map((point) => (
                          <p key={point.hash} className="font-mono text-xs">
                            {coordinate(point)}
                            {point.ele !== undefined ? ` · ${point.ele} m` : ""}
                          </p>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={resolve.isPending}
                        onClick={() =>
                          resolve.mutateAsync({
                            id: String(conflict._id),
                            resolution: "defer",
                          })}
                      >
                        Decide later
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={resolve.isPending}
                        onClick={() =>
                          resolve.mutateAsync({
                            id: String(conflict._id),
                            resolution: "keep_existing",
                          })}
                      >
                        Keep current
                      </Button>
                      <Button
                        size="sm"
                        disabled={resolve.isPending || !candidate}
                        onClick={() =>
                          resolve.mutateAsync({
                            id: String(conflict._id),
                            resolution: "use_incoming",
                            candidateImportId: candidate
                              ? String(candidate.importId)
                              : undefined,
                          })}
                      >
                        Use incoming
                      </Button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}
