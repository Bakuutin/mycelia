import { expect } from "@std/expect";

import { Auth } from "@/lib/auth/core.server.ts";
import { ResourceManager } from "@/lib/auth/resources.ts";
import { memoryExportQuery, MemoryExportResource } from "./resource.server.ts";

class FakeCursor {
  closed = false;
  index = 0;

  constructor(readonly documents: Record<string, unknown>[]) {}

  hasNext(): Promise<boolean> {
    return Promise.resolve(this.index < this.documents.length);
  }

  next(): Promise<Record<string, unknown> | null> {
    return Promise.resolve(this.documents[this.index++] ?? null);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class TestMemoryExportResource extends MemoryExportResource {
  readonly cursor = new FakeCursor([
    { _id: "1", text: "first" },
    { _id: "2", text: "second" },
    { _id: "3", text: "third" },
  ]);
  findArgs: unknown[] = [];

  protected override getDatabase(): Promise<any> {
    return Promise.resolve({
      collection: (name: string) => ({
        countDocuments: (query: unknown) => {
          this.findArgs = [name, query];
          return Promise.resolve(3);
        },
        find: (query: unknown, options: unknown) => {
          this.findArgs = [name, query, options];
          return this.cursor;
        },
      }),
    });
  }
}

const auth = new Auth({
  principal: "exporter",
  policies: [{ resource: "memory-export/*", action: "read", effect: "allow" }],
});

async function expectForbidden(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
    throw new Error("Expected operation to be forbidden");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(403);
  }
}

Deno.test("memory export accepts only fixed collections, read actions, and bounded pages", () => {
  const resource = new MemoryExportResource();
  expect(
    resource.schemas.request.safeParse({
      action: "count",
      collection: "objects",
    }).success,
  ).toBe(true);
  expect(
    resource.schemas.request.safeParse({
      action: "count",
      collection: "audio_chunks",
    }).success,
  ).toBe(false);
  expect(
    resource.schemas.request.safeParse({
      action: "find",
      collection: "objects",
    }).success,
  ).toBe(false);
  expect(
    resource.schemas.request.safeParse({
      action: "getFirstBatch",
      collection: "objects",
      batchSize: 1001,
    }).success,
  ).toBe(false);
  expect(resource.extractActions({ action: "count", collection: "objects" }))
    .toEqual([
      { path: ["memory-export", "objects"], actions: ["read"] },
    ]);
});

Deno.test("memory export excludes system and tool message roles server-side", () => {
  expect(memoryExportQuery("messages")).toEqual({
    role: { $nin: ["system", "tool", "developer", "function"] },
    "raw.role": { $nin: ["system", "tool", "developer", "function"] },
  });
  expect(memoryExportQuery("chats")).toEqual({});
});

Deno.test("memory export requires its dedicated read policy", async () => {
  const manager = new ResourceManager();
  manager.registerResource(new MemoryExportResource());
  const wrongAuth = new Auth({
    principal: "mongo-reader",
    policies: [{ resource: "db/objects", action: "read", effect: "allow" }],
  });

  await expectForbidden(
    manager.getResource("memory-export", wrongAuth)({
      action: "count",
      collection: "objects",
    }),
  );
});

Deno.test("memory export paginates with a principal-bound cursor", async () => {
  const resource = new TestMemoryExportResource();
  const first = await resource.use({
    action: "getFirstBatch",
    collection: "messages",
    batchSize: 2,
  }, auth) as any;

  expect(first.data.map((item: any) => item._id)).toEqual(["1", "2"]);
  expect(first.hasMore).toBe(true);
  expect(first.cursorId).not.toBe("");
  expect(resource.findArgs[0]).toBe("messages");
  expect(resource.findArgs[1]).toEqual(memoryExportQuery("messages"));

  await expectForbidden(
    resource.use({
      action: "getMore",
      collection: "messages",
      cursorId: first.cursorId,
      batchSize: 1,
    }, new Auth({ principal: "other" })),
  );

  const second = await resource.use({
    action: "getMore",
    collection: "messages",
    cursorId: first.cursorId,
    batchSize: 1,
  }, auth) as any;
  expect(second.data.map((item: any) => item._id)).toEqual(["3"]);
  expect(second.hasMore).toBe(false);
  expect(second.cursorId).toBe("");
  expect(resource.cursor.closed).toBe(true);
});
