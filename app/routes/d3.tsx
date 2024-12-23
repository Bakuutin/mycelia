import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import * as d3 from 'd3';
import _ from 'lodash';
import { LoaderFunctionArgs } from '@remix-run/node';
import { MongoClient } from 'mongodb';
import { z } from "zod";

const zTimelineItem = z.object({
    id: z.string(),
    start: z.date(),
    end: z.date(),
});

type TimelineItem = z.infer<typeof zTimelineItem>;


function getDaysAgo(n: number) {
    const today = new Date(new Date().toISOString().split('T')[0])
    const monthAgo = new Date(today.getTime() - n * 24 * 60 * 60 * 1000)
    return monthAgo
}

const QuerySchema = z.object({
    start: z.coerce.date(),
    end: z.coerce.date(),
});

const zLoaderData = z.object({
    items: z.array(zTimelineItem),
    start: z.date(),
    end: z.date(),
});

type LoaderData = z.infer<typeof zLoaderData>;

export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    let params;
    try {
        params = QuerySchema.parse({
            start: url.searchParams.get('start') || getDaysAgo(30),
            end: url.searchParams.get('end') || getDaysAgo(-1),
        })
    } catch (error) {
        console.error(error);
        throw new Response("Invalid format", { status: 400 });
    }
    let {start, end } = params;

    const duration = end.getTime() - start.getTime();
    const originalStart = start;
    const originalEnd = end;
    start = new Date(start.getTime() - duration / 2);
    end = new Date(end.getTime() + duration / 2);

    const day = 1000 * 60 * 60 * 24;
  
    let gap = 0;

    if (duration > day * 3) {
        gap = duration * 0.03;
    }

    const client = new MongoClient(process.env.MONGO_URL as string);
    try {
        await client.connect();
        const database = client.db("a5t-2024-11-19");
        const collection = database.collection("source_files");
        const items = await collection.find({
            start: {
                $lte: end,
            },
            end: {
                $gte: start,
            },
        })
            .sort({ start: 1 })
            .toArray();

        const timelineData: TimelineItem[] = [];
        

        if (gap > 0) {
            let prev: TimelineItem | null = null;
            for (const _item of items) {
                const item: TimelineItem = {
                    start: _item.start,
                    end: _item.end,
                    id: _item._id.toHexString(),
                };

                if (prev) {
                    if (prev.end.getTime() > item.start.getTime() - gap) {
                        prev.end = _.max([prev.end, item.end]) as Date;
                    } else {
                        timelineData.push(prev);
                        prev = null;
                    }
                } else {
                    prev = item;
                }

            }
            if (prev) {
                timelineData.push(prev);
            }
        } else {
            timelineData.push(...items.map(item => ({
                start: item.start,
                end: item.end,
                id: item._id.toHexString(),
            })));
        }

        return ({
            items: timelineData,
            start: originalStart,
            end: originalEnd,
        });
    } finally {
        await client.close();
    }
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
        return newScale.ticks().map(tick => ({
            value: tick,
            xOffset: newScale(tick)
        }));
    }, [scale, transform]);

    const hasTime = useMemo(() => {
        return ticks.some(({ value }) => (
            value.getHours() !== 0 ||
            value.getMinutes() !== 0 ||
            value.getSeconds() !== 0
        ));
    }, [ticks]);

    const hasSeconds = useMemo(() => {
        return ticks.some(({ value }) => value.getSeconds() !== 0);
    }, [ticks]);

    const [start, end] = scale.range();

    return (
        <g transform={`translate(0,${height})`}>
            <path
                d={`M${start},6V0H${end}V6`}
                fill="none"
                stroke="currentColor"
            />
            {ticks.map(({ value, xOffset }) => (
                <g key={value.toISOString()} transform={`translate(${xOffset},0)`}>
                    <line y2="6" stroke="currentColor" />
                    <text
                        style={{
                            fontSize: "10px",
                            textAnchor: "middle",
                            transform: "translateY(20px)",
                        }}>
                        {value.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </text>
                    {hasTime && (
                        <text
                            style={{
                                fontSize: "10px",
                                textAnchor: "middle",
                                transform: "translateY(30px)",
                            }}>
                            {
                                hasSeconds ?
                                    value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) :
                                    value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
                            }
                        </text>
                    )}
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
  function optimizeTimelineLayout(items: TimelineItem[], epsilon: number): OptimizedTimelineItem[] {
    
    const oItems: OptimizedTimelineItem[] = items.map(item => ({
        start: new Date(item.start),
        end: new Date(item.end),
        duration: new Date(item.end).getTime() - new Date(item.start).getTime(),
        original: item,
        layer: 0,
    }));

    
    // Track active items in each layer
    const layers: OptimizedTimelineItem[][] = [];
    
    // Process each item to assign layers
    const optimizedItems = oItems.map(item => {
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

          const hasConflict = (
            layers[targetLayer].length > 0 &&
            layers[targetLayer][layers[targetLayer].length - 1].end.getTime() > item.start.getTime() + epsilon
          ); 
          
          if (!hasConflict) {
            foundLayer = true;
          } else {
            targetLayer++;
          }
        }
      }
      const optimizedItem = { ...item, layer: targetLayer };
      layers[targetLayer].push(optimizedItem);
      
      return optimizedItem;
    });
  
    return optimizedItems;
  }

const TimelineItems = ({
    items,
    scale,
    transform
}: {
    items: TimelineItem[];
    scale: d3.ScaleTime<number, number>;
    transform: d3.ZoomTransform;
}) => {
    const newScale = transform.rescaleX(scale);
    const [start, end] = newScale.domain();
    const duration = end.getTime() - start.getTime();

    const ITEM_HEIGHT = 20;
    const LAYER_GAP = 4;
    const TOTAL_HEIGHT = ITEM_HEIGHT + LAYER_GAP;

    const optimizedItems = useMemo(() => optimizeTimelineLayout(items, duration * 0.01), [items, duration]);

    return (
        <g>
            {optimizedItems.map(item => {
                const startX = newScale(item.start);
                const endX = newScale(item.end);
                const width = Math.max(endX - startX, 2);

                return (
                    <rect
                        key={item.original.id}
                        x={startX}
                        y={item.layer * TOTAL_HEIGHT}
                        width={width}
                        height={ITEM_HEIGHT}
                        fill="#4299e1"
                        opacity={0.7}
                    />
                );
            })}
        </g>
    );
};

const TimelinePage = () => {
    let { items, start, end } = zLoaderData.parse(useLoaderData<LoaderData>());

    const fetcher = useFetcher<LoaderData>();

    if (fetcher.data) {
        items = zLoaderData.parse(fetcher.data).items;
    }

    const containerRef = useRef<HTMLDivElement>(null);

    const [dimensions, setDimensions] = useState({ width: 800, height: 300 });

    const margin = { top: 20, right: 20, bottom: 60, left: 40 };
    const width = dimensions.width - margin.left - margin.right;
    const height = dimensions.height - margin.top - margin.bottom;


    const [transform, setTransform] = useState(d3.zoomIdentity);

    useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                setDimensions({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height
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

    const fetchMore = useCallback(_.debounce((start, end) => {
        const duration = end.getTime() - start.getTime();
        const formData = new FormData();
        formData.append('start', start.toISOString());
        formData.append('end', end.toISOString());

        fetcher.submit(formData, {
            method: 'get',
            preventScrollReset: true,
        });
    }, 500),
        [fetcher]
    );

    const handleZoom = useCallback((event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        setTransform(event.transform);

        const newScale = event.transform.rescaleX(timeScale);
        const [
            start, end
        ] = newScale.domain();

        fetchMore(start, end);
    }, [timeScale, fetcher]);

    const zoom = useMemo(() => {
        return d3.zoom()
            .scaleExtent([0, 304549])
            .extent([[0, 0], [width, height]])
            .on("zoom", handleZoom);
    }, [width, height, handleZoom]);

    useEffect(() => {
        const svg = d3.select("#timeline-svg");
        svg.call(zoom as any);
    }, [zoom]);

    // if (!containerRef.current) return;

    return (
        <div className="h-screen p-4" ref={containerRef}>
            {fetcher.state === "loading" && (
                <div className="absolute top-4 right-4 bg-blue-500 text-white px-4 py-2 rounded">
                    Loading...
                </div>
            )}
            {containerRef.current && (
                <svg
                    id="timeline-svg"
                    className="w-full h-full overflow-x-scroll"
                    width={width + margin.left + margin.right}
                    height={height + margin.top + margin.bottom}
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
    );
};

export default TimelinePage;
