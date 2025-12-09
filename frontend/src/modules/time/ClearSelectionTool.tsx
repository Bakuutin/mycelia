import { Tool } from "@/core/core.ts";
import { Button } from "@/components/ui/button.tsx";
import { CircleOff } from "lucide-react";
import { useTimelineSelectionStore } from "@/stores/timelineSelectionStore.ts";

export const ClearSelectionTool: Tool = {
  component: () => {
    const { selection, clearSelection } = useTimelineSelectionStore();
    const hasSelection = !!(selection.start && selection.end);

    return (
      <Button
        onClick={clearSelection}
        disabled={!hasSelection}
        variant="outline"
      >
        <CircleOff className="w-4 h-4" />
      </Button>
    );
  },
  tooltip: "Clear timeline selection",
};

