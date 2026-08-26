// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  normalizeBounds,
  readMapUrlState,
  updateMapUrl,
} from "./MapExperiencePage";

describe("map URL state", () => {
  it("round-trips viewport, cursor and layers without losing time params", () => {
    history.replaceState(
      {},
      "",
      "/map?start=100&end=200&lat=46.948000&lng=7.447400&z=15.25&at=150&layers=routes,conversations",
    );
    const parsed = readMapUrlState();
    expect(parsed.viewport).toEqual({ center: [46.948, 7.4474], zoom: 15.25 });
    expect([...parsed.layers]).toEqual(["routes", "conversations"]);
    expect(parsed.at?.getTime()).toBe(150);

    updateMapUrl(parsed.viewport, parsed.layers, parsed.at);
    const params = new URLSearchParams(location.search);
    expect(params.get("start")).toBe("100");
    expect(params.get("end")).toBe("200");
    expect(params.get("lat")).toBe("46.948000");
    expect(params.get("layers")).toBe("conversations,routes");
  });

  it("normalizes a viewport crossing the antimeridian", () => {
    expect(normalizeBounds({ west: 170, east: 190, south: -10, north: 10 }))
      .toEqual({ west: 170, east: -170, south: -10, north: 10 });
  });

  it("does not invent a zero viewport and preserves an explicitly empty layer set", () => {
    history.replaceState({}, "", "/map?start=100&end=200&layers=");
    const parsed = readMapUrlState();
    expect(parsed.viewport).toBeNull();
    expect([...parsed.layers]).toEqual([]);
  });
});
