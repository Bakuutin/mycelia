import { useState, useEffect, useMemo } from "react";

interface Transcript {
  _id: string;
  text: string;
  start: Date;
  end: Date;
}

export const useTranscripts = (cursorDate: Date | null) => {
  const [transcripts, setTranscripts] = useState<Transcript[]>(cachedTranscripts);

  const bucketMs = 5000;
  const bucketKey = useMemo(() => {
    if (!cursorDate) return null;
    return Math.floor(cursorDate.getTime() / bucketMs) * bucketMs;
  }, [cursorDate]);

  useEffect(() => {
    if (!cursorDate || bucketKey === null) return;
    if (inFlightBuckets.has(bucketKey)) return;
    if (lastFetchedBucket !== null && bucketKey === lastFetchedBucket) return;

    inFlightBuckets.add(bucketKey);

    const delta = 5 * 60 * 1000;
    const startTime = new Date(cursorDate.getTime() - delta);
    const endTime = new Date(cursorDate.getTime() + delta);

    fetch("/api/resource/tech.mycelia.mongo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "find",
        collection: "transcriptions",
        query: {
          start: {
            $gte: { $date: startTime.toISOString() },
            $lte: { $date: endTime.toISOString() },
          },
          segments: { $exists: true },
        },
        options: { limit: 50, sort: { start: 1 } },
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch transcripts");
        return res.json();
      })
      .then((data) => {
        if (!Array.isArray(data)) return;
        const transcriptData = data.flatMap((item: any) =>
          item.segments.map((seg: any, index: number) => ({
            _id: `${item._id.$oid}-${index}`,
            text: seg.text,
            start: new Date(new Date(item.start).getTime() + seg.start * 1000),
            end: new Date(new Date(item.start).getTime() + seg.end * 1000),
          }))
        );
        cachedTranscripts = transcriptData;
        setTranscripts(transcriptData);
        lastFetchedBucket = bucketKey;
      })
      .catch((error) => {
        console.error("Failed to fetch transcripts:", error);
      })
      .finally(() => {
        inFlightBuckets.delete(bucketKey);
      });
  }, [bucketKey, cursorDate]);

  return { transcripts };
};

let cachedTranscripts: Transcript[] = [];
let lastFetchedBucket: number | null = null;
const inFlightBuckets = new Set<number>();