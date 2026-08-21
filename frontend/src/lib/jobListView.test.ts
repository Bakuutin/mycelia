// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildJobsListRequest,
  getJobsListView,
  resolveJobEventState,
  shouldRefreshJobsViews,
  withJobsListView,
} from "./jobListView";

describe("jobs list views", () => {
  it("uses the operational view by default", () => {
    expect(getJobsListView(new URLSearchParams())).toBe("operational");
  });

  it("round-trips the Empty view through the URL", () => {
    const empty = withJobsListView(
      new URLSearchParams("type=transcription&hideEmpty=true"),
      "idle_auto",
    );
    expect(empty.toString()).toBe("type=transcription&view=empty");
    expect(getJobsListView(empty)).toBe("idle_auto");

    const operational = withJobsListView(empty, "operational");
    expect(operational.toString()).toBe("type=transcription");
    expect(getJobsListView(operational)).toBe("operational");
  });

  it("sends the selected server-side view with the jobs request", () => {
    expect(buildJobsListRequest("idle_auto", ["transcription"])).toMatchObject({
      action: "list",
      view: "idle_auto",
      limit: 1000,
      types: ["transcription"],
    });
    expect(buildJobsListRequest("operational")).not.toHaveProperty("types");
  });

  it("refreshes all views when a completed job can change membership", () => {
    expect(shouldRefreshJobsViews("job.completed")).toBe(true);
    expect(shouldRefreshJobsViews("job.progress")).toBe(false);
    expect(shouldRefreshJobsViews("job.failed")).toBe(false);
  });

  it("supports a compact active-only request for the global status badge", () => {
    expect(buildJobsListRequest("operational", undefined, {
      statuses: ["active", "waiting", "delayed"],
      limit: 200,
    })).toMatchObject({
      statuses: ["active", "waiting", "delayed"],
      limit: 200,
    });
  });

  it("sends an indexed provider filter to the jobs resource", () => {
    expect(buildJobsListRequest("operational", ["diarization"], {
      providerProfileId: "gpu-legacy",
    })).toMatchObject({
      types: ["diarization"],
      providerProfileId: "gpu-legacy",
      limit: 1000,
    });
  });

  it("sends a campaign filter for Timeline rebuild tracking", () => {
    expect(buildJobsListRequest("operational", ["histRecalculation"], {
      campaignId: "6a84b87878391add0d82e6aa",
    })).toMatchObject({
      types: ["histRecalculation"],
      campaignId: "6a84b87878391add0d82e6aa",
    });
  });

  it("does not turn progress events into a fake lifecycle state", () => {
    expect(resolveJobEventState("job.progress", undefined, "active")).toBe(
      "active",
    );
    expect(resolveJobEventState("job.started", undefined, "waiting")).toBe(
      "active",
    );
    expect(resolveJobEventState("job.completed", undefined, "active")).toBe(
      "completed",
    );
    expect(resolveJobEventState("job.progress", "active", "waiting")).toBe(
      "active",
    );
  });
});
