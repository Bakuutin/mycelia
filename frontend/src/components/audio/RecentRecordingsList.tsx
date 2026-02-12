import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { RecordingCard, type SourceFileRecord } from "./RecordingCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, ChevronDown, ListMusic } from "lucide-react";

const PAGE_SIZE = 5;

export function RecentRecordingsList() {
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  const {
    data: recordings,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["recent-web-recordings", displayCount],
    queryFn: async () => {
      // Query source_files for web recordings (streaming_api from web)
      const results = await api.callResource("mongo", {
        action: "find",
        collection: "source_files",
        query: {
          $or: [
            { "metadata.source": "websocket" },
            { importer: "streaming_api", "platform.node": "web" },
          ],
        },
        options: {
          sort: { start: -1 },
          limit: displayCount + 1, // +1 to check if there's more
        },
      }) as SourceFileRecord[];

      return results;
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const hasMore = recordings && recordings.length > displayCount;
  const displayedRecordings = recordings?.slice(0, displayCount) || [];

  const handleLoadMore = () => {
    setDisplayCount((prev) => prev + PAGE_SIZE);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListMusic className="h-5 w-5" />
            Recent Recordings
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!recordings || recordings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListMusic className="h-5 w-5" />
            Recent Recordings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No recordings yet. Start recording to see your audio here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListMusic className="h-5 w-5" />
          Recent Recordings
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {displayedRecordings.map((recording) => (
          <RecordingCard key={recording._id} recording={recording} />
        ))}

        {hasMore && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleLoadMore}
            disabled={isFetching}
          >
            <ChevronDown className="h-4 w-4 mr-2" />
            Load More
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
