import { expect } from "@std/expect";
import {
  nearestPointInsideSegment,
  projectConversation,
  selectCoveringLocationSegment,
  shouldQueueConversationProjectionChange,
} from "./conversation-map.server.ts";

const at = new Date("2026-05-06T12:30:00Z");

Deno.test("manual segment wins over stay and move", () => {
  const segments = [
    {
      _id: "move",
      type: "move" as const,
      start: new Date("2026-05-06T12:00:00Z"),
      end: new Date("2026-05-06T13:00:00Z"),
    },
    {
      _id: "stay",
      type: "stay" as const,
      start: new Date("2026-05-06T12:00:00Z"),
      end: new Date("2026-05-06T13:00:00Z"),
      loc: { type: "Point" as const, coordinates: [7, 46] as [number, number] },
    },
    {
      _id: "manual",
      type: "manual" as const,
      start: new Date("2026-05-06T12:00:00Z"),
      end: new Date("2026-05-06T13:00:00Z"),
      loc: { type: "Point" as const, coordinates: [8, 47] as [number, number] },
    },
  ];
  expect(selectCoveringLocationSegment(segments, at)?._id).toBe("manual");
});

Deno.test("move matching cannot escape the covering move", () => {
  const move = {
    _id: "move",
    type: "move" as const,
    start: new Date("2026-05-06T12:00:00Z"),
    end: new Date("2026-05-06T13:00:00Z"),
  };
  const points = [
    {
      ts: new Date("2026-05-06T11:59:59Z"),
      loc: { type: "Point" as const, coordinates: [1, 1] as [number, number] },
    },
    {
      ts: new Date("2026-05-06T12:31:00Z"),
      loc: { type: "Point" as const, coordinates: [7, 46] as [number, number] },
    },
    {
      ts: new Date("2026-05-06T13:00:01Z"),
      loc: { type: "Point" as const, coordinates: [2, 2] as [number, number] },
    },
  ];
  expect(nearestPointInsideSegment(points, at, move)?.loc.coordinates).toEqual([
    7,
    46,
  ]);
});

Deno.test("gap leaves a conversation unmatched", () => {
  const row = projectConversation(
    {
      _id: "conversation",
      isConversation: true,
      timeRanges: [{
        start: new Date("2026-05-06T12:20:00Z"),
        end: new Date("2026-05-06T12:40:00Z"),
      }],
    },
    "generation",
    [{
      _id: "gap",
      type: "gap",
      start: new Date("2026-05-06T12:00:00Z"),
      end: new Date("2026-05-06T13:00:00Z"),
    }],
    [],
  );
  expect(row?.matched).toBe(false);
  expect(row?.matchKind).toBe("unmatched");
});

Deno.test("only map-relevant object changes enter the durable queue", () => {
  expect(shouldQueueConversationProjectionChange("update", ["name"])).toBe(
    true,
  );
  expect(shouldQueueConversationProjectionChange("update", ["summary"])).toBe(
    false,
  );
  expect(shouldQueueConversationProjectionChange("delete")).toBe(true);
});
