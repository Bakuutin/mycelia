import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { TimelineRecoveryStatus } from "./TimelineRecoveryStatus";

describe("TimelineRecoveryStatus", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows that a rebuild is required and links to recovery controls", async () => {
    vi.spyOn(api, "callResource").mockResolvedValue({
      checkedAt: "2026-08-13T00:00:00.000Z",
      status: "needs_attention",
      sources: [{
        collection: "audio_chunks",
        label: "Audio chunks",
        documents: 100,
        firstStart: null,
        lastStart: null,
        lastEnd: null,
        histogramDocuments: 80,
        difference: -20,
      }],
      histograms: [],
      bookkeeping: {
        checked: false,
        terminalSequences: null,
        eligibleChunks: null,
        modifiedChunks: 0,
        applied: false,
      },
      lastBookkeepingRepair: null,
      campaign: null,
      issues: [{
        severity: "error",
        code: "histogram_count_audio_chunks",
        message: "mismatch",
      }],
      scope: { verifies: [], note: "" },
      performance: { totalMs: 10, stages: {}, note: "" },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TimelineRecoveryStatus />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(/Full histogram rebuild is recommended/),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Recovery controls" }).getAttribute(
        "href",
      ),
    ).toBe("/jobs?timelineAudit=1#timeline-integrity");
  });
});
