import React, { Suspense, useRef, useState, useEffect } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { LoaderFunctionArgs } from "@remix-run/node";
import {
  type LoaderData,
  type Timestamp,
  zLoaderData,
  zTimestamp,
} from "../types/timeline.ts";
import { CursorLine } from "@/components/timeline/cursorLine.tsx";
import { AudioPlayer, useDateStore } from "@/components/player.tsx";
import { TimelineAxis } from "@/components/timeline/TimelineAxis.tsx";
import { TimelineItems } from "@/components/timeline/TimelineItems.tsx";
import { PlayPauseButton } from "@/components/timeline/PlayPauseButton.tsx";
import { authenticateOrRedirect } from "../lib/auth/core.server.ts";
import { fetchTimelineData, getDaysAgo } from "../services/timeline.server.ts";
import { useTimeline } from "../hooks/useTimeline.ts";
import GainSlider from "@/components/timeline/GainSlider.tsx";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOrRedirect(request);

  const url = new URL(request.url);
  let params;
  try {
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");

    params = {
      start: startParam
        ? zTimestamp.parse(startParam)
        : BigInt(getDaysAgo(30).getTime()) as Timestamp,
      end: endParam
        ? zTimestamp.parse(endParam)
        : BigInt(getDaysAgo(-1).getTime()) as Timestamp,
    };
  } catch (error) {
    console.error(error);
    throw new Response("Invalid format", { status: 400 });
  }

  return fetchTimelineData(auth.db, params.start, params.end);
}



const FONT_SIZE = 16;
const LINE_HEIGHT = 24;
const PADDING = 6;

interface TextBlockProps {
  x: number;
  y: number;
  text: string;
}

const TextBlock = ({ x, y, text }: TextBlockProps) => {
  const ref = useRef<SVGTextElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (ref.current) {
      setWidth(ref.current.getBBox().width + PADDING * 2);
    }
  }, [text]);

  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={0}
        y={0}
        width={width}
        height={LINE_HEIGHT}
        fill="lightblue"
        rx={4}
      />
      <text
        ref={ref}
        x={PADDING}
        y={LINE_HEIGHT / 2 + FONT_SIZE / 2 - 4}
        fontSize={FONT_SIZE}
      >
        {text}
      </text>
    </g>
  );
};

interface Transcript {
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
      {
        transcripts.map((transcript) => {
          return (
            <span className="opacity-20 hover:opacity-100 transition-colors hover:cursor-pointer" key={transcript.start} onClick={() => {
              resetDate(new Date(transcript.start));
              setIsPlaying(true);
            }}>
              {transcript.text} 
            </span>
          )
        })
      }
    </div>
  );
}

const TimelinePage = () => {
  let { items, voices, start, end, transcripts } = zLoaderData.parse(
    useLoaderData<LoaderData>(),
  );
  const fetcher = useFetcher<LoaderData>();

  if (fetcher.data) {
    const data = zLoaderData.parse(fetcher.data);
    items = data.items;
    voices = data.voices;
    transcripts = data.transcripts;
  }

  const { currentDate, resetDate, setIsPlaying } = useDateStore();

  const handleDateRangeChange = (start: Date, end: Date) => {
    const form = new FormData();
    form.append("start", BigInt(start.getTime()).toString());
    form.append("end", BigInt(end.getTime()).toString());
    fetcher.submit(form);

    const searchParams = new URLSearchParams({
      start: BigInt(start.getTime()).toString(),
      end: BigInt(end.getTime()).toString(),
    });
    globalThis.history.replaceState(null, "", `?${searchParams.toString()}`);
  };

  const {
    containerRef,
    transform,
    timeScale,
    width,
    height,
  } = useTimeline(
    { items, voices, start, end, transcripts },
    handleDateRangeChange,
  );

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
          style={{
            height: height,
          }}
        >
          {containerRef.current && (
              <svg
                id="timeline-svg"
                className="w-full h-full overflow-x-scroll"
                width={width}
                height={height}
                onClick={(event) => {
                  const svgElement = event.currentTarget;
                  console.log(svgElement);
                  const rect = svgElement.getBoundingClientRect();
                  const x = event.clientX - rect.left;
                  const newScale = transform.rescaleX(timeScale);
                  const clickedDate = newScale.invert(x);
                  resetDate(clickedDate);
                  setIsPlaying(true);
                }}
              >
                <g
                >
                  <TimelineAxis
                    scale={timeScale}
                    transform={transform}
                    height={0}
                    width={width}
                  />
                  <g clipPath="url(#clip)">
                    <TimelineItems
                      items={items}
                      scale={timeScale}
                      transform={transform}
                    />
                    {currentDate !== null && (
                      <CursorLine
                        position={transform.applyX(timeScale(currentDate))}
                        height={80}
                      />
                    )}
                  </g>
                </g>
              </svg>
          )}
        </div>
        <TranscriptsRow
          transcripts={transcripts}
        />
      </div>
    </>
  );
};

export default TimelinePage;
