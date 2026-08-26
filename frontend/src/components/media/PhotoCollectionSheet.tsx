import { ArrowUpRight, Loader2, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { AuthenticatedMediaImage } from "@/components/media/AuthenticatedMediaImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface PhotoCollectionItem {
  assetId: string;
  fileName: string;
  status: string;
  capturedAt?: string | Date | null;
  thumbnailUrl?: string;
  shortCaption?: string;
  location?: {
    latitude: number;
    longitude: number;
  } | null;
}

export interface PhotoCollectionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  items: PhotoCollectionItem[];
  total?: number;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
}

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (
    [
      "failed",
      "budget_blocked",
      "source_missing",
      "source_changed",
    ].includes(status)
  ) {
    return "destructive";
  }
  if (["queued", "processing", "staged"].includes(status)) {
    return "secondary";
  }
  return status === "ready" ? "default" : "outline";
}

function capturedAtLabel(value: PhotoCollectionItem["capturedAt"]):
  | string
  | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : undefined;
}

export function PhotoCollectionSheet({
  open,
  onOpenChange,
  title,
  description,
  items,
  total = items.length,
  loading = false,
  hasMore = false,
  onLoadMore,
}: PhotoCollectionSheetProps) {
  const countLabel = hasMore && total <= items.length
    ? `Showing ${items.length} photo${items.length === 1 ? "" : "s"}`
    : total === items.length
    ? `${total} photo${total === 1 ? "" : "s"}`
    : `${items.length} of ${total} photos`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 border-b px-6 py-5 pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {description ?? countLabel}
          </SheetDescription>
          {description && (
            <div className="text-xs text-muted-foreground">{countLabel}</div>
          )}
        </SheetHeader>

        {loading && items.length === 0
          ? (
            <div
              className="flex min-h-48 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading photos…
            </div>
          )
          : items.length === 0
          ? (
            <div className="flex min-h-48 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              No photos to show.
            </div>
          )
          : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="divide-y px-4">
                {items.map((item) => {
                  const capturedAt = capturedAtLabel(item.capturedAt);
                  return (
                    <Link
                      key={item.assetId}
                      to={`/media?assetId=${encodeURIComponent(item.assetId)}`}
                      aria-label={`Open ${item.fileName}`}
                      className="group grid grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <AuthenticatedMediaImage
                        path={item.thumbnailUrl}
                        alt={item.fileName}
                        className="h-20 w-20 rounded-md border bg-muted object-cover"
                      />
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1 truncate text-sm font-medium">
                            {item.fileName}
                          </div>
                          <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                        </div>
                        <p className="line-clamp-3 text-sm text-muted-foreground">
                          {item.shortCaption?.trim() ||
                            "No visual description yet."}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={statusVariant(item.status)}>
                            {item.status}
                          </Badge>
                          {capturedAt && (
                            <span className="text-xs text-muted-foreground">
                              {capturedAt}
                            </span>
                          )}
                        </div>
                        {item.location && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {item.location.latitude.toFixed(5)},{" "}
                            {item.location.longitude.toFixed(5)}
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </ScrollArea>
          )}

        {hasMore && (
          <div className="shrink-0 border-t p-4">
            {onLoadMore
              ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={loading}
                  onClick={() => void onLoadMore()}
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? "Loading more…" : "Load more photos"}
                </Button>
              )
              : (
                <p className="text-center text-xs text-muted-foreground">
                  Additional photos may be available in this view.
                </p>
              )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
