import { assertEquals, assertThrows } from "@std/assert";
import { ObjectId } from "bson";
import {
  zMediaEvent,
  zMediaEventLink,
  zMediaEventUnderstanding,
} from "./media-events.ts";

const understanding = {
  schemaVersion: "mycelia.media-event-output.v1" as const,
  title: "Прогулка в парке",
  eventType: "walk" as const,
  description: "Группа людей гуляет по парку.",
  temporalLabel: "Днём",
  place: {
    kind: "park" as const,
    visualSummary: "Зелёный городской парк",
    confidence: 0.9,
    evidenceRefs: ["preview-1"],
  },
  participants: {
    visiblePeopleRange: { min: 2, max: 4 },
    groups: [{
      role: "participants" as const,
      visibleCountRange: { min: 2, max: 4 },
      evidenceRefs: ["preview-1"],
      confidence: 0.8,
    }],
  },
  keyActions: [{
    text: "Прогулка",
    evidenceRefs: ["preview-1"],
    confidence: 0.9,
  }],
  highlights: [{
    ref: "preview-1",
    rank: 1,
    reason: "Хорошо передаёт место",
    confidence: 0.85,
  }],
  keywords: ["парк", "прогулка"],
  confidence: 0.86,
  warnings: [],
};

Deno.test("media event understanding is strict and privacy-preserving", () => {
  assertEquals(
    zMediaEventUnderstanding.parse(understanding).eventType,
    "walk",
  );
  assertThrows(() =>
    zMediaEventUnderstanding.parse({
      ...understanding,
      participants: {
        ...understanding.participants,
        identity: "Alice",
      },
    })
  );
  assertThrows(() =>
    zMediaEventUnderstanding.parse({
      ...understanding,
      participants: {
        visiblePeopleRange: { min: 5, max: 2 },
        groups: [],
      },
    })
  );
});

Deno.test("media event is owner-scoped and requires at least two assets", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const assetIds = [new ObjectId(), new ObjectId()];
  const parsed = zMediaEvent.parse({
    _id: new ObjectId(),
    owner: "user:example",
    stableKey: "event-v1:asset-a:asset-b",
    status: "ready",
    assetIds,
    startAt: now,
    endAt: new Date(now.getTime() + 60_000),
    representativeAssetIds: [assetIds[0]],
    analysis: understanding,
    publishedRunId: "event-run-v1:published",
    createdAt: now,
    updatedAt: now,
  });
  assertEquals(parsed.owner, "user:example");
  assertEquals(parsed.publishedRunId, "event-run-v1:published");
  assertThrows(() =>
    zMediaEvent.parse({
      ...parsed,
      assetIds: [assetIds[0]],
    })
  );
});

Deno.test("media event links keep owner and idempotency key explicit", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const parsed = zMediaEventLink.parse({
    _id: new ObjectId(),
    owner: "user:example",
    linkKey: "temporal:event:transcription",
    eventId: new ObjectId(),
    targetType: "transcription",
    targetId: new ObjectId(),
    status: "suggested",
    relation: "temporal_overlap",
    overlap: { startAt: now, endAt: now, seconds: 0 },
    confidence: 0.75,
    createdAt: now,
    updatedAt: now,
  });
  assertEquals(parsed.targetType, "transcription");
});
