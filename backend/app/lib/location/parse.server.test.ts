import { expect } from "@std/expect";
import { zipSync } from "fflate";
import {
  detectFormat,
  parseGpx,
  parseKml,
  parseKmz,
  parseTrackFile,
} from "./parse.server.ts";

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Organic Maps">
  <trk>
    <name>Morning walk</name>
    <trkseg>
      <trkpt lat="41.7151" lon="44.8271">
        <ele>450.2</ele>
        <time>2026-08-01T07:00:00Z</time>
      </trkpt>
      <trkpt lat="41.7160" lon="44.8280">
        <time>2026-08-01T07:01:00Z</time>
      </trkpt>
      <trkpt lat="41.7170" lon="44.8290"></trkpt>
    </trkseg>
  </trk>
  <wpt lat="41.7000" lon="44.8000">
    <time>2026-08-01T06:00:00Z</time>
  </wpt>
</gpx>`;

const KML_GX_TRACK = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <Placemark>
      <gx:Track>
        <when>2026-08-02T10:00:00Z</when>
        <when>2026-08-02T10:05:00Z</when>
        <gx:coord>44.8271 41.7151 450</gx:coord>
        <gx:coord>44.8300 41.7200 455</gx:coord>
      </gx:Track>
    </Placemark>
  </Document>
</kml>`;

const KML_LINESTRING = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder>
      <Placemark>
        <LineString>
          <coordinates>44.8271,41.7151,450 44.8300,41.7200,455 44.8350,41.7250,460</coordinates>
        </LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

Deno.test("parseGpx extracts timestamped points, skips the rest", () => {
  const { points, skipped } = parseGpx(GPX);
  expect(points.length).toBe(3);
  expect(skipped).toBe(1); // trkpt without <time>
  // Sorted by time: wpt at 06:00 comes first.
  expect(points[0].lat).toBeCloseTo(41.7);
  expect(points[0].ts.toISOString()).toBe("2026-08-01T06:00:00.000Z");
  expect(points[1].ele).toBeCloseTo(450.2);
  expect(points[1].lng).toBeCloseTo(44.8271);
});

Deno.test("parseGpx rejects non-GPX documents", () => {
  expect(() => parseGpx("<html></html>")).toThrow("missing <gpx> root");
});

Deno.test("parseKml reads gx:Track when/coord pairs", () => {
  const { points, skipped } = parseKml(KML_GX_TRACK);
  expect(points.length).toBe(2);
  expect(skipped).toBe(0);
  expect(points[0].lat).toBeCloseTo(41.7151);
  expect(points[0].lng).toBeCloseTo(44.8271);
  expect(points[0].ele).toBeCloseTo(450);
  expect(points[1].ts.toISOString()).toBe("2026-08-02T10:05:00.000Z");
});

Deno.test("parseKml counts LineString coords as skipped (no timestamps)", () => {
  const { points, skipped } = parseKml(KML_LINESTRING);
  expect(points.length).toBe(0);
  expect(skipped).toBe(3);
});

Deno.test("parseKmz unwraps doc.kml", () => {
  const bytes = zipSync({
    "doc.kml": new TextEncoder().encode(KML_GX_TRACK),
  });
  const { points } = parseKmz(bytes);
  expect(points.length).toBe(2);
});

Deno.test("parseKmz rejects archives without kml", () => {
  const bytes = zipSync({ "readme.txt": new TextEncoder().encode("hi") });
  expect(() => parseKmz(bytes)).toThrow("no .kml document");
});

Deno.test("detectFormat maps extensions", () => {
  expect(detectFormat("track.GPX")).toBe("gpx");
  expect(detectFormat("track.kml")).toBe("kml");
  expect(detectFormat("track.kmz")).toBe("kmz");
  expect(detectFormat("track.zip")).toBe(null);
});

Deno.test("parseTrackFile dispatches by format", () => {
  const bytes = new TextEncoder().encode(GPX);
  const { points } = parseTrackFile("gpx", bytes);
  expect(points.length).toBe(3);
});
