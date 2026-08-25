import { describe, expect, it } from "vitest";
import {
  buildEmptyActivationRepairPreviewRequest,
  buildEmptyActivationRepairRequest,
  type EmptyActivationRepairPreview,
} from "./activationRepair";

describe("empty activation repair contract", () => {
  it("separates read-only preview from typed repair confirmation", () => {
    const preview = {
      runId: "empty-active-run",
      confirmation: "REPAIR empty-active-run 42",
    } as EmptyActivationRepairPreview;

    expect(buildEmptyActivationRepairPreviewRequest(preview.runId)).toEqual({
      action: "repair-empty-activation-preview",
      runId: "empty-active-run",
    });
    expect(buildEmptyActivationRepairRequest(
      preview,
      preview.confirmation!,
    )).toEqual({
      action: "repair-empty-activation",
      runId: "empty-active-run",
      confirmation: "REPAIR empty-active-run 42",
    });
  });
});
