import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/Markdown";
import { SummarizeDialog } from "@/components/dialogs/SummarizeDialog";
import { SummaryCompareDialog } from "@/components/dialogs/SummaryCompareDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Wand2, Star, GitCompare } from "lucide-react";
import { formatRelativeTime } from "@/lib/formatTime";
import type { Object } from "@/types/objects";

interface SummarySectionProps {
  object: Object;
  summaryJobId?: string | null;
  onSummaryClick?: (summary: NonNullable<Object["summaries"]>[number]) => void;
  onStarSummary?: (index: number) => void;
}

export function SummarySection({ object, summaryJobId, onSummaryClick, onStarSummary }: SummarySectionProps) {
  const [isSummarizeOpen, setIsSummarizeOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);

  const summaries = object.summaries || [];
  const hasSummaries = summaries.length > 0;
  const hasMultipleSummaries = summaries.length > 1;

  // Find starred summary index, or default to latest (last)
  const getDefaultIndex = () => {
    if (!hasSummaries) return 0;
    const starredIndex = summaries.findIndex((s) => s.starred);
    return starredIndex !== -1 ? starredIndex : summaries.length - 1;
  };

  const [currentIndex, setCurrentIndex] = useState(getDefaultIndex);
  const currentSummary = hasSummaries ? summaries[currentIndex] : null;

  const canGenerateSummary = object.isConversation &&
    object.timeRanges?.[0]?.start &&
    object.timeRanges?.[0]?.end;

  // Reset to starred or latest summary when summaries array changes
  useEffect(() => {
    if (summaryJobId) {
      const linkedIndex = summaries.findIndex((summary) => summary.jobId === summaryJobId);
      if (linkedIndex !== -1) {
        setCurrentIndex(linkedIndex);
        return;
      }
    }
    const starredIndex = summaries.findIndex((s) => s.starred);
    setCurrentIndex(starredIndex !== -1 ? starredIndex : (summaries.length > 0 ? summaries.length - 1 : 0));
  }, [summaries.length, summaries, summaryJobId]);

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

        {/* Generate Summary Button */}
        {canGenerateSummary && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setIsSummarizeOpen(true)}
          >
            <Wand2 className="w-4 h-4 mr-1" />
            Generate
          </Button>
        )}
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
                    <span className="capitalize">
                      {["small", "medium", "large"].includes(currentSummary.model)
                        ? currentSummary.model
                        : "custom"}
                    </span>
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
                {currentSummary.sourceRefs && (
                  <span className="flex items-center gap-1">
                    <span className="font-medium">Source:</span>
                    <span>
                      {currentSummary.sourceRefs.conversationChunkIds.length} chunk(s),{" "}
                      {currentSummary.sourceRefs.transcriptionIds.length} transcription(s)
                    </span>
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

              {/* Actions and Navigation */}
              <div className="flex items-center gap-1">
                {/* Star toggle button */}
                {onStarSummary && (
                  <Button
                    variant={currentSummary?.starred ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => onStarSummary(currentIndex)}
                    aria-label={currentSummary?.starred ? "Unstar summary" : "Star summary"}
                  >
                    <Star className={`h-4 w-4 ${currentSummary?.starred ? "fill-current" : ""}`} />
                  </Button>
                )}

                {/* Navigation (only show if multiple summaries) */}
                {hasMultipleSummaries && (
                  <>
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
                          {currentSummary?.starred && " ★"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {summaries.map((s, i) => (
                          <SelectItem key={i} value={String(i)} className="text-xs">
                            <span className="flex items-center gap-1">
                              {s.starred && <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />}
                              <span>{s.model} - {formatRelativeTime(new Date(s.date))}</span>
                            </span>
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

                    {/* Compare button */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 ml-1"
                      onClick={() => setIsCompareOpen(true)}
                      aria-label="Compare summaries"
                    >
                      <GitCompare className="h-4 w-4 mr-1" />
                      Compare
                    </Button>
                  </>
                )}
              </div>
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
        />
      )}

      {/* Compare Summaries Dialog */}
      {hasMultipleSummaries && onStarSummary && (
        <SummaryCompareDialog
          open={isCompareOpen}
          onOpenChange={setIsCompareOpen}
          summaries={summaries}
          initialLeftIndex={currentIndex}
          onStarSummary={onStarSummary}
        />
      )}
    </div>
  );
}
