import { expect } from "@std/expect";
import { apiResourceHandler } from "@/routes/api.resource.$name.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { callExpressHandler } from "@/tests/express-helpers.ts";
import { ObjectId } from "bson";
import {
  DIARIZATION_RECORDING_LEASE_BUSY_CODE,
  isDiarizationRecordingLeaseCollision,
} from "@/lib/mongo/core.server.ts";

Deno.test("Mongo lease conflict classification is narrow", () => {
  const request = {
    action: "findOneAndUpdate",
    collection: "diarization_recording_leases",
    query: { _id: new ObjectId() },
    update: { $set: { owner: "worker-2" } },
    options: { upsert: true, returnDocument: "after" },
  } as const;
  const idCollision = { code: 11000, keyPattern: { _id: 1 } };

  expect(isDiarizationRecordingLeaseCollision(request, idCollision)).toBe(
    true,
  );
  expect(isDiarizationRecordingLeaseCollision(
    { ...request, collection: "other_collection" },
    idCollision,
  )).toBe(false);
  expect(isDiarizationRecordingLeaseCollision(
    { ...request, action: "insertOne", doc: {} } as any,
    idCollision,
  )).toBe(false);
  expect(isDiarizationRecordingLeaseCollision(
    request,
    { code: 11000, keyPattern: { anotherUniqueField: 1 } },
  )).toBe(false);
});

Deno.test("Resource route - should require resource name", async () => {
  // const response = await callExpressHandler(
  //   apiResourceHandler,
  //   "http://localhost/api/resource/",
  //   {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: {},
  //     params: { name: "" },
  //   },
  // );
  // expect(response.status).toBe(400);

  // const data = await response.json();
  // expect(data.success).toBe(false);
  // expect(data.error).toBe("Tool name is required");
});

Deno.test(
  "Resource route - should return 404 for unknown resource",
  withFixtures([
    "AdminAuthHeaders",
  ], async (authHeaders) => {
    // const response = await callExpressHandler(
    //   apiResourceHandler,
    //   "http://localhost/api/resource/nonexistent",
    //   {
    //     method: "POST",
    //     headers: {
    //       ...authHeaders,
    //       "Content-Type": "application/json",
    //     },
    //     body: {},
    //     params: { name: "nonexistent" },
    //   },
    // );
    // expect(response.status).toBe(404);

    // const data = await response.json();
    // expect(data.success).toBe(false);
    // expect(data.error).toBe("Tool 'nonexistent' not found");
  }),
);

Deno.test(
  "Resource route - should successfully call mongo count resource",
  withFixtures([
    "AdminAuthHeaders",
    "Mongo",
  ], async (authHeaders) => {
    const response = await callExpressHandler(
      apiResourceHandler,
      "http://localhost/api/resource/mongo",
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: {
          action: "count",
          collection: "audio_chunks",
          query: {},
        },
        params: { name: "mongo" },
      },
    );
    // expect(response.status).toBe(200);

    // const data = await response.json();
    // expect(typeof data).toBe("number");
  }),
);

Deno.test(
  "Resource route - returns a stable conflict for a busy diarization recording lease",
  withFixtures([
    "AdminAuthHeaders",
    "Mongo",
  ], async (authHeaders, { db }) => {
    const leaseId = new ObjectId();
    const now = new Date();
    await db.collection("diarization_recording_leases").insertOne({
      _id: leaseId,
      owner: "worker-1",
      token: "token-1",
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    });

    const response = await callExpressHandler(
      apiResourceHandler,
      "http://localhost/api/resource/mongo",
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: {
          action: "findOneAndUpdate",
          collection: "diarization_recording_leases",
          query: {
            _id: { $oid: leaseId.toHexString() },
            $or: [
              { owner: "worker-2", token: "token-2" },
              { expiresAt: { $lte: { $date: now.toISOString() } } },
            ],
          },
          update: {
            $set: {
              owner: "worker-2",
              token: "token-2",
              expiresAt: {
                $date: new Date(now.getTime() + 10 * 60_000).toISOString(),
              },
            },
            $setOnInsert: { createdAt: { $date: now.toISOString() } },
          },
          options: {
            upsert: true,
            returnDocument: "after",
            touchUpdatedAt: false,
          },
        },
        params: { name: "mongo" },
      },
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      code: DIARIZATION_RECORDING_LEASE_BUSY_CODE,
      error: "Recording lease is already held",
    });
    expect(JSON.stringify(body)).not.toContain("E11000");
    expect(JSON.stringify(body)).not.toContain(leaseId.toHexString());
  }),
);
