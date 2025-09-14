import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getProcessorResource } from "../core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";

Deno.test(
  "should get processing status - pending when no process field",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth, { db }: any) => {
    const processor = await getProcessorResource(auth);

    await db.collection("itemsToProcess").insertMany(Array.from({ length: 10 }, (_, i) => ({ name: `test-${i}` })));

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
    const names = Array.from({ length: 10 }, (_, i) => `test-${i}`)

    await db.collection("itemsToProcess").insertMany(names.map(name => ({ name })));

    const claims = Array.from({ length: 5 }, () => processor({
      action: "claim",
      collection: "itemsToProcess",
      processorName: "test-processor",
      workerId: "test-worker",
      batchSize: 2,
    }));

    const results = await Promise.all(claims)

    expect(results[0]).toHaveLength(2)
    expect(results.flat().map(item => item.name).toSorted()).toEqual(names)
  }),
);
