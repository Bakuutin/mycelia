import { Layer, LayerComponentProps, Tool } from "@/core.ts";
import React, { useMemo } from "react";

import { AudioPlayer, useDateStore } from "./player.tsx";
import { TimelineItems } from "./TimelineItems.tsx";
import { CursorLine } from "./cursorLine.tsx";
import { useAudioItems } from "./useAudioItems.ts";
import { useTimelineRange } from "@/stores/timelineRange.ts";
import { PlayPauseButton } from "./PlayPauseButton.tsx";
import GainSlider from "./GainSlider.tsx";

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
            console.log(svgElement);
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
