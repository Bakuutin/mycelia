import React from 'react';
import { z } from "zod";

const zTranscript = z.object({
    text: z.string(),
    words: z.array(z.object({
        word: z.string(),
        start: z.number(),
        end: z.number(),
        t_dtw: z.number(),
        probability: z.number(),
    })),
    id: z.number(),
    start: z.date(),
    end: z.date(),
    transcriptID: z.string(),
});

type Transcript = z.infer<typeof zTranscript>;

interface TranscriptsRowProps {
    transcripts: Transcript[];
}

export const TranscriptsRow = ({
    transcripts,
}: TranscriptsRowProps) => {
    return (
        <g transform="translate(0,60)">
            {transcripts.map((transcript) => (
                <text
                    key={transcript.id}
                    x={0}
                    y={20}
                    fill="currentColor"
                >
                    {transcript.text}
                </text>
            ))}
        </g>
    );
}; 