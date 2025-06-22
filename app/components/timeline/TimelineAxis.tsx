import React, { useMemo } from "react";
import * as d3 from "d3";
import { Label } from "./formatters/types.ts";
import gregorianFormatter from "./formatters/gregorian.ts";

interface TimelineAxisProps {
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  height: number;
  width: number;
  formatter?: (
    scale: d3.ScaleTime<number, number>,
    transform: d3.ZoomTransform,
    width: number,
  ) => Label[];
}

interface AxisLineProps {
  start: number;
  end: number;
  height: number;
}

interface TickLabelProps {
  value: Date;
  xOffset: number;
  segments: React.ReactNode[];
}

const TickLabel: React.FC<TickLabelProps> = ({ value, xOffset, segments }) => {
  const [first, ...rest] = segments;

  return (
    <g
      transform={`translate(${xOffset},0)`}
    >
      <foreignObject
        width="100px"
        height="45px"
        style={{
          transform: "translateX(-50px)",
        }}
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
      <line
        x1="0"
        x2="0"
        y1="48"
        y2="45"
        stroke="currentColor"
        strokeWidth="1"
      />
    </g>
  );
};

const TickLabels: React.FC<{ labels: Label[] }> = ({ labels }) => (
  <>
    {labels.map(({ value, xOffset, segments }) => (
      <TickLabel
        key={value.getTime().toString()}
        value={value}
        xOffset={xOffset}
        segments={segments}
      />
    ))}
  </>
);

export const TimelineAxis = ({
  scale,
  transform,
  height,
  width,
  formatter = gregorianFormatter,
}: TimelineAxisProps) => {
  const labels = useMemo(() => formatter(scale, transform, width), [
    scale,
    transform,
    width,
    formatter,
  ]);
  const [start, end] = scale.range();

  // TODO: Be able Big Bang to the timeline 3.787 ± 0.020 billion years ago. (Doesn't fit in JS number precision rn)

  return (
    <g transform={`translate(0,${height})`}>
      <TickLabels labels={labels} />
    </g>
  );
};
