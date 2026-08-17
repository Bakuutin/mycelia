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

const KML_BOOKMARK = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:mwm="https://comaps.app">
  <Document>
    <name>My Places</name>
    <ExtendedData>
      <mwm:lastModified>2026-08-17T11:59:39Z</mwm:lastModified>
      <mwm:accessRules>Local</mwm:accessRules>
    </ExtendedData>
    <Placemark>
      <name>Torgvas Abano</name>
      <description>Hot spring</description>
      <TimeStamp><when>2026-08-01T08:00:00Z</when></TimeStamp>
      <styleUrl>#placemark-cyan</styleUrl>
      <Point><coordinates>45.493027,42.25548,0</coordinates></Point>
      <ExtendedData>
        <mwm:name>
          <mwm:lang code="default">თორღვას გოგირდის აბანო</mwm:lang>
          <mwm:lang code="en">Torgvas Abano</mwm:lang>
        </mwm:name>
        <mwm:customName><mwm:lang code="default">Bath</mwm:lang></mwm:customName>
        <mwm:featureTypes><mwm:value>natural-hot_spring</mwm:value></mwm:featureTypes>
        <mwm:icon>Sights</mwm:icon>
        <mwm:scale>15</mwm:scale>
        <mwm:visibility>1</mwm:visibility>
      </ExtendedData>
    </Placemark>
  </Document>
</kml>`;

Deno.test("parseGpx extracts timestamped points, skips the rest", () => {
  const { points, tracks, bookmarks, skipped, untimedCoordinates } = parseGpx(
    GPX,
  );
  expect(points.length).toBe(2);
  expect(tracks.length).toBe(1);
  expect(bookmarks.length).toBe(1);
  expect(skipped).toBe(0);
  expect(untimedCoordinates).toBe(1);
  expect(points[0].ele).toBeCloseTo(450.2);
  expect(points[0].lng).toBeCloseTo(44.8271);
  expect(bookmarks[0].lat).toBeCloseTo(41.7);
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
  const { points, tracks, skipped, untimedCoordinates } = parseKml(
    KML_LINESTRING,
  );
  expect(points.length).toBe(0);
  expect(tracks[0].kind).toBe("untimed-path");
  expect(tracks[0].coordinates.length).toBe(3);
  expect(skipped).toBe(0);
  expect(untimedCoordinates).toBe(3);
});

Deno.test("parseKml keeps bookmarks and typed metadata out of GPS points", () => {
  const result = parseKml(KML_BOOKMARK);
  expect(result.points.length).toBe(0);
  expect(result.bookmarks.length).toBe(1);
  expect(result.datasetMetadata.name).toBe("My Places");
  expect(result.datasetMetadata.sourceTimestamp?.toISOString()).toBe(
    "2026-08-17T11:59:39.000Z",
  );
  expect(result.bookmarks[0].sourceTimestamp?.toISOString()).toBe(
    "2026-08-01T08:00:00.000Z",
  );
  expect(result.bookmarks[0].customNames?.default).toBe("Bath");
  expect(result.bookmarks[0].localizedNames?.en).toBe("Torgvas Abano");
  expect(result.bookmarks[0].featureTypes).toEqual(["natural-hot_spring"]);
  expect(result.bookmarks[0].style?.icon).toBe("cyan");
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
  expect(points.length).toBe(2);
});
