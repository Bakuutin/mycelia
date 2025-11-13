import * as d3 from "d3";
import React from "react";
import { Label, Tick } from "./types.ts";

const day = 1000 * 60 * 60 * 24;

const checkAllJanFirst = (ticks: Tick[]): boolean => {
  return ticks.length > 0 &&
    ticks.every(({ value }) => value.getMonth() === 0 && value.getDate() === 1);
};

const checkHasTime = (ticks: Tick[]): boolean => {
  return ticks.some(({ value }) => (
    value.getHours() !== 0 ||
    value.getMinutes() !== 0 ||
    value.getSeconds() !== 0
  ));
};

const checkHasWeekdays = (ticks: Tick[]): boolean => {
  const [first, last] = [ticks[0].value, ticks[ticks.length - 1].value];
  return last.getTime() - first.getTime() < 30 * day;
};

const checkHasSeconds = (ticks: Tick[]): boolean => {
  return ticks.some(({ value }) => value.getSeconds() !== 0);
};

const checkHasMilliseconds = (ticks: Tick[]): boolean => {
  return ticks.some(({ value }) => value.getMilliseconds() !== 0);
};

const formatTime = (
  date: Date,
  hasSeconds: boolean,
  hasMilliseconds: boolean,
): string => {
  if (hasMilliseconds) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }) + `.${date.getMilliseconds().toString().padStart(3, "0")}`;
  }

  return hasSeconds
    ? date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    : date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
};

export const formatLabel = (
  date: Date,
  options?: {
    allJanFirst?: boolean;
    hasTime?: boolean;
    hasWeekdays?: boolean;
    hasSeconds?: boolean;
    hasMilliseconds?: boolean;
  },
): React.ReactNode[] => {
  const year = date.getFullYear().toString();
  const defaults = {
    allJanFirst: false,
    hasTime: true,
    hasWeekdays: true,
    hasSeconds: true,
    hasMilliseconds: false,
  };

  const { allJanFirst, hasTime, hasWeekdays, hasSeconds, hasMilliseconds } = {
    ...defaults,
    ...options,
  };

  if (allJanFirst) {
    return [year];
  }

  const month = date.toLocaleDateString([], { month: "short" });
  const day = date.getDate();
  const weekday = date.toLocaleDateString([], { weekday: "short" });

  return [
    hasTime ? formatTime(date, hasSeconds, hasMilliseconds) : null,
    hasWeekdays ? weekday : null,
    `${month} ${day}`,
    year,
  ].filter(Boolean) as React.ReactNode[];
};

const generateGregorianLabels = (
  scale: d3.ScaleTime<number, number>,
  transform: d3.ZoomTransform,
  width: number,
): Label[] => {
  const newScale = transform.rescaleX(scale);
  const tickValues = newScale.ticks(Math.ceil(width / 227));
  const ticks = tickValues.map((tick) => ({
    value: tick,
    xOffset: newScale(tick),
  }));

  const allJanFirst = checkAllJanFirst(ticks);
  const hasTime = checkHasTime(ticks);
  const hasWeekdays = checkHasWeekdays(ticks);
  const hasSeconds = checkHasSeconds(ticks);
  const hasMilliseconds = checkHasMilliseconds(ticks);

  let prev: React.ReactNode[] | null = null;
  return ticks.map(({ value, xOffset }) => {
    const fullSegments = formatLabel(
      value,
      { allJanFirst, hasTime, hasWeekdays, hasSeconds, hasMilliseconds },
    );
    const result = {
      value,
      xOffset,
      segments: !prev
        ? fullSegments
        : fullSegments.filter((segment, i) => segment !== prev![i]),
    };
    prev = fullSegments;
    return result;
  });
};

export default generateGregorianLabels;
