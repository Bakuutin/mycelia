import { expect } from "@std/expect";
import {
  allowsCompatibleDiarizatorFallback,
  getDiarizatorAdmissionPriority,
  isDiarizatorSlotUnavailable,
} from "./diarizator-admission.ts";

Deno.test("only archive-wide missing diarization has soft affinity", () => {
  expect(allowsCompatibleDiarizatorFallback({
    type: "diarization",
    mode: "missing",
  })).toBe(true);
  expect(allowsCompatibleDiarizatorFallback({
    type: "diarization",
    mode: "missing",
    originalId: "recording",
  })).toBe(false);
  expect(allowsCompatibleDiarizatorFallback({
    type: "diarization",
    mode: "build_generation",
  })).toBe(false);
  expect(allowsCompatibleDiarizatorFallback({ type: "enrollment" })).toBe(
    false,
  );
});

Deno.test("voice enrollment yields neither to live nor historical diarization", () => {
  expect(getDiarizatorAdmissionPriority({ type: "profileReenrollment" }))
    .toBeLessThan(
      getDiarizatorAdmissionPriority({
        type: "diarization",
        originalId: "recording",
      }),
    );
  expect(
    getDiarizatorAdmissionPriority({
      type: "diarization",
      originalId: "recording",
    }),
  ).toBeLessThan(
    getDiarizatorAdmissionPriority({ type: "diarization" }),
  );
  expect(getDiarizatorAdmissionPriority({ type: "profileReenrollment" }, 99))
    .toBe(1);
  expect(getDiarizatorAdmissionPriority({
    type: "diarization",
    originalId: "recording",
  }, 1)).toBe(5);
  expect(getDiarizatorAdmissionPriority({ type: "diarization" }, 10)).toBe(10);
  expect(getDiarizatorAdmissionPriority({
    type: "diarization",
    mode: "build_generation",
  })).toBe(15);
  expect(getDiarizatorAdmissionPriority({ type: "diarization" })).toBe(20);
});

Deno.test("only slot-capacity failures enter diarizator admission waiting", () => {
  expect(isDiarizatorSlotUnavailable(
    new Error("All healthy diarizator provider concurrency slots are reserved"),
  )).toBe(true);
  expect(isDiarizatorSlotUnavailable(
    new Error("Diarizator provider faeon has no free concurrency slots"),
  )).toBe(true);
  expect(isDiarizatorSlotUnavailable(
    new Error(
      "No compatible healthy diarizator provider concurrency slots are available",
    ),
  )).toBe(true);
  expect(isDiarizatorSlotUnavailable(new Error("No healthy route"))).toBe(
    false,
  );
});
