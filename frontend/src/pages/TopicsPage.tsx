import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatTime } from '@/lib/formatTime';
import { Button } from '@/components/ui/button';
import { useTopicsStore, type HistogramItem } from '@/stores/topicsStore';

interface TopicItem {
  name: string;
  importance: number;
  description: string;
}

const TopicsPage = () => {
  const { items, loading, loadingMore, error, fetchInitial, loadMore } = useTopicsStore();
  const { timeFormat } = useSettingsStore();

  function normalizeTopic(raw: unknown): TopicItem {
    if (typeof raw === 'string') {
      return { name: raw, importance: 0, description: '' };
    }
    if (raw && typeof raw === 'object') {
      const anyRaw = raw as Record<string, unknown>;
      const nameValue = typeof anyRaw.name === 'string'
        ? anyRaw.name
        : typeof anyRaw.topic === 'string'
          ? anyRaw.topic
          : 'Untitled';
      const importanceValue = typeof anyRaw.importance === 'number' && Number.isFinite(anyRaw.importance)
        ? anyRaw.importance
        : 0;
      const descriptionValue = typeof anyRaw.description === 'string' ? anyRaw.description : '';
      return {
        name: nameValue,
        importance: importanceValue,
        description: descriptionValue,
      };
    }
    return { name: 'Untitled', importance: 0, description: '' };
  }

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  // Removed IntersectionObserver in favor of an explicit button to load more

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Topics</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading topics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Topics</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Topics</h1>

      <div className="border rounded-lg divide-y">
        {items.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground">No topics found</p>
          </div>
        ) : (
          items.map((hist) => (
            <div key={typeof hist._id === 'string' ? hist._id : (hist._id as any).toString?.() ?? JSON.stringify(hist._id)} className="p-4">
              <div className="flex items-baseline justify-between gap-4">
                {(() => {
                  const startDate = new Date(hist.start);
                  const endDate = hist.end ? new Date(hist.end) : new Date(new Date(hist.start).getTime() + 5 * 60 * 1000);
                  const startMs = startDate.getTime();
                  const endMs = endDate.getTime();
                  return (
                    <Link
                      to={{ pathname: '/transcript', search: `?start=${startMs}&end=${endMs}` }}
                      className="text-sm text-muted-foreground hover:underline"
                    >
                      {formatTime(startDate, timeFormat)} → {formatTime(endDate, timeFormat)}
                    </Link>
                  );
                })()}
                {hist.topics && (
                  <span className="text-xs text-muted-foreground">{hist.topics.length} topics</span>
                )}
              </div>

              {hist.topics && hist.topics.length > 0 && (
                <ul className="mt-3 list-disc pl-6 space-y-1">
                  {(hist.topics as unknown[])
                    .map(normalizeTopic)
                    .map((t, idx) => (
                      <li key={idx} className="text-sm">{t.name}</li>
                    ))}
                </ul>
              )}
            </div>
          ))
        )}
        <div className="p-4 text-center">
          <Button type="button" variant="secondary" onClick={loadMore} disabled={loadingMore || items.length === 0}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TopicsPage;


