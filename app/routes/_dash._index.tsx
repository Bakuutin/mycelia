import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AudioPlayer, useDateStore } from "@/components/player.tsx";
import { PlayPauseButton } from "@/components/timeline/PlayPauseButton.tsx";
import { useTimeline } from "../hooks/useTimeline.ts";
import GainSlider from "@/components/timeline/GainSlider.tsx";
import { config } from "@/config.ts";
import { useTimelineRange } from "../stores/timelineRange.ts";
import _ from "lodash";



interface Transcript {
  id: string;
  start: string;
  text: string;
}

interface TranscriptsRowProps {
  transcripts: Transcript[];
}

function TranscriptsRow({ transcripts }: TranscriptsRowProps) {
  const { resetDate, setIsPlaying } = useDateStore();

  return (
    <div className="">
      {transcripts.map((transcript) => {
        return (
          <span
            className="opacity-20 hover:opacity-100 transition-colors hover:cursor-pointer"
            key={transcript.id}
            onClick={() => {
              resetDate(new Date(transcript.start));
              setIsPlaying(true);
            }}
          >
            {transcript.text}
          </span>
        );
      })}
    </div>
  );
}

const TimelinePage = () => {
  const { start, end } = useTimelineRange();

  const setQueryParams = useCallback(
    _.debounce((start: Date, end: Date) => {
      const form = new FormData();
      form.append("start", start.getTime().toString());
      form.append("end", end.getTime().toString());
      
      const searchParams = new URLSearchParams({
        start: start.getTime().toString(),
        end: end.getTime().toString(),
      });
      globalThis.history.replaceState(null, "", `?${searchParams.toString()}`);
    }, 500),
    [],
  );

    useEffect(() => {
      setQueryParams(start, end);
  }, [start, end]);

  const {
    containerRef,
    transform,
    timeScale,
    width,
  } = useTimeline();

  return (
    <>
      <div className="p-4 gap-4 flex flex-col">
        <div className="flex flex-row items-center gap-4">
          <PlayPauseButton />
          <GainSlider />

          <AudioPlayer />
        </div>
        <div
          ref={containerRef}
        >
          {containerRef.current && (
            <>
              {config.layers.map((layer, i) => (
                <layer.component
                  key={i}
                  scale={timeScale}
                  transform={transform}
                  width={width}
                />
              ))}
            </>
          )}
        </div>
        {/* <TranscriptsRow
          transcripts={transcripts}
        /> */}
      </div>
    </>
  );
};

export default TimelinePage;
