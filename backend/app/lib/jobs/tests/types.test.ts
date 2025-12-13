import { expect } from "@std/expect";
import { VadJobDataSchema, JobDataSchema, JobTypeSchema } from "../types.ts";

Deno.test("JobTypeSchema validates job types", () => {
  expect(JobTypeSchema.parse("vad")).toBe("vad");
  expect(JobTypeSchema.parse("transcription")).toBe("transcription");
  expect(JobTypeSchema.parse("diarization")).toBe("diarization");
  expect(JobTypeSchema.parse("ingestion")).toBe("ingestion");

  expect(() => JobTypeSchema.parse("invalid")).toThrow();
});

Deno.test("VadJobDataSchema validates VAD job data", () => {
  const validData = {
    type: "vad",
    limit: 1000,
    batchSize: 100,
  };

  const result = VadJobDataSchema.parse(validData);

  expect(result.type).toBe("vad");
  expect(result.limit).toBe(1000);
  expect(result.batchSize).toBe(100);
});

Deno.test("VadJobDataSchema applies defaults", () => {
  const minimalData = {
    type: "vad",
  };

  const result = VadJobDataSchema.parse(minimalData);

  expect(result.limit).toBe(1000);
  expect(result.batchSize).toBe(100);
});

Deno.test("VadJobDataSchema accepts date strings and coerces to Date", () => {
  const dataWithDates = {
    type: "vad",
    start: "2024-01-01T00:00:00Z",
    end: "2024-01-02T00:00:00Z",
  };

  const result = VadJobDataSchema.parse(dataWithDates);

  expect(result.start).toBeInstanceOf(Date);
  expect(result.end).toBeInstanceOf(Date);
  expect(result.start?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
});

Deno.test("VadJobDataSchema accepts originalId", () => {
  const dataWithOriginalId = {
    type: "vad",
    originalId: "67a1b2c3d4e5f6789abcdef0",
  };

  const result = VadJobDataSchema.parse(dataWithOriginalId);

  expect(result.originalId).toBe("67a1b2c3d4e5f6789abcdef0");
});

Deno.test("JobDataSchema discriminates by type", () => {
  const vadData = {
    type: "vad",
    limit: 500,
  };

  const result = JobDataSchema.parse(vadData);

  expect(result.type).toBe("vad");
  if (result.type === "vad") {
    expect(result.limit).toBe(500);
  }
});

Deno.test("JobDataSchema rejects invalid type", () => {
  const invalidData = {
    type: "unknown",
    limit: 100,
  };

  expect(() => JobDataSchema.parse(invalidData)).toThrow();
});

Deno.test("JobDataSchema requires type field", () => {
  const noType = {
    limit: 100,
  };

  expect(() => JobDataSchema.parse(noType)).toThrow();
});
