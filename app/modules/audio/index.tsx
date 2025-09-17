import { Layer, LayerComponentProps, Tool } from "@/core.ts";
import React, { useMemo } from "react";

import { AudioPlayer, useDateStore } from "./player.tsx";
import { TimelineItems } from "./TimelineItems.tsx";
import { CursorLine } from "./cursorLine.tsx";
import { useAudioItems } from "./useAudioItems.ts";
import { useTimelineRange } from "@/stores/timelineRange.ts";
import { PlayPauseButton } from "./PlayPauseButton.tsx";
import GainSlider from "./GainSlider.tsx";
import { useTranscripts } from "./useTranscripts.ts";

const day = 1000 * 60 * 60 * 24;

export const AudioPlayerTool: Tool = {
  component: () => {
    return (
      <>
        <PlayPauseButton />
        <AudioPlayer />
      </>
    );
  },
};

export const GainTool: Tool = {
  component: () => {
    return <GainSlider />;
  },
};

export const DateTimePickerTool: Tool = {
  component: () => {
    const { currentDate, resetDate } = useDateStore();
    
    const handleDateTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const newDate = new Date(event.target.value);
      resetDate(newDate);
    };
    
    const formatDateTimeLocal = (date: Date | null) => {
      if (!date) return "";
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };
    
    return (
      <input
        type="datetime-local"
        value={formatDateTimeLocal(currentDate)}
        onChange={handleDateTimeChange}
        className="px-2 py-1 text-white [&::-webkit-calendar-picker-indicator]:filter [&::-webkit-calendar-picker-indicator]:invert"
        step="1"
      />
    );
  },
};

export const AudioLayer: () => Layer = () => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { currentDate, resetDate, setIsPlaying } = useDateStore();

      const { start, end } = useTimelineRange();

      const resolution = useMemo(() => {
        const duration = end.getTime() - start.getTime();
        if (duration > 300 * day) {
          return "1week";
        } else if (duration > 50 * day) {
          return "1day";
        } else if (duration > day) {
          return "1hour";
        } else {
          return "5min";
        }
      }, [start, end]);

      const { items } = useAudioItems(start, end, resolution);

      return (
        <svg
          className="w-full h-full zoomable"
          width={width}
          height={40}
          onClick={(event) => {
            const svgElement = event.currentTarget;
            const rect = svgElement.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const newScale = transform.rescaleX(scale);
            const clickedDate = newScale.invert(x);
            resetDate(clickedDate);
            setIsPlaying(true);
          }}
        >
          <g>
            <TimelineItems
              items={items as any}
              scale={scale}
              transform={transform}
            />
            {currentDate !== null && (
              <CursorLine
                position={transform.applyX(scale(currentDate))}
                height={80}
              />
            )}
          </g>
        </svg>
      );
    },
  } as Layer;
};


export const TranscriptLayer: () => Layer = () => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { currentDate } = useDateStore();
      const { transcripts } = useTranscripts(currentDate);
      
      return (
        <div>
          <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
            {transcripts.map((transcript) => {
              const isActive = !!currentDate && transcript.start <= currentDate && currentDate <= transcript.end;
              const base = "text-sm p-1 rounded";
              const cls = isActive ? `${base} bg-yellow-600` : `${base} bg-gray-600`;
              return (
                <p key={transcript._id} className={cls}>
                  {transcript.text}
                </p>
              );
            })}
          </div>
        </div>
      );
    },
  } as Layer;
};