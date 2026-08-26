import { expect } from "@std/expect";
import { ObjectId } from "bson";
import type { Auth } from "@/lib/auth/core.server.ts";
import { DOMAIN_MANAGED_MEDIA_JOB_TYPES } from "@/lib/jobs/job-action-policy.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import "./fixtures.ts";

Deno.test(
  "Jobs cancel and clear_queue reject domain media without changing Mongo",
  withFixtures(["Admin", "Mongo", "JobsResource"], async (
    admin: Auth,
    mongo,
  ) => {
    const jobs = admin.getResource("jobs");

    for (const workerType of DOMAIN_MANAGED_MEDIA_JOB_TYPES) {
      const cancelId = new ObjectId();
      const clearId = new ObjectId();
      await mongo.db.collection("jobs").insertMany([
        {
          _id: cancelId,
          type: workerType,
          state: "waiting",
          data: { type: workerType },
          createdAt: new Date(),
        },
        {
          _id: clearId,
          type: workerType,
          state: "delayed",
          data: { type: workerType },
          createdAt: new Date(),
        },
      ]);

      await expect(jobs({
        action: "cancel",
        id: cancelId.toString(),
      })).rejects.toThrow("domain-managed media campaign");
      await expect(jobs({
        action: "clear_queue",
        workerType,
      })).rejects.toThrow("domain-managed media campaign");

      const stored = await mongo.db.collection("jobs").find({
        _id: { $in: [cancelId, clearId] },
      }).sort({ state: 1 }).toArray();
      expect(stored.map((job: { state: string }) => job.state)).toEqual([
        "delayed",
        "waiting",
      ]);
      expect(
        stored.every((job: Record<string, unknown>) =>
          job.cancelReason === undefined && job.finishedAt === undefined
        ),
      ).toBe(true);
    }
  }),
);
