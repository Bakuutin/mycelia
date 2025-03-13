import React, { useMemo } from 'react';
import * as d3 from 'd3';

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
        return newScale.ticks();
    }, [scale, transform]);

    return (
        <g transform={`translate(0,${height})`}>
            <line
                x1={0}
                y1={0}
                x2={width}
                y2={0}
                stroke="currentColor"
                strokeWidth={1}
            />
            {ticks.map((tick) => {
                const x = transform.apply(scale(tick));
                return (
                    <g key={tick.getTime()} transform={`translate(${x},0)`}>
                        <line
                            y1={0}
                            y2={6}
                            stroke="currentColor"
                            strokeWidth={1}
                        />
                        <text
                            y={9}
                            dy=".71em"
                            textAnchor="middle"
                            fill="currentColor"
                        >
                            {tick.toLocaleDateString()}
                        </text>
                    </g>
                );
            })}
        </g>
    );
}; 