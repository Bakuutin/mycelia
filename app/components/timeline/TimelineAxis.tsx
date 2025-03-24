import React, { useMemo } from "react";
import * as d3 from "d3";

const day = 1000 * 60 * 60 * 24;

interface TimelineAxisProps {
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  height: number;
  width: number;
}

export const TimelineAxis = ({
  scale,
  transform,
  height,
  width,
}: TimelineAxisProps) => {
  const ticks = useMemo(() => {
    const newScale = transform.rescaleX(scale);
    const tickValues = newScale.ticks(Math.ceil(width / 227));

    return tickValues.map((tick) => ({
      value: tick,
      xOffset: newScale(tick),
      isNewYear: tick.getMonth() === 0 && tick.getDate() === 1,
    }));
  }, [scale, transform]);

  const allJanFirst = useMemo(() => {
    return ticks.length > 0 &&
      ticks.every(({ value }) =>
        value.getMonth() === 0 && value.getDate() === 1
      );
  }, [ticks]);

  const hasTime = useMemo(() => {
    return ticks.some(({ value }) => (
      value.getHours() !== 0 ||
      value.getMinutes() !== 0 ||
      value.getSeconds() !== 0
    ));
  }, [ticks]);

  const hasWeekdays = useMemo(() => {
    // diff in days between first and last tick is less than 30
    const [first, last] = [ticks[0].value, ticks[ticks.length - 1].value];

    return last.getTime() - first.getTime() < 30 * day;
  }, [ticks]);

  const hasSeconds = useMemo(() => {
    return ticks.some(({ value }) => value.getSeconds() !== 0);
  }, [ticks]);

  const [start, end] = scale.range();

  const formatTime = (date: Date): string => {
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

  const formatLabel = (date: Date): string[] => {
    const year = date.getFullYear().toString();

    if (allJanFirst) {
      return [year];
    }

    const month = date.toLocaleDateString([], { month: "short" });
    const day = date.getDate();
    const weekday = date.toLocaleDateString([], { weekday: "short" });

    return [
      hasTime ? formatTime(date) : null,
      hasWeekdays ? weekday : null,
      `${month} ${day}`,
      year,
    ].filter(Boolean) as string[];
  };

  const labels = useMemo(() => {
    let prev: any = null;
    return ticks.map(({ value, xOffset }, i) => {
      const fullLabels = formatLabel(value);
      const result = {
        value,
        xOffset,
        labels: !prev
          ? fullLabels
          : fullLabels.filter((label, i) => label !== prev[i]),
      };
      prev = fullLabels;
      return result;
    });
  }, [ticks]);

  return (
    <g transform={`translate(0,${height})`}>
      <path
        d={`M${start},6V0H${end}V6`}
        fill="none"
        stroke="currentColor"
      />
      {labels.map(({ value, xOffset, labels }, i) => (
        <g
          key={value.getTime().toString()}
          transform={`translate(${xOffset},0)`}
        >
          <line
            y2="6"
            stroke="currentColor"
          />
          <foreignObject
            width="100px"
            height="200px"
            style={{
              transform: "translateY(10px) translateX(-50px)",
            }}
          >
            {labels.map((segment) => (
              <p className="text-center" key={segment}>{segment}</p>
            ))}
          </foreignObject>
        </g>
      ))}
    </g>
  );
};
