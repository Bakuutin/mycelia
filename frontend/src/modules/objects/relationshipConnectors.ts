import type { Object } from "@/types/objects.ts";
import type {
  ObjectCategory,
  ObjectCategoryConfig,
  ObjectsLayoutMode,
} from "@/types/tracks.ts";

export type TimelineObject = Object & {
  subjectObject?: Object;
  objectObject?: Object;
};

export type ExtractedObjectRange = {
  object: TimelineObject;
  rangeIndex: number;
  start: Date;
  end?: Date;
  category: ObjectCategory;
};

export type PlacedObjectRange = {
  startX: number;
  endX: number;
  lane: number;
  startOffScreen: boolean;
  endOffScreen: boolean;
  hasNoEnd: boolean;
  isSmall: boolean;
} & ExtractedObjectRange;

export type CategorySection = {
  category: ObjectCategory;
  config: ObjectCategoryConfig;
  startLane: number;
  laneCount: number;
  yOffset: number;
};

export type RelationshipConnector = {
  key: string;
  path: string;
  color: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type RenderedRangeRect = {
  key: string;
  range: PlacedObjectRange;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type LayoutMetrics = {
  laneHeight: number;
  topMargin: number;
  categoryHeaderHeight: number;
};

function getRangeKey(range: PlacedObjectRange): string {
  return `${range.object._id.toString()}-${range.rangeIndex}`;
}

export function getRangeYOffset(
  range: PlacedObjectRange,
  categorySections: CategorySection[],
  layoutMode: ObjectsLayoutMode,
  metrics: LayoutMetrics,
): number {
  if (layoutMode !== "by-category" || categorySections.length === 0) {
    return 0;
  }

  const section = categorySections.find((s) => s.category === range.category);
  if (!section) return 0;

  return section.yOffset + metrics.categoryHeaderHeight - metrics.topMargin -
    section.startLane * metrics.laneHeight;
}

function getRenderedRangeRect(
  range: PlacedObjectRange,
  categorySections: CategorySection[],
  layoutMode: ObjectsLayoutMode,
  metrics: LayoutMetrics,
): RenderedRangeRect | null {
  const startX = range.startX < 0 ? 0 : range.startX;
  let rangeWidth = range.endX - startX;

  if (Number.isNaN(rangeWidth) || rangeWidth <= 0) return null;
  if (rangeWidth < 2) rangeWidth = 2;

  const height = metrics.laneHeight - 2;
  const yOffset = getRangeYOffset(range, categorySections, layoutMode, metrics);
  const y = yOffset + metrics.topMargin + range.lane * metrics.laneHeight;

  return {
    key: getRangeKey(range),
    range,
    x: startX,
    y,
    width: rangeWidth,
    height,
    centerX: startX + rangeWidth / 2,
    centerY: y + height / 2,
  };
}

function getRangeInterval(range: ExtractedObjectRange | PlacedObjectRange) {
  return {
    start: range.start.getTime(),
    end: range.end?.getTime() ?? Number.POSITIVE_INFINITY,
  };
}

function getIntervalOverlapMs(
  a: ExtractedObjectRange | PlacedObjectRange,
  b: ExtractedObjectRange | PlacedObjectRange,
): number {
  const intervalA = getRangeInterval(a);
  const intervalB = getRangeInterval(b);
  return Math.max(
    0,
    Math.min(intervalA.end, intervalB.end) -
      Math.max(intervalA.start, intervalB.start),
  );
}

function getIntervalGapMs(
  a: ExtractedObjectRange | PlacedObjectRange,
  b: ExtractedObjectRange | PlacedObjectRange,
): number {
  const intervalA = getRangeInterval(a);
  const intervalB = getRangeInterval(b);

  if (intervalA.end < intervalB.start) {
    return intervalB.start - intervalA.end;
  }

  if (intervalB.end < intervalA.start) {
    return intervalA.start - intervalB.end;
  }

  return 0;
}

function buildConnectorPath(
  relationshipRect: RenderedRangeRect,
  targetRect: RenderedRangeRect,
  kind: "subject" | "object",
) {
  const targetIsAbove = targetRect.centerY < relationshipRect.centerY;
  const inset = Math.min(Math.max(relationshipRect.width * 0.2, 10), 28);
  const startX = kind === "subject"
    ? relationshipRect.x + inset
    : relationshipRect.x + relationshipRect.width - inset;
  const startY = targetIsAbove
    ? relationshipRect.y
    : relationshipRect.y + relationshipRect.height;
  const endX = targetRect.centerX;
  const endY = targetIsAbove ? targetRect.y + targetRect.height : targetRect.y;
  const verticalDistance = Math.abs(endY - startY);
  const controlOffset = Math.max(18, Math.min(72, verticalDistance * 0.55));
  const controlStartY = targetIsAbove
    ? startY - controlOffset
    : startY + controlOffset;
  const controlEndY = targetIsAbove
    ? endY + controlOffset
    : endY - controlOffset;

  return {
    startX,
    startY,
    endX,
    endY,
    path:
      `M ${startX} ${startY} C ${startX} ${controlStartY} ${endX} ${controlEndY} ${endX} ${endY}`,
  };
}

function findBestTargetRange(
  relationshipRange: PlacedObjectRange,
  relationshipRect: RenderedRangeRect,
  candidates: RenderedRangeRect[],
): RenderedRangeRect | null {
  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => {
    const overlapDelta = getIntervalOverlapMs(b.range, relationshipRange) -
      getIntervalOverlapMs(a.range, relationshipRange);
    if (overlapDelta !== 0) return overlapDelta;

    const gapDelta = getIntervalGapMs(a.range, relationshipRange) -
      getIntervalGapMs(b.range, relationshipRange);
    if (gapDelta !== 0) return gapDelta;

    return Math.abs(a.centerX - relationshipRect.centerX) -
      Math.abs(b.centerX - relationshipRect.centerX);
  })[0] ?? null;
}

export function buildRelationshipConnectors(
  placed: PlacedObjectRange[],
  categorySections: CategorySection[],
  layoutMode: ObjectsLayoutMode,
  metrics: LayoutMetrics,
): RelationshipConnector[] {
  const renderedRanges = placed
    .map((range) =>
      getRenderedRangeRect(range, categorySections, layoutMode, metrics)
    )
    .filter((range): range is RenderedRangeRect => range !== null);

  const renderedRangesByObjectId = new Map<string, RenderedRangeRect[]>();

  for (const range of renderedRanges) {
    const objectId = range.range.object._id.toString();
    const existing = renderedRangesByObjectId.get(objectId) ?? [];
    existing.push(range);
    renderedRangesByObjectId.set(objectId, existing);
  }

  const connectors: RelationshipConnector[] = [];

  for (const relationshipRect of renderedRanges) {
    const relationshipObject = relationshipRect.range.object;
    if (
      !relationshipObject.isRelationship || !relationshipObject.relationship
    ) {
      continue;
    }

    const connections: Array<{
      kind: "subject" | "object";
      targetId: string | undefined;
    }> = [
      {
        kind: "subject",
        targetId: relationshipObject.relationship.subject?.toString(),
      },
      {
        kind: "object",
        targetId: relationshipObject.relationship.object?.toString(),
      },
    ];

    for (const connection of connections) {
      if (!connection.targetId) continue;

      const candidates = renderedRangesByObjectId.get(connection.targetId) ??
        [];
      const targetRect = findBestTargetRange(
        relationshipRect.range,
        relationshipRect,
        candidates,
      );

      if (!targetRect) continue;

      const connector = buildConnectorPath(
        relationshipRect,
        targetRect,
        connection.kind,
      );

      connectors.push({
        key: `${relationshipRect.key}-${connection.kind}-${targetRect.key}`,
        color: relationshipObject.color as string || "#94a3b8",
        ...connector,
      });
    }
  }

  return connectors;
}
