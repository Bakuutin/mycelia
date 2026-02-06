import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Maximize2, Bookmark, Trash2, Star } from "lucide-react";
import { config } from "@/config";
import { useMarkedRangesStore } from "@/stores/markedRangesStore";
import { formatTime } from "@/lib/formatTime";

interface TimelineToolbarProps {
  onZoomToFit: () => void;
  onTimeRangeSelect: (range: string) => void;
  onZoomToRange?: (start: Date, end: Date) => void;
}

const ToolWrapper = ({ tool }: { tool: any }) => {
  const Component = tool.component;

  return (
    <div className="flex flex-col items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Component />
          </span>
        </TooltipTrigger>
        {tool.tooltip && (
          <TooltipContent>
            <p>{tool.tooltip}</p>
          </TooltipContent>
        )}
      </Tooltip>
      {tool.label && (
        <span className="text-xs text-muted-foreground">{tool.label}</span>
      )}
    </div>
  );
};

export function TimelineToolbar({
  onZoomToFit,
  onTimeRangeSelect,
  onZoomToRange,
}: TimelineToolbarProps) {
  const { ranges, removeRange } = useMarkedRangesStore();

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button variant="outline" size="icon" onClick={onZoomToFit}>
                <Maximize2 className="w-4 h-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Fit timeline to show all entities</p>
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-muted-foreground">Fit All</span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <Clock className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Jump to a specific time range</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onTimeRangeSelect("last5min")}>
              Last 5 minutes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTimeRangeSelect("lastHour")}>
              Last hour
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTimeRangeSelect("today")}>
              Today
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTimeRangeSelect("yesterday")}>
              Yesterday
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTimeRangeSelect("thisWeek")}>
              This week
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTimeRangeSelect("currentMonth")}>
              Current month
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTimeRangeSelect("yearToDate")}>
              Year to date
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTimeRangeSelect("pastYear")}>
              Past year
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-xs text-muted-foreground">Time Range</span>
      </div>

      {/* Bookmarks popover */}
      <div className="flex flex-col items-center gap-1">
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="relative">
                  <Bookmark className="w-4 h-4" />
                  {ranges.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
                      {ranges.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Bookmarked ranges</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="p-3 border-b">
              <h4 className="font-medium text-sm">Bookmarks ({ranges.length})</h4>
            </div>
            {ranges.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No bookmarks yet. Select a time range and click the star to bookmark it.
              </div>
            ) : (
              <ScrollArea className="max-h-80">
                <div className="divide-y">
                  {ranges.map((range) => (
                    <div
                      key={range.id}
                      className="flex items-center gap-2 p-2 hover:bg-muted/50 group"
                    >
                      <Star
                        className="w-3.5 h-3.5 flex-shrink-0 fill-current"
                        style={{ color: range.color }}
                      />
                      <button
                        className="flex-1 text-left min-w-0 cursor-pointer"
                        onClick={() => onZoomToRange?.(range.start, range.end)}
                      >
                        <div className="text-sm font-medium truncate">
                          {range.label || "Untitled"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {formatTime(range.start)} &mdash; {formatTime(range.end)}
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRange(range.id);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </PopoverContent>
        </Popover>
        <span className="text-xs text-muted-foreground">Bookmarks</span>
      </div>

      {config.tools.map((tool, i) => (
        <ToolWrapper key={i} tool={tool} />
      ))}
    </div>
  );
}
