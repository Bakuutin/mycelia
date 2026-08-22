import { expect } from "@std/expect";
import { ObjectId } from "bson";
import { withFixtures } from "@/tests/fixtures.server.ts";
import {
  DIARIZATOR_ADMISSION_DRAIN_LOCK_RESOURCE,
  DIARIZATOR_ROUTE_ENQUEUE_LOCK_RESOURCE,
  getQueue,
  persistAndAddJobRecord,
  reserveAndAddPersistedDiarizatorJob,
  reserveDiarizatorRouteAndCommit,
  withDiarizatorAdmissionDrainLock,
} from "./queue.ts";
import "./tests/fixtures.ts";

const route = (
  id: string,
  priority: number,
  concurrency = 1,
) => ({
  id,
  name: id,
  baseUrl: `http://${id}.example.test`,
  enabled: true,
  priority,
  concurrency,
});

function uniqueLockResource(): string {
  return `${DIARIZATOR_ROUTE_ENQUEUE_LOCK_RESOURCE}:${crypto.randomUUID()}`;
}

Deno.test(
  "diarizator admission drains are serialized across concurrent triggers",
  withFixtures(["JobQueue"], async () => {
    const lockResource =
      `${DIARIZATOR_ADMISSION_DRAIN_LOCK_RESOURCE}:${crypto.randomUUID()}`;
    let running = 0;
    let maximumRunning = 0;
    const drain = () =>
      withDiarizatorAdmissionDrainLock(async () => {
        running += 1;
        maximumRunning = Math.max(maximumRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running -= 1;
      }, lockResource);

    await Promise.all([drain(), drain(), drain()]);
    expect(maximumRunning).toBe(1);
  }),
);

Deno.test(
  "diarizator reservation serializes concurrent enqueues for one slot",
  withFixtures(["JobQueue"], async () => {
    const reservations: Record<string, number> = {};
    const options = {
      routes: [route("gpu-1", 10)],
      healthyIds: new Set(["gpu-1"]),
      commit: async (selected: ReturnType<typeof route>) => {
        await Promise.resolve();
        reservations[selected.id] = (reservations[selected.id] ?? 0) + 1;
        return selected.id;
      },
    };
    const dependencies = {
      lockResource: uniqueLockResource(),
      getLoad: async () => ({ ...reservations }),
    };

    const results = await Promise.allSettled([
      reserveDiarizatorRouteAndCommit(options, dependencies),
      reserveDiarizatorRouteAndCommit(options, dependencies),
    ]);

    expect(results.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected"))
      .toHaveLength(1);
    expect(reservations).toEqual({ "gpu-1": 1 });
  }),
);

Deno.test(
  "diarizator reservation fills distinct routes without overbooking",
  withFixtures(["JobQueue"], async () => {
    const reservations: Record<string, number> = {};
    const dependencies = {
      lockResource: uniqueLockResource(),
      getLoad: async () => ({ ...reservations }),
    };
    const reserve = () =>
      reserveDiarizatorRouteAndCommit({
        routes: [route("gpu-1", 10), route("gpu-2", 20)],
        healthyIds: new Set(["gpu-1", "gpu-2"]),
        commit: async (selected) => {
          reservations[selected.id] = (reservations[selected.id] ?? 0) + 1;
          return selected.id;
        },
      }, dependencies);

    const results = await Promise.allSettled([reserve(), reserve(), reserve()]);

    expect(results.filter((result) => result.status === "fulfilled"))
      .toHaveLength(2);
    expect(results.filter((result) => result.status === "rejected"))
      .toHaveLength(1);
    expect(reservations).toEqual({ "gpu-1": 1, "gpu-2": 1 });
  }),
);

Deno.test(
  "maintenance recovery races a normal reservation without overbooking",
  withFixtures(["JobQueue"], async () => {
    const reservations: Record<string, number> = {};
    const addedJobIds: string[] = [];
    const queue = {
      add: (
        _name: string,
        data: Record<string, any>,
        options: { jobId: string },
      ) => {
        const providerId = data.routingContext.providerProfileId;
        reservations[providerId] = (reservations[providerId] ?? 0) + 1;
        addedJobIds.push(options.jobId);
        return Promise.resolve({ id: options.jobId, data });
      },
      getJob: () => Promise.resolve(undefined),
    } as any;
    const dependencies = {
      lockResource: uniqueLockResource(),
      getLoad: async () => ({ ...reservations }),
    };
    const routes = [route("gpu-1", 10)];
    const healthyIds = new Set(["gpu-1"]);
    const normalJobId = new ObjectId().toString();
    const recoveryJobId = new ObjectId().toString();

    const normal = reserveDiarizatorRouteAndCommit({
      routes,
      healthyIds,
      commit: async (selected, _load, signal) =>
        await persistAndAddJobRecord({
          mongo: () => Promise.resolve({ insertedId: normalJobId }),
          queue,
          jobId: normalJobId,
          parsedData: {
            type: "diarization",
            routingContext: {
              providerProfileId: selected.id,
              resolvedAt: new Date().toISOString(),
            },
          },
          trigger: { type: "auto", principal: "test" },
          reservationSignal: signal,
          publishUpdate: () => Promise.resolve(),
        }),
    }, dependencies);
    const recovery = reserveAndAddPersistedDiarizatorJob({
      routes,
      healthyIds,
      queue,
      jobId: recoveryJobId,
      jobData: {
        type: "diarization",
        routingContext: {
          providerProfileId: "gpu-1",
          resolvedAt: "2026-08-18T00:00:00.000Z",
        },
      },
    }, dependencies);

    const results = await Promise.allSettled([normal, recovery]);

    expect(results.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected"))
      .toHaveLength(1);
    expect(reservations).toEqual({ "gpu-1": 1 });
    expect(addedJobIds).toHaveLength(1);
  }),
);

Deno.test(
  "maintenance recovery keeps the saved provider and requires it to be healthy",
  async () => {
    let addCalls = 0;
    await expect(reserveAndAddPersistedDiarizatorJob({
      routes: [route("gpu-1", 10), route("gpu-2", 20)],
      healthyIds: new Set(["gpu-2"]),
      queue: {
        add: () => {
          addCalls += 1;
          return Promise.resolve({});
        },
        getJob: () => Promise.resolve(undefined),
      } as any,
      jobId: new ObjectId().toString(),
      jobData: {
        type: "diarization",
        routingContext: {
          providerProfileId: "gpu-1",
          resolvedAt: "2026-08-18T00:00:00.000Z",
        },
      },
    })).rejects.toThrow("Saved diarizator provider gpu-1 is not healthy");
    expect(addCalls).toBe(0);
  },
);

Deno.test(
  "maintenance recovery preserves the stable job id and legacy payload",
  withFixtures(["JobQueue"], async () => {
    const jobId = new ObjectId().toString();
    const jobData = {
      type: "diarization",
      batchSize: 32,
      routingContext: {
        providerProfileId: "gpu-1",
        resolvedAt: "2026-08-18T00:00:00.000Z",
      },
    };
    let added: { data: Record<string, any>; jobId: string } | undefined;

    await reserveAndAddPersistedDiarizatorJob({
      routes: [route("gpu-1", 10)],
      healthyIds: new Set(["gpu-1"]),
      queue: {
        add: (_name: string, data: Record<string, any>, options: any) => {
          added = { data, jobId: options!.jobId! };
          return Promise.resolve({ id: options!.jobId, data });
        },
        getJob: () => Promise.resolve(undefined),
      } as any,
      jobId,
      jobData,
    }, {
      lockResource: uniqueLockResource(),
      getLoad: () => Promise.resolve({}),
    });

    expect(added?.jobId).toBe(jobId);
    expect(added?.data).toBe(jobData);
    expect(added?.data.maxSequenceChunks).toBeUndefined();
  }),
);

Deno.test(
  "diarizator reservation releases its lock when commit fails",
  withFixtures(["JobQueue"], async () => {
    const dependencies = {
      lockResource: uniqueLockResource(),
      getLoad: async () => ({}),
    };
    const input = {
      routes: [route("gpu-1", 10)],
      healthyIds: new Set(["gpu-1"]),
    };

    await expect(reserveDiarizatorRouteAndCommit({
      ...input,
      commit: () => Promise.reject(new Error("commit failed")),
    }, dependencies)).rejects.toThrow("commit failed");

    await expect(reserveDiarizatorRouteAndCommit({
      ...input,
      commit: async (selected) => selected.id,
    }, dependencies)).resolves.toBe("gpu-1");
  }),
);

Deno.test(
  "diarizator reservation counts jobs from every routed queue",
  withFixtures(["JobQueue"], async () => {
    const providerId = `gpu-cross-queue-${crypto.randomUUID()}`;
    const jobId = new ObjectId().toString();
    const enrollmentQueue = getQueue("enrollment");
    await enrollmentQueue.add("enrollment", {
      type: "enrollment",
      routingContext: {
        providerProfileId: providerId,
        resolvedAt: new Date().toISOString(),
      },
    }, { jobId });

    try {
      await expect(reserveDiarizatorRouteAndCommit({
        routes: [route(providerId, 10)],
        healthyIds: new Set([providerId]),
        commit: async () => "unexpected",
      }, {
        lockResource: uniqueLockResource(),
      })).rejects.toThrow(
        "All healthy diarizator provider concurrency slots are reserved",
      );
    } finally {
      await enrollmentQueue.remove(jobId);
    }
  }),
);

function fakeMongoStore() {
  let doc: Record<string, any> | undefined;
  const mongo = async (request: Record<string, any>) => {
    if (request.action === "insertOne") {
      doc = request.doc;
      return { insertedId: request.doc._id };
    }
    if (request.action === "updateOne" && doc) {
      Object.assign(doc, request.update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    }
    throw new Error(`Unexpected Mongo operation: ${request.action}`);
  };
  return { mongo, getDoc: () => doc };
}

Deno.test("failed BullMQ add immediately fails its Mongo job record", async () => {
  const store = fakeMongoStore();
  const jobId = new ObjectId().toString();
  const addError = new Error("redis write failed");

  await expect(persistAndAddJobRecord({
    mongo: store.mongo,
    queue: {
      add: () => Promise.reject(addError),
      getJob: () => Promise.resolve(undefined),
    } as any,
    jobId,
    parsedData: { type: "diarization" },
    trigger: { type: "auto", principal: "test" },
    publishUpdate: () => Promise.resolve(),
  })).rejects.toThrow("redis write failed");

  expect(store.getDoc()).toMatchObject({
    state: "failed",
    failedReason: "queue_enqueue_failed: redis write failed",
  });
  expect(store.getDoc()?.finishedAt).toBeInstanceOf(Date);
});

Deno.test("Mongo insert failure cannot create a BullMQ job", async () => {
  let addCalls = 0;
  await expect(persistAndAddJobRecord({
    mongo: () => Promise.reject(new Error("mongo insert failed")),
    queue: {
      add: () => {
        addCalls += 1;
        return Promise.resolve({});
      },
      getJob: () => Promise.resolve(undefined),
    } as any,
    jobId: new ObjectId().toString(),
    parsedData: { type: "diarization" },
    trigger: { type: "auto", principal: "test" },
    publishUpdate: () => Promise.resolve(),
  })).rejects.toThrow("mongo insert failed");

  expect(addCalls).toBe(0);
});

Deno.test(
  "an aborted route reservation compensates Mongo before BullMQ add",
  async () => {
    const store = fakeMongoStore();
    const controller = new AbortController();
    let addCalls = 0;
    const mongo = async (request: Record<string, any>) => {
      const result = await store.mongo(request);
      if (request.action === "insertOne") {
        controller.abort(new Error("route lease expired"));
      }
      return result;
    };

    await expect(persistAndAddJobRecord({
      mongo,
      queue: {
        add: () => {
          addCalls += 1;
          return Promise.resolve({});
        },
        getJob: () => Promise.resolve(undefined),
      } as any,
      jobId: new ObjectId().toString(),
      parsedData: { type: "diarization" },
      trigger: { type: "auto", principal: "test" },
      reservationSignal: controller.signal,
      publishUpdate: () => Promise.resolve(),
    })).rejects.toThrow("Diarizator route reservation is temporarily busy");

    expect(addCalls).toBe(0);
    expect(store.getDoc()).toMatchObject({
      state: "failed",
      failedReason:
        "queue_reservation_aborted: Diarizator route reservation is temporarily busy",
    });
  },
);

Deno.test(
  "an ambiguous add with unavailable reconciliation keeps Mongo waiting",
  async () => {
    const store = fakeMongoStore();
    const addError = new Error("connection reset after write");

    await expect(persistAndAddJobRecord({
      mongo: store.mongo,
      queue: {
        add: () => Promise.reject(addError),
        getJob: () => Promise.reject(new Error("redis unavailable")),
      } as any,
      jobId: new ObjectId().toString(),
      parsedData: { type: "diarization" },
      trigger: { type: "auto", principal: "test" },
      publishUpdate: () => Promise.resolve(),
    })).rejects.toThrow("connection reset after write");

    expect(store.getDoc()).toMatchObject({ state: "waiting" });
    expect(store.getDoc()?.failedReason).toBeUndefined();
    expect(store.getDoc()?.finishedAt).toBeUndefined();
  },
);

Deno.test("ambiguous BullMQ add reuses the exact accepted job", async () => {
  const store = fakeMongoStore();
  const jobId = new ObjectId().toString();
  const existing = {
    id: jobId,
    data: {
      type: "diarization",
      routingContext: {
        providerProfileId: "gpu-1",
        resolvedAt: "2026-08-18T00:00:00.000Z",
      },
    },
  };

  const job = await persistAndAddJobRecord({
    mongo: store.mongo,
    queue: {
      add: () => Promise.reject(new Error("connection reset after write")),
      getJob: () => Promise.resolve(existing),
    } as any,
    jobId,
    parsedData: existing.data,
    trigger: { type: "auto", principal: "test" },
    publishUpdate: () => Promise.resolve(),
  });

  expect(job).toBe(existing);
  expect(store.getDoc()?.state).toBe("waiting");
});
