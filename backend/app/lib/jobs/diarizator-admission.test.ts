import { expect } from "@std/expect";
import {
  getDiarizatorAdmissionPriority,
  isDiarizatorSlotUnavailable,
} from "./diarizator-admission.ts";

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
});

Deno.test("only slot-capacity failures enter diarizator admission waiting", () => {
  expect(isDiarizatorSlotUnavailable(
    new Error("All healthy diarizator provider concurrency slots are reserved"),
  )).toBe(true);
  expect(isDiarizatorSlotUnavailable(
    new Error("Diarizator provider faeon has no free concurrency slots"),
  )).toBe(true);
  expect(isDiarizatorSlotUnavailable(new Error("No healthy route"))).toBe(
    false,
  );
});
