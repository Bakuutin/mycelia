import type { EventItem } from "@/types/events";
import { estimateTitleWidth } from "@/lib/measureText";

export interface Bounds {
  startX: number;
  endX: number;
  width: number;
}

export interface TitleFit {
  canFitTitle: boolean;
  displayTitle: string;
  titleWidth: number;
  shortTitleWidth: number;
}

export interface PreparedRenderedEvent {
  id: string;
  parentId?: string;
  event: EventItem;
  startX: number;
  endX: number;
  width: number;
  canFitTitle: boolean;
  displayTitle: string;
}

export function toIdString(id: unknown): string | undefined {
  if (id == null) return undefined;
  try {
    // ObjectId and strings both implement toString sensibly
    return (id as { toString: () => string }).toString();
  } catch {
    return undefined;
  }
}

/**
 * Compute start/end x-coordinates and width for an event using the provided scale.
 */
export function computeBounds(event: EventItem, xFor: (d: Date) => number): Bounds {
  const startX = xFor(event.start);
  const endDate = event.end ?? (event.kind === "range" ? new Date() : event.start);
  const endX = xFor(endDate);
  const width = Math.max(2, endX - startX);
  return { startX, endX, width };
}

/**
 * Decide which title to display and whether any title can fit within the given width.
 * Uses cached width measurements when available, otherwise estimates.
 */
export function computeTitleFit(
  event: EventItem,
  width: number,
  minVisibleWidth: number
): TitleFit {
  const measured = event.titleWidth && event.shortTitleWidth
    ? { titleWidth: event.titleWidth, shortTitleWidth: event.shortTitleWidth }
    : estimateTitleWidth(event.title, event.shortTitle);

  const { titleWidth, shortTitleWidth } = measured;
  const canFitFullTitle = width >= titleWidth;
  const canFitShortTitle = !!event.shortTitle && width >= shortTitleWidth;
  const canFitTitle = canFitFullTitle || canFitShortTitle || width >= minVisibleWidth;

  const displayTitle = canFitFullTitle
    ? event.title
    : (canFitShortTitle ? event.shortTitle! : event.title);

  return { canFitTitle, displayTitle, titleWidth, shortTitleWidth };
}

export interface EventIndex {
  byId: Map<string, PreparedRenderedEvent>;
  childrenByParentId: Map<string, string[]>;
  roots: string[]; // events with no parentId
  orphanRoots: string[]; // events whose parentId is not present
  orderedIds: string[]; // input order for stable filtering later
}

/**
 * Prepare render data and structural indices for visibility resolution.
 */
export function buildEventIndex(
  items: EventItem[],
  xFor: (d: Date) => number,
  minVisibleWidth: number
): EventIndex {
  const byId = new Map<string, PreparedRenderedEvent>();
  const childrenByParentId = new Map<string, string[]>();
  const presentIds = new Set<string>();
  const orderedIds: string[] = [];

  for (const item of items) {
    const id = toIdString(item._id)!;
    const parentId = toIdString(item.parentId);
    presentIds.add(id);
    const { startX, endX, width } = computeBounds(item, xFor);
    const { canFitTitle, displayTitle } = computeTitleFit(item, width, minVisibleWidth);
    byId.set(id, {
      id,
      parentId,
      event: item,
      startX,
      endX,
      width,
      canFitTitle,
      displayTitle,
    });
    if (parentId) {
      const arr = childrenByParentId.get(parentId) ?? [];
      arr.push(id);
      childrenByParentId.set(parentId, arr);
    }
    orderedIds.push(id);
  }

  const roots: string[] = [];
  const orphanRoots: string[] = [];
  for (const id of presentIds) {
    const node = byId.get(id)!;
    if (!node.parentId) {
      roots.push(id);
    } else if (!presentIds.has(node.parentId)) {
      orphanRoots.push(id);
    }
  }

  return { byId, childrenByParentId, roots, orphanRoots, orderedIds };
}

/**
 * Resolve which events to show based on parent/child visibility rules.
 * - If any child is visible → parent hidden
 * - Else if node canFitTitle → node visible
 * - Else if node has no parent → node visible (fallback)
 * - Else → node hidden
 */
export function resolveVisibility(
  byId: Map<string, PreparedRenderedEvent>,
  childrenByParentId: Map<string, string[]>,
  roots: string[],
  orphanRoots: string[]
): Set<string> {
  const visible = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);

    const childIds = childrenByParentId.get(id) ?? [];
    for (const childId of childIds) {
      dfs(childId);
    }

    const node = byId.get(id);
    if (!node) return;

    const anyChildVisible = childIds.some(childId => visible.has(childId));
    if (anyChildVisible) {
      return; // prefer children over parent
    }

    if (node.canFitTitle) {
      visible.add(id);
      return;
    }

    if (!node.parentId) {
      // root fallback
      visible.add(id);
    }
  }

  for (const id of roots) dfs(id);
  for (const id of orphanRoots) dfs(id);

  return visible;
}


