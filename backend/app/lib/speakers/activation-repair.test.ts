import { expect } from "@std/expect";
import {
  type ActivationRun,
  buildEmptyActivationRepairPlan,
  collectReplacementRunIds,
  evaluateActivationSafety,
  evaluateEmptyActivationRepair,
  explainGenerationState,
  previewActivationSafety,
} from "./activation-repair.ts";

const RANGE = {
  start: new Date("2026-08-01T00:00:00.000Z"),
  end: new Date("2026-08-02T00:00:00.000Z"),
};

function run(
  overrides: Partial<ActivationRun> = {},
): ActivationRun {
  return {
    runId: "generation-8",
    status: "ready",
    range: RANGE,
    ...overrides,
  };
}

Deno.test("activation preview blocks an empty run from removing active coverage", () => {
  const preview = evaluateActivationSafety({
    run: run(),
    counts: {
      targetSegments: 0,
      targetSegmentsInRange: 0,
      targetActiveSegmentsInRange: 0,
      replacedActiveSegments: 137,
    },
    replacementRunIds: ["legacy-v0"],
  });

  expect(preview.allowed).toBe(false);
  expect(preview.destructive).toBe(true);
  expect(preview.blockers).toContain(
    "empty_target_would_remove_active_coverage",
  );
  expect(preview.summary).toContain("137 active segments");
});

Deno.test("activation server preview uses bounded predicates and exact counts", async () => {
  const queries: Record<string, unknown>[] = [];
  const preview = await previewActivationSafety(run(), {
    countSegments: (query) => {
      queries.push(query);
      if ((query.runId as { $ne?: string })?.$ne) return Promise.resolve(18);
      if (query.lifecycleStatus === "active") return Promise.resolve(0);
      if (query.start) return Promise.resolve(12);
      return Promise.resolve(12);
    },
    distinctSegmentRunIds: (query) => {
      queries.push(query);
      return Promise.resolve(["legacy-v0"]);
    },
  });

  expect(preview.allowed).toBe(true);
  expect(preview.counts).toEqual({
    targetSegments: 12,
    targetSegmentsInRange: 12,
    targetActiveSegmentsInRange: 0,
    replacedActiveSegments: 18,
  });
  expect(queries).toContainEqual({
    runId: { $ne: "generation-8" },
    lifecycleStatus: "active",
    start: { $lt: RANGE.end },
    end: { $gt: RANGE.start },
  });
});

Deno.test("repair predecessor discovery accepts only persisted provenance", () => {
  expect(collectReplacementRunIds(
    { runId: "generation-8", replacesRunId: "legacy-v0" },
    [
      { runId: "generation-6", supersededBy: "some-other-run" },
      { runId: "generation-7", supersededBy: "generation-8" },
      {
        runId: "partial-run",
        partialSupersessions: [{ runId: "generation-8" }],
      },
    ],
  )).toEqual(["generation-7", "legacy-v0", "partial-run"]);
});

Deno.test("empty activation repair plan restores coverage before failing the target", () => {
  const activatedAt = new Date("2026-08-21T10:00:00.000Z");
  const preview = evaluateEmptyActivationRepair({
    run: run({ status: "active", activatedAt }),
    replacementRunIds: ["legacy-v0"],
    counts: {
      targetSegments: 0,
      targetActiveSegments: 0,
      recoverableSupersededSegments: 137,
      alreadyActiveReplacementSegments: 4,
      competingActiveSegments: 0,
      fullySupersededRunDocuments: 1,
      partialSupersessionRunDocuments: 0,
    },
  });
  const now = new Date("2026-08-21T10:05:00.000Z");
  const plan = buildEmptyActivationRepairPlan(preview, now);

  expect(preview.repairable).toBe(true);
  expect(plan.operations.map((operation) => operation.key)).toEqual([
    "claim_empty_activation",
    "restore_segments",
    "restore_fully_superseded_runs",
    "clear_partial_supersessions",
    "complete_empty_activation_repair",
  ]);
  expect(plan.operations[1]).toMatchObject({
    collection: "diarizations",
    action: "updateMany",
    expectedMatches: 137,
    query: {
      runId: { $in: ["legacy-v0"] },
      lifecycleStatus: "superseded",
    },
  });
  expect(plan.operations[4].query).toMatchObject({
    runId: "generation-8",
    status: "active",
    activatedAt,
    "activationRepair.repairId": plan.repairId,
    "activationRepair.state": "repairing",
  });
});

Deno.test("repair can resume after segments were already restored", () => {
  const preview = evaluateEmptyActivationRepair({
    run: run({
      status: "active",
      activatedAt: new Date("2026-08-21T10:00:00.000Z"),
    }),
    replacementRunIds: ["legacy-v0"],
    counts: {
      targetSegments: 0,
      targetActiveSegments: 0,
      recoverableSupersededSegments: 0,
      alreadyActiveReplacementSegments: 141,
      competingActiveSegments: 0,
      fullySupersededRunDocuments: 0,
      partialSupersessionRunDocuments: 0,
    },
  });
  const plan = buildEmptyActivationRepairPlan(preview);

  expect(preview.repairable).toBe(true);
  expect(plan.operations[1].expectedMatches).toBe(0);
  expect(plan.operations.at(-1)?.key).toBe(
    "complete_empty_activation_repair",
  );
});

Deno.test("repair refuses a target that acquired any segments", () => {
  const preview = evaluateEmptyActivationRepair({
    run: run({
      status: "active",
      activatedAt: new Date("2026-08-21T10:00:00.000Z"),
    }),
    replacementRunIds: ["legacy-v0"],
    counts: {
      targetSegments: 1,
      targetActiveSegments: 0,
      recoverableSupersededSegments: 137,
      alreadyActiveReplacementSegments: 0,
      competingActiveSegments: 0,
      fullySupersededRunDocuments: 1,
      partialSupersessionRunDocuments: 0,
    },
  });

  expect(preview.repairable).toBe(false);
  expect(preview.blockers).toContain("target_run_not_empty");
  expect(() => buildEmptyActivationRepairPlan(preview)).toThrow();
});

Deno.test("repair refuses to resurrect coverage over a newer active generation", () => {
  const preview = evaluateEmptyActivationRepair({
    run: run({
      status: "active",
      activatedAt: new Date("2026-08-21T10:00:00.000Z"),
    }),
    replacementRunIds: ["legacy-v0"],
    counts: {
      targetSegments: 0,
      targetActiveSegments: 0,
      recoverableSupersededSegments: 137,
      alreadyActiveReplacementSegments: 0,
      competingActiveSegments: 8,
      fullySupersededRunDocuments: 1,
      partialSupersessionRunDocuments: 0,
    },
  });

  expect(preview.repairable).toBe(false);
  expect(preview.blockers).toContain("newer_active_coverage_present");
});

Deno.test("generation explanations distinguish stale and repairable empty runs", () => {
  expect(explainGenerationState({
    run: run({
      status: "building",
      createdAt: new Date("2026-08-21T09:00:00.000Z"),
    }),
    campaigns: [],
    now: new Date("2026-08-21T10:00:00.000Z"),
  })).toMatchObject({
    code: "interrupted",
    observedStatus: "interrupted",
    canActivate: false,
  });

  expect(explainGenerationState({
    run: run({ status: "active" }),
    segmentCount: 0,
    activeSegmentCount: 0,
    recoverableSupersededSegments: 137,
  })).toMatchObject({
    code: "active_empty_repairable",
    severity: "error",
    canRepair: true,
  });
});
