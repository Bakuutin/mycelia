import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import * as d3 from 'd3';
import _ from 'lodash';
import { LoaderFunctionArgs } from '@remix-run/node';
import { MongoClient } from 'mongodb';
import { c } from 'node_modules/vite/dist/node/types.d-aGj9QkWt';

d3.axisBottom;
// Types from your original code
type TimelineItem = {
  id: string;
  start: string;
  end: string;
};

type LoaderData = {
  items: TimelineItem[];
  start: string;
  end: string;
};

function getDefaultStartDate() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return date.toISOString().split('T')[0];
}

function getDefaultEndDate() {
  return new Date().toISOString().split('T')[0];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const visibleStart = url.searchParams.get('start') || getDefaultStartDate();
  const visibleEnd = url.searchParams.get('end') || getDefaultEndDate();

  // Validate dates
  if (!Date.parse(visibleStart) || !Date.parse(visibleEnd)) {
    throw new Response("Invalid date format", { status: 400 });
  }

  const client = new MongoClient(process.env.MONGO_URL as string);

  const [start, end] = [visibleStart, visibleEnd].map(date => new Date(date));

  try {
    await client.connect();
    const database = client.db("a5t-2024-11-19");
    const collection = database.collection("source_files");
    console.log({ start, end });
    const items = await collection.find({
      start: {
        $lte: end,
      },
      end: {
        $gte: start,
      },
    })
    .sort({ start: -1 })
    .limit(1090)
    .toArray();

    const timelineData = items.map(item => ({
      id: item._id.toString(),
      start: item.start,
      end: item.end,
    }));

    // Return JSON response with proper typing
    return ({
      items: timelineData,
      start: visibleStart,
      end: visibleEnd,
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
      const numberOfTicks = Math.floor(width / 120);
      return newScale.ticks(numberOfTicks).map(tick => ({
        value: tick,
        xOffset: newScale(tick)
      }));
    }, [scale, transform]);

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
                transform: "translateY(20px)"
              }}>
              {value.toISOString()}
            </text>
          </g>
        ))}
      </g>
    );
  };
  
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

    console.log(items.length)
    
    return (
      <g>
        {items.map(item => {
          const startX = newScale(new Date(item.start));
          const endX = newScale(new Date(item.end));
          const width = Math.max(endX - startX, 2);
          
          return (
            <rect
              key={item.id}
              x={startX}
              y={0}
              width={width}
              height={10}
              fill="#4299e1"
              opacity={0.7}
            />
          );
        })}
      </g>
    );
  };
  
  const TimelinePage = () => {
    const { items, start, end } = useLoaderData<LoaderData>();
  
    const fetcher = useFetcher();
    
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
    console.log(event.transform);
      setTransform(event.transform);
      
      const newScale = event.transform.rescaleX(timeScale);
      const [
        start, end
      ] = newScale.domain();

      fetchMore(start, end);
    }, [timeScale, fetcher]);
  
    const zoom = useMemo(() => {
      return d3.zoom()
        // .scaleExtent([0.5, 20])
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
        { containerRef.current && (
        <svg 
          id="timeline-svg"
          className="w-full h-full"
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
  