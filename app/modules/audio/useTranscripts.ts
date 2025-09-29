import { useState, useEffect, useMemo } from "react";
import { callResource } from "@/utils/resources.client.ts";

interface Transcript {
  _id: string;
  segments: {text: string; start: number; end: number}[];
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

    const delta = 25 * 60 * 1000;
    const startTime = new Date(cursorDate.getTime() - delta);
    const endTime = new Date(cursorDate.getTime() + delta);

    callResource("tech.mycelia.mongo", {
      action: "find",
      collection: "transcriptions",
      query: {
        start: {
          $gte: startTime,
          $lte: endTime,
        },
        segments: { $exists: true },
      },
      options: { limit: 50, sort: { start: 1 } },
    })
      .then((data) => {
        if (!Array.isArray(data)) return;
        cachedTranscripts = data;
        setTranscripts(data);
        lastFetchedBucket = bucketKey;
      })
      .catch((error) => {
        console.error("Failed to get transcripts:", error);
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