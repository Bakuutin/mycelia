import * as d3 from "d3";
import type { HistogramItem } from "./useHistogramCache";

interface HistogramBarsProps {
  items: HistogramItem[];
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  width: number;
  height?: number;
}

const HistogramBar = ({
  item,
  scale,
  maxCount,
  height,
}: {
  item: HistogramItem;
  scale: d3.ScaleTime<number, number>;
  maxCount: number;
  height: number;
}) => {
  const startX = scale(item.start);
  const endX = scale(item.end);
  const width = Math.max(endX - startX, 1);

  const count = item.totals.audio_chunks?.count || 0;
  const barHeight = maxCount > 0 ? (count / maxCount) * height : 0;

  const speechCount = item.totals.audio_chunks?.has_speech || 0;
  const speechRatio = count > 0 ? speechCount / count : 0;

  const baseColor = item.stale ? "rgb(255, 182, 193)" : "rgb(59, 130, 246)";
  const opacity = 0.3 + speechRatio * 0.7;

  return (
    <rect
      x={startX}
      y={height - barHeight}
      width={width}
      height={barHeight}
      fill={baseColor}
      opacity={opacity}
      className="histogram-bar"
    />
  );
};

export const HistogramBars = ({
  items,
  scale,
  transform,
  width,
  height = 60,
}: HistogramBarsProps) => {
  const newScale = transform.rescaleX(scale);
  console.log("57 HistogramBars", items.length);

  const maxCount = items.length > 0
    ? Math.max(
        ...items.map((item) => item.totals.audio_chunks?.count || 0),
        1,
      )
    : 1;

  return (
    <svg className="w-full zoomable" width={width} height={height}>
      <defs>
        <pattern
          id="stale-stripes-histogram"
          patternUnits="userSpaceOnUse"
          width="4"
          height="4"
        >
          <rect width="4" height="4" fill="pink" opacity="1" />
          <path
            d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2"
            stroke="rgb(255,20,147)"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      <g>
        {items.map((item) => (
          <HistogramBar
            key={item.id}
            item={item}
            scale={newScale}
            maxCount={maxCount}
            height={height}
          />
        ))}
      </g>
    </svg>
  );
};
