import React, { useMemo } from "react";
import * as d3 from "d3";
import { Label } from "./formatters/types";
import gregorianFormatter from "./formatters/gregorian";

interface TimelineAxisProps {
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  height: number;
  width: number;
  formatter?: (scale: d3.ScaleTime<number, number>, transform: d3.ZoomTransform, width: number) => Label[];
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

const AxisLine: React.FC<AxisLineProps> = ({ start, end, height }) => (
  <g transform={`translate(0,${height})`}>
    <path
      d={`M${start},6V0H${end}V6`}
      fill="none"
      stroke="currentColor"
    />
  </g>
);

const TickLabel: React.FC<TickLabelProps> = ({ value, xOffset, segments }) => (
  <g
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
      {segments.map((segment, i) => (
        <p className="text-center" key={i}>{segment}</p>
      ))}
    </foreignObject>
  </g>
);

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
  const labels = useMemo(() => formatter(scale, transform, width), [scale, transform, width, formatter]);
  const [start, end] = scale.range();


  // TODO: Add Big Bang to the timeline 3.787 ± 0.020 billion years ago

  return (
    <g transform={`translate(0,${height})`}>
      <AxisLine start={start} end={end} height={height} />
      <TickLabels labels={labels} />
    </g>
  );
};
