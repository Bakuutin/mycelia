import { ScrollArea } from "@/components/ui/scroll-area";
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
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Objects ({selectedObjects.length})
        </h3>
        {hasSelections && selectedObjects.length > 0 && (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      {selectedObjects.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No objects in the current time range
        </p>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="grid gap-4 grid-cols-1 pr-3">
            {selectedObjects.map((object) => (
              <ObjectTile
                key={object._id.toString()}
                object={object}
                isSelected={selectedIds?.has(object._id.toString())}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
