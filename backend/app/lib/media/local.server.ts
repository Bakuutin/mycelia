import { walk } from "@std/fs/walk";
import { basename, extname, relative, resolve, SEPARATOR } from "@std/path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { env } from "#/env.ts";

export type LocalMediaInspection = {
  realPath: string;
  relativePath: string;
  fileName: string;
  kind: "image" | "pdf";
  mimeType: string;
  byteLength: number;
  sha256: string;
  pageCount: number;
  width?: number;
  height?: number;
  capturedAt?: Date;
  metadata: Record<string, unknown>;
};

export type UploadedMediaPreparation = {
  inspection: Omit<LocalMediaInspection, "realPath" | "relativePath">;
  thumbnail?: { data: Uint8Array; width: number; height: number };
  preview?: { data: Uint8Array; width: number; height: number };
};

const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
]);

export function mediaSourceConfigured(): boolean {
  return Boolean(env.MEDIA_SOURCE_ROOT);
}

export async function resolveMediaSourcePath(relativePath: string): Promise<{
  root: string;
  realPath: string;
  relativePath: string;
}> {
  if (!env.MEDIA_SOURCE_ROOT) {
    throw new Error("MEDIA_SOURCE_ROOT is not configured");
  }
  if (!relativePath || relativePath.includes("\0")) {
    throw new Error("A relative media path is required");
  }
  const root = await Deno.realPath(env.MEDIA_SOURCE_ROOT);
  const candidate = resolve(root, relativePath);
  const realPath = await Deno.realPath(candidate);
  if (realPath !== root && !realPath.startsWith(`${root}${SEPARATOR}`)) {
    throw new Error("Media path escapes the configured source root");
  }
  return { root, realPath, relativePath: relative(root, realPath) || "." };
}

export async function scanMediaSource(
  relativePath: string,
  limit: number,
): Promise<string[]> {
  const resolved = await resolveMediaSourcePath(relativePath);
  const stat = await Deno.stat(resolved.realPath);
  if (stat.isFile) return [resolved.relativePath];
  if (!stat.isDirectory) {
    throw new Error("Media source is not a file or folder");
  }

  const files: string[] = [];
  for await (
    const entry of walk(resolved.realPath, {
      includeDirs: false,
      followSymlinks: false,
      maxDepth: 20,
    })
  ) {
    if (!SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const real = await Deno.realPath(entry.path);
    if (
      real !== resolved.root && !real.startsWith(`${resolved.root}${SEPARATOR}`)
    ) {
      continue;
    }
    files.push(relative(resolved.root, real));
    if (files.length >= limit) break;
  }
  return files.sort();
}

export function detectMediaMime(
  bytes: Uint8Array,
): { kind: "image" | "pdf"; mimeType: string } {
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  if (starts(0xff, 0xd8, 0xff)) {
    return { kind: "image", mimeType: "image/jpeg" };
  }
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { kind: "image", mimeType: "image/png" };
  }
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) return { kind: "image", mimeType: "image/webp" };
  if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") {
    return { kind: "pdf", mimeType: "application/pdf" };
  }
  throw new Error("Unsupported or invalid media file");
}

async function inspectMediaFile(
  path: string,
  fileName: string,
  limits: { maxImageBytes: number; maxPdfBytes: number; maxPdfPages: number },
): Promise<Omit<LocalMediaInspection, "realPath" | "relativePath">> {
  const stat = await Deno.stat(path);
  if (!stat.isFile) throw new Error("Media item is not a file");
  const data = await Deno.readFile(path);
  const detected = detectMediaMime(data.slice(0, 16));
  const maximum = detected.kind === "pdf"
    ? limits.maxPdfBytes
    : limits.maxImageBytes;
  if (data.byteLength > maximum) {
    throw new Error(`File exceeds the configured ${maximum} byte limit`);
  }

  let pageCount = 1;
  let width: number | undefined;
  let height: number | undefined;
  let metadata: Record<string, unknown> = {};
  if (detected.kind === "pdf") {
    const pdf = await PDFDocument.load(data, { ignoreEncryption: false });
    pageCount = pdf.getPageCount();
    if (pageCount > limits.maxPdfPages) {
      throw new Error(
        `PDF has ${pageCount} pages; maximum is ${limits.maxPdfPages}`,
      );
    }
    metadata = {
      pageCount,
      title: pdf.getTitle(),
      author: pdf.getAuthor(),
      subject: pdf.getSubject(),
      creator: pdf.getCreator(),
      producer: pdf.getProducer(),
      creationDate: pdf.getCreationDate()?.toISOString(),
      modificationDate: pdf.getModificationDate()?.toISOString(),
    };
  } else {
    const [technical, exif] = await Promise.all([
      ffprobe(path),
      exiftool(path),
    ]);
    const latitude = Number(exif.GPSLatitude);
    const longitude = Number(exif.GPSLongitude);
    const altitude = Number(exif.GPSAltitude);
    metadata = {
      ...technical,
      ...(Object.keys(exif).length > 0 ? { exif } : {}),
      ...(Number.isFinite(latitude) && Number.isFinite(longitude)
        ? {
          location: {
            latitude,
            longitude,
            ...(Number.isFinite(altitude) ? { altitudeMeters: altitude } : {}),
          },
        }
        : {}),
    };
    const stream = Array.isArray(technical.streams)
      ? technical.streams[0]
      : null;
    width = Number(stream?.width) || undefined;
    height = Number(stream?.height) || undefined;
    if (!width || !height) {
      throw new Error("Image dimensions could not be read");
    }
    if (width * height > 75_000_000) {
      throw new Error("Image exceeds the 75 megapixel safety limit");
    }
  }

  return {
    fileName,
    kind: detected.kind,
    mimeType: detected.mimeType,
    byteLength: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    pageCount,
    width,
    height,
    capturedAt: findCapturedAt(metadata),
    metadata,
  };
}

async function ffprobe(path: string): Promise<Record<string, unknown>> {
  const command = new Deno.Command("ffprobe", {
    args: [
      "-v",
      "error",
      "-show_entries",
      "format=format_name,size:format_tags:stream=width,height,pix_fmt,color_space,color_transfer,color_primaries:stream_tags",
      "-of",
      "json",
      path,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  if (!output.success) {
    throw new Error(
      `Image metadata extraction failed: ${
        new TextDecoder().decode(output.stderr).slice(0, 300)
      }`,
    );
  }
  return JSON.parse(new TextDecoder().decode(output.stdout));
}

async function exiftool(path: string): Promise<Record<string, unknown>> {
  try {
    const output = await new Deno.Command("exiftool", {
      args: ["-json", "-n", "-a", "-s", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!output.success) return {};
    const parsed = JSON.parse(new TextDecoder().decode(output.stdout));
    const first = Array.isArray(parsed) ? parsed[0] : null;
    if (!first || typeof first !== "object") return {};
    const { SourceFile: _sourceFile, ...metadata } = first;
    return metadata;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return {};
    throw error;
  }
}

function findCapturedAt(metadata: Record<string, unknown>): Date | undefined {
  const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
  const format = metadata.format && typeof metadata.format === "object"
    ? metadata.format as Record<string, unknown>
    : {};
  const exif = metadata.exif && typeof metadata.exif === "object"
    ? metadata.exif as Record<string, unknown>
    : undefined;
  const tagObjects = [exif, format.tags, ...streams.map((s: any) => s?.tags)]
    .filter((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object")
    );
  const keys = [
    "DateTimeOriginal",
    "date_time_original",
    "creation_time",
    "CreateDate",
    "date",
  ];
  for (const tags of tagObjects) {
    for (const key of keys) {
      const raw = tags[key];
      if (typeof raw !== "string") continue;
      const normalized = raw.replace(
        /^(\d{4}):(\d{2}):(\d{2})\s/,
        "$1-$2-$3T",
      );
      const date = new Date(normalized);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return undefined;
}

export async function inspectLocalMedia(
  relativePath: string,
  limits: { maxImageBytes: number; maxPdfBytes: number; maxPdfPages: number },
): Promise<LocalMediaInspection> {
  const resolved = await resolveMediaSourcePath(relativePath);
  const inspected = await inspectMediaFile(
    resolved.realPath,
    basename(resolved.realPath),
    limits,
  );

  return {
    realPath: resolved.realPath,
    relativePath: resolved.relativePath,
    ...inspected,
  };
}

export async function prepareUploadedMedia(
  bytes: Uint8Array,
  fileName: string,
  limits: { maxImageBytes: number; maxPdfBytes: number; maxPdfPages: number },
  options: { createPreviews?: boolean } = {},
): Promise<UploadedMediaPreparation> {
  const detected = detectMediaMime(bytes.slice(0, 16));
  const suffix = detected.kind === "pdf"
    ? ".pdf"
    : detected.mimeType === "image/jpeg"
    ? ".jpg"
    : detected.mimeType === "image/png"
    ? ".png"
    : ".webp";
  const sourcePath = await Deno.makeTempFile({ suffix });
  try {
    await Deno.writeFile(sourcePath, bytes);
    const inspection = await inspectMediaFile(
      sourcePath,
      basename(fileName.replaceAll("\\", "/")) || `upload${suffix}`,
      limits,
    );
    if (inspection.kind === "pdf" || options.createPreviews === false) {
      return { inspection };
    }
    const [thumbnail, preview] = await Promise.all([
      createWebpPreview(sourcePath, 256, 70),
      createWebpPreview(sourcePath, 1280, 80),
    ]);
    return { inspection, thumbnail, preview };
  } finally {
    await Deno.remove(sourcePath).catch(() => undefined);
  }
}

export async function createWebpPreview(
  sourcePath: string,
  maxDimension: number,
  quality: number,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const outputPath = await Deno.makeTempFile({ suffix: ".webp" });
  try {
    const result = await new Deno.Command("ffmpeg", {
      args: [
        "-v",
        "error",
        "-i",
        sourcePath,
        "-vf",
        `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`,
        "-frames:v",
        "1",
        "-map_metadata",
        "-1",
        "-c:v",
        "libwebp",
        "-q:v",
        String(quality),
        "-y",
        outputPath,
      ],
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!result.success) {
      throw new Error(
        `Preview generation failed: ${
          new TextDecoder().decode(result.stderr).slice(0, 300)
        }`,
      );
    }
    const metadata = await ffprobe(outputPath);
    const stream = Array.isArray(metadata.streams) ? metadata.streams[0] : null;
    return {
      data: await Deno.readFile(outputPath),
      width: Number(stream?.width),
      height: Number(stream?.height),
    };
  } finally {
    await Deno.remove(outputPath).catch(() => undefined);
  }
}

export async function readLocalMedia(
  relativePath: string,
): Promise<Uint8Array> {
  const resolved = await resolveMediaSourcePath(relativePath);
  return await Deno.readFile(resolved.realPath);
}

export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}
