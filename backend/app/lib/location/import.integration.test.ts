import { expect } from "@std/expect";
import type { Auth } from "@/lib/auth/core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { up as upgradeLocationImports } from "../../../migrations/0050_location_import_review.ts";
import {
  analyzeLocationFile,
  confirmLocationPreview,
} from "./import.server.ts";

function gpx(points: Array<{ time: string; lat: number; lng: number }>) {
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Test route</name><trkseg>${
    points.map((point) =>
      `<trkpt lat="${point.lat}" lon="${point.lng}"><time>${point.time}</time></trkpt>`
    ).join("")
  }</trkseg></trk><wpt lat="41.71" lon="44.81"><name>Saved</name></wpt></gpx>`;
}

function upload(filename: string, text: string) {
  return {
    originalname: filename,
    mimetype: "application/gpx+xml",
    buffer: new TextEncoder().encode(text),
  };
}

Deno.test(
  "location analyze/confirm is idempotent and imports only partial-overlap additions",
  withFixtures(["Admin", "Mongo"], async (auth: Auth, { db }) => {
    await upgradeLocationImports(db);
    const firstFile = gpx([
      { time: "2026-08-01T00:00:00Z", lat: 41.7, lng: 44.8 },
      { time: "2026-08-01T00:01:00Z", lat: 41.7001, lng: 44.8001 },
    ]);
    const first = await analyzeLocationFile(
      auth,
      upload("first.gpx", firstFile),
    );
    expect(first.counts.newPoints).toBe(2);
    expect(first.counts.bookmarksNew).toBe(1);
    const receipt = await confirmLocationPreview(auth, first.previewId);
    const repeated = await confirmLocationPreview(auth, first.previewId);
    expect(repeated.importId).toBe(receipt.importId);
    expect(
      await db.collection("location_points").countDocuments({
        visible: true,
        selection: "accepted",
      }),
    ).toBe(2);

    const exact = await analyzeLocationFile(
      auth,
      upload("renamed.gpx", firstFile),
    );
    expect(exact.exactFileMatch?.filename).toBe("first.gpx");
    expect(exact.canConfirm).toBe(false);

    const partial = await analyzeLocationFile(
      auth,
      upload(
        "partial.gpx",
        gpx([
          { time: "2026-08-01T00:01:00Z", lat: 41.7001, lng: 44.8001 },
          { time: "2026-08-01T00:02:00Z", lat: 41.7002, lng: 44.8002 },
        ]),
      ),
    );
    expect(partial.counts.matchedPoints).toBe(1);
    expect(partial.counts.newPoints).toBe(1);
    await confirmLocationPreview(auth, partial.previewId);
    expect(
      await db.collection("location_points").countDocuments({
        visible: true,
        selection: "accepted",
      }),
    ).toBe(3);
    const shared = await db.collection("location_points").findOne({
      ts: new Date("2026-08-01T00:01:00Z"),
    });
    expect(shared?.importIds).toHaveLength(2);

    const conflicting = await analyzeLocationFile(
      auth,
      upload(
        "conflict.gpx",
        gpx([
          { time: "2026-08-01T00:00:00Z", lat: 10, lng: 20 },
        ]),
      ),
    );
    expect(conflicting.counts.newPoints).toBe(0);
    expect(conflicting.counts.conflictGroups).toBe(1);
    await confirmLocationPreview(auth, conflicting.previewId);
    expect(
      await db.collection("location_points").countDocuments({
        ts: new Date("2026-08-01T00:00:00Z"),
        visible: true,
        selection: "accepted",
      }),
    ).toBe(1);
    expect(
      await db.collection("location_point_conflicts").countDocuments({
        status: "pending",
      }),
    ).toBe(1);
  }),
);
