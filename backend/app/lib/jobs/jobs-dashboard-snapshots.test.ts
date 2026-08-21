import { expect } from "@std/expect";
import {
  beginDashboardRefresh,
  completeDashboardRefresh,
  failDashboardRefresh,
  readDashboardSnapshot,
} from "./jobs-dashboard-snapshots.ts";

function memoryMongo(initial: Record<string, any> = {}) {
  const documents = new Map<string, any>(
    Object.entries(initial).map((
      [key, value],
    ) => [key, structuredClone(value)]),
  );
  const applyUpdate = (document: Record<string, any>, update: any) => {
    if (update.$setOnInsert && Object.keys(document).length === 0) {
      Object.assign(document, structuredClone(update.$setOnInsert));
    }
    if (update.$set) Object.assign(document, structuredClone(update.$set));
    for (const key of Object.keys(update.$unset ?? {})) delete document[key];
  };
  const mongo = async (input: any) => {
    const id = String(input.query?._id);
    if (input.action === "findOne") {
      return documents.has(id) ? structuredClone(documents.get(id)) : null;
    }
    if (input.action === "updateOne") {
      let document = documents.get(id);
      if (!document && input.options?.upsert) {
        document = { _id: id };
        documents.set(id, document);
      }
      if (!document) return { matchedCount: 0, modifiedCount: 0 };
      if (
        input.query.operationId &&
        document.operationId !== input.query.operationId
      ) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(document, input.update);
      return { matchedCount: 1, modifiedCount: 1 };
    }
    if (input.action === "findOneAndUpdate") {
      const document = documents.get(id);
      if (!document) return null;
      const leaseExpired = !document.leaseUntil ||
        new Date(document.leaseUntil).getTime() <= Date.now();
      if (document.state === "refreshing" && !leaseExpired) return null;
      applyUpdate(document, input.update);
      return structuredClone(document);
    }
    throw new Error(`Unsupported memory Mongo action ${input.action}`);
  };
  return { mongo, documents };
}

Deno.test("dashboard refresh lease rejects concurrent work and accepts expiry", async () => {
  const { mongo, documents } = memoryMongo();
  expect(await beginDashboardRefresh(mongo, "snapshot", "first")).not
    .toBeNull();
  expect(await beginDashboardRefresh(mongo, "snapshot", "second")).toBeNull();

  documents.get("snapshot").leaseUntil = new Date(Date.now() - 1);
  expect(await beginDashboardRefresh(mongo, "snapshot", "third"))
    .toMatchObject({ operationId: "third", state: "refreshing" });
});

Deno.test("failed refresh keeps the last committed data as stale", async () => {
  const { mongo } = memoryMongo();
  const lease = await beginDashboardRefresh(mongo, "snapshot", "initial");
  expect(lease).not.toBeNull();
  await completeDashboardRefresh(mongo, "snapshot", "initial", { value: 42 });

  expect(await beginDashboardRefresh(mongo, "snapshot", "refresh"))
    .not.toBeNull();
  await failDashboardRefresh(mongo, "snapshot", "refresh", new Error("boom"));
  expect(await readDashboardSnapshot(mongo, "snapshot")).toMatchObject({
    state: "stale",
    data: { value: 42 },
    lastError: "boom",
  });
});
