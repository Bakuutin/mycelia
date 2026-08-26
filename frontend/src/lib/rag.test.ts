import { describe, expect, it } from "vitest";

import { ragCanonicalRoute } from "./rag";

describe("ragCanonicalRoute", () => {
  it("keeps native routes and safely maps legacy Mycelia provenance URIs", () => {
    expect(ragCanonicalRoute("/objects/o1")).toBe("/objects/o1");
    expect(
      ragCanonicalRoute("/messaging/c1?messageId=m1"),
    ).toBe("/messaging/c1?messageId=m1");
    expect(ragCanonicalRoute("mycelia://objects/o1")).toBe("/objects/o1");
    expect(ragCanonicalRoute("mycelia://media/assets/a1")).toBe(
      "/media?assetId=a1",
    );
    expect(
      ragCanonicalRoute("mycelia://transcriptions/t1", {
        start: "2026-08-20T10:00:00.000Z",
        end: "2026-08-20T10:05:00.000Z",
      }),
    ).toBe(
      "/transcript?start=2026-08-20T10%3A00%3A00.000Z&end=2026-08-20T10%3A05%3A00.000Z",
    );
  });
});
