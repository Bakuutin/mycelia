import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ModelSelector } from "./ModelSelector";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({
  callResource: vi.fn(),
}));

const mockCallResource = vi.mocked(api.callResource);

describe("ModelSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallResource.mockResolvedValue({
      models: [{ id: "provider/model-b" }, { id: "provider/model-a" }],
      categories: {},
    });
  });

  it("prefetches available models when requested by a job dialog", async () => {
    render(
      <ModelSelector
        value="medium"
        onChange={() => {}}
        prefetch
      />,
    );

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith("llm", { action: "list" });
    });
  });
});
