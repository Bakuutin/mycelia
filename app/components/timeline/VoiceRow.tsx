import React from "react";
import * as d3 from "d3";

interface Voice {
  start: Date;
  end: Date;
  _id: string;
}

interface VoiceRowProps {
  voices: Voice[];
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
}

export const VoiceRow = ({
  voices,
  scale,
  transform,
}: VoiceRowProps) => {
  const newScale = transform.rescaleX(scale);
  return (
    <>
      <h1>{voices.length}</h1>
      <g>
        {voices.map((item) => {
          const startX = newScale(item.start);
          const endX = newScale(item.end);
          const width = Math.max(endX - startX, 1);

          return (
            <rect
              key={item._id}
              x={startX}
              y={0}
              width={width}
              height={10}
              className="fill-chart-2"
            />
          );
        })}
      </g>
    </>
  );
};
