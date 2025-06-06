import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import _ from "lodash";
import { type LoaderData } from "../types/timeline.ts";

interface TimelineDimensions {
  width: number;
  height: number;
}

export function useTimeline(
  data: LoaderData,
  onDateRangeChange: (start: Date, end: Date) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<TimelineDimensions>({
    width: 800,
    height: 100,
  });
  const [transform, setTransform] = useState(d3.zoomIdentity);

  const width = dimensions.width;
  const height = dimensions.height;

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions((prev) => ({
          ...prev,
          width: entry.contentRect.width,
        }));
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [containerRef]);

  const timeScale = useMemo(() => {
    return d3.scaleTime()
      .domain([new Date(data.start), new Date(data.end)])
      .range([0, width]);
  }, [data.start, data.end, width]);

  const fetchMore = useCallback(
    _.debounce((start: Date, end: Date) => {
      onDateRangeChange(start, end);
    }, 300),
    [onDateRangeChange],
  );

  const handleZoom = useCallback(
    (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      const newScale = event.transform.rescaleX(timeScale);
      const [start, end] = newScale.domain();
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return;
      }
      setTransform(event.transform);
      fetchMore(start, end);
    },
    [timeScale, fetchMore],
  );

  const zoom = useMemo(() => {
    const zoom = d3.zoom();
    zoom.on("zoom", handleZoom);
    return zoom;
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
