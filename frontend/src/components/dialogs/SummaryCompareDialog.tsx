import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/Markdown";
import { Star } from "lucide-react";
import { formatRelativeTime } from "@/lib/formatTime";
import type { Object } from "@/types/objects";

type Summary = NonNullable<Object["summaries"]>[number];

interface SummaryCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaries: Summary[];
  initialLeftIndex: number;
  onStarSummary: (index: number) => void;
}

function SummaryPanel({
  summary,
  index,
  summaries,
  onSelectIndex,
  onStar,
  isStarred,
}: {
  summary: Summary;
  index: number;
  summaries: Summary[];
  onSelectIndex: (index: number) => void;
  onStar: () => void;
  isStarred: boolean;
}) {
  const formatCost = (cost: number | undefined) => {
    if (cost === undefined || cost === null) return "N/A";
    return `$${cost.toFixed(4)}`;
  };

  const formatTokens = (tokens: number | undefined) => {
    if (tokens === undefined || tokens === null) return "N/A";
    return tokens.toLocaleString();
  };

  const getModelDisplay = (summary: Summary) => {
    const alias = ["small", "medium", "large"].includes(summary.model)
      ? summary.model
      : "custom";
    return summary.modelName ? `${alias} | ${summary.modelName}` : alias;
  };

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden">
      {/* Dropdown header */}
      <div className="p-2 border-b bg-muted/30 flex-shrink-0">
        <Select
          value={String(index)}
          onValueChange={(v) => onSelectIndex(Number(v))}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {summaries[index]?.model} - {formatRelativeTime(new Date(summaries[index]?.date))}
              {summaries[index]?.starred && " ★"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {summaries.map((s, i) => (
              <SelectItem key={i} value={String(i)}>
                <span className="flex items-center gap-2">
                  {s.starred && <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />}
                  <span>{s.model} - {formatRelativeTime(new Date(s.date))}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary content */}
      <ScrollArea className="flex-1 p-3">
        <div className="prose prose-sm max-w-none">
          <Markdown>{summary.text}</Markdown>
        </div>
      </ScrollArea>

      {/* Metadata footer */}
      <div className="p-3 border-t bg-muted/30 flex-shrink-0 space-y-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">Model:</span>
            <span className="ml-1 font-medium">{getModelDisplay(summary)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Cost:</span>
            <span className="ml-1 font-medium">{formatCost(summary.usage?.cost)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Tokens:</span>
            <span className="ml-1 font-medium">{formatTokens(summary.usage?.totalTokens)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Date:</span>
            <span className="ml-1 font-medium">{formatRelativeTime(new Date(summary.date))}</span>
          </div>
        </div>
        <Button
          variant={isStarred ? "default" : "outline"}
          size="sm"
          className="w-full"
          onClick={onStar}
        >
          <Star className={`w-4 h-4 mr-1 ${isStarred ? "fill-current" : ""}`} />
          {isStarred ? "Starred" : "Star"}
        </Button>
      </div>
    </div>
  );
}

export function SummaryCompareDialog({
  open,
  onOpenChange,
  summaries,
  initialLeftIndex,
  onStarSummary,
}: SummaryCompareDialogProps) {
  const [leftIndex, setLeftIndex] = useState(initialLeftIndex);
  const [rightIndex, setRightIndex] = useState(() => {
    // Default right panel to starred or latest
    const starredIndex = summaries.findIndex((s) => s.starred);
    if (starredIndex !== -1 && starredIndex !== initialLeftIndex) {
      return starredIndex;
    }
    // Latest (last in array), or first if left is already latest
    const latestIndex = summaries.length - 1;
    return latestIndex !== initialLeftIndex ? latestIndex : 0;
  });

  // Reset indices when dialog opens with new initial values
  useEffect(() => {
    if (open) {
      setLeftIndex(initialLeftIndex);
      const starredIndex = summaries.findIndex((s) => s.starred);
      if (starredIndex !== -1 && starredIndex !== initialLeftIndex) {
        setRightIndex(starredIndex);
      } else {
        const latestIndex = summaries.length - 1;
        setRightIndex(latestIndex !== initialLeftIndex ? latestIndex : 0);
      }
    }
  }, [open, initialLeftIndex, summaries]);

  if (summaries.length < 2) {
    return null;
  }

  const leftSummary = summaries[leftIndex];
  const rightSummary = summaries[rightIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Compare Summaries</DialogTitle>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
          <SummaryPanel
            summary={leftSummary}
            index={leftIndex}
            summaries={summaries}
            onSelectIndex={setLeftIndex}
            onStar={() => onStarSummary(leftIndex)}
            isStarred={!!leftSummary.starred}
          />
          <SummaryPanel
            summary={rightSummary}
            index={rightIndex}
            summaries={summaries}
            onSelectIndex={setRightIndex}
            onStar={() => onStarSummary(rightIndex)}
            isStarred={!!rightSummary.starred}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
