import { expect } from "@std/expect";
import { ObjectId } from "bson";
import { listObjectCards, OBJECT_CARD_PROJECTION } from "./list-cards.ts";

function candidate(index: number) {
  return {
    _id: new ObjectId(),
    name: `Person ${index}`,
    isPerson: true,
    createdAt: new Date(1_000 - index),
    updatedAt: new Date(1_000 - index),
  };
}

Deno.test("tag membership is bounded by the base candidate window", async () => {
  const candidates = Array.from({ length: 11 }, (_, index) => candidate(index));
  const tagId = new ObjectId();
  const calls: any[] = [];
  const mongo = async (input: any) => {
    calls.push(input);
    if (input.action === "find") return candidates;
    const match = input.pipeline?.[0]?.$match ?? {};
    if (match["relationship.object"]) {
      return [{ _id: candidates[9]._id }];
    }
    return [];
  };

  const result = await listObjectCards(mongo, {
    section: "person",
    filters: { tagIds: [tagId.toString()] },
    sort: "updatedAt",
    limit: 2,
  }, false);

  const baseCall = calls.find((call) => call.action === "find");
  expect(baseCall.options.limit).toBe(11);
  expect(baseCall.options.projection).toEqual(OBJECT_CARD_PROJECTION);
  const membershipCall = calls.find((call) =>
    call.pipeline?.[0]?.$match?.["relationship.object"]
  );
  expect(
    membershipCall.pipeline[0].$match["relationship.subject"].$in,
  ).toHaveLength(10);
  expect(membershipCall.options.hint).toBe("relationship_subject_1");
  expect(membershipCall.pipeline.some((stage: any) => stage.$lookup)).toBe(
    false,
  );
  expect(result.items.map((item) => item.name)).toEqual(["Person 9"]);
  expect(result.hasMore).toBe(true);
  expect(result.nextCursor).toEqual(expect.any(String));
});

Deno.test("tagged text search preserves relevance order and offset continuation", async () => {
  const firstWindow = Array.from(
    { length: 11 },
    (_, index) => candidate(index),
  );
  const secondWindow = [candidate(11)];
  const tagIds = [new ObjectId(), new ObjectId()];
  const calls: any[] = [];
  let searchWindow = 0;
  const mongo = async (input: any) => {
    calls.push(input);
    const firstMatch = input.pipeline?.[0]?.$match ?? {};
    if (input.action === "aggregate" && firstMatch.isRelationship !== true) {
      return searchWindow++ === 0 ? firstWindow : secondWindow;
    }
    if (firstMatch["relationship.object"]) {
      return [{
        _id: searchWindow === 1 ? firstWindow[9]._id : secondWindow[0]._id,
      }];
    }
    return [];
  };

  const first = await listObjectCards(mongo, {
    section: "person",
    filters: {
      search: "person",
      tagIds: tagIds.map(String),
      tagMode: "and",
    },
    sort: "name",
    limit: 2,
  }, false);
  const firstSearchCall = calls.find((call) =>
    call.action === "aggregate" &&
    call.pipeline?.[0]?.$match?.isRelationship !== true
  );
  expect(firstSearchCall.pipeline[0].$match.$and[1]).toEqual({
    $text: { $search: "person" },
  });
  expect(firstSearchCall.pipeline[2]).toEqual({
    $sort: { score: { $meta: "textScore" }, _id: -1 },
  });
  const firstMembership = calls.find((call) =>
    call.pipeline?.[0]?.$match?.["relationship.object"]
  );
  expect(firstMembership.pipeline).toContainEqual({
    $match: { matchedTagCount: 2 },
  });
  expect(first.items.map((item) => item.name)).toEqual(["Person 9"]);

  const callCount = calls.length;
  const second = await listObjectCards(mongo, {
    section: "person",
    filters: {
      search: "person",
      tagIds: tagIds.map(String),
      tagMode: "and",
    },
    sort: "name",
    cursor: first.nextCursor!,
    limit: 2,
  }, false);
  const secondSearchCall = calls.slice(callCount).find((call) =>
    call.action === "aggregate" &&
    call.pipeline?.[0]?.$match?.isRelationship !== true
  );
  expect(secondSearchCall.pipeline).toContainEqual({ $skip: 10 });
  expect(second.items.map((item) => item.name)).toEqual(["Person 11"]);
});
