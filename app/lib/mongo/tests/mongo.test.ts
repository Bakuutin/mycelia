import { expect, fn } from "@std/expect";
import { z } from "zod";
import { Auth } from "@/lib/auth/core.server.ts";
import {
  defaultResourceManager,
  ModifyPolicy,
  Policy,
} from "@/lib/auth/resources.ts";
import { getMongoResource, MongoResource } from "../core.server.ts";

const mongoResource: MongoResource = new MongoResource();
defaultResourceManager.registerResource(mongoResource);
let auth: Auth;

function getMockDb() {
  const mockCollection = {
    find: fn(() => [{ _id: 1, name: "Alice" }]),
    findOne: fn(() => ({ _id: 1, name: "Alice" })),
    insertOne: fn(() => ({ insertedId: 1 })),
    insertMany: fn(() => ({ insertedIds: [1, 2] })),
    updateOne: fn(() => ({ matchedCount: 1, modifiedCount: 1 })),
    updateMany: fn(() => ({ matchedCount: 2, modifiedCount: 2 })),
    deleteOne: fn(() => ({ deletedCount: 1 })),
    deleteMany: fn(() => ({ deletedCount: 2 })),
    countDocuments: fn(() => 42),
  };
  const mockDb = {
    collection: fn(() => mockCollection),
  };
  return mockDb;
}

function setup(policies?: Policy[]) {
  auth = new Auth({
    principal: "mongo-tester",
    policies: policies ?? [
      { resource: "db/*", action: "*", effect: "allow" },
    ],
  });
  mongoResource.getRootDB = async () => getMockDb() as any;
}

Deno.test("should allow find", async () => {
  setup();
  const resourceFn = await auth.getResource("tech.mycelia.mongo");
  const req = { action: "find" as const, collection: "users", query: {} };
  const result = await resourceFn(req);
  expect(result).toEqual([{ _id: 1, name: "Alice" }]);
});

Deno.test("should allow insertOne", async () => {
  setup();
  const resourceFn = await auth.getResource("tech.mycelia.mongo");
  const req = {
    action: "insertOne" as const,
    collection: "users",
    doc: { name: "Bob" },
  };
  const result = await resourceFn(req);
  expect(result).toHaveProperty("insertedId", 1);
});

Deno.test("should enforce policy: deny delete", async () => {
  setup([
    { resource: "db/*", action: "delete", effect: "deny" },
    { resource: "db/*", action: "*", effect: "allow" },
  ]);
  const resourceFn = await auth.getResource("tech.mycelia.mongo");
  const req = { action: "deleteOne" as const, collection: "users", query: {} };
  await expect(resourceFn(req)).rejects.toHaveProperty("status", 403);
});

Deno.test("should apply filter modifier for insertOne", async () => {
  setup([{
    resource: "db/*",
    action: "write",
    effect: "modify",
    middleware: { code: "filter", arg: { filter: { role: "user" } } },
  }]);
  const resourceFn = await auth.getResource("tech.mycelia.mongo");
  await expect(
    resourceFn({
      action: "insertOne",
      collection: "users",
      doc: { role: "admin" },
    }),
  ).rejects.toHaveProperty("status", 403);
  const result = await resourceFn({
    action: "insertOne",
    collection: "users",
    doc: { role: "user" },
  });
  expect(result).toHaveProperty("insertedId", 1);
});
