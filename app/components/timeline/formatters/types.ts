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
