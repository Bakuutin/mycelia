import { promises as fs } from "node:fs";
import path from "node:path";
import { DateTime } from "npm:luxon";
import process from "node:process";
import os from "node:os";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { Db } from "npm:mongodb";
import { z, ZodTypeAny } from "zod";
import mongoose, { Schema, Types } from "mongoose";
import { ingestPendingSourceFiles } from "./chunking.ts";
export type Metadata = {
  [key: string]: any;
};

export type FSMetadata = Metadata & {
  path: string;
  extension: string;
  created: Date;
  size: number;
};

export type FilenameStartStrategy = {
  type: "filename";
  regex: RegExp;
  format: string;
  timezone?: string;
};

export type DateCreatedStartStrategy = {
  type: "date-created";
};

export type StartStrategy = FilenameStartStrategy | DateCreatedStartStrategy;

export type FSImporterConfig = {
  root: string;
  extensions?: string[];
  startStrategy: StartStrategy;
};

export type AppleVoiceMemosImporterConfig = {
  root: string;
};

export type SourceFile = {
  path: string;
  [key: string]: any;
};

export type Importer = {
  _id: Types.ObjectId;
  name: string;
  type: string;
  enabled: boolean;
  config: any;
};

const importerSchema = new Schema<Importer>({
  type: { type: String, required: true },
  name: { type: String, required: true },
  config: { type: Object, required: true },
  enabled: { type: Boolean, default: true },
});

const ImporterModel = mongoose.models.Importer ||
  mongoose.model<Importer>("Importer", importerSchema, "importers");

async function getFiles(dir: string) {
  const files = await fs.readdir(dir);
  return files.map((file) => path.join(dir, file));
}

async function getFSMetadata(file: string): Promise<FSMetadata> {
  const { size, birthtime } = await fs.stat(file);
  return {
    path: file,
    created: birthtime,
    size,
    extension: path.extname(file).slice(1),
  };
}

function getFileStart(metadata: FSMetadata, strategy: StartStrategy): Date {
  if (strategy.type === "date-created") {
    return metadata.created;
  }
  if (strategy.type === "filename") {
    const match = metadata.path.match(strategy.regex);
    if (!match) {
      throw new Error(`Could not find start date in filename ${metadata.path}`);
    }

    const date = DateTime.fromFormat(match[1], strategy.format, {
      zone: strategy.timezone ?? "UTC",
      setZone: true,
    });
    if (!date.isValid) {
      const explanation = DateTime.fromFormatExplain(match[1], strategy.format);
      throw new Error(`Invalid date format: ${explanation}`);
    }
    return date.toJSDate();
  }
  throw new Error(`Unknown start strategy`);
}

async function getDiscoveredPaths(db: Db): Promise<Set<string>> {
  const paths = await db.collection<SourceFile>("source_files")
    .find({}, { projection: { path: 1, _id: 0 } })
    .toArray();
  return new Set(paths.map((doc) => doc.path));
}

async function discoverFiles(
  importer: { name: string; _id: Types.ObjectId; config: FSImporterConfig },
  dryRun = false,
) {
  const { root, extensions, startStrategy } = importer.config;

  const db = await getRootDB();
  const discovered = await getDiscoveredPaths(db);
  const files = await getFiles(root);

  const newFiles = [];

  for (const path of files) {
    if (discovered.has(path)) {
      continue;
    }
    const metadata = await getFSMetadata(path);

    if (extensions && !extensions.includes(metadata.extension)) {
      continue;
    }

    Object.assign(metadata, {
      start: getFileStart(metadata, startStrategy),
      importer: importer._id.toHexString(),
      platform: {
        system: process.platform,
        node: os.hostname(),
      },
      ingested: false,
    });
    newFiles.push(metadata);
  }

  console.log(`Discovered ${newFiles.length} new files via ${importer.name}`);

  if (newFiles.length > 0 && !dryRun) {
    await db.collection<SourceFile>("source_files").insertMany(newFiles);
  }

  return newFiles;
}

type ImporterHandlerWithSchema<T extends ZodTypeAny> = {
  schema: T;
  handle: (
    importer: { name: string; _id: Types.ObjectId; config: z.infer<T> },
    dryRun?: boolean,
  ) => Promise<any>;
};

const importerRegistry: Record<string, ImporterHandlerWithSchema<ZodTypeAny>> =
  {};

export function registerImporterHandler<T extends ZodTypeAny>(
  type: string,
  schema: T,
  handle: (
    importer: { name: string; _id: Types.ObjectId; config: z.infer<T> },
    dryRun?: boolean,
  ) => Promise<any>,
) {
  importerRegistry[type] = { schema, handle };
}

registerImporterHandler(
  "fs",
  z.object({
    root: z.string(),
    extensions: z.array(z.string()).optional(),
    startStrategy: z.union([
      z.object({
        type: z.literal("filename"),
        regex: z.instanceof(RegExp),
        format: z.string(),
        timezone: z.string().optional(),
      }),
      z.object({
        type: z.literal("date-created"),
      }),
    ]),
  }),
  discoverFiles,
);

async function handleImporter(importer: Importer, dryRun = false) {
  const handler = importerRegistry[importer.type];
  if (!handler) {
    console.warn(`No handler registered for importer type: ${importer.type}`);
    return;
  }

  const parsed = handler.schema.safeParse(importer.config);
  if (!parsed.success) {
    console.error(
      `Invalid config for importer ${importer.name}:`,
      parsed.error.format(),
    );
    return;
  }

  await handler.handle({
    _id: importer._id,
    name: importer.name,
    config: parsed.data,
  }, dryRun);
}

export async function findAndImportFiles() {
  const importers = await ImporterModel.find({ enabled: true });

  for (const importer of importers) {
    await handleImporter(importer);
  }

  await ingestPendingSourceFiles();
}
