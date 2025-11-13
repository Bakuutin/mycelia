import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { Object } from "@/types/objects";
import { formatTime } from "@/lib/formatTime";
import { useSettingsStore } from "@/stores/settingsStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { X } from "lucide-react";
import { TimelineChart } from "@/components/timeline/TimelineChart";
import { IconDisplay } from "@/components/IconDisplay";
import { config } from "@/config";
import { useObjects } from "@/modules/objects/useObjects";
import { isTimeRangeShorterThanTranscriptThreshold } from "@/lib/transcriptUtils";

const TimelinePage = () => {
  const { objects, loading, error } = useObjects();
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(
    new Set(),
  );
  const { timeFormat } = useSettingsStore();

  const toggleObjectSelection = (objectId: string) => {
    setSelectedObjectIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(objectId)) {
        newSet.delete(objectId);
      } else {
        newSet.add(objectId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedObjectIds(new Set(objects.map((o) => o._id.toString())));
  };

  const clearSelection = () => {
    setSelectedObjectIds(new Set());
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading objects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500 mb-2">Error loading objects: {error}</p>
          <p className="text-sm text-muted-foreground">
            Check browser console for details
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="flex items-center gap-2">
          {config.tools.map((tool, i) => <tool.component key={i} />)}
        </div>
      </div>

      <div className="border rounded-lg p-2">
        <TimelineChart />
      </div>
    </div>
  );
};

export default TimelinePage;
