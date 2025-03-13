import React from 'react';
import * as d3 from 'd3';

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
    return (
        <g transform="translate(0,30)">
            {voices.map((voice) => {
                const x = transform.apply(scale(voice.start));
                const width = transform.apply(scale(voice.end)) - x;
                return (
                    <rect
                        key={voice._id}
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