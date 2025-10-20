import * as d3 from "d3";
import React from "react";
import { Label } from "./types.ts";

const SI_PREFIXES = [
  { value: 1e-3, symbol: "ms", power: -3, unit: "millisecond" },
  { value: 1, symbol: "s", power: 0, unit: "second" },
  { value: 1e3, symbol: "ks", power: 3, unit: "kilosecond" },
  { value: 1e6, symbol: "Ms", power: 6, unit: "megasecond" },
  { value: 1e9, symbol: "Gs", power: 9, unit: "gigasecond" },
  { value: 1e12, symbol: "Ts", power: 12, unit: "terasecond" },
  { value: 1e15, symbol: "Ps", power: 15, unit: "petasecond" },
  { value: 1e18, symbol: "Es", power: 18, unit: "exasecond" },
  { value: 1e21, symbol: "Zs", power: 21, unit: "zettasecond" },
  { value: 1e24, symbol: "Ys", power: 24, unit: "yottasecond" },
  { value: 1e27, symbol: "Rs", power: 27, unit: "ronnasecond" },
  { value: 1e30, symbol: "Qs", power: 30, unit: "quettasecond" },
].reverse();

export const formatDuration = (ms: number): React.ReactNode[] => {
  const isNegative = ms < 0;
  const seconds = Math.abs(ms / 1000);
  const segments: React.ReactNode[] = [];
  let remaining = seconds;

  if (ms === 0) {
    return ["0"];
  }

  SI_PREFIXES.forEach((prefix) => {
    const value = remaining / prefix.value;
    if (value >= 1) {
      const segment = `${Math.floor(value)}${prefix.symbol}`;
      segments.push(
        isNegative && segments.length === 0 ? `-${segment}` : segment,
      );
      remaining = remaining % prefix.value;
    }
  });

  return segments;
};

const generateTicks = (start: number, end: number, width: number) => {
  const range = end - start;
  const count = Math.ceil(width / 227);
  let step = Math.pow(10, Math.floor(Math.log10(range / count)));

  const ticksPerPx = (end - start) / (step * width);
  if (ticksPerPx > 1 / 60) {
    step *= 10;
  }

  const ticks: number[] = [];
  let current = Math.floor(start / step) * step;

  while (current <= end) {
    ticks.push(current);
    current += step;
  }

  if (ticks.length > 0) {
    const firstTickOffset = (ticks[0] - start) / range * width;
    if (firstTickOffset < 100) {
      ticks.shift();
    }
  }

  return ticks;
};

const generateSILabels = (
  scale: d3.ScaleTime<number, number>,
  transform: d3.ZoomTransform,
  width: number,
): Label[] => {
  const newScale = transform.rescaleX(scale);
  const [start, end] = newScale.domain();
  const tickValues = generateTicks(start.getTime(), end.getTime(), width);

  let prevSegments: React.ReactNode[] = [];

  return tickValues.map((time) => {
    const segments = formatDuration(time);
    const result = {
      value: new Date(time),
      xOffset: newScale(new Date(time)),
      segments: segments.filter((segment, i) => segment !== prevSegments[i]),
    };
    prevSegments = segments;
    result.segments.reverse();
    return result;
  });
};

export default generateSILabels;
