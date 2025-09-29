import React, { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Layer, LayerComponentProps, Tool } from "@/core.ts";
import { useEvents, useEventsStore } from "./useEvents.ts";
import { Button } from "@/components/ui/button.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter, SheetClose } from "@/components/ui/sheet.tsx";
import type { EventItem } from "@/types/events.ts";
import { callResource } from "@/utils/resources.client.ts";
import { PlusIcon } from "lucide-react/icons";

function useLaneLayout(items: ReturnType<typeof useEvents>["items"], xFor: (d: Date) => number) {
  return useMemo(() => {
    const placed: Array<{ event: EventItem; startX: number; endX: number; lane: number; }>
      = [];

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
      const sorted = [...categoryItems].sort((a, b) => a.start.getTime() - b.start.getTime());

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
    const { setSelected, setEditingEvent } = useEventsStore();

    const y = topMargin + p.lane * laneHeight;
    const isPoint = p.kind === "point";
    const w = Math.max(2, p.endX - p.startX);
    const fill = event.color;

    let title = event.title ?? '';
    if (w < (100) && event.shortTitle) {
      title = event.shortTitle;
    }


    return (
      <g key={event._id.toString()}
         className="timeline-item"
         onClick={() => {
          setSelected(event._id);
        }}
         onContextMenu={(e) => {
          e.preventDefault();
          setSelected(event._id);
          setEditingEvent(event);
        }}
         style={{ cursor: 'pointer' }}
      >
        <rect x={p.startX} y={y + (p.thin ? 4 : 2)} width={w} height={p.thin ? 6 : 10} fill={fill} />
        <foreignObject x={p.startX} y={y} width={isPoint ? 100 : w} height={laneHeight} className="text-[10px]">
            {title}
        </foreignObject>
      </g>
    );
}

const eventFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  shortTitle: z.string().optional(),
  description: z.string().optional(),
  kind: z.enum(["point", "range"]),
  category: z.string().min(1, "Category is required"),
  color: z.string().min(1, "Color is required"),
  start: z.string().min(1, "Start date is required").transform(str => new Date(str)),
  end: z.string().optional().transform(str => str ? new Date(str) : null),
});

type EventFormData = z.infer<typeof eventFormSchema>;
type EventFormInput = {
  title: string;
  shortTitle: string;
  description: string;
  kind: "point" | "range";
  category: string;
  color: string;
  start: string;
  end: string;
};

interface EventFormProps {
  defaultValues?: Partial<EventFormInput>;
  onSubmit: (data: EventFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  submitLabel: string;
  isEdit?: boolean;
}

const EventForm: React.FC<EventFormProps> = ({ defaultValues, onSubmit, onDelete, submitLabel, isEdit }) => {
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<EventFormInput>({
    defaultValues: {
      title: "",
      shortTitle: "",
      description: "",
      kind: "point" as const,
      category: "misc",
      color: "#64748b",
      start: toLocalDateTime(new Date()),
      end: "",
      ...defaultValues,
    },
  });

  const watchedKind = watch("kind");

  const onSubmitInternal = async (values: EventFormInput) => {
    const result = eventFormSchema.safeParse(values);
    if (!result.success) return;
    await onSubmit(result.data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmitInternal)} className="space-y-6 py-4">
      <div className="space-y-4">
        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="title" className="text-right">Title</Label>
          <div className="col-span-3">
            <Input id="title" placeholder="E.g. Started a new job" {...register("title")} aria-invalid={!!errors.title} aria-describedby={errors.title ? "title-error" : undefined} />
            {errors.title && <p id="title-error" className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="shortTitle" className="text-right">Short Title</Label>
          <Input id="shortTitle" className="col-span-3" placeholder="Optional compact label" {...register("shortTitle")} />
        </div>

        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="description" className="text-right">Description</Label>
          <Input id="description" className="col-span-3" placeholder="Optional details" {...register("description")} />
        </div>

        <div className="grid grid-cols-4 items-center gap-4">
          <Label className="text-right">Kind</Label>
          <div className="col-span-3">
            <div className="inline-flex items-center rounded-md border bg-muted p-0.5">
              <Button
                type="button"
                size="sm"
                variant={watchedKind === "point" ? "default" : "ghost"}
                aria-pressed={watchedKind === "point"}
                aria-selected={watchedKind === "point"}
                className="rounded-sm"
                onClick={() => setValue("kind", "point")}
              >
                Point
              </Button>
              <Button
                type="button"
                size="sm"
                variant={watchedKind === "range" ? "default" : "ghost"}
                aria-pressed={watchedKind === "range"}
                aria-selected={watchedKind === "range"}
                className="rounded-sm"
                onClick={() => setValue("kind", "range")}
              >
                Range
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="category" className="text-right">Category</Label>
          <div className="col-span-3">
            <Input id="category" list="event-categories" placeholder="E.g. work, life, education" {...register("category")} aria-invalid={!!errors.category} aria-describedby={errors.category ? "category-error" : undefined} />
            <datalist id="event-categories">
              <option value="geography" />
              <option value="life" />
              <option value="education" />
              <option value="relationship" />
              <option value="work" />
              <option value="misc" />
            </datalist>
            {errors.category && <p id="category-error" className="text-xs text-red-500 mt-1">{errors.category.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="color" className="text-right">Color</Label>
          <div className="col-span-3 flex items-center gap-3">
            <Input id="color" type="color" className="h-9 w-14 p-1" {...register("color")} />
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="start" className="text-right">Start</Label>
          <div className="col-span-3">
            <Input id="start" type="datetime-local" {...register("start")} aria-invalid={!!errors.start} aria-describedby={errors.start ? "start-error" : undefined} />
            {errors.start && <p id="start-error" className="text-xs text-red-500 mt-1">{errors.start.message}</p>}
          </div>
        </div>

        {watchedKind === "range" && (
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="end" className="text-right">End</Label>
            <div className="col-span-3 flex gap-2">
              <Input id="end" type="datetime-local" className="flex-1" {...register("end")} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setValue("end", "")}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {isEdit && onDelete && (
          <Button type="button" variant="destructive" onClick={onDelete} disabled={isSubmitting}>
            Delete
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
};

function toLocalDateTime(date: Date | null): string {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const EditEventSheet: React.FC = () => {
  const { editingEvent, setEditingEvent, setItems } = useEventsStore();

  const handleClose = () => {
    setEditingEvent(null);
  };

  const handleSubmit = async (data: EventFormData) => {
    if (!editingEvent) return;

    const updateDoc: any = {
      $set: {
        kind: data.kind,
        title: data.title,
        shortTitle: data.shortTitle || undefined,
        description: data.description || undefined,
        color: data.color,
        category: data.category,
        start: data.start,
        updatedAt: new Date(),
      },
    };

    if (data.kind === "range" && data.end) {
      updateDoc.$set.end = data.end;
    } else {
      updateDoc.$unset = { end: "" };
    }

    await callResource("tech.mycelia.mongo", {
      action: "updateOne",
      collection: "events",
      query: { _id: editingEvent._id },
      update: updateDoc,
    });
    const list = await callResource("tech.mycelia.mongo", {
      action: "find",
      collection: "events",
      query: {},
      options: { sort: { start: 1 } }
    });
    setItems(list);
    handleClose();
  };

  const handleDelete = async () => {
    if (!editingEvent) return;
    const confirmed = globalThis.confirm ? globalThis.confirm("Delete this event?") : true;
    if (!confirmed) return;
    await callResource("tech.mycelia.mongo", {
      action: "deleteOne",
      collection: "events",
      query: { _id:  editingEvent._id },
    });
    setItems((items) => items.filter((item) => item._id !== editingEvent._id));
    handleClose();
  };

  const defaultValues: Partial<EventFormInput> = useMemo(() => {
    if (!editingEvent) return {};
    return {
      title: editingEvent.title,
      shortTitle: editingEvent.shortTitle || "",
      description: editingEvent.description || "",
      kind: editingEvent.kind,
      category: editingEvent.category,
      color: editingEvent.color,
      start: toLocalDateTime(editingEvent.start),
      end: editingEvent.kind === "range" && editingEvent.end ? toLocalDateTime(editingEvent.end) : "",
    };
  }, [editingEvent]);

  if (!editingEvent) return null;

  return (
    <Sheet open={!!editingEvent} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Edit Event</SheetTitle>
        </SheetHeader>
        <EventForm
          defaultValues={defaultValues}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          submitLabel="Save"
          isEdit
        />
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="secondary" onClick={handleClose}>Cancel</Button>
          </SheetClose>
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


      return (
        <>
          <svg className="w-full h-full zoomable" width={width} height={height}>
              {layout.placed.map(
                (p) => (
                  <EventComponent key={p.event._id.toString()} p={p} topMargin={topMargin} laneHeight={laneHeight} event={p.event} />
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
    const { setItems } = useEventsStore();
    const [open, setOpen] = React.useState(false);

    const handleSubmit = async (data: EventFormData) => {
      const now = new Date();
      const doc = {
        action: "insertOne",
        collection: "events",
        doc: {
          kind: data.kind,
          title: data.title,
          shortTitle: data.shortTitle || undefined,
          description: data.description || undefined,
          color: data.color,
          category: data.category,
          start: data.start,
          ...(data.kind === "range" && data.end ? { end: data.end } : {}),
          createdAt: now,
          updatedAt: now,
        },
      } as const;

      const res = await callResource("tech.mycelia.mongo", doc);
      setItems(items => [...items, res]);
      setOpen(false);
    };

    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button>
            <PlusIcon className="w-4 h-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Create Event</SheetTitle>
          </SheetHeader>
          <EventForm
            onSubmit={handleSubmit}
            submitLabel="Create"
          />
          <SheetFooter>
            <SheetClose asChild>
              <Button variant="secondary">Cancel</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  },
};


