import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Conversation } from '@/types/conversations';
import { Button } from '@/components/ui/button';
import { PlusIcon, MessageSquare } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ConversationCard } from '@/components/ConversationCard';
import { formatTime } from '@/lib/formatTime';
import { useSettingsStore } from '@/stores/settingsStore';
import { Badge } from '@/components/ui/badge';

const ConversationsPage = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { timeFormat } = useSettingsStore();

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "aggregate",
          collection: "conversations",
          pipeline: [
            {
              $addFields: {
                latestEnd: {
                  $max: {
                    $map: {
                      input: "$timeRanges",
                      as: "r",
                      in: { $ifNull: ["$$r.end", "$$r.start"] }
                    }
                  }
                }
              }
            },
            { $sort: { latestEnd: -1 } },
          ],
        });
        setConversations(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch conversations');
      } finally {
        setLoading(false);
      }
    };

    fetchConversations();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Conversations</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading conversations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Conversations</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-2 md:px-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Conversations</h1>
        <Link to="/conversations/new">
          <Button>
            <PlusIcon className="w-4 h-4 mr-2" />
            Create Conversation
          </Button>
        </Link>
      </div>

      {conversations.length === 0 ? (
        <Card className="p-8 text-center">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            No conversations yet. Create your first conversation!
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(() => {
            const oneHourMs = 60 * 60 * 1000;
            let lastBucket: number | null = null;
            const elements: JSX.Element[] = [];
            const getLatestEndMs = (c: Conversation): number => {
              const ranges = Array.isArray(c.timeRanges) ? c.timeRanges : [];
              let maxMs = 0;
              for (const r of ranges) {
                const endMs = new Date(r.end || r.start).getTime();
                if (endMs > maxMs) maxMs = endMs;
              }
              return maxMs || new Date(c.updatedAt).getTime();
            };

            for (let i = 0; i < conversations.length; i++) {
              const c = conversations[i];
              const latestEndMs = getLatestEndMs(c);
              const bucketStartMs = Math.floor(latestEndMs / oneHourMs) * oneHourMs;
              if (bucketStartMs !== lastBucket) {
                lastBucket = bucketStartMs;
                const label = formatTime(new Date(bucketStartMs), timeFormat);
                elements.push(
                  <div key={`divider-${bucketStartMs}-${i}`} className="sm:col-span-2 relative my-2">
                    <div className="border-t" />
                    <div className="absolute left-1/2 -top-0">
                      <Badge variant="secondary" className="text-xs" style={{ transform: 'translate(-50%, -14px)' }}>
                        {label}
                      </Badge>
                    </div>
                  </div>
                );
              }
              elements.push(
                <ConversationCard
                  key={c._id.toString()}
                  conversation={c}
                />
              );
            }
            return elements;
          })()}
        </div>
      )}
    </div>
  );
};

export default ConversationsPage;
