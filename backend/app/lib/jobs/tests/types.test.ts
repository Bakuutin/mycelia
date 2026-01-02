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
  "jobRegistry validates VAD job data via schema",
  withFixtures(["JobWorkers"], () => {
    const vadCapability = jobRegistry.get("vad");
    expect(vadCapability).toBeDefined();

    const validData = {
      type: "vad",
      limit: 500,
    };

    const result = vadCapability!.schema.parse(validData);
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
