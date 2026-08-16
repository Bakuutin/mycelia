// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildJobsListRequest,
  getJobsListView,
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
});
