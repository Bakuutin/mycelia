import React from "react";

export interface Tick {
  value: Date;
  xOffset: number;
}

export interface Label {
  value: Date;
  xOffset: number;
  segments: React.ReactNode[];
}

export type Formatter = (
  scale: d3.ScaleTime<number, number>,
  transform: d3.ZoomTransform,
  width: number,
) => Label[];
