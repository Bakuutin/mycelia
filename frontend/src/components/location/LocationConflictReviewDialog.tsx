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
  useLocationMetadataConflicts,
  useLocationRouteConflicts,
  useResolveLocationConflict,
  useResolveLocationMetadataConflict,
  useResolveLocationRouteConflict,
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
  const { data: metadataData, isLoading: metadataLoading } =
    useLocationMetadataConflicts("pending", open);
  const resolve = useResolveLocationConflict();
  const resolveMetadata = useResolveLocationMetadataConflict();
  const { data: routeData, isLoading: routesLoading } =
    useLocationRouteConflicts("pending", open);
  const resolveRoute = useResolveLocationRouteConflict();
  const hasCoordinateConflicts = (data?.conflicts.length ?? 0) > 0;
  const hasMetadataConflicts = (metadataData?.conflicts.length ?? 0) > 0;
  const hasRouteConflicts = (routeData?.conflicts.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review location differences</DialogTitle>
          <DialogDescription>
            Source variants are retained. Coordinate candidates stay out of the
            timeline, while metadata uses its deterministic default until you
            explicitly choose a value.
          </DialogDescription>
        </DialogHeader>
        {isLoading || metadataLoading || routesLoading
          ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )
          : !hasCoordinateConflicts && !hasMetadataConflicts &&
              !hasRouteConflicts
          ? (
            <p className="text-sm text-muted-foreground">
              Nothing needs review.
            </p>
          )
          : (
            <div className="space-y-5">
              {hasRouteConflicts && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">
                    Overlapping route sources ({routeData!.conflicts.length})
                  </h3>
                  {routeData!.conflicts.map((conflict) => (
                    <section
                      key={String(conflict._id)}
                      className="space-y-3 rounded-md border p-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">
                          {new Date(conflict.overlapStart).toLocaleString()} —
                          {" "}
                          {new Date(conflict.overlapEnd).toLocaleString()}
                        </p>
                        <Badge variant="outline">needs review</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {conflict.trackNames[0] || "Source 1"} and{" "}
                        {conflict.trackNames[1] || "Source 2"} are separated by
                        {" "}
                        {(conflict.medianSeparationM / 1000).toFixed(0)}{" "}
                        km in the same period. Both remain visible until you
                        decide.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolveRoute.isPending}
                          onClick={() =>
                            resolveRoute.mutate({
                              id: String(conflict._id),
                              resolution: "use_first",
                            })}
                        >
                          Use {conflict.trackNames[0] || "source 1"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolveRoute.isPending}
                          onClick={() =>
                            resolveRoute.mutate({
                              id: String(conflict._id),
                              resolution: "use_second",
                            })}
                        >
                          Use {conflict.trackNames[1] || "source 2"}
                        </Button>
                        <Button
                          size="sm"
                          disabled={resolveRoute.isPending}
                          onClick={() =>
                            resolveRoute.mutate({
                              id: String(conflict._id),
                              resolution: "keep_both",
                            })}
                        >
                          Keep both
                        </Button>
                      </div>
                    </section>
                  ))}
                </div>
              )}
              {hasCoordinateConflicts && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">
                    Coordinate differences ({data!.conflicts.length})
                  </h3>
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
                                {point.ele !== undefined
                                  ? ` · ${point.ele} m`
                                  : ""}
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
                                {point.ele !== undefined
                                  ? ` · ${point.ele} m`
                                  : ""}
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
              {hasMetadataConflicts && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">
                    Metadata differences ({metadataData!.conflicts.length})
                  </h3>
                  {metadataData!.conflicts.map((conflict) => (
                    <section
                      key={String(conflict._id)}
                      className="space-y-3 rounded-md border p-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">
                          {conflict.entityType} · {conflict.field}
                        </p>
                        <Badge variant="outline">
                          default: {conflict.defaultSelection}
                        </Badge>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                            Current
                          </p>
                          <pre className="overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                            {JSON.stringify(conflict.existingValue, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                            Incoming {conflict.incomingFormat.toUpperCase()}
                          </p>
                          <pre className="overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                            {JSON.stringify(conflict.incomingValue, null, 2)}
                          </pre>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={resolveMetadata.isPending}
                          onClick={() =>
                            resolveMetadata.mutateAsync({
                              id: String(conflict._id),
                              resolution: "defer",
                            })}
                        >
                          Decide later
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resolveMetadata.isPending}
                          onClick={() =>
                            resolveMetadata.mutateAsync({
                              id: String(conflict._id),
                              resolution: "keep_existing",
                            })}
                        >
                          Keep current
                        </Button>
                        <Button
                          size="sm"
                          disabled={resolveMetadata.isPending}
                          onClick={() =>
                            resolveMetadata.mutateAsync({
                              id: String(conflict._id),
                              resolution: "use_incoming",
                            })}
                        >
                          Use incoming
                        </Button>
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}
