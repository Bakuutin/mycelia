import { useMemo } from "react";
import type { EventItem } from "@/types/events.ts";
import {
  buildEventIndex,
  resolveVisibility,
  type PreparedRenderedEvent,
} from "./visibility";

interface RenderedEvent {
  event: EventItem;
  startX: number;
  endX: number;
  width: number;
  canFitTitle: boolean;
  displayTitle: string;
}

export function useVisibleEvents(
  items: EventItem[],
  xFor: (d: Date) => number,
  minVisibleWidth: number = 30
): RenderedEvent[] {
  // Computes positioned render data for timeline events and filters which events
  // should be visible based on parent/child relationships and title fit.
  // Rules:
  // - Prefer showing children over a parent when any child is visible
  // - Otherwise, show an event if its full or short title fits, or if its width
  //   exceeds minVisibleWidth
  // - Roots (including orphans) are allowed as a fallback when nothing fits
  return useMemo(() => {
    const { byId, childrenByParentId, roots, orphanRoots, orderedIds } = buildEventIndex(items, xFor, minVisibleWidth);
    const visibleIds = resolveVisibility(byId, childrenByParentId, roots, orphanRoots);

    const rendered: RenderedEvent[] = [];
    for (const id of orderedIds) {
      const prepared = byId.get(id) as PreparedRenderedEvent | undefined;
      if (prepared && visibleIds.has(id)) {
        rendered.push({
          event: prepared.event,
          startX: prepared.startX,
          endX: prepared.endX,
          width: prepared.width,
          canFitTitle: prepared.canFitTitle,
          displayTitle: prepared.displayTitle,
        });
      }
    }

    return rendered;
  }, [items, xFor, minVisibleWidth]);
}
