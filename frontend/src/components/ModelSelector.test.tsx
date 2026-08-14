import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("keeps a disabled provider name visible for an existing exact-model pin", async () => {
    mockCallResource.mockResolvedValue({
      models: [],
      providers: [{
        id: "local",
        name: "Local GPU",
        enabled: false,
        aliases: { medium: "qwen.gguf" },
        models: ["qwen.gguf"],
      }],
    });

    render(
      <ModelSelector
        value="qwen.gguf"
        providerValue="local"
        onChange={() => {}}
        prefetch
      />,
    );

    expect(await screen.findByRole("combobox"))
      .toHaveTextContent("qwen.gguf @ Local GPU");
  });
});
