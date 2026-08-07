import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import _ from "lodash";
import { useTimelineRange } from "../stores/timelineRange.ts";

interface TimelineDimensions {
  width: number;
  height: number;
}

interface TimelineContextValue {
  containerRef: React.RefObject<HTMLDivElement | null>;
  dimensions: TimelineDimensions;
  transform: d3.ZoomTransform;
  timeScale: d3.ScaleTime<number, number>;
  width: number;
  zoomTo: (newStart: Date, newEnd: Date) => void;
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

export function TimelineProvider({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<TimelineDimensions>({
    width: 800,
    height: 100,
  });
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);

  const { start, end, setRange } = useTimelineRange();

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([{ contentRect }]) => {
      setDimensions((prev) => ({ ...prev, width: contentRect.width }));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const timeScale = useMemo(() =>
    d3.scaleTime()
      .domain([start, end])
      .range([0, dimensions.width]), [start, end, dimensions.width]);

  const onZoom = useCallback(
    _.debounce((start: Date, end: Date) => {
      setRange(start, end);
    }, 10),
    [setRange],
  );

  const handleZoom = useCallback(
    (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      const t = event.transform;
      setTransform(t);

      const [start, end] = t.rescaleX(timeScale).domain();
      if (!isNaN(start.getTime())) onZoom(start, end);

      d3.selectAll<SVGSVGElement, unknown>(".zoomable, .zoomed").each(function () {
        const svg = d3.select(this);
        const node = svg.node();

        if (!node || node.contains(event.sourceEvent?.target as Element)) {
          return;
        }

        svg.property("__zoom", t);
      });
    },
    [timeScale, onZoom],
  );

  const zoomBehavior = useMemo(() =>
    d3.zoom<SVGSVGElement, unknown>()
      .on("zoom", handleZoom)
      .wheelDelta((event) => -event.deltaY * 0.002)
      .touchable(() => true)
      .filter((event) => {
        if (event.type === "dblclick") return false;
        if (event.button && event.button !== 0) return false;
        return true;
      }), [
    handleZoom,
    dimensions.width,
    dimensions.height,
  ]);

  useEffect(() => {
    const svgs = d3.selectAll<SVGSVGElement, unknown>(".zoomable");

    svgs.each(function () {
      const svg = d3.select(this);
      const node = svg.node();

      if (node) {
        node.style.touchAction = "none";
        node.style.webkitUserSelect = "none";
        node.style.userSelect = "none";
      }

      svg.call(zoomBehavior as any);
      svg.property("__zoom", transform);
    });

    return () => {
      svgs.on("zoom", null);
    };
  }, [zoomBehavior, dimensions.width, dimensions.height]);

  const zoomTo = useCallback((newStart: Date, newEnd: Date) => {
    if (!dimensions.width) return;

    const i = d3.interpolate([start.getTime(), end.getTime()], [newStart.getTime(), newEnd.getTime()]);

    setTransform(d3.zoomIdentity);
    d3.selectAll<SVGSVGElement, unknown>(".zoomable")
      .interrupt()
      .property("__zoom", d3.zoomIdentity);

    if (containerRef.current) {
      d3.select(containerRef.current)
        .transition()
        .duration(250)
        .tween("zoomTo", () => {
          return (t) => {
            const [s, e] = i(t);
            setRange(new Date(s), new Date(e));
          };
        });
    }
  }, [dimensions.width, start, end, setRange]);

  const value = {
    containerRef,
    dimensions,
    transform,
    timeScale,
    width: dimensions.width,
    zoomTo,
  };

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
}

export function useTimeline() {
  const context = useContext(TimelineContext);
  if (!context) {
    throw new Error("useTimeline must be used within a TimelineProvider");
  }
  return context;
}
