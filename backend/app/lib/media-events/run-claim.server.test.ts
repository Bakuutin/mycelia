import { assertEquals } from "jsr:@std/assert@^1.0.15";
import { withFixtures } from "@/tests/fixtures.server.ts";
import {
  claimMediaEventRun,
  markMediaEventRunOutcomeUnknown,
  markMediaEventRunProviderStarted,
  markMediaEventRunReady,
} from "./run-claim.server.ts";

Deno.test(
  "media event run permits one provider call and recovers ready without repeating",
  withFixtures(["Mongo"], async ({ db }) => {
    const first = await claimMediaEventRun(db, {
      runId: "event-run-ready",
      jobId: "job-one",
      initial: { eventId: "event-one" },
    }, { claimId: "claim-one" });
    assertEquals(first.kind, "claimed");
    if (first.kind !== "claimed") return;
    await markMediaEventRunProviderStarted(db, first.claim);
    await markMediaEventRunReady(db, first.claim, {
      analysis: { title: "Ready event" },
    });

    const recovered = await claimMediaEventRun(db, {
      runId: "event-run-ready",
      jobId: "job-two",
      initial: { eventId: "event-one" },
    });
    assertEquals(recovered.kind, "ready");
  }),
);

Deno.test(
  "media event provider outcome unknown is never reclaimed automatically",
  withFixtures(["Mongo"], async ({ db }) => {
    const first = await claimMediaEventRun(db, {
      runId: "event-run-unknown",
      jobId: "job-one",
      initial: { eventId: "event-two" },
    }, { claimId: "claim-unknown", leaseMs: 1_000 });
    assertEquals(first.kind, "claimed");
    if (first.kind !== "claimed") return;
    await markMediaEventRunProviderStarted(db, first.claim);
    await markMediaEventRunOutcomeUnknown(
      db,
      first.claim,
      "provider result unknown",
    );

    const repeated = await claimMediaEventRun(db, {
      runId: "event-run-unknown",
      jobId: "job-two",
      initial: { eventId: "event-two" },
    });
    assertEquals(repeated.kind, "busy");
    if (repeated.kind === "busy") {
      assertEquals(repeated.reason, "provider_outcome_unknown");
    }
  }),
);
