import { useMemo, useRef, useEffect } from "react";
import { Layer, LayerComponentProps } from "@/core/core.ts";
import { useTimelineSelectionStore } from "@/stores/timelineSelectionStore.ts";

import { Formatter, Label } from "./formatters/types.ts";

import gregorianFormatter from "./formatters/gregorian.ts";
import siFormatter from "./formatters/si.ts";

export const GregorianFormatter: Formatter = gregorianFormatter;
export const SiFormatter: Formatter = siFormatter;

export * from "./ClearSelectionTool";

export type TimeLayerOptions = {
  formatter: Formatter;
};

export const TimeLayer: (options?: TimeLayerOptions) => Layer = (
  options = { formatter: gregorianFormatter },
) => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { selection, setSelection } = useTimelineSelectionStore();
      const svgRef = useRef<SVGSVGElement>(null);
      const isSelectingRef = useRef(false);
      const selectionStartXRef = useRef<number | null>(null);
      const selectionStartTimeRef = useRef<Date | null>(null);
      const hasMovedRef = useRef(false);
      const draggingHandleRef = useRef<"left" | "right" | null>(null);
      const handleStartTimeRef = useRef<Date | null>(null);
      const selectionRef = useRef(selection);
      const scaleRef = useRef(scale);
      const transformRef = useRef(transform);
      
      useEffect(() => {
        selectionRef.current = selection;
      }, [selection]);

      useEffect(() => {
        scaleRef.current = scale;
        transformRef.current = transform;
      }, [scale, transform]);

      useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;

        const handleDocumentMouseMove = (e: MouseEvent) => {
          if (!setSelection || !svg) return;

          const rect = svg.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const rescaledScale = transformRef.current.rescaleX(scaleRef.current);
          const clampedX = Math.max(0, Math.min(width, x));
          const newTime = rescaledScale.invert(clampedX);

          if (draggingHandleRef.current === "left") {
            const currentSelection = selectionRef.current;
            if (!currentSelection?.end) return;
            const end = currentSelection.end;
            if (newTime <= end) {
              setSelection({ start: newTime, end });
            } else {
              setSelection({ start: end, end: newTime });
            }
          } else if (draggingHandleRef.current === "right") {
            const currentSelection = selectionRef.current;
            if (!currentSelection?.start) return;
            const start = currentSelection.start;
            if (newTime >= start) {
              setSelection({ start, end: newTime });
            } else {
              setSelection({ start: newTime, end: start });
            }
          } else if (isSelectingRef.current && selectionStartXRef.current !== null && selectionStartTimeRef.current !== null) {
            const deltaX = Math.abs(x - selectionStartXRef.current);
            
            if (deltaX > 3) {
              hasMovedRef.current = true;
            }
            
            if (hasMovedRef.current) {
              const endTime = rescaledScale.invert(clampedX);
              const startTime = selectionStartTimeRef.current;
              
              if (startTime <= endTime) {
                setSelection({ start: startTime, end: endTime });
              } else {
                setSelection({ start: endTime, end: startTime });
              }
            }
          } else {
            return;
          }
          
          e.preventDefault();
          e.stopPropagation();
        };

        const handleDocumentMouseUp = (e: MouseEvent) => {
          if (!isSelectingRef.current && !draggingHandleRef.current) return;
          
          if (draggingHandleRef.current) {
            draggingHandleRef.current = null;
            handleStartTimeRef.current = null;
          } else if (isSelectingRef.current) {
            if (!hasMovedRef.current && setSelection && selectionStartTimeRef.current) {
              setSelection({ start: null, end: null });
            }
            
            isSelectingRef.current = false;
            selectionStartXRef.current = null;
            selectionStartTimeRef.current = null;
            hasMovedRef.current = false;
          }
          
          document.removeEventListener("mousemove", handleDocumentMouseMove, { capture: true });
          document.removeEventListener("mouseup", handleDocumentMouseUp, { capture: true });
          
          e.preventDefault();
          e.stopPropagation();
        };

        const handleHandleMouseDown = (e: MouseEvent, handle: "left" | "right") => {
          if (e.button !== 0) return;
          if (!setSelection) return;
          const currentSelection = selectionRef.current;
          if (!currentSelection?.start || !currentSelection?.end) return;

          draggingHandleRef.current = handle;
          handleStartTimeRef.current = handle === "left" ? currentSelection.start : currentSelection.end;
          
          document.addEventListener("mousemove", handleDocumentMouseMove, { capture: true });
          document.addEventListener("mouseup", handleDocumentMouseUp, { capture: true });
          
          e.preventDefault();
          e.stopPropagation();
        };

        const handleNativeMouseDown = (e: MouseEvent) => {
          if (e.button !== 0) return;
          if (!setSelection) return;

          const target = e.target as Element;
          if (target.classList.contains("selection-handle")) {
            const handle = target.classList.contains("selection-handle-left") ? "left" : "right";
            handleHandleMouseDown(e, handle);
            return;
          }

          const rect = svg.getBoundingClientRect();
          const x = e.clientX - rect.left;
          
          isSelectingRef.current = true;
          selectionStartXRef.current = x;
          hasMovedRef.current = false;
          
          const rescaledScale = transformRef.current.rescaleX(scaleRef.current);
          const startTime = rescaledScale.invert(x);
          selectionStartTimeRef.current = startTime;
          
          document.addEventListener("mousemove", handleDocumentMouseMove, { capture: true });
          document.addEventListener("mouseup", handleDocumentMouseUp, { capture: true });
          
          e.preventDefault();
          e.stopPropagation();
        };

        svg.addEventListener("mousedown", handleNativeMouseDown, { capture: true });

        return () => {
          svg.removeEventListener("mousedown", handleNativeMouseDown, { capture: true });
          document.removeEventListener("mousemove", handleDocumentMouseMove, { capture: true });
          document.removeEventListener("mouseup", handleDocumentMouseUp, { capture: true });
        };
      }, [width, setSelection]);

      const selectionRect = useMemo(() => {
        if (!selection?.start || !selection?.end) return null;

        const rescaledScale = transform.rescaleX(scale);
        const x1 = rescaledScale(selection.start);
        const x2 = rescaledScale(selection.end);
        
        const left = Math.min(x1, x2);
        const width = Math.abs(x2 - x1);

        if (Number.isNaN(width)) return null;

        return { left, width };
      }, [selection, scale, transform]);

      return (
        <svg
          ref={svgRef}
          width={width}
          height={40}
          className="overflow-visible"
          style={{ cursor: "crosshair" }}
        >
          {selectionRect && (
            <>
              <rect
                x={selectionRect.left}
                y={0}
                width={selectionRect.width}
                height={40}
                fill="rgba(59, 130, 246, 0.2)"
                stroke="rgba(59, 130, 246, 0.5)"
                strokeWidth={1}
                pointerEvents="none"
              />
              
              {/* Visual Handles */}
              <rect
                x={selectionRect.left - 2}
                y={0}
                width={4}
                height={40}
                fill="rgba(59, 130, 246, 0.8)"
                stroke="rgba(59, 130, 246, 1)"
                strokeWidth={1}
                pointerEvents="none"
              />
              <rect
                x={selectionRect.left + selectionRect.width - 2}
                y={0}
                width={4}
                height={40}
                fill="rgba(59, 130, 246, 0.8)"
                stroke="rgba(59, 130, 246, 1)"
                strokeWidth={1}
                pointerEvents="none"
              />
            </>
          )}
        <TimelineAxis
          scale={scale}
          transform={transform}
          width={width}
          formatter={options.formatter}
        />
        {selectionRect && (
          <>
            {/* Interactive Hit Areas */}
            <rect
              className="selection-handle selection-handle-left"
              x={selectionRect.left - 5}
              y={0}
              width={10}
              height={40}
              fill="transparent"
              style={{ cursor: "ew-resize" }}
              pointerEvents="all"
            />
            <rect
              className="selection-handle selection-handle-right"
              x={selectionRect.left + selectionRect.width - 5}
              y={0}
              width={10}
              height={40}
              fill="transparent"
              style={{ cursor: "ew-resize" }}
              pointerEvents="all"
            />
          </>
        )}
      </svg>
      );
    },
  } as Layer;
};

interface TimelineAxisProps extends LayerComponentProps {
  formatter: Formatter;
}

const TimelineAxis = ({
  scale,
  transform,
  width,
  formatter = gregorianFormatter,
}: TimelineAxisProps) => {
  const labels = useMemo(() => formatter(scale, transform, width), [
    scale,
    transform,
    formatter,
  ]);

  // TODO: Be able Big Bang to the timeline 3.787 ± 0.020 billion years ago. (Doesn't fit in JS number precision rn)

  return (
    <g style={{ pointerEvents: "none" }}>
      <TickLabels labels={labels} />
    </g>
  );
};

const TickLabel: React.FC<{
  xOffset: number;
  segments: React.ReactNode[];
}> = ({ xOffset, segments }) => {
  const [first, ...rest] = segments;
  const width = 150;

  return (
    <g
      transform={`translate(${xOffset - width / 2},0)`}
    >
      <foreignObject
        width={width}
        height="40px"
        className="overflow-visible"
        style={{ pointerEvents: "none" }}
      >
        <div className="flex flex-col-reverse h-full">
          <p className="text-center text-xs">{first}</p>
          {rest.length > 0 && (
            <div className="mx-auto text-center text-xs flex flex-row-reverse gap-1">
              {rest.map((segment, i) => <span key={i}>{segment}</span>)}
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  );
};

const TickLabels: React.FC<{ labels: Label[] }> = ({ labels }) => (
  <>
    {labels.map(({ xOffset, segments }, idx) => (
      <TickLabel
        key={idx}
        xOffset={xOffset}
        segments={segments}
      />
    ))}
  </>
);
