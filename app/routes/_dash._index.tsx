import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import * as d3 from "d3";
import _ from "lodash";
import { LoaderFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { CursorLine } from "@/components/cursorLine.tsx";

import { AudioPlayer, useDateStore } from "@/components/player.tsx";

import { Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button.tsx";
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
  
  // console.log(await auth.db.collection("source_files").findOne({}))
  // return {
  //   items: [],
  //   start: originalStart,
  //   end: originalEnd,
  //   gap,
  //   voices: [],
  //   transcripts: [],
  // }
  const col = auth.db.collection("source_files");
  // console.log(col);
  const res =  await col.find({}, {limit: 1});
  // console.log(155, Object.keys(res));

  const items: any[] = await col.find({
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
    voices = await auth.db.collection('diarizations').find({
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

  let transcripts: Transcript[] = [];
  if (true) {
    transcripts = (
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
  }

  return ({
    items: sources,
    start: originalStart,
    end: originalEnd,
    gap,
    voices,
    transcripts,
  });
}

const TimelineAxis = ({
  scale,
  transform,
  height,
  width,
}: {
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  height: number;
  width: number;
}) => {
  const ticks = useMemo(() => {
    const newScale = transform.rescaleX(scale);
    const tickValues = newScale.ticks(Math.ceil(width / 227));

    return tickValues.map((tick) => ({
      value: tick,
      xOffset: newScale(tick),
      isNewYear: tick.getMonth() === 0 && tick.getDate() === 1,
    }));
  }, [scale, transform]);

  const allJanFirst = useMemo(() => {
    return ticks.length > 0 &&
      ticks.every(({ value }) =>
        value.getMonth() === 0 && value.getDate() === 1
      );
  }, [ticks]);

  const hasTime = useMemo(() => {
    return ticks.some(({ value }) => (
      value.getHours() !== 0 ||
      value.getMinutes() !== 0 ||
      value.getSeconds() !== 0
    ));
  }, [ticks]);

  const hasWeekdays = useMemo(() => {
    // diff in days between first and last tick is less than 30
    const [first, last] = [ticks[0].value, ticks[ticks.length - 1].value];

    return last.getTime() - first.getTime() < 30 * day;
  }, [ticks]);

  const hasSeconds = useMemo(() => {
    return ticks.some(({ value }) => value.getSeconds() !== 0);
  }, [ticks]);

  const [start, end] = scale.range();

  const formatTime = (date: Date): string => {
    return hasSeconds
      ? date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
  };

  const formatLabel = (date: Date): string[] => {
    const year = date.getFullYear().toString();

    if (allJanFirst) {
      return [year];
    }

    const month = date.toLocaleDateString([], { month: "short" });
    const day = date.getDate();
    const weekday = date.toLocaleDateString([], { weekday: "short" });

    return [
      hasTime ? formatTime(date) : null,
      hasWeekdays ? weekday : null,
      `${month} ${day}`,
      year,
    ].filter(Boolean) as string[];
  };

  const labels = useMemo(() => {
    let prev: any = null;
    return ticks.map(({ value, xOffset }, i) => {
      const fullLabels = formatLabel(value);
      const result = {
        value,
        xOffset,
        labels: !prev
          ? fullLabels
          : fullLabels.filter((label, i) => label !== prev[i]),
      };
      prev = fullLabels;
      return result;
    });
  }, [ticks]);

  return (
    <g transform={`translate(0,${height})`}>
      <path
        d={`M${start},6V0H${end}V6`}
        fill="none"
        stroke="currentColor"
      />
      {labels.map(({ value, xOffset, labels }, i) => (
        <g
          key={value.getTime().toString()}
          transform={`translate(${xOffset},0)`}
        >
          <line
            y2="6"
            stroke="currentColor"
          />
          <foreignObject
            width="100px"
            height="200px"
            style={{
              transform: "translateY(10px) translateX(-50px)",
            }}
          >
            {labels.map((segment) => (
              <p className="text-center" key={segment}>{segment}</p>
            ))}
          </foreignObject>
        </g>
      ))}
    </g>
  );
};

interface OptimizedTimelineItem {
  start: Date;
  end: Date;
  layer: number;
  duration: number;
  original: TimelineItem;
}

// This function optimizes the vertical positioning of timeline items
function optimizeTimelineLayout(
  items: TimelineItem[],
  epsilon: number,
): OptimizedTimelineItem[] {
  const oItems: OptimizedTimelineItem[] = items.map((item) => ({
    start: new Date(item.start),
    end: new Date(item.end),
    duration: new Date(item.end).getTime() - new Date(item.start).getTime(),
    original: item,
    layer: 0,
  }));

  // Track active items in each layer
  const layers: OptimizedTimelineItem[][] = [];

  // Process each item to assign layers
  const optimizedItems = oItems.map((item) => {
    let targetLayer = 0;
    let foundLayer = false;

    // Find the lowest available layer
    while (!foundLayer) {
      if (targetLayer >= layers.length) {
        // Create new layer if needed
        layers[targetLayer] = [];
        foundLayer = true;
      } else {
        // Check for conflicts in current layer

        const hasConflict = layers[targetLayer].length > 0 &&
          layers[targetLayer][layers[targetLayer].length - 1].end.getTime() >
            item.start.getTime() + epsilon;

        if (hasConflict && 3) {
          foundLayer = true;
        }

        if (!hasConflict) {
          foundLayer = true;
        } else {
          targetLayer++;
        }
      }
    }
    const optimizedItem = { ...item, layer: targetLayer };
    layers[targetLayer] = layers[targetLayer] || [];
    layers[targetLayer].push(optimizedItem);

    return optimizedItem;
  });

  return optimizedItems;
}

const TimelineItems = ({
  items,
  scale,
  transform,
}: {
  items: TimelineItem[];
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
}) => {
  const newScale = transform.rescaleX(scale);
  const [start, end] = newScale.domain();
  const duration = end.getTime() - start.getTime();

  const MARGIN = 14;
  const ITEM_HEIGHT = 20;
  const LAYER_GAP = 4;
  const TOTAL_HEIGHT = ITEM_HEIGHT + LAYER_GAP;

  const optimizedItems = useMemo(
    () => optimizeTimelineLayout(items, duration * 0.01),
    [items, duration],
  );

  return (
    <g>
      {optimizedItems.map((item) => {
        const startX = newScale(item.start);
        const endX = newScale(item.end);
        const width = duration < 1000 * year ? Math.max(endX - startX, 2) : 2;

        return (
          <rect
            key={item.original.id}
            x={startX}
            y={item.layer * TOTAL_HEIGHT + MARGIN}
            width={width}
            height={ITEM_HEIGHT}
            className="fill-chart-1"
          >
            <title>{item.original.id}</title>
          </rect>
        );
      })}
    </g>
  );
};

const VoiceRow = ({
  voices,
  scale,
  transform,
}: {
  voices: any[];
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
}) => {
  const newScale = transform.rescaleX(scale);
  return (
    <>
      <h1>{voices.length}</h1>
      <g>
        {voices.map((item) => {
          const startX = newScale(item.start);
          const endX = newScale(item.end);
          const width = Math.max(endX - startX, 1);

          return (
            <rect
              key={item._id}
              x={startX}
              y={0}
              width={width}
              height={10}
              className="fill-chart-2"
            />
          );
        })}
      </g>
    </>
  );
};

const TranscriptsRow = ({
  transcripts,
}: {
  transcripts: Transcript[];
}) => {
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

const PlayPauseButton = () => {
  const { isPlaying, toggleIsPlaying } = useDateStore();
  return (
    <Button onClick={() => toggleIsPlaying()}>
      {isPlaying ? <Pause /> : <Play />}
    </Button>
  );
};

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
      // const duration = end.getTime() - start.getTime();
      const form = new FormData();
      form.append("start", start.toISOString());
      form.append("end", end.toISOString());
      fetcher.submit(form);
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
    [timeScale, fetcher],
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
