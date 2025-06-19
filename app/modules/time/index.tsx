import { Layer, LayerComponentProps } from "@/core.ts"

import React, { useMemo } from "react";
import * as d3 from "d3";
import { Formatter, Label } from "./formatters/types.ts";

import gregorianFormatter from "./formatters/gregorian.ts";
import siFormatter from "./formatters/si.ts";

export const GregorianFormatter: Formatter = gregorianFormatter;
export const SiFormatter: Formatter = siFormatter;


export type TimeLayerOptions = {
  formatter: Formatter;
}

export const TimeLayer: (options?: TimeLayerOptions) => Layer = (options = {formatter: gregorianFormatter}) => {
    return {
        component: ({scale, transform, width}: LayerComponentProps) => (
          <svg width={width} height={40} className="zoomable overflow-visible">
            <TimelineAxis
                scale={scale}
                transform={transform}
                width={width}
                formatter={options.formatter}
            />
          </svg>
        ),
    } as Layer
}




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
      <g>
        <TickLabels labels={labels} />
      </g>
    );
  };

const TickLabel: React.FC<{
  value: Date;
  xOffset: number;
  segments: React.ReactNode[];
}> = ({ value, xOffset, segments }) => {
  const [first, ...rest] = segments;


  return (
    <g
      transform={`translate(${xOffset},0)`}
    >
      <foreignObject
      width="150px"
      height="40px"
      className="overflow-visible"
    >
          <div className="flex flex-col-reverse h-full">
            <p className="text-center text-xs">{first}</p>
            {
              rest.length > 0 && (
                <div className="mx-auto text-center text-xs flex flex-row-reverse gap-1">
                    {
                      rest.map((segment, i) => (
                        <span key={i}>{segment}</span>
                      ))
                    }
                </div>
              )
            }
          </div>
    </foreignObject>
  </g>
);
}

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
