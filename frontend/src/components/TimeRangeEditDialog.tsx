import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { formatTime } from "@/lib/formatTime";
import { Pencil, Trash2 } from "lucide-react";

interface TimeRange {
  start: Date;
  end?: Date;
  name?: string;
}

interface TimeRangeEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeRange: TimeRange;
  index: number;
  onSave: (index: number, range: TimeRange) => void;
  onDelete: (index: number) => void;
}

export function TimeRangeEditDialog({
  open,
  onOpenChange,
  timeRange,
  index,
  onSave,
  onDelete,
}: TimeRangeEditDialogProps) {
  const [name, setName] = useState(timeRange.name || "");
  const [start, setStart] = useState<Date>(timeRange.start);
  const [end, setEnd] = useState<Date | undefined>(timeRange.end);

  const handleSave = () => {
    onSave(index, {
      start,
      end,
      name: name.trim() || undefined,
    });
    onOpenChange(false);
  };

  const handleDelete = () => {
    onDelete(index);
    onOpenChange(false);
  };

  // Format duration
  const getDuration = () => {
    if (!start || !end) return null;
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "< 1 minute";
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""}`;
    if (diffHours < 24) {
      const mins = diffMins % 60;
      return mins > 0 ? `${diffHours}h ${mins}m` : `${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
    }
    return `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Time Range {index + 1}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="range-name">Name (optional)</Label>
            <Input
              id="range-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Meeting, Event, etc."
            />
          </div>

          {/* Start Time */}
          <div className="space-y-2">
            <Label>Start Time</Label>
            <DateTimePicker
              value={start}
              onChange={(date) => date && setStart(date)}
              placeholder="Select start time"
            />
          </div>

          {/* End Time */}
          <div className="space-y-2">
            <Label>End Time (optional)</Label>
            <DateTimePicker
              value={end}
              onChange={(date) => setEnd(date || undefined)}
              placeholder="Select end time"
              nullable
            />
          </div>

          {/* Duration display */}
          {getDuration() && (
            <div className="text-sm text-muted-foreground">
              Duration: <span className="font-medium">{getDuration()}</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Compact display component for time ranges
interface TimeRangeCompactProps {
  timeRange: TimeRange;
  index: number;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}

export function TimeRangeCompact({
  timeRange,
  index,
  onEdit,
  onDelete,
}: TimeRangeCompactProps) {
  const formatDateTime = (date: Date): string => {
    return formatTime(date);
  };

  const getDuration = () => {
    if (!timeRange.end) return "Ongoing";
    const diffMs = timeRange.end.getTime() - timeRange.start.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) {
      const mins = diffMins % 60;
      return mins > 0 ? `${diffHours}h ${mins}m` : `${diffHours}h`;
    }
    const days = Math.floor(diffHours / 24);
    return `${days}d`;
  };

  return (
    <div className="flex items-center justify-between gap-2 p-2 border rounded-md bg-muted/20 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {timeRange.name && (
            <span className="text-sm font-medium truncate">{timeRange.name}</span>
          )}
          {!timeRange.name && (
            <span className="text-sm text-muted-foreground">Time Range {index + 1}</span>
          )}
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {getDuration()}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {formatDateTime(timeRange.start)}
          {timeRange.end && ` → ${formatDateTime(timeRange.end)}`}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onEdit(index)}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onDelete(index)}
        >
          <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}
