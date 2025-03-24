import React, { useEffect, useRef } from "react";
import { useDateStore } from "@/components/player.tsx";

interface Transcript {
  text: string;
  words: Array<{
    word: string;
    start: number;
    end: number;
    t_dtw: number;
    probability: number;
  }>;
  id: number;
  start: Date;
  end: Date;
  transcriptID: string;
}

interface TranscriptsRowProps {
  transcripts: Transcript[];
}

export const TranscriptsRow = ({
  transcripts,
}: TranscriptsRowProps) => {
  const { resetDate, currentDate, setIsPlaying } = useDateStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentDate || transcripts.length === 0) {
      return;
    }
    const activeTranscript = transcripts.find(
      (t) =>
        currentDate >= t.start &&
        (t.end
          ? currentDate <= t.end
          : currentDate <= new Date(t.start.getTime() + 2000)),
    );

    if (activeTranscript && scrollContainerRef.current) {
      const element = document.getElementById(
        `transcript-${activeTranscript.transcriptID}-${activeTranscript.id}`,
      );

      if (element) {
        const container = scrollContainerRef.current;
        const scrollLeft = element.offsetLeft - (container.clientWidth / 2) +
          (element.offsetWidth / 2);

        // Add a small delay to make the scroll more noticeable
        setTimeout(() => {
          container.scrollTo({
            left: scrollLeft,
            behavior: "smooth",
          });
        }, 100);

        // Optionally add a CSS transition for even smoother movement
        container.style.scrollBehavior = "smooth";
      }
    }
  }, [currentDate, transcripts]);

  if (!currentDate || transcripts.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      <div
        className="flex overflow-x-auto space-x-4 p-4 scroll-smooth"
        ref={scrollContainerRef}
        style={{
          scrollbarWidth: "thin",
          scrollBehavior: "smooth",
          transition: "scroll-left 0.5s ease-in-out",
        }}
      >
        {transcripts.map((s: Transcript) => {
          const isActive: boolean = currentDate && currentDate >= s.start &&
            currentDate <= s.end;

          return (
            <div
              key={`transcript-${s.transcriptID}-${s.id}`}
              id={`transcript-${s.transcriptID}-${s.id}`}
              onClick={() => {
                resetDate(s.start);
                setIsPlaying(true);
              }}
              className={`
                flex-shrink-0 
                w-48 
                p-4 
                rounded-lg 
                border-2 
                cursor-pointer
                transition-all 
                duration-300
                ${
                isActive
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }
              `}
            >
              <h3 className="font-medium text-gray-900">
                {s.start.toLocaleTimeString()}
              </h3>
              <p className="mt-2 text-sm text-gray-600 line-clamp-3">
                {s.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
