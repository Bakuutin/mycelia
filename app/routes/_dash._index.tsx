import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import * as d3 from "d3";
import _ from "lodash";
import { LoaderFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { CursorLine } from "@/components/cursorLine.tsx";
import { AudioPlayer, useDateStore } from "@/components/player.tsx";
import { TimelineAxis } from "@/components/timeline/TimelineAxis.tsx";
import { TimelineItems } from "@/components/timeline/TimelineItems.tsx";
import { VoiceRow } from "@/components/timeline/VoiceRow.tsx";
import { TranscriptsRow } from "@/components/timeline/TranscriptsRow.tsx";
import { PlayPauseButton } from "@/components/timeline/PlayPauseButton.tsx";
import { authenticateOrRedirect } from "../lib/auth/core.server.ts";

const zTimelineItem = z.object({
  id: z.string(),
  start: z.date(),
  end: z.date(),
});

const zTranscript = z.object({
  text: z.string(),
  words: z.array(z.object({
    word: z.string(),
    start: z.number(),
    end: z.number(),
    t_dtw: z.number(),
    probability: z.number(),
  })),
  id: z.number(),
  start: z.date(),
  end: z.date(),
  transcriptID: z.string(),
});

type Transcript = z.infer<typeof zTranscript>;

type TimelineItem = z.infer<typeof zTimelineItem>;

interface StartEnd {
  start: Date;
  end: Date;
  _id: ObjectId;
}

const day = 1000 * 60 * 60 * 24;
const year = day * 365;

function getDaysAgo(n: number) {
  const today = new Date(new Date().toISOString().split("T")[0]);
  const monthAgo = new Date(today.getTime() - n * 24 * 60 * 60 * 1000);
  return monthAgo;
}

const QuerySchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
});

const zLoaderData = z.object({
  items: z.array(zTimelineItem),
  voices: z.array(z.object({
    start: z.date(),
    end: z.date(),
    _id: z.string(),
  })),
  transcripts: z.array(zTranscript),
  start: z.date(),
  end: z.date(),
  gap: z.number(),
});

type LoaderData = z.infer<typeof zLoaderData>;

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOrRedirect(request);

  const url = new URL(request.url);
  let params;
  try {
    params = QuerySchema.parse({
      start: url.searchParams.get("start") || getDaysAgo(30),
      end: url.searchParams.get("end") || getDaysAgo(-1),
    });
  } catch (error) {
    console.error(error);
    throw new Response("Invalid format", { status: 400 });
  }
  let { start, end } = params;

  const mergeGap = (items: StartEnd[], gap: number, updateKey: any = null) => {
    if (gap <= 0 || items.length === 0) {
      return items;
    }
    const result: StartEnd[] = [];
    let prev: StartEnd | null = null;
    for (const item of items) {
      if (prev) {
        if (prev.end.getTime() > item.start.getTime() - gap) {
          prev.end = _.max([prev.end, item.end]) as Date;
          if (
            updateKey && typeof updateKey === "function"
          ) {
            prev = updateKey(prev, item);
          }
        } else {
          result.push(prev);
          prev = null;
        }
      } else {
        prev = item;
      }
    }
    if (prev) {
      result.push(prev);
    }
    return result;
  };

  const duration = end.getTime() - start.getTime();
  const originalStart = start;
  const originalEnd = end;
  start = new Date(start.getTime() - duration / 2);
  end = new Date(end.getTime() + duration / 2);

  let gap = 0;

  if (duration > day * 7) {
    gap = day / 4;
  }
  if (duration > day * 300) {
    gap = day * 10;
  }

  const items: any[] = await auth.db.collection("source_files").find({
    start: {
      $lte: end,
    },
    end: {
      $gte: start,
    },
  }, { sort: { start: 1 } });

  const sources: TimelineItem[] = mergeGap(items, gap).map((item) => ({
    start: item.start,
    end: item.end,
    id: item._id.toHexString(),
  }));

  let voices: any[] = [];
  if (duration < day * 2) {
    voices = await auth.db.collection("diarizations").find({
      start: {
        $lte: end,
      },
      end: {
        $gte: start,
      },
    }, { sort: { start: 1 } });
    voices = voices.map((voice) => ({
      start: voice.start,
      end: voice.end,
      _id: voice._id.toHexString(),
    }));
    voices = mergeGap(voices, duration / 100);
  }

  const transcripts = (
    await auth.db.collection("transcriptions").find({
      start: {
        $lte: end,
      },
      end: {
        $gte: start,
      },
    }, { sort: { start: 1 }, limit: 20 })
  ).flatMap((t) => {
    const transcriptID = t._id.toHexString();
    return t.segments.map((s: any) =>
      ({
        ...s,
        start: new Date(t.start.getTime() + s.start * 1000),
        end: new Date(t.start.getTime() + s.end * 1000),
        transcriptID,
      }) as Transcript
    );
  }).sort((a, b) => a.start.getTime() - b.start.getTime());

  return ({
    items: sources,
    start: originalStart,
    end: originalEnd,
    gap,
    voices,
    transcripts,
  });
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

  const containerRef = useRef<HTMLDivElement>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 350 });

  const margin = { top: 10, right: 20, bottom: 110, left: 40 };
  const width = dimensions.width - margin.left - margin.right;
  const height = dimensions.height - margin.top - margin.bottom;

  const { currentDate, resetDate, isPlaying, setIsPlaying } = useDateStore();

  const [transform, setTransform] = useState(d3.zoomIdentity);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height,
        });
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  const timeScale = useMemo(() => {
    return d3.scaleTime()
      .domain([new Date(start), new Date(end)])
      .range([0, width]);
  }, [start, end, width]);

  const fetchMore = useCallback(
    _.debounce((start, end) => {
      const form = new FormData();
      form.append("start", start.toISOString());
      form.append("end", end.toISOString());
      fetcher.submit(form);
      
      // Update URL search params without triggering a navigation
      const searchParams = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
      });
      window.history.replaceState(null, '', `?${searchParams.toString()}`);
    }, 500),
    [fetcher],
  );

  const handleZoom = useCallback(
    (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      setTransform(event.transform);
      const newScale = event.transform.rescaleX(timeScale);
      const [
        start,
        end,
      ] = newScale.domain();

      fetchMore(start, end);
    },
    [timeScale, fetchMore],
  );

  const zoom = useMemo(() => {
    return d3.zoom()
      .scaleExtent([5e-7, 304549])
      .extent([[0, 0], [width, height]])
      .on("zoom", handleZoom);
  }, [width, height, handleZoom]);

  useEffect(() => {
    const svg = d3.select("#timeline-svg");
    svg.call(zoom as any);
  }, [zoom]);

  return (
    <>
      <div className="p-4 gap-4 flex flex-col">
        <div
          ref={containerRef}
          style={{ height: height + margin.top + margin.bottom }}
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
              width={width + margin.left + margin.right}
              height={height + margin.top + margin.bottom}
              onClick={(event) => {
                // Calculate cursor position based on click coordinates
                const svgElement = event.currentTarget;
                const rect = svgElement.getBoundingClientRect();
                const x = event.clientX - rect.left - margin.left;
                const newScale = transform.rescaleX(timeScale);
                const clickedDate = newScale.invert(x);
                resetDate(clickedDate);
                setIsPlaying(true);
              }}
            >
              <g transform={`translate(${margin.left},${margin.top})`}>
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
                      height={height - margin.top}
                    />
                  )}
                </g>
                <TimelineAxis
                  scale={timeScale}
                  transform={transform}
                  height={height - margin.top}
                  width={width}
                />
              </g>
            </svg>
          )}
        </div>
        <div className="flex flex-row">
          <PlayPauseButton />
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
