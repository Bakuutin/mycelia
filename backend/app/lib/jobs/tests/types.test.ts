import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { jobRegistry } from "../job-registry.ts";
import "./fixtures.ts";

Deno.test(
  "jobRegistry discovers job types dynamically",
  withFixtures(["JobWorkers"], () => {
    const types = jobRegistry.getJobTypes();

    // Should have discovered some job types
    expect(types.length).toBeGreaterThan(0);

    // Should include known job types
    expect(types).toContain("vad");
    expect(types).toContain("summarization");
    expect(types).toContain("histRecalculation");
  }),
);

Deno.test(
  "every event or interval worker declares a pending-work preflight",
  withFixtures(["JobWorkers"], async () => {
    await jobRegistry.loadAllImplementations();
    const automaticWorkers = jobRegistry.list().filter((worker) =>
      (worker.triggers?.sources?.length ?? 0) > 0 ||
      (worker.triggers?.interval ?? 0) > 0
    );
    const missing = automaticWorkers
      .filter((worker) => typeof worker.hasPendingWork !== "function")
      .map((worker) => worker.manifest.name);

    expect(missing).toEqual([]);
  }),
);

Deno.test(
  "jobRegistry validates VAD job data via schema",
  withFixtures(["JobWorkers"], () => {
    const vadCapability = jobRegistry.get("vad");
    expect(vadCapability).toBeDefined();

    const validData = {
      type: "vad",
      limit: 500,
    };

    const result = jobRegistry.validateJobData(validData);
    expect(result.type).toBe("vad");
    expect((result as any).limit).toBe(500);
  }),
);

Deno.test(
  "jobRegistry.validateJobData validates and parses job data",
  withFixtures(["JobWorkers"], () => {
    const vadData = {
      type: "vad",
      limit: 500,
    };

    const result = jobRegistry.validateJobData(vadData);
    expect(result.type).toBe("vad");
  }),
);

Deno.test(
  "jobRegistry preserves the reserved routing snapshot",
  withFixtures(["JobWorkers"], () => {
    const result = jobRegistry.validateJobData({
      type: "vad",
      limit: 500,
      routingContext: {
        presetId: "future-source-preset",
        providerProfileId: "llm-primary",
        resolvedAt: "2026-08-02T00:00:00.000Z",
      },
    });

    expect(result.routingContext).toEqual({
      presetId: "future-source-preset",
      providerProfileId: "llm-primary",
      resolvedAt: "2026-08-02T00:00:00.000Z",
    });
  }),
);

Deno.test(
  "jobRegistry.validateJobData materializes schema defaults, including enums",
  withFixtures(["JobWorkers"], () => {
    // Workers cast job.data without re-parsing, so enqueue-time validation
    // must fill every schema default. Enum defaults are the regression case:
    // the toJSONSchema/fromJSONSchema round-trip does not apply them.
    const result = jobRegistry.validateJobData({
      type: "summarization",
    }) as Record<string, unknown>;

    expect(result.reasoning).toBe("off"); // enum default
    expect(result.maxTokens).toBe(8192); // number default
    expect(result.retryNow).toBe(false); // boolean default
  }),
);

Deno.test(
  "jobRegistry.validateJobData keeps explicit values over defaults",
  withFixtures(["JobWorkers"], () => {
    const result = jobRegistry.validateJobData({
      type: "summarization",
      reasoning: "default",
      maxTokens: 512,
    }) as Record<string, unknown>;

    expect(result.reasoning).toBe("default");
    expect(result.maxTokens).toBe(512);
  }),
);

Deno.test(
  "jobRegistry.validateJobData rejects unknown fields",
  withFixtures(["JobWorkers"], () => {
    // io:"input" manifests drop additionalProperties:false, so the registry
    // enforces unknown-field rejection itself — typos must not be silently
    // stripped into a job that ignores them.
    expect(() =>
      jobRegistry.validateJobData({
        type: "summarization",
        bogusOption: true,
      })
    ).toThrow(/Unknown field/);
  }),
);

Deno.test(
  "jobRegistry.validateJobData throws for unknown type",
  withFixtures(["JobWorkers"], () => {
    const invalidData = {
      type: "unknown_type",
      limit: 100,
    };

    expect(() => jobRegistry.validateJobData(invalidData)).toThrow();
  }),
);

Deno.test(
  "jobRegistry.validateJobData throws for missing type",
  withFixtures(["JobWorkers"], () => {
    const noType = {
      limit: 100,
    };

    expect(() => jobRegistry.validateJobData(noType)).toThrow();
  }),
);
