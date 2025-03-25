import React, { Suspense } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { LoaderFunctionArgs } from "@remix-run/node";
import { zLoaderData, type LoaderData, zTimestamp, type Timestamp } from "../types/timeline";
import { CursorLine } from "@/components/timeline/cursorLine.tsx";
import { AudioPlayer, useDateStore } from "@/components/player.tsx";
import { TimelineAxis } from "@/components/timeline/TimelineAxis.tsx";
import { TimelineItems } from "@/components/timeline/TimelineItems.tsx";
import { VoiceRow } from "@/components/timeline/VoiceRow.tsx";
import { TranscriptsRow } from "@/components/timeline/TranscriptsRow.tsx";
import { PlayPauseButton } from "@/components/timeline/PlayPauseButton.tsx";
import { authenticateOrRedirect } from "../lib/auth/core.server.ts";
import { fetchTimelineData, getDaysAgo } from "../services/timeline.server.ts";
import { useTimeline } from "../hooks/useTimeline.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOrRedirect(request);

  const url = new URL(request.url);
  let params;
  try {
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    
    params = {
      start: startParam ? zTimestamp.parse(startParam) : BigInt(getDaysAgo(30).getTime()) as Timestamp,
      end: endParam ? zTimestamp.parse(endParam) : BigInt(getDaysAgo(-1).getTime()) as Timestamp,
    };
  } catch (error) {
    console.error(error);
    throw new Response("Invalid format", { status: 400 });
  }

  return fetchTimelineData(auth.db, params.start, params.end);
}

const TimelinePage = () => {
  let { items, voices, start, end, transcripts } = zLoaderData.parse(
    useLoaderData<LoaderData>(),
  );
  const fetcher = useFetcher<LoaderData>();
  const navigate = useNavigate();

  if (fetcher.data) {
    const data = zLoaderData.parse(fetcher.data);
    items = data.items;
    voices = data.voices;
    transcripts = data.transcripts;
  }

  const { currentDate, resetDate, isPlaying, setIsPlaying } = useDateStore();

  const handleDateRangeChange = (start: Date, end: Date) => {
    const form = new FormData();
    form.append("start", BigInt(start.getTime()).toString());
    form.append("end", BigInt(end.getTime()).toString());
    fetcher.submit(form);
    
    // Update URL search params without triggering a navigation
    const searchParams = new URLSearchParams({
      start: BigInt(start.getTime()).toString(),
      end: BigInt(end.getTime()).toString(),
    });
    window.history.replaceState(null, '', `?${searchParams.toString()}`);
  };

  const {
    containerRef,
    dimensions,
    transform,
    timeScale,
    width,
    height,
  } = useTimeline({ items, voices, start, end, transcripts, gap: 0 }, handleDateRangeChange);

  
  return (
    <>
      <div className="p-4 gap-4 flex flex-col">

      <div className="flex flex-row">
          <PlayPauseButton />
        </div>
        <div
          ref={containerRef}
          style={{ height: height + dimensions.margin.top + dimensions.margin.bottom }}
        >
          {fetcher.state === "loading" && (
            <div className="absolute top-4 right-4 bg-blue-500 text-white px-4 py-2 rounded">
              Loading...
            </div>
          )}
          <AudioPlayer />
          {containerRef.current && (
            <svg
              id="timeline-svg"
              className="w-full h-full overflow-x-scroll"
              width={width + dimensions.margin.left + dimensions.margin.right}
              height={height + dimensions.margin.top + dimensions.margin.bottom}
              style={{ backgroundColor: 'purple' }}
              onClick={(event) => {
                const svgElement = event.currentTarget;
                const rect = svgElement.getBoundingClientRect();
                const x = event.clientX - rect.left - dimensions.margin.left;
                const newScale = transform.rescaleX(timeScale);
                const clickedDate = newScale.invert(x);
                resetDate(clickedDate);
                setIsPlaying(true);
              }}
            >
              <g transform={`translate(${dimensions.margin.left},${dimensions.margin.top})`}>
                <clipPath id="clip">
                  <rect width={width} height={height} />
                </clipPath>
                <g clipPath="url(#clip)">
                  <TimelineItems
                    items={items}
                    scale={timeScale}
                    transform={transform}
                  />
                  <VoiceRow
                    voices={voices}
                    scale={timeScale}
                    transform={transform}
                  />
                  {currentDate !== null && (
                    <CursorLine
                      position={transform.applyX(timeScale(currentDate))}
                      height={height - dimensions.margin.top}
                    />
                  )}
                </g>
                <TimelineAxis
                  scale={timeScale}
                  transform={transform}
                  height={height}
                  width={width}
                />
              </g>
            </svg>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="flex justify-start flex-col px-[2.5rem]">
          <TranscriptsRow transcripts={transcripts} />
        </div>
      </div>
    </>
  );
};

export default TimelinePage;
