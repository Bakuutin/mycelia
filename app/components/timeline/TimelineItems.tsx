import React from 'react';
import * as d3 from 'd3';
import { z } from "zod";

const zTimelineItem = z.object({
    id: z.string(),
    start: z.date(),
    end: z.date(),
});

type TimelineItem = z.infer<typeof zTimelineItem>;

interface TimelineItemsProps {
    items: TimelineItem[];
    scale: d3.ScaleTime<number, number>;
    transform: d3.ZoomTransform;
}

export const TimelineItems = ({
    items,
    scale,
    transform
}: TimelineItemsProps) => {
    return (
        <g>
            {items.map((item) => {
                const x = transform.apply(scale(item.start));
                const width = transform.apply(scale(item.end)) - x;
                return (
                    <rect
                        key={item.id}
                        x={x}
                        y={0}
                        width={width}
                        height={20}
                        fill="currentColor"
                        fillOpacity={0.1}
                        stroke="currentColor"
                        strokeWidth={1}
                    />
                );
            })}
        </g>
    );
}; 