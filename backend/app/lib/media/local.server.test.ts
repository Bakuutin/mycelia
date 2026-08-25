import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.15";
import { PDFDocument } from "pdf-lib";
import {
  assertSafeMediaRelativePath,
  detectMediaMime,
  inspectCapturedAt,
  mediaLocationFromMetadata,
  prepareUploadedMedia,
} from "./local.server.ts";

Deno.test("mounted media paths must stay relative to the configured root", () => {
  assertSafeMediaRelativePath(".");
  assertSafeMediaRelativePath("2026/photos");
  assertThrows(
    () => assertSafeMediaRelativePath("/Users/example/Pictures"),
    Error,
    "relative to the configured media source",
  );
  assertThrows(
    () => assertSafeMediaRelativePath("../private"),
    Error,
    '".." are not allowed',
  );
});

Deno.test("detectMediaMime trusts magic bytes rather than the filename", () => {
  assertEquals(
    detectMediaMime(
      new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ]),
    ),
    { kind: "image", mimeType: "image/png" },
  );
  assertThrows(
    () => detectMediaMime(new TextEncoder().encode("photo")),
    Error,
    "Unsupported or invalid media file",
  );
});

Deno.test("prepareUploadedMedia inspects an uploaded PDF without retaining its path", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 100]);
  const prepared = await prepareUploadedMedia(
    await pdf.save(),
    "../unsafe/name.pdf",
    { maxImageBytes: 1_000_000, maxPdfBytes: 1_000_000, maxPdfPages: 15 },
  );
  assertEquals(prepared.inspection.fileName, "name.pdf");
  assertEquals(prepared.inspection.kind, "pdf");
  assertEquals(prepared.inspection.pageCount, 1);
  assertEquals(prepared.thumbnail, undefined);
});

Deno.test("naive EXIF capture time is deterministic and marked timezone unknown", () => {
  const inspected = inspectCapturedAt({
    exif: { DateTimeOriginal: "2026:08:21 12:34:56.125" },
  });
  assertEquals(
    inspected.capturedAt?.toISOString(),
    "2026-08-21T12:34:56.125Z",
  );
  assertEquals(inspected.capturedAtTimeZone, undefined);
  assertEquals(inspected.capturedAtTimeZoneSource, "unknown");
});

Deno.test("EXIF offset fields turn wall-clock capture time into an instant", () => {
  const originalOffset = inspectCapturedAt({
    exif: {
      DateTimeOriginal: "2026:08:21 12:34:56",
      OffsetTimeOriginal: "+04:00",
    },
  });
  assertEquals(
    originalOffset.capturedAt?.toISOString(),
    "2026-08-21T08:34:56.000Z",
  );
  assertEquals(originalOffset.capturedAtTimeZone, "+04:00");
  assertEquals(originalOffset.capturedAtTimeZoneSource, "exif_offset");

  const digitizedFallback = inspectCapturedAt({
    exif: {
      DateTimeOriginal: "2026:08:21 12:34:56",
      OffsetTimeDigitized: "-0230",
    },
  });
  assertEquals(
    digitizedFallback.capturedAt?.toISOString(),
    "2026-08-21T15:04:56.000Z",
  );
  assertEquals(digitizedFallback.capturedAtTimeZone, "-02:30");
  assertEquals(digitizedFallback.capturedAtTimeZoneSource, "exif_offset");
});

Deno.test("an embedded capture offset takes precedence over EXIF offset tags", () => {
  const inspected = inspectCapturedAt({
    exif: {
      DateTimeOriginal: "2026:08:21 12:34:56Z",
      OffsetTimeOriginal: "+04:00",
    },
  });
  assertEquals(
    inspected.capturedAt?.toISOString(),
    "2026-08-21T12:34:56.000Z",
  );
  assertEquals(inspected.capturedAtTimeZone, "Z");
  assertEquals(inspected.capturedAtTimeZoneSource, "embedded");
});

Deno.test("prepareUploadedMedia preserves local EXIF date and GPS metadata", async () => {
  const source = await Deno.makeTempFile({ suffix: ".jpg" });
  try {
    const generated = await new Deno.Command("ffmpeg", {
      args: [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=green:s=32x24",
        "-frames:v",
        "1",
        "-y",
        source,
      ],
    }).output();
    assertEquals(generated.success, true);
    const tagged = await new Deno.Command("exiftool", {
      args: [
        "-overwrite_original",
        "-GPSLatitude=40.18",
        "-GPSLongitude=44.51",
        "-DateTimeOriginal=2026:08:21 12:34:56",
        source,
      ],
    }).output();
    assertEquals(tagged.success, true);

    const prepared = await prepareUploadedMedia(
      await Deno.readFile(source),
      "tagged.jpg",
      { maxImageBytes: 1_000_000, maxPdfBytes: 1_000_000, maxPdfPages: 15 },
      { createPreviews: false },
    );
    assertEquals(
      prepared.inspection.capturedAt?.toISOString(),
      "2026-08-21T12:34:56.000Z",
    );
    assertEquals(
      prepared.inspection.capturedAtTimeZoneSource,
      "unknown",
    );
    assertEquals(prepared.inspection.location, {
      latitude: 40.18,
      longitude: 44.51,
    });
    assertEquals(
      (prepared.inspection.metadata.location as any)?.latitude,
      40.18,
    );
    assertEquals(
      (prepared.inspection.metadata.location as any)?.longitude,
      44.51,
    );
    assertEquals(mediaLocationFromMetadata(prepared.inspection.metadata), {
      latitude: 40.18,
      longitude: 44.51,
    });
  } finally {
    await Deno.remove(source).catch(() => undefined);
  }
});
