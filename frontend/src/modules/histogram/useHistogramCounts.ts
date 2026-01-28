import { useMemo } from "react";
import { useTimelineRange } from "@/stores/timelineRange";
import { useHistogramItems } from "./useHistogramItems";

export interface HistogramCounts {
  voiceDetection: number; // bins with speech detected
  audioChunks: number;
  transcriptions: number;
  diarizations: number;
  dataPresence: number; // bins with any data
}

export function useHistogramCounts(): HistogramCounts {
  const { start, end } = useTimelineRange();
  const { items } = useHistogramItems(start, end);

  return useMemo(() => {
    let voiceDetection = 0;
    let audioChunks = 0;
    let transcriptions = 0;
    let diarizations = 0;
    let dataPresence = 0;

    for (const item of items) {
      const audio = item.totals.audio_chunks;
      const trans = item.totals.transcriptions;
      const diar = item.totals.diarizations;

      if (audio?.count) {
        audioChunks += audio.count;
        if (audio.has_speech) {
          voiceDetection += audio.has_speech;
        }
      }

      if (trans?.count) {
        transcriptions += trans.count;
      }

      if (diar?.count) {
        diarizations += diar.count;
      }

      // Data presence: count bins that have any data
      if (audio?.count || trans?.count) {
        dataPresence++;
      }
    }

    return {
      voiceDetection,
      audioChunks,
      transcriptions,
      diarizations,
      dataPresence,
    };
  }, [items]);
}
