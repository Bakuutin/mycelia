import React, { useMemo } from "react";
import type { Layer, LayerComponentProps, Tool } from "@/core.ts";
import { useEvents, useEventsStore } from "./useEvents.ts";
import { useTimelineRange } from "@/stores/timelineRange.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter, SheetClose } from "@/components/ui/sheet.tsx";
import { EJSON } from "bson";
import type { EventItem } from "@/types/events.ts";

function useLaneLayout(items: ReturnType<typeof useEvents>["items"], xFor: (d: Date) => number) {
  return useMemo(() => {
    const laneEnds: number[] = [];
    const placed: Array<{ id: string; startX: number; endX: number; lane: number; color: string; kind: "point" | "range"; title: string; shortTitle?: string; thin?: boolean }>
      = [];

    const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (const ev of sorted) {
      const startX = xFor(ev.start);
      const endX = xFor(ev.end ?? ev.start);
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] >= startX) lane++;
      if (lane === laneEnds.length) laneEnds.push(endX);
      else laneEnds[lane] = endX;
      placed.push({ id: ev._id, startX, endX, lane, color: ev.color, kind: ev.kind, title: ev.title, shortTitle: ev.shortTitle, thin: ev.style?.thin ?? false });
    }
    return { placed, lanes: laneEnds.length };
  }, [items, xFor]);
}

export const EventComponent: React.FC<{ p: any, topMargin: number, laneHeight: number, event: EventItem }> = ({ p, topMargin, laneHeight, event }) => {
    const { hoveringId, selectedId, setHovering, setSelected, setEditingEvent } = useEventsStore();

    const y = topMargin + p.lane * laneHeight;
    const isPoint = p.kind === "point";
    const w = Math.max(2, p.endX - p.startX);
    const isHover = hoveringId === p.id;
    const isSelected = selectedId === p.id;
    const fill = p.color;
    const opacity = isSelected ? 1 : isHover ? 0.9 : 0.8;
    const stroke = isSelected ? "black" : "none";
    const strokeWidth = isSelected ? 1 : 0;


    return (
      <g key={p.id}
         className="timeline-item"
         onMouseEnter={() => setHovering(p.id)}
         onMouseLeave={() => setHovering(null)}
         onClick={() => {
          setSelected(p.id);
        }}
         onContextMenu={(e) => {
          e.preventDefault();
          setSelected(p.id);
          setEditingEvent(event);
          console.log("clicked", p.id);
        }}
         style={{ cursor: 'pointer' }}
      >
        {isPoint ? (
          <circle cx={p.startX} cy={y + laneHeight / 2} r={p.thin ? 2 : 3} fill={fill} opacity={opacity} stroke={stroke} strokeWidth={strokeWidth} />
        ) : (
          <rect x={p.startX} y={y + (p.thin ? 4 : 2)} width={w} height={p.thin ? 6 : 10} rx={2} fill={fill} opacity={opacity} stroke={stroke} strokeWidth={strokeWidth} />
        )}
        {(p.shortTitle ?? p.title) && (
          <text x={isPoint ? p.startX + 4 : p.startX + 4} y={y + laneHeight - 4} fontSize={10} fill="#111">
            {p.shortTitle ?? p.title}
          </text>
        )}
      </g>
    );
}

const EditEventSheet: React.FC = () => {
  const { editingEvent, setEditingEvent, setItems } = useEventsStore();
  const { start, end } = useTimelineRange();
  const [title, setTitle] = React.useState("");
  const [shortTitle, setShortTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [kind, setKind] = React.useState<"point" | "range">("point");
  const [category, setCategory] = React.useState("");
  const [color, setColor] = React.useState("#64748b");
  const [startAt, setStartAt] = React.useState(new Date());
  const [endAt, setEndAt] = React.useState<Date | null>(null);

  React.useEffect(() => {
    if (editingEvent) {
      setTitle(editingEvent.title);
      setShortTitle(editingEvent.shortTitle || "");
      setDescription(editingEvent.description || "");
      setKind(editingEvent.kind);
      setCategory(editingEvent.category);
      setColor(editingEvent.color);
      setStartAt(editingEvent.start);
      setEndAt(editingEvent.end || null);
    }
  }, [editingEvent]);

  const handleClose = () => {
    setEditingEvent(null);
  };

  const submit = async () => {
    if (!editingEvent) return;

    const now = new Date();
    const doc = {
      action: "updateOne",
      collection: "events",
      query: { _id: editingEvent._id },
      update: {
        $set: {
          kind,
          title: title || "Untitled",
          shortTitle: shortTitle || undefined,
          description: description || undefined,
          color,
          category,
          start: startAt,
          ...(kind === "range" && endAt ? { end: endAt } : { $unset: { end: "" } }),
          updatedAt: now,
        },
      },
    } as const;

    await fetch("/api/resource/tech.mycelia.mongo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(EJSON.serialize(doc)),
    });

    const q = { action: "find", collection: "events", query: { start: { $gte: start, $lt: end } }, options: { sort: { start: 1 } } } as const;
    const res = await fetch("/api/resource/tech.mycelia.mongo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(EJSON.serialize(q)) });
    const list = await res.json();
    setItems((list as any[]).map((d) => ({ id: d._id?.$oid ?? String(d._id ?? d.id), kind: d.kind, title: d.title, shortTitle: d.shortTitle, description: d.description, color: d.color, category: d.category, start: new Date(d.start), end: d.end ? new Date(d.end) : undefined, parentId: d.parentId ? String(d.parentId) : undefined, style: d.style, createdAt: new Date(d.createdAt ?? d.start ?? Date.now()), updatedAt: new Date(d.updatedAt ?? d.start ?? Date.now()) })));
    handleClose();
  };

  const remove = async () => {
    if (!editingEvent) return;
    const confirmed = globalThis.confirm ? globalThis.confirm("Delete this event?") : true;
    if (!confirmed) return;
    const doc = {
      action: "deleteOne",
      collection: "events",
      query: { _id: editingEvent._id },
    } as const;
    await fetch("/api/resource/tech.mycelia.mongo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(EJSON.serialize(doc)),
    });
    setItems((items) => items.filter((item) => item._id !== editingEvent._id));
    
    handleClose();
  };

  const toLocal = (d: Date | null) => {
    if (!d) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  };

  return (
    <Sheet open={!!editingEvent} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Edit Event</SheetTitle>
        </SheetHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="title" className="text-right">Title</Label>
            <Input id="title" className="col-span-3" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="shortTitle" className="text-right">Short Title</Label>
            <Input id="shortTitle" className="col-span-3" value={shortTitle} onChange={(e) => setShortTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">Description</Label>
            <Input id="description" className="col-span-3" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Kind</Label>
            <div className="col-span-3 flex gap-2">
              <Button variant={kind === 'point' ? undefined : 'secondary'} onClick={() => setKind('point')}>Point</Button>
              <Button variant={kind === 'range' ? undefined : 'secondary'} onClick={() => setKind('range')}>Range</Button>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="category" className="text-right">Category</Label>
            <Input id="category" className="col-span-3" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="color" className="text-right">Color</Label>
            <Input id="color" type="color" className="col-span-3" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="start" className="text-right">Start</Label>
            <Input id="start" type="datetime-local" className="col-span-3" value={toLocal(startAt)} onChange={(e) => setStartAt(new Date(e.target.value))} />
          </div>
          {kind === 'range' && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="end" className="text-right">End</Label>
              <Input id="end" type="datetime-local" className="col-span-3" value={toLocal(endAt)} onChange={(e) => setEndAt(e.target.value ? new Date(e.target.value) : null)} />
            </div>
          )}
        </div>
        <SheetFooter>
          <Button variant="destructive" onClick={remove}>Delete</Button>
          <SheetClose asChild>
            <Button variant="secondary" onClick={handleClose}>Cancel</Button>
          </SheetClose>
          <Button onClick={submit}>Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export const EventsLayer: () => Layer = () => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { items } = useEvents();
      const xFor = useMemo(() => {
        return (d: Date) => transform.applyX(scale(d));
      }, [scale, transform]);
      const layout = useLaneLayout(items, xFor);

      const laneHeight = 16;
      const topMargin = 4;
      const height = topMargin + layout.lanes * laneHeight + 10;

      const itemsById = useMemo(() => {
        const map = new Map<string, EventItem>();
        for (const item of items) {
          map.set(item._id, item);
        }
        return map;
      }, [items]);

      return (
        <>
          <svg className="w-full h-full zoomable" width={width} height={height}>
              {layout.placed.map(
                (p) => (<g key={p.id}>{
                  (() => {
                  const event = itemsById.get(p.id);
                  return event ? <EventComponent key={p.id} p={p} topMargin={topMargin} laneHeight={laneHeight} event={event} /> : null;
                })()}
                </g>
                ))
              }
          </svg>
          <EditEventSheet />
        </>
      );
    },
  } as Layer;
};

export const CreateEventTool: Tool = {
  component: () => {
    const { start, end } = useTimelineRange();
    const { setItems } = useEventsStore();
    const [open, setOpen] = React.useState(false);
    const [title, setTitle] = React.useState("");
    const [kind, setKind] = React.useState<"point" | "range">("point");
    const [category, setCategory] = React.useState("misc");
    const [color, setColor] = React.useState("#64748b");
    const [startAt, setStartAt] = React.useState(new Date());
    const [endAt, setEndAt] = React.useState<Date | null>(null);

    const submit = async () => {
      const now = new Date();
      const doc = {
        action: "insertOne",
        collection: "events",
        doc: {
          kind,
          title: title || "Untitled",
          color,
          category,
          start: startAt,
          ...(kind === "range" && endAt ? { end: endAt } : {}),
          createdAt: now,
          updatedAt: now,
        },
      } as const;
      await fetch("/api/resource/tech.mycelia.mongo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(EJSON.serialize(doc)),
      });
      const q = { action: "find", collection: "events", query: { start: { $gte: start, $lt: end } }, options: { sort: { start: 1 } } } as const;
      const res = await fetch("/api/resource/tech.mycelia.mongo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(EJSON.serialize(q)) });
      const list = await res.json();
      setItems((list as any[]).map((d) => ({ id: d._id?.$oid ?? String(d._id ?? d.id), kind: d.kind, title: d.title, shortTitle: d.shortTitle, description: d.description, color: d.color, category: d.category, start: new Date(d.start), end: d.end ? new Date(d.end) : undefined, parentId: d.parentId ? String(d.parentId) : undefined, style: d.style, createdAt: new Date(d.createdAt ?? d.start ?? Date.now()), updatedAt: new Date(d.updatedAt ?? d.start ?? Date.now()) })));
      setOpen(false);
      setTitle("");
    };

    const toLocal = (d: Date | null) => {
      if (!d) return "";
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };

    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button>Create Event</Button>
        </SheetTrigger>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Create Event</SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="title" className="text-right">Title</Label>
              <Input id="title" className="col-span-3" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Kind</Label>
              <div className="col-span-3 flex gap-2">
                <Button variant={kind === 'point' ? undefined : 'secondary'} onClick={() => setKind('point')}>Point</Button>
                <Button variant={kind === 'range' ? undefined : 'secondary'} onClick={() => setKind('range')}>Range</Button>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="category" className="text-right">Category</Label>
              <Input id="category" className="col-span-3" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="color" className="text-right">Color</Label>
              <Input id="color" type="color" className="col-span-3" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="start" className="text-right">Start</Label>
              <Input id="start" type="datetime-local" className="col-span-3" value={toLocal(startAt)} onChange={(e) => setStartAt(new Date(e.target.value))} />
            </div>
            {kind === 'range' && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="end" className="text-right">End</Label>
                <Input id="end" type="datetime-local" className="col-span-3" value={toLocal(endAt)} onChange={(e) => setEndAt(e.target.value ? new Date(e.target.value) : null)} />
              </div>
            )}
          </div>
          <SheetFooter>
            <SheetClose asChild>
              <Button variant="secondary">Cancel</Button>
            </SheetClose>
            <Button onClick={submit}>Save</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  },
};


