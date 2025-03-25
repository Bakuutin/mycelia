import * as d3 from "d3";
import React from "react";
import { Label } from "./gregorian";

const SI_PREFIXES = [
  { value: 1e-30, symbol: "qs" }, // quectosecond
  { value: 1e-27, symbol: "rs" }, // rontosecond
  { value: 1e-24, symbol: "ys" }, // yoctosecond
  { value: 1e-21, symbol: "zs" }, // zeptosecond
  { value: 1e-18, symbol: "as" }, // attosecond
  { value: 1e-15, symbol: "fs" }, // femtosecond
  { value: 1e-12, symbol: "ps" }, // picosecond
  { value: 1e-9, symbol: "ns" },  // nanosecond
  { value: 1e-6, symbol: "μs" },  // microsecond
  { value: 1e-3, symbol: "ms" },  // millisecond
  { value: 1e-2, symbol: "cs" },  // centisecond
  { value: 1e-1, symbol: "ds" },  // decisecond
  { value: 1, symbol: "s" },      // second
  // { value: 1e1, symbol: "das" },  // decasecond
  // { value: 1e2, symbol: "hs" },   // hectosecond
  { value: 1e3, symbol: "ks" },   // kilosecond
  { value: 1e6, symbol: "Ms" },   // megasecond
  { value: 1e9, symbol: "Gs" },   // gigasecond
  { value: 1e12, symbol: "Ts" },  // terasecond
  { value: 1e15, symbol: "Ps" },  // petasecond
  { value: 1e18, symbol: "Es" },  // exasecond
  { value: 1e21, symbol: "Zs" },  // zettasecond
  { value: 1e24, symbol: "Ys" },  // yottasecond
  { value: 1e27, symbol: "Rs" },  // ronnasecond
  { value: 1e30, symbol: "Qs" },  // quettasecond
].reverse(); // Reverse to find largest prefix first

const formatDuration = (ms: number): React.ReactNode[] => {
  const isNegative = ms < 0;
  const seconds = Math.abs(ms / 1000);
  const segments: React.ReactNode[] = [];
  let remaining = seconds;

  if (ms === 0) {
    return ["0"];
  }
  
  // Find all non-zero units using modulo
  SI_PREFIXES.forEach(prefix => {
    const value = remaining / prefix.value;
    if (value >= 1) {
      const segment = `${Math.floor(value)}${prefix.symbol}`;
      segments.push(isNegative && segments.length === 0 ? `-${segment}` : segment);
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
  if (ticksPerPx > 1/60) {
    step *= 10;
  }
  
  const ticks: number[] = [];
  let current = Math.floor(start / step) * step;
  
  while (current <= end) {
    ticks.push(current);
    current += step;
  }
  
  // Skip first tick if it's too close to the start
  if (ticks.length > 0) {
    const firstTickOffset = (ticks[0] - start) / range * width;
    if (firstTickOffset < 100) {
      ticks.shift();
    }
  }
  
  return ticks;
};

export const generateSILabels = (
  scale: d3.ScaleTime<number, number>,
  transform: d3.ZoomTransform,
  width: number
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
    return result;
  });
}; 