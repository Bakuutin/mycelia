import { expect } from "@std/expect";
import {
  buildSummaryRerunPipeline,
  ReprocessModelArtifactsSchema,
} from "./summary-rerun.ts";

const range = {
  action: "reprocess_model_artifacts",
  artifactType: "summary",
  targetModel: "qwen-unc",
  start: "2026-08-24T00:00:00Z",
  end: "2026-08-31T00:00:00Z",
};

Deno.test("range reruns accept all models but reject unbounded and malformed selections", () => {
  expect(ReprocessModelArtifactsSchema.safeParse(range).success).toBe(true);
  for (
    const invalid of [
      { ...range, end: undefined },
      { ...range, end: range.start },
      { ...range, start: undefined, end: undefined },
      { ...range, artifactIds: [] },
      { ...range, artifactIds: ["invalid"] },
      { ...range, afterObjectId: "invalid" },
    ]
  ) {
    expect(ReprocessModelArtifactsSchema.safeParse(invalid).success).toBe(
      false,
    );
  }
});

Deno.test("source model and date bounds apply to the same summary; pagination follows conversation ids", () => {
  const input = ReprocessModelArtifactsSchema.parse({
    ...range,
    sourceModel: "old-model",
    limit: 100,
    afterObjectId: "000000000000000000000100",
  });
  const pipeline = buildSummaryRerunPipeline(input);
  const match = pipeline[0].$match as any;
  const conditions = match.$expr.$and[0].$anyElementTrue[0].$map.in.$and;
  expect(conditions[0].$eq[1]).toBe("old-model");
  expect(conditions[1]).toEqual({
    $gte: ["$$summary.date", new Date(range.start)],
  });
  expect(conditions[2]).toEqual({
    $lt: ["$$summary.date", new Date(range.end)],
  });
  expect(match._id.$gt.toString()).toBe(input.afterObjectId);
  expect(pipeline.slice(1)).toEqual([{ $sort: { _id: 1 } }, { $limit: 100 }, {
    $project: { _id: 1 },
  }]);
});
