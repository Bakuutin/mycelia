import React, { useMemo } from "react";
import type { Layer, LayerComponentProps, Tool } from "@/core/core.ts";
import { useEvents } from "./useEvents.ts";
import { useVisibleEvents } from "./useVisibleEvents.ts";
import { Button } from "@/components/ui/button.tsx";
import type { EventItem } from "@/types/events.ts";
import { PlusIcon } from "lucide-react/icons";
import { EditableTimelineItem } from "@/components/timeline/EditableTimelineItem.tsx";
import { useNavigate } from "react-router-dom";

function useLaneLayout(items: ReturnType<typeof useEvents>["items"], xFor: (d: Date) => number) {
  return useMemo(() => {
    const placed: Array<{ event: EventItem; startX: number; endX: number; lane: number; }>
      = [];

    const itemsById = new Map<ObjectId, EventItem>();
    for (const item of items) {
      itemsById.set(item._id, item);
    }

    const getDepth = (item: EventItem): number => {
      if (!item.parentId) return 0;
      const parent = itemsById.get(item.parentId);
      if (!parent) return 0;
      return 1 + getDepth(parent);
    };

    // Group items by category
    const byCategory = new Map<string, typeof items>();
    for (const item of items) {
      const category = item.category;
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category)!.push(item);
    }

    // Define category order for consistent lane assignment
    const categoryOrder = ["geography", "life", "education", "relationship", "work"];
    const categories = Array.from(byCategory.keys()).sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });

    let currentLane = 0;

    // Process each category
    for (const category of categories) {
      const categoryItems = byCategory.get(category)!;
      const sorted = [...categoryItems].sort((a, b) => {
        const depthA = getDepth(a);
        const depthB = getDepth(b);
        if (depthA !== depthB) return depthA - depthB;
        return a.start.getTime() - b.start.getTime();
      });

      const laneEnds: number[] = [];

      for (const ev of sorted) {
        const startX = xFor(ev.start);
        const endX = xFor(ev.end ?? (ev.kind === "range" ? new Date() : ev.start));

        // Find available lane within this category's lanes
        let lane = 0;
        while (lane < laneEnds.length && laneEnds[lane] > startX) lane++;

        if (lane === laneEnds.length) laneEnds.push(endX);
        else laneEnds[lane] = endX;

        placed.push({
          event: ev,
          startX,
          endX,
          lane: currentLane + lane,
        });
      }

      // Move to next category's lane offset
      currentLane += laneEnds.length;
    }

    return { placed, lanes: currentLane };
  }, [items, xFor]);
}

export const EventComponent: React.FC<{ p: any, topMargin: number, laneHeight: number, event: EventItem }> = ({ p, topMargin, laneHeight, event }) => {
    const navigate = useNavigate();

    const y = topMargin + p.lane * laneHeight;
    const isPoint = event.kind === "point";
    const w = Math.max(2, p.endX - p.startX);

    let title = event.title ?? '';
    if (w < 100 && event.shortTitle) {
      title = event.shortTitle;
    }

    return (
      <EditableTimelineItem
        id={event._id.toString()}
        x={p.startX}
        y={y}
        width={w}
        height={laneHeight}
        fill={event.color}
        label={title}
        labelWidth={isPoint ? 100 : w}
        thin={p.thin}
        onSelect={() => navigate(`/events/${event._id.toString()}`)}
        onEdit={() => navigate(`/events/${event._id.toString()}`)}
      />
    );
}


export const EventsLayer: () => Layer = () => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { items } = useEvents();
      const xFor = useMemo(() => {
        return (d: Date) => transform.applyX(scale(d));
      }, [scale, transform]);

      const visibleEvents = useVisibleEvents(items, xFor);
      const visibleItems = visibleEvents.map(r => r.event);

      const layout = useLaneLayout(visibleItems, xFor);

      const laneHeight = 16;
      const topMargin = 4;
      const height = topMargin + layout.lanes * laneHeight + 10;


      return (
        <>
          <svg className="w-full h-full zoomable" width={width} height={height}>
              {layout.placed.map(
                (p) => {
                  const renderedEvent = visibleEvents.find(r => r.event._id.toString() === p.event._id.toString());
                  const displayTitle = renderedEvent?.displayTitle || p.event.title;

                  return (
                    <EventComponent
                      key={p.event._id.toString()}
                      p={p}
                      topMargin={topMargin}
                      laneHeight={laneHeight}
                      event={{ ...p.event, title: displayTitle }}
                    />
                  );
                })
              }
          </svg>
        </>
      );
    },
  } as Layer;
};

export const CreateEventTool: Tool = {
  component: () => {
    const navigate = useNavigate();
    return (
      <Button onClick={() => navigate("/events/new")}>
        <PlusIcon className="w-4 h-4" />
      </Button>
    );
  },
};


