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
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);

  // Resize observer for width
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([{ contentRect }]) => {
      setDimensions((prev) => ({ ...prev, width: contentRect.width }));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [containerRef]);

  // Base time scale
  const timeScale = useMemo(() =>
    d3.scaleTime()
      .domain([new Date(data.start), new Date(data.end)])
      .range([0, dimensions.width]), [dimensions.width]);

  // Debounced data fetch
  const fetchMore = useCallback(
    _.debounce((start: Date, end: Date) => onDateRangeChange(start, end), 300),
    [onDateRangeChange],
  );

  // Zoom event handler: horizontal only, syncs state
  const handleZoom = useCallback(
    (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      const t = event.transform;
      setTransform(t);

      // fetch new domain
      const newDomain = t.rescaleX(timeScale).domain();
      if (!isNaN(newDomain[0].getTime())) fetchMore(newDomain[0], newDomain[1]);

      // Sync zoom state across all zoomable SVGs
      d3.selectAll<SVGSVGElement, unknown>(".zoomable").each(function () {
        const svg = d3.select(this);
        const node = svg.node();

        if (!node || node.contains(event.sourceEvent?.target as Element)) {
          return;
        }

        svg.property("__zoom", t);
      });
    },
    [timeScale],
  );

  // Memoize zoom behavior to prevent recreation
  const zoomBehavior = useMemo(() =>
    d3.zoom<SVGSVGElement, unknown>()
      .on("zoom", handleZoom)
      // .scaleExtent([0.1, 100])
      // .translateExtent([[0, 0], [dimensions.width, dimensions.height]])
      .wheelDelta((event) => -event.deltaY * 0.002), [
    handleZoom,
    dimensions.width,
    dimensions.height,
  ]);

  // Attach zoom once
  useEffect(() => {
    const svgs = d3.selectAll<SVGSVGElement, unknown>(".zoomable");

    svgs.each(function () {
      const svg = d3.select(this);
      // attach zoom
      svg.call(zoomBehavior as any);
      // initialize internal state
      svg.property("__zoom", transform);
    });

    return () => {
      svgs.on("zoom", null);
    };
  }, [zoomBehavior, dimensions.width, dimensions.height]);

  return {
    containerRef,
    dimensions,
    transform,
    timeScale,
    width: dimensions.width,
    height: dimensions.height,
  };
}
