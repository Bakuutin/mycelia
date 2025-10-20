import React, { useMemo } from "react";
import * as d3 from "d3";
import { type Layer, type LayerComponentProps } from "@/core.ts";

import { formatDuration } from "@/modules/time/formatters/si.ts";

const minute = 60 * 1000;

type MapLayerOptions = {
  height?: number;
};

export const MapLayer: (options?: MapLayerOptions) => Layer = (
  options = {},
) => {
  const { height = 80 } = options;

  const Component: React.FC<LayerComponentProps> = (
    { scale, transform, width },
  ) => {
    const middle = width / 2;
    const K = 14;
    const linear = Array.from({ length: K + 1 }, (_, i) => -K / 2 + i);

    return (
      <svg width={width} height={height} className="zoomable overflow-visible">
        <g>
          {linear.map((i) => (
            <g
              key={i.toString()}
              style={{ transform: `translateX(${middle + width * i / K}px)` }}
            >
              <line
                y1={0}
                y2={10 + i * i}
                stroke="#E5E7EB"
                strokeWidth={1}
                fill="none"
              />
              <text
                y={20 + i * i}
                textAnchor="middle"
                dominantBaseline="hanging"
                fontSize="12px"
                fill="#E5E7EB"
              >
                {formatDuration(1000 * (10 ** Math.abs(i)) * Math.sign(i))}
              </text>
            </g>
          ))}
        </g>
      </svg>
    );
  };

  return { component: Component } as Layer;
};

export default MapLayer;
