import { useState, useEffect } from "react";

interface Transcript {
  _id: string;
  text: string;
  start: Date;
  end: Date;
}

export const useTranscripts = (cursorDate: Date | null) => {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);

  useEffect(() => {
    if (!cursorDate) {
      return;
    }

    if (lastFetchTime && Math.abs(cursorDate.getTime() - lastFetchTime.getTime()) < 5000) {
      return;
    }

    const fetchTranscripts = async () => {
      try {
        const delta = 5* 60 * 1000;
        const startTime = new Date(cursorDate.getTime() - delta);
        const endTime = new Date(cursorDate.getTime() + delta);


        const response = await fetch("/api/resource/tech.mycelia.mongo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "find",
            collection: "transcriptions",
            query: {
              start: {
                $gte: { $date: startTime.toISOString() },
                $lte: { $date: endTime.toISOString() },
              },
              segments: {
                $exists: true
              },
            },
            options: { limit: 50, sort: { start: 1 } }
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch transcripts");
        }

        const data = await response.json();
        if (Array.isArray(data)) {
          console.log(data);
          const transcriptData = data.flatMap((item: any) => item.segments.map((seg: any, index: number) => ({
            _id: `${item._id}-${index}`,
            text: seg.text,
            start: new Date(new Date(item.start).getTime() + seg.start*1000),
            end: new Date(new Date(item.start).getTime() + seg.end*1000),
          })));
          setTranscripts(transcriptData);
          setLastFetchTime(cursorDate);
        }
      } catch (error) {
        console.error("Failed to fetch transcripts:", error);
      }
    };

    fetchTranscripts();
  }, [cursorDate, lastFetchTime]);

  return { transcripts };
};