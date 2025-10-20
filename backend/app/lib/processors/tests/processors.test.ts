import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getProcessorResource } from "../core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { getMongoResource } from "../../mongo/core.server.ts";

Deno.test(
  "should get processing status - pending when no process field",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth, { db }: any) => {
    const processor = await getProcessorResource(auth);

    await db.collection("itemsToProcess").insertMany(
      Array.from({ length: 10 }, (_, i) => ({ name: `test-${i}` })),
    );

    const result = await processor({
      action: "claim",
      collection: "itemsToProcess",
      processorName: "test-processor",
      workerId: "test-worker",
      batchSize: 3,
    });
    expect(result).toHaveLength(3);

    expect(result[0]).toHaveProperty("name", "test-9"); // oldest first
  }),
);

Deno.test(
  "should claimBatch in parallel with",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth, { db }: any) => {
    const processor = await getProcessorResource(auth);
    const names = Array.from({ length: 10 }, (_, i) => `test-${i}`);

    await db.collection("itemsToProcess").insertMany(
      names.map((name) => ({ name })),
    );

    const claims = Array.from({ length: 5 }, () =>
      processor({
        action: "claim",
        collection: "itemsToProcess",
        processorName: "test-processor",
        workerId: "test-worker",
        batchSize: 2,
      }));

    const results = await Promise.all(claims);

    expect(results[0]).toHaveLength(2);
    expect(results.flat().map((item) => item.name).toSorted()).toEqual(names);
  }),
);

Deno.test(
  "should mark items as processed",
  withFixtures([
    "Admin",
    "Mongo",
    "accessLogger",
  ], async (auth: Auth, { db }: any, accessLogger: any) => {
    const processor = await getProcessorResource(auth);
    const mongo = await getMongoResource(auth);
    const names = Array.from({ length: 10 }, (_, i) => `test-${i}`);
    const col = db.collection("itemsToProcess");
    await col.insertMany(names.map((name) => ({ name })));

    let [a, b]: any[] = await processor({
      action: "claim",
      collection: "itemsToProcess",
      processorName: "test",
      workerId: "test-worker",
      batchSize: 2,
    });

    async function refreshFromDB(): Promise<any[]> {
      return mongo({
        collection: "itemsToProcess",
        action: "find",
        query: { _id: { $in: [a._id, b._id] } },
      });
    }

    [a, b] = await refreshFromDB();

    expect(a.test.status).toEqual("in-progress");
    expect(a.test.startedAt).toBeInstanceOf(Date);

    await mongo({
      collection: "itemsToProcess",
      action: "updateMany",
      query: {
        "_id": {
          $in: [a._id, b._id],
        },
      },
      update: {
        $set: {
          "test.computed": 42,
        },
      },
    });

    [a, b] = await refreshFromDB();
    expect(a.test.computed).toEqual(42);

    await processor({
      action: "acknowledge",
      collection: "itemsToProcess",
      processorName: "test",
      statuses: [
        {
          id: a._id,
          status: "done",
          thisPropertyIsSetDuringAck: true,
        },
        {
          id: b._id,
          status: "failed",
          error: "he-he",
        },
      ],
    });

    [a, b] = await refreshFromDB();
    expect(a.test.status).toEqual("done");
    expect(a.test.startedAt).toBeInstanceOf(Date);
    expect(a.test).toHaveProperty("computed", 42);
    expect(a.test).toHaveProperty("thisPropertyIsSetDuringAck", true);

    expect(b.test.status).toEqual("failed");
    expect(b.test.error).toEqual("he-he");

    expect(accessLogger).toHaveBeenCalledWith(
      "admin",
      "tech.mycelia.processors",
      [{ path: ["processors", "test"], actions: ["acknowledge"] }],
    );
  }),
);
