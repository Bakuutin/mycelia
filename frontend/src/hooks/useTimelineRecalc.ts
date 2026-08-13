import { useWebSocketSubscription } from "./useWebSocket";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

const RESOLUTION_TO_MS: Record<string, number> = {
  "1min": 60 * 1000,
  "5min": 5 * 60 * 1000,
  "15min": 15 * 60 * 1000,
  "1hour": 60 * 60 * 1000,
  "6hour": 6 * 60 * 60 * 1000,
  "1day": 24 * 60 * 60 * 1000,
};

export function useTimelineRecalc() {
  const [activeRanges, setActiveRanges] = useState<any[]>([]);
  const queryClient = useQueryClient();

  useWebSocketSubscription(
    "mongo:histogram",
    (message) => {
      const { event, data } = message;
      if (!data || event !== "mongo.change") return;

      const { collection, document } = data;
      if (!collection || !document) return;

      if (!collection.startsWith("histogram_")) return;

      const resolution = collection.replace("histogram_", "");
      const start = document.start ? new Date(document.start) : null;

      if (!start || !RESOLUTION_TO_MS[resolution]) return;

      const end = new Date(start.getTime() + RESOLUTION_TO_MS[resolution]);

      setActiveRanges((prev) => {
        return [
          ...prev,
          {
            resolution,
            start,
            end,
            addedAt: Date.now(),
            key: document._id.toString(),
          },
        ];
      });
    },
    true,
  );

  // Cleanup old ranges every second
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActiveRanges((prev) =>
        prev.filter((range) => now - range.addedAt < 10000)
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return { activeRanges };
}
