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
import { Clock } from "lucide-react";
import { config } from "@/config";

interface TimelineToolbarProps {
  onZoomToFit: () => void;
  onTimeRangeSelect: (range: string) => void;
}

const ToolWrapper = ({ tool }: { tool: any }) => {
  const Component = tool.component;

  if (!tool.tooltip) {
    return <Component />;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Component />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tool.tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export function TimelineToolbar({
  onZoomToFit,
  onTimeRangeSelect,
}: TimelineToolbarProps) {
  return (
    <div className="flex items-center gap-2">
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
            <p>Quick time ranges</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onZoomToFit}>
            All
          </DropdownMenuItem>
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

      {config.tools.map((tool, i) => (
        <ToolWrapper key={i} tool={tool} />
      ))}
    </div>
  );
}
