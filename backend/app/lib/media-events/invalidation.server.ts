import { createHash, randomUUID } from "node:crypto";
import { type Db, ObjectId } from "mongodb";
import {
  finishGcpBudget,
  type GcpBudgetExecutionClaim,
  reconcileReadyGcpBudget,
  releaseUnstartedGcpBudgetAttempt,
} from "@/lib/media/gcp-budget.server.ts";

function objectId(value: ObjectId | string): ObjectId {
  return value instanceof ObjectId ? value : new ObjectId(value);
}

function eventObjectId(owner: string, eventId: ObjectId): ObjectId {
  return new ObjectId(
    createHash("sha256").update(
      ["media-event-object-v1", owner, String(eventId)].join("\0"),
    ).digest("hex").slice(0, 24),
  );
}

function membershipId(owner: string, assetId: ObjectId): ObjectId {
  return new ObjectId(
    createHash("sha256").update(
      ["media-event-membership-v1", owner, String(assetId)].join("\0"),
    ).digest("hex").slice(0, 24),
  );
}

function safeReason(reason: string): string {
  return reason.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 900);
}

/** Atomically prevents a concurrent event confirmation from claiming an asset. */
export async function fenceMediaAssetDerivedDeletion(
  db: Db,
  owner: string,
  assetIdValue: ObjectId | string,
) {
  const assetId = objectId(assetIdValue);
  const now = new Date();
  const memberships = db.collection<any>("media_event_memberships");
  const id = membershipId(owner, assetId);
  const previous = await memberships.findOne({ _id: id, owner, assetId });
  const deletionFenceId = previous?.status === "deleting" &&
      previous.deletionFenceId
    ? String(previous.deletionFenceId)
    : randomUUID();
  let fencedEventId: ObjectId | undefined;
  if (previous?.eventId) {
    const eventId = objectId(previous.eventId);
    const currentEvent = await db.collection<any>("media_events").findOne({
      _id: eventId,
      owner,
      status: { $ne: "stale" },
    }, { projection: { _id: 1, providerDeletionPending: 1 } });
    if (currentEvent) {
      if (currentEvent.providerDeletionPending?.id === deletionFenceId) {
        fencedEventId = eventId;
      } else {
        const fenced = await db.collection("media_events").updateOne(
          {
            _id: eventId,
            owner,
            status: { $ne: "stale" },
            providerDeletionPending: { $exists: false },
            $or: [
              { providerCallPermit: { $exists: false } },
              { "providerCallPermit.leaseExpiresAt": { $lte: now } },
            ],
          },
          {
            $set: {
              providerDeletionPending: {
                id: deletionFenceId,
                assetId,
                startedAt: now,
              },
              updatedAt: now,
            },
            $unset: { providerCallPermit: "" },
          },
        );
        if (fenced.modifiedCount !== 1) {
          throw new Error(
            "Media event analysis is currently calling its provider; retry deletion after it finishes",
          );
        }
        fencedEventId = eventId;
      }
    }
  }
  try {
    if (previous) {
      const reserved = await memberships.updateOne(
        {
          _id: id,
          owner,
          assetId,
          eventId: previous.eventId,
          status: previous.status,
          ...(previous.receiptId ? { receiptId: previous.receiptId } : {}),
        },
        {
          $set: {
            status: "deleting",
            deletionFenceId,
            updatedAt: now,
          },
        },
      );
      if (reserved.modifiedCount !== 1) {
        throw new Error("Could not acquire the derived-media deletion fence");
      }
    } else {
      await memberships.insertOne({
        _id: id,
        owner,
        assetId,
        status: "deleting",
        deletionFenceId,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (error) {
    if (fencedEventId) {
      await db.collection("media_events").updateOne(
        {
          _id: fencedEventId,
          owner,
          "providerDeletionPending.id": deletionFenceId,
        },
        { $unset: { providerDeletionPending: "" } },
      ).catch(() => {});
    }
    throw error;
  }
  return { deletionFenceId };
}

/**
 * Fences all events which depended on an asset before its derived previews are
 * removed. The helper deliberately has no import from the media resource so
 * deleteDerived can call it without creating a circular module dependency.
 */
export async function invalidateMediaEventsForAsset(
  db: Db,
  owner: string,
  assetIdValue: ObjectId | string,
  reason = "A derived media preview used by this event was removed",
) {
  const assetId = objectId(assetIdValue);
  const membership = await db.collection<any>("media_event_memberships")
    .findOne({
      _id: membershipId(owner, assetId),
      owner,
      assetId,
      status: "deleting",
    });
  if (!membership?.deletionFenceId) {
    throw new Error("Derived-media invalidation requires a deletion fence");
  }
  const deletionFenceId = String(membership.deletionFenceId);
  const events = await db.collection<any>("media_events").find({
    owner,
    assetIds: assetId,
    status: { $ne: "stale" },
  }, {
    projection: {
      _id: 1,
      objectId: 1,
      deletionGeneration: 1,
      providerDeletionPending: 1,
    },
  }).toArray();
  if (!events.length) {
    await db.collection("media_event_memberships").updateOne(
      { _id: membershipId(owner, assetId), owner, assetId },
      {
        $set: {
          status: "deleted",
          invalidatedAt: new Date(),
          invalidationReason: safeReason(reason),
          updatedAt: new Date(),
        },
      },
    );
    return { invalidatedEvents: 0 };
  }
  const eventIds = events.map((event) => objectId(event._id));
  const now = new Date();
  let invalidatedEvents = 0;
  for (const event of events) {
    if (event.providerDeletionPending?.id !== deletionFenceId) {
      const fenced = await db.collection("media_events").updateOne(
        {
          _id: event._id,
          owner,
          status: { $ne: "stale" },
          providerDeletionPending: { $exists: false },
          $or: [
            { providerCallPermit: { $exists: false } },
            { "providerCallPermit.leaseExpiresAt": { $lte: now } },
          ],
        },
        {
          $set: {
            providerDeletionPending: {
              id: deletionFenceId,
              assetId,
              startedAt: now,
            },
            updatedAt: now,
          },
          $unset: { providerCallPermit: "" },
        },
      );
      if (fenced.modifiedCount !== 1) {
        throw new Error(
          "Media event provider execution must finish before derived deletion",
        );
      }
    }
    const tombstoneId = createHash("sha256").update(
      ["media-event-deletion-v1", owner, String(event._id), deletionFenceId]
        .join("\0"),
    ).digest("hex");
    const invalidated = await db.collection("media_events").updateOne(
      {
        _id: event._id,
        owner,
        status: { $ne: "stale" },
        "providerDeletionPending.id": deletionFenceId,
      },
      {
        $set: {
          status: "stale",
          safeError: safeReason(reason),
          deletionTombstoneId: tombstoneId,
          updatedAt: now,
        },
        $inc: { deletionGeneration: 1 },
        $unset: {
          analysis: "",
          currentRunId: "",
          previewSnapshots: "",
          jobId: "",
          publicationClaimId: "",
          publicationLeaseExpiresAt: "",
          providerCallPermit: "",
        },
      },
    );
    if (invalidated.modifiedCount !== 1) {
      throw new Error("Media event deletion generation fence was lost");
    }
    event.deletionGeneration = Number(event.deletionGeneration ?? 0) + 1;
    event.deletionTombstoneId = tombstoneId;
    invalidatedEvents++;
  }
  const runs = await db.collection<any>("media_event_runs").find({
    owner,
    eventId: { $in: eventIds },
  }).toArray();
  for (const run of runs) {
    const usesGoogle = run.providerSnapshot?.providerType === "google-cloud" ||
      run.provenance?.providerType === "google-cloud" ||
      run.usage?.service === "google-cloud";
    if (run.state === "ready") {
      let settlementError: unknown;
      if (usesGoogle) {
        try {
          await reconcileReadyGcpBudget(db, run.attemptId);
        } catch (error) {
          settlementError = error;
        }
      }
      await db.collection("media_event_runs").updateOne(
        { _id: run._id, state: "ready" },
        {
          $set: {
            invalidatedAt: now,
            invalidationReason: safeReason(reason),
            ...(!usesGoogle
              ? { budgetSettlementState: "not_applicable" }
              : settlementError
              ? {
                settlementPending: {
                  target: "committed",
                  requestedAt: now,
                  attempts: Number(run.settlementPending?.attempts ?? 0) + 1,
                  lastError: safeReason(String(settlementError)),
                },
              }
              : { budgetSettlementState: "committed" }),
            updatedAt: now,
          },
          $unset: {
            analysis: "",
            ...(!settlementError ? { settlementPending: "" } : {}),
          },
        },
      );
      continue;
    }
    if (run.state === "building" && run.executionClaim?.id) {
      const budget = run.attemptId
        ? await db.collection<any>("gcp_usage_events").findOne({
          attemptId: run.attemptId,
        })
        : null;
      const executionState = budget?.execution?.state;
      const outcomeUnknown = run.executionClaim.phase === "started" ||
        executionState === "started";
      const settlementTarget = outcomeUnknown ? "unknown" : "released";
      let settlementError: unknown;
      if (usesGoogle) {
        try {
          if (settlementTarget === "released") {
            await releaseUnstartedGcpBudgetAttempt(db, run.attemptId, now);
          } else if (
            budget?.state === "reserved" || budget?.state === "settling"
          ) {
            if (!budget.execution?.id) {
              throw new Error("GCP budget execution marker is missing");
            }
            const budgetClaim: GcpBudgetExecutionClaim = {
              attemptId: run.attemptId,
              executionId: budget.execution.id,
              leaseExpiresAt: budget.execution.leaseExpiresAt ?? now,
            };
            await finishGcpBudget(db, budgetClaim, "unknown");
          } else if (
            budget && !["unknown", "committed"].includes(budget.state)
          ) {
            throw new Error(
              `GCP budget settlement is not terminal (${budget.state})`,
            );
          }
        } catch (error) {
          settlementError = error;
        }
      }
      if (settlementError) {
        await db.collection("media_event_runs").updateOne(
          {
            _id: run._id,
            state: "building",
            "executionClaim.id": run.executionClaim.id,
          },
          {
            $set: {
              settlementPending: {
                target: settlementTarget,
                requestedAt: now,
                attempts: Number(run.settlementPending?.attempts ?? 0) + 1,
                lastError: safeReason(String(settlementError)),
              },
              safeError: safeReason(reason),
              invalidatedAt: now,
              invalidationReason: safeReason(reason),
              updatedAt: now,
            },
            $unset: { analysis: "" },
          },
        );
        continue;
      }
      await db.collection("media_event_runs").updateOne(
        {
          _id: run._id,
          state: "building",
          "executionClaim.id": run.executionClaim.id,
        },
        {
          $set: {
            state: outcomeUnknown ? "provider_outcome_unknown" : "failed",
            safeError: safeReason(reason),
            invalidatedAt: now,
            invalidationReason: safeReason(reason),
            budgetSettlementState: settlementTarget,
            updatedAt: now,
          },
          $unset: {
            analysis: "",
            settlementPending: "",
            ...(outcomeUnknown ? {} : { executionClaim: "" }),
          },
        },
      );
      continue;
    }
    await db.collection("media_event_runs").updateOne(
      { _id: run._id },
      {
        $set: {
          invalidatedAt: now,
          invalidationReason: safeReason(reason),
          updatedAt: now,
        },
        $unset: { analysis: "" },
      },
    );
  }
  await Promise.all([
    db.collection("media_event_links").deleteMany({
      owner,
      eventId: { $in: eventIds },
    }),
    db.collection("media_event_memberships").deleteMany({
      owner,
      eventId: { $in: eventIds },
      assetId: { $ne: assetId },
    }),
    db.collection("media_event_analysis_previews").deleteMany({
      owner,
      eventId: { $in: eventIds },
    }),
    db.collection("media_event_publication_claims").updateMany(
      { _id: { $in: eventIds }, owner },
      { $set: { state: "invalidated", updatedAt: now } },
    ),
  ]);
  await db.collection("media_event_memberships").updateOne(
    { _id: membershipId(owner, assetId), owner, assetId },
    {
      $set: {
        status: "deleted",
        invalidatedAt: now,
        invalidationReason: safeReason(reason),
        updatedAt: now,
      },
    },
  );
  const publishedIds = events.flatMap((event) =>
    event.objectId ? [objectId(event.objectId)] : []
  );
  const deterministicIds = eventIds.map((eventId) =>
    eventObjectId(owner, eventId)
  );
  const objects = await db.collection<any>("objects").find({
    _id: { $in: [...publishedIds, ...deterministicIds] },
  }).toArray();
  for (const initial of objects) {
    const sourceEvent = events.find((event) =>
      String(event._id) ===
        String(initial.metadata?.mediaEvent?.eventId ?? "") ||
      String(eventObjectId(owner, objectId(event._id))) === String(initial._id)
    );
    if (!sourceEvent) continue;
    let object = initial;
    let staled = object.metadata?.mediaEvent?.stale === true &&
      Number(object.metadata?.mediaEvent?.deletionGeneration ?? -1) ===
        Number(sourceEvent.deletionGeneration);
    for (let attempt = 0; attempt < 5 && !staled; attempt++) {
      const version = Number(object.version ?? 0);
      const updated = await db.collection("objects").updateOne(
        {
          _id: object._id,
          ...(object.version === undefined
            ? { version: { $exists: false } }
            : { version }),
        },
        {
          $set: {
            "metadata.mediaEvent.stale": true,
            "metadata.mediaEvent.staleReason": safeReason(reason),
            "metadata.mediaEvent.publicationState": "invalidated",
            "metadata.mediaEvent.deletionGeneration":
              sourceEvent.deletionGeneration,
            "metadata.mediaEvent.deletionTombstoneId":
              sourceEvent.deletionTombstoneId,
            isEvent: false,
            _listCategories: [],
            updatedAt: now,
          },
          $inc: { version: 1 },
        },
      );
      if (updated.modifiedCount === 1) {
        staled = true;
        await db.collection("object_history").insertOne({
          objectId: object._id,
          action: "update",
          timestamp: now,
          userId: owner,
          version: version + 1,
          field: "metadata.mediaEvent.stale",
          oldValue: object.metadata?.mediaEvent?.stale,
          newValue: true,
        }).catch(() => {});
        break;
      }
      object = await db.collection<any>("objects").findOne({
        _id: object._id,
      });
      if (!object) {
        staled = true;
        break;
      }
      staled = object.metadata?.mediaEvent?.stale === true &&
        Number(object.metadata?.mediaEvent?.deletionGeneration ?? -1) ===
          Number(sourceEvent.deletionGeneration);
    }
    if (!staled) {
      throw new Error(
        "Published media event Object changed repeatedly during invalidation",
      );
    }
  }
  return { invalidatedEvents };
}
