import { Button } from "@/components/ui/button";
import { ObjectTile } from "@/components/ObjectTile";

interface SelectedObjectsPanelProps {
  selectedObjects: any[];
  onClear: () => void;
  hasSelections?: boolean;
  /** IDs of objects currently selected on the timeline */
  selectedIds?: Set<string>;
}

export function SelectedObjectsPanel({
  selectedObjects,
  onClear,
  hasSelections = true,
  selectedIds,
}: SelectedObjectsPanelProps) {
  if (selectedObjects.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-lg p-4">
      {hasSelections && (
        <div className="flex items-center justify-end mb-3">
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
      )}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {selectedObjects.map((object) => (
          <ObjectTile
            key={object._id.toString()}
            object={object}
            isSelected={selectedIds?.has(object._id.toString())}
          />
        ))}
      </div>
    </div>
  );
}
