import React, { useMemo } from "react";
import * as d3 from "d3";
import { type Layer, type LayerComponentProps } from "@/core.ts";

type MapLayerOptions = {
  height?: number;
  curvatureK?: number;
  gridLines?: number;
};

function warpFraction(fraction: number, curvatureK: number): number {
  if (curvatureK === 0) return fraction;
  const denom = Math.tanh(curvatureK);
  return Math.tanh(curvatureK * fraction) / denom;
}

function buildCurvePath(
  linearX: number,
  warpedX: number,
  height: number,
  samples: number,
): string {
  const parts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const y = (i / samples) * height;
    const alpha = Math.pow(y / height, 2);
    const x = linearX * (1 - alpha) + warpedX * alpha;
    parts.push(`${i === 0 ? "M" : "L"}${x},${y}`);
  }
  return parts.join(" ");
}

export const MapLayer: (options?: MapLayerOptions) => Layer = (
  options = {},
) => {
  const { height = 80, curvatureK = 2, gridLines = 8 } = options;

  const Component: React.FC<LayerComponentProps> = ({ scale, transform, width }) => {
    const paths = useMemo(() => {
      const newScale = transform.rescaleX(scale);
      const [start, end] = newScale.domain();
      const totalMs = end.getTime() - start.getTime();
      const ticks = d3.scaleTime().domain([start, end]).ticks(gridLines);
      const result: { d: string; key: string }[] = [];
      for (const t of ticks) {
        const fraction = (t.getTime() - start.getTime()) / totalMs;
        const linearX = newScale(t);
        const warpedX = warpFraction(fraction, curvatureK) * width;
        const d = buildCurvePath(linearX, warpedX, height, 24);
        result.push({ d, key: t.getTime().toString() });
      }
      return result;
    }, [scale, transform, width, height, curvatureK, gridLines]);

    return (
      <svg width={width} height={height} className="zoomable overflow-visible">
        <g>
          {paths.map(p => (
            <path key={p.key} d={p.d} stroke="#E5E7EB" strokeWidth={1} fill="none" />
          ))}
        </g>
      </svg>
    );
  };

  return { component: Component } as Layer;
};

export default MapLayer;




