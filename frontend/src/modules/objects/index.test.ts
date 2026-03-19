import { describe, expect, it } from "vitest";
import { ObjectId } from "bson";
import { buildRelationshipConnectors } from "./relationshipConnectors.ts";

type PlacedRange = Parameters<typeof buildRelationshipConnectors>[0][number];
type CategorySection = Parameters<
  typeof buildRelationshipConnectors
>[1][number];
const metrics = {
  laneHeight: 40,
  topMargin: 4,
  categoryHeaderHeight: 24,
} as const;

function createObject(
  overrides: Partial<PlacedRange["object"]> = {},
): PlacedRange["object"] {
  return {
    _id: overrides._id ?? new ObjectId(),
    icon: { text: "•" },
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createPlacedRange(overrides: Partial<PlacedRange>): PlacedRange {
  return {
    object: createObject(),
    rangeIndex: 0,
    start: new Date("2025-01-01T00:00:00.000Z"),
    end: new Date("2025-01-02T00:00:00.000Z"),
    category: "other",
    startX: 0,
    endX: 100,
    lane: 0,
    startOffScreen: false,
    endOffScreen: false,
    hasNoEnd: false,
    isSmall: false,
    ...overrides,
  };
}

describe("buildRelationshipConnectors", () => {
  it("connects relationship blocks to visible subject and object lines in category layout", () => {
    const subject = createObject({
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      name: "Me",
      isPerson: true,
    });
    const target = createObject({
      _id: new ObjectId("507f1f77bcf86cd799439012"),
      name: "Mexico",
    });
    const relationship = createObject({
      _id: new ObjectId("507f1f77bcf86cd799439013"),
      name: "lives in",
      isRelationship: true,
      relationship: {
        subject: subject._id,
        object: target._id,
        symmetrical: false,
      },
    });

    const placed: PlacedRange[] = [
      createPlacedRange({
        object: subject,
        category: "person",
        lane: 0,
        startX: 20,
        endX: 160,
      }),
      createPlacedRange({
        object: relationship,
        category: "relationship",
        lane: 1,
        startX: 80,
        endX: 220,
      }),
      createPlacedRange({
        object: target,
        category: "other",
        lane: 2,
        startX: 140,
        endX: 280,
      }),
    ];

    const sections: CategorySection[] = [
      {
        category: "person",
        config: { id: "person", label: "People", color: "#3b82f6", icon: "👤" },
        startLane: 0,
        laneCount: 1,
        yOffset: 4,
      },
      {
        category: "relationship",
        config: {
          id: "relationship",
          label: "Relationships",
          color: "#ec4899",
          icon: "🔗",
        },
        startLane: 1,
        laneCount: 1,
        yOffset: 68,
      },
      {
        category: "other",
        config: { id: "other", label: "Other", color: "#6b7280", icon: "📦" },
        startLane: 2,
        laneCount: 1,
        yOffset: 132,
      },
    ];

    const connectors = buildRelationshipConnectors(
      placed,
      sections,
      "by-category",
      metrics,
    );

    expect(connectors).toHaveLength(2);

    const upwardConnector = connectors.find((connector) =>
      connector.endY < connector.startY
    );
    const downwardConnector = connectors.find((connector) =>
      connector.endY > connector.startY
    );

    expect(upwardConnector).toBeDefined();
    expect(downwardConnector).toBeDefined();
  });

  it("prefers the overlapping target range when an object has multiple visible ranges", () => {
    const subjectId = new ObjectId("507f1f77bcf86cd799439021");
    const targetId = new ObjectId("507f1f77bcf86cd799439022");
    const relationship = createObject({
      _id: new ObjectId("507f1f77bcf86cd799439023"),
      isRelationship: true,
      relationship: {
        subject: subjectId,
        object: targetId,
        symmetrical: false,
      },
    });

    const subject = createObject({
      _id: subjectId,
      name: "Subject",
      isPerson: true,
    });
    const target = createObject({
      _id: targetId,
      name: "Target",
    });

    const placed: PlacedRange[] = [
      createPlacedRange({
        object: subject,
        category: "person",
        start: new Date("2025-01-01T00:00:00.000Z"),
        end: new Date("2025-01-02T00:00:00.000Z"),
        startX: 0,
        endX: 40,
      }),
      createPlacedRange({
        object: subject,
        category: "person",
        rangeIndex: 1,
        start: new Date("2025-01-06T00:00:00.000Z"),
        end: new Date("2025-01-10T00:00:00.000Z"),
        startX: 140,
        endX: 260,
      }),
      createPlacedRange({
        object: target,
        category: "other",
        start: new Date("2025-01-06T00:00:00.000Z"),
        end: new Date("2025-01-10T00:00:00.000Z"),
        startX: 220,
        endX: 340,
      }),
      createPlacedRange({
        object: relationship,
        category: "relationship",
        lane: 1,
        start: new Date("2025-01-07T00:00:00.000Z"),
        end: new Date("2025-01-08T00:00:00.000Z"),
        startX: 160,
        endX: 280,
      }),
    ];

    const connectors = buildRelationshipConnectors(
      placed,
      [],
      "mixed",
      metrics,
    );
    const subjectConnector = connectors.find((connector) =>
      connector.key.includes("-subject-")
    );

    expect(subjectConnector).toBeDefined();
    expect(subjectConnector!.endX).toBeGreaterThan(180);
  });
});
