import { assert, assertEquals } from "jsr:@std/assert";
import { z } from "zod";
import { convertToModelMessages, jsonSchema, tool } from "ai";
import {
  resourceToTools,
  zodSchemaToJsonSchema,
} from "@/lib/mcp/ai-sdk-adapter.ts";
import {
  zDateOrString,
  zObjectId,
} from "@myceliasdk/zod-json-schema.ts";
import { ObjectsResource } from "@/lib/objects/resource.server.ts";
import { MongoResource } from "@/lib/mongo/core.server.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { chatToolFilter } from "@/routes/api.chat.ts";

function hasEmptySubschema(schema: unknown): boolean {
  if (Array.isArray(schema)) {
    return schema.some(hasEmptySubschema);
  }
  if (schema && typeof schema === "object") {
    const obj = schema as Record<string, unknown>;
    if (Array.isArray(obj.anyOf) && obj.anyOf.some((s) => {
      if (!s || typeof s !== "object") return false;
      const keys = Object.keys(s as Record<string, unknown>);
      return keys.length === 0 || (keys.length === 1 && keys[0] === "description");
    })) {
      return true;
    }
    return Object.values(obj).some(hasEmptySubschema);
  }
  return false;
}

Deno.test("zDateOrString().describe() keeps the custom JSON schema", () => {
  const json = zodSchemaToJsonSchema(
    z.object({ start: zDateOrString().describe("Start date/time") }),
  ) as any;
  assertEquals(json.properties.start.type, "string");
  assertEquals(json.properties.start.format, "date-time");
  assertEquals(json.properties.start.description, "Start date/time");
});

Deno.test("zObjectId().describe() keeps the custom JSON schema", () => {
  const json = zodSchemaToJsonSchema(
    z.object({ id: zObjectId().describe("Target id") }),
  ) as any;
  assertEquals(json.properties.id.type, "string");
  assertEquals(json.properties.id.description, "Target id");
});

Deno.test("objects tool schemas contain no empty subschemas", () => {
  const resource = new ObjectsResource();
  const tools = resourceToTools(resource, {} as Auth);
  for (const [name, def] of Object.entries(tools)) {
    const json = zodSchemaToJsonSchema(def.inputSchema);
    assert(
      !hasEmptySubschema(json),
      `Tool ${name} emits an empty subschema: ${JSON.stringify(json)}`,
    );
  }
});

Deno.test("chat tool filter keeps mongo read-only and hides internal actions", () => {
  const mongoTools = resourceToTools(new MongoResource(), {} as Auth, {
    toolFilter: chatToolFilter,
  });
  const mongoNames = Object.keys(mongoTools);
  assert(mongoNames.includes("mongo_find"));
  assert(mongoNames.includes("mongo_aggregate"));
  for (
    const forbidden of [
      "mongo_insertOne",
      "mongo_insertMany",
      "mongo_updateOne",
      "mongo_updateMany",
      "mongo_deleteOne",
      "mongo_deleteMany",
      "mongo_bulkWrite",
      "mongo_createIndex",
      "mongo_findOneAndUpdate",
    ]
  ) {
    assert(!mongoNames.includes(forbidden), `${forbidden} must be filtered`);
  }

  const objectsTools = resourceToTools(new ObjectsResource(), {} as Auth, {
    toolFilter: chatToolFilter,
  });
  const objectNames = Object.keys(objectsTools);
  assert(objectNames.includes("objects_create"));
  assert(objectNames.includes("objects_merge"));
  assert(!objectNames.includes("objects_claimSummarization"));
  assert(!objectNames.includes("objects_releaseSummarization"));
});

Deno.test("approval-responded UI parts survive conversion to model messages", async () => {
  const tools = {
    objects_create: tool({
      description: "create",
      inputSchema: jsonSchema({ type: "object" }),
      needsApproval: true,
      execute: async () => ({}),
    }),
  };

  const modelMessages = await convertToModelMessages([
    {
      role: "user",
      parts: [{ type: "text", text: "Create an event" }],
    },
    {
      role: "assistant",
      parts: [
        {
          type: "tool-objects_create",
          toolCallId: "call_1",
          state: "approval-responded",
          input: { object: { name: "Dentist", isEvent: true } },
          approval: { id: "approval_1", approved: true },
        } as any,
      ],
    },
  ], { tools, ignoreIncompleteToolCalls: true });

  const flatParts = modelMessages.flatMap((message) =>
    Array.isArray(message.content) ? message.content : []
  );
  assert(
    flatParts.some((part: any) => part.type === "tool-approval-response"),
    `Expected a tool-approval-response part, got: ${
      JSON.stringify(modelMessages)
    }`,
  );
  assert(
    flatParts.some((part: any) => part.type === "tool-call"),
    "Expected the original tool-call to be preserved",
  );
});

Deno.test("objects_create timeRanges.start is a proper date-time schema", () => {
  const resource = new ObjectsResource();
  const tools = resourceToTools(resource, {} as Auth);
  const json = zodSchemaToJsonSchema(tools.objects_create.inputSchema) as any;
  const start = json.properties.object.properties.timeRanges.items.properties.start;
  assertEquals(start.type, "string");
  assertEquals(start.format, "date-time");
});
