import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import _ from "lodash";
import { type LoaderData } from "../types/timeline";

interface TimelineDimensions {
  width: number;
  height: number;
  margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export function useTimeline(
  data: LoaderData,
  onDateRangeChange: (start: Date, end: Date) => void
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<TimelineDimensions>({
    width: 800,
    height: 350,
    margin: { top: 10, right: 20, bottom: 110, left: 40 },
  });
  const [transform, setTransform] = useState(d3.zoomIdentity);

  const width = dimensions.width - dimensions.margin.left - dimensions.margin.right;
  const height = dimensions.height - dimensions.margin.top - dimensions.margin.bottom;

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions(prev => ({
          ...prev,
          width: entry.contentRect.width,
        }));
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const timeScale = useMemo(() => {
    return d3.scaleTime()
      .domain([new Date(data.start), new Date(data.end)])
      .range([0, width]);
  }, [data.start, data.end, width]);

  const fetchMore = useCallback(
    _.debounce((start: Date, end: Date) => {
      onDateRangeChange(start, end);
    }, 300),
    [onDateRangeChange]
  );

  const handleZoom = useCallback(
    (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      setTransform(event.transform);
      const newScale = event.transform.rescaleX(timeScale);
      const [start, end] = newScale.domain();
      fetchMore(start, end);
    },
    [timeScale, fetchMore]
  );

  const zoom = useMemo(() => {
    return d3.zoom()
      .on("zoom", handleZoom);
  }, [width, height, handleZoom]);

  useEffect(() => {
    const svg = d3.select("#timeline-svg");
    svg.call(zoom as any);
  }, [zoom]);

  return {
    containerRef,
    dimensions,
    transform,
    timeScale,
    width,
    height,
  };
} 