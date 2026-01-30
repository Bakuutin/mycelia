import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/Markdown";
import { SummarizeDialog } from "@/components/dialogs/SummarizeDialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Wand2, Loader2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/formatTime";
import { callResource } from "@/lib/api";
import type { Object } from "@/types/objects";

type CategoryKey = "small" | "medium" | "large";

// Category labels and descriptions
const CATEGORIES: Record<CategoryKey, { label: string; hint: string }> = {
  small: { label: "Small", hint: "Fast, economical" },
  medium: { label: "Medium", hint: "Balanced performance" },
  large: { label: "Large", hint: "Most capable" },
};

const CATEGORY_KEYS: CategoryKey[] = ["small", "medium", "large"];

interface ModelCategory {
  default: string;
  models: string[];
}

interface ModelsResponse {
  models: { id: string; owned_by?: string }[];
  categories: {
    small: ModelCategory;
    medium: ModelCategory;
    large: ModelCategory;
  };
}

interface SummarySectionProps {
  object: Object;
  onSummaryClick?: (summary: NonNullable<Object["summaries"]>[number]) => void;
}

export function SummarySection({ object, onSummaryClick }: SummarySectionProps) {
  const [selectedModel, setSelectedModel] = useState("medium");
  const [isSummarizeOpen, setIsSummarizeOpen] = useState(false);
  const [modelsData, setModelsData] = useState<ModelsResponse | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  const summaries = object.summaries || [];
  const hasSummaries = summaries.length > 0;
  const hasMultipleSummaries = summaries.length > 1;

  // Default to latest (last) summary
  const [currentIndex, setCurrentIndex] = useState(hasSummaries ? summaries.length - 1 : 0);
  const currentSummary = hasSummaries ? summaries[currentIndex] : null;

  const canGenerateSummary = object.isConversation &&
    object.timeRanges?.[0]?.start &&
    object.timeRanges?.[0]?.end;

  // Fetch available models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        setLoadingModels(true);
        const response = await callResource("llm", { action: "list" }) as ModelsResponse;
        setModelsData(response);
      } catch (e) {
        console.error("Failed to fetch models:", e);
      } finally {
        setLoadingModels(false);
      }
    };
    fetchModels();
  }, []);

  // Reset to latest (last) summary when summaries array changes
  useEffect(() => {
    setCurrentIndex(summaries.length > 0 ? summaries.length - 1 : 0);
  }, [summaries.length]);

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : summaries.length - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev < summaries.length - 1 ? prev + 1 : 0));
  };

  return (
    <div className="border rounded-lg p-4 bg-muted/30 min-h-[400px] max-h-[800px] flex flex-col">
      {/* Header with title, model selector, and generate button */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold text-muted-foreground">Summary</h3>

        <div className="flex items-center gap-2">
          {/* Model Size Selector */}
          {canGenerateSummary && (
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {loadingModels ? (
                  <div className="flex items-center justify-center p-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <>
                    {CATEGORY_KEYS.map((category) => {
                      const cat = modelsData?.categories[category];
                      const categoryInfo = CATEGORIES[category];
                      const availableModels = modelsData?.models || [];

                      return (
                        <SelectGroup key={category}>
                          <SelectLabel className="text-xs font-semibold">
                            {categoryInfo.label}
                            <span className="font-normal text-muted-foreground ml-1">
                              ({categoryInfo.hint})
                            </span>
                          </SelectLabel>
                          <SelectItem value={category} className="pl-4">
                            <span className="capitalize">{category}</span>
                            {cat?.default && cat.default !== category && (
                              <span className="text-muted-foreground ml-1">→ {cat.default}</span>
                            )}
                          </SelectItem>
                          {availableModels
                            .filter((m: { id: string }) => {
                              const id = m.id.toLowerCase();
                              if (category === "small") {
                                return id.includes("haiku") || id.includes("mini") || id.includes("small");
                              }
                              if (category === "large") {
                                return id.includes("opus") || id.includes("large") || (id.includes("4o") && !id.includes("mini"));
                              }
                              // medium: sonnet or anything not matching small/large
                              return id.includes("sonnet");
                            })
                            .map((model: { id: string }) => (
                              <SelectItem key={model.id} value={model.id} className="pl-6 text-xs">
                                {model.id}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      );
                    })}
                  </>
                )}
              </SelectContent>
            </Select>
          )}

          {/* Generate Summary Button */}
          {canGenerateSummary && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setIsSummarizeOpen(true)}
                >
                  <Wand2 className="w-4 h-4 mr-1" />
                  Generate
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Generate a new summary using {selectedModel} model</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Summary Content */}
      {hasSummaries && currentSummary ? (
        <>
          <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]]:!overflow-y-scroll">
            <div className="prose prose-sm max-w-none pr-3">
              <Markdown>{currentSummary.text}</Markdown>
            </div>
          </ScrollArea>

          {/* Summary metadata and navigation footer */}
          <div className="flex-shrink-0 pt-3 mt-3 border-t">
            <div className="flex items-center justify-between flex-wrap gap-2">
              {/* Metadata */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {currentSummary.model && (
                  <span className="flex items-center gap-1">
                    <span className="capitalize">{currentSummary.model}</span>
                    {currentSummary.modelName && (
                      <>
                        <span className="text-muted-foreground/50">|</span>
                        <span>{currentSummary.modelName}</span>
                      </>
                    )}
                  </span>
                )}
                {(currentSummary as any).promptName && (
                  <span className="flex items-center gap-1">
                    <span className="font-medium">Prompt:</span>
                    <span>{(currentSummary as any).promptName}</span>
                  </span>
                )}
                {currentSummary.date && (
                  <span className="flex items-center gap-1">
                    <span className="font-medium">Generated:</span>
                    <span>{formatRelativeTime(new Date(currentSummary.date))}</span>
                  </span>
                )}
                {(currentSummary.usage || currentSummary.prompt || currentSummary.jobId) && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => onSummaryClick?.(currentSummary)}
                    className="p-0 h-auto text-xs"
                  >
                    More details...
                  </Button>
                )}
              </div>

              {/* Navigation (only show if multiple summaries) */}
              {hasMultipleSummaries && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={goToPrevious}
                    aria-label="Previous summary"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  {/* Version dropdown */}
                  <Select
                    value={String(currentIndex)}
                    onValueChange={(v) => setCurrentIndex(Number(v))}
                  >
                    <SelectTrigger className="h-7 w-[130px] text-xs">
                      <SelectValue>
                        {currentIndex + 1} of {summaries.length}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {summaries.map((s, i) => (
                        <SelectItem key={i} value={String(i)} className="text-xs">
                          {s.model} - {formatRelativeTime(new Date(s.date))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={goToNext}
                    aria-label="Next summary"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <p className="text-sm mb-2">No summary available</p>
          {canGenerateSummary && (
            <p className="text-xs">Click "Generate" to create one</p>
          )}
        </div>
      )}

      {/* Summarize Dialog */}
      {canGenerateSummary && (
        <SummarizeDialog
          open={isSummarizeOpen}
          onOpenChange={setIsSummarizeOpen}
          startDate={object.timeRanges![0].start}
          endDate={object.timeRanges![0].end!}
          objectId={object._id?.toString()}
          title="Summarize Conversation"
          description="Generate a summary for this conversation."
          defaultModel={selectedModel}
        />
      )}
    </div>
  );
}
