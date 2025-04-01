import { promises as fs } from "node:fs";
import path from "node:path";
import { DateTime } from "npm:luxon";
import process from "node:process";
import os from "node:os";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { Db } from "npm:mongodb";

export type Metadata = {
    [key: string]: any;
}

export type FSMetadata = Metadata & {
    path: string,
    extension: string,
    created: Date,
    size: number,
}

export type FilenameStartStrategy = {
    type: "filename",
    regex: RegExp,
    format: string,
    timezone?: string,
}

export type DateCreatedStartStrategy = {
    type: "date-created",
}

export type StartStrategy = FilenameStartStrategy | DateCreatedStartStrategy;


export type FSImporterConfig = {
    name: string,
    root: string,
    extensions?: string[],
    startStrategy: StartStrategy,
}

export type SourceFile = {
    path: string;
    [key: string]: any;
}

async function getFiles(dir: string) {
    const files = await fs.readdir(dir);
    return files.map(file => path.join(dir, file));
}

async function getFSMetadata(file: string): Promise<FSMetadata> {
    const {size, birthtime} = await fs.stat(file);
    return { path: file, created: birthtime, size, extension: path.extname(file).slice(1) };
}



function getFileStart(metadata: FSMetadata, strategy: StartStrategy): Date {
    if (strategy.type === "date-created") {
        return metadata.created;
    }
    if (strategy.type === "filename") {
        const match = metadata.path.match(strategy.regex);
        if (!match) {
            throw new Error(`Could not find start date in filename ${metadata.path}`)
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
    return new Set(paths.map(doc => doc.path));
}

async function discoverFiles(config: FSImporterConfig, dryRun = false) {
    const db = await getRootDB();
    const discovered = await getDiscoveredPaths(db);
    const files = await getFiles(config.root);

    const newFiles = [];

    for (const path of files) {
        if (discovered.has(path)) {
            continue;
        }
        const metadata = await getFSMetadata(path);

        if (config.extensions && !config.extensions.includes(metadata.extension)) {
            continue;
        }

        Object.assign(metadata, {
            start: getFileStart(metadata, config.startStrategy),
            platform: {
                system: process.platform,
                node: os.hostname(),
                importer: config.name,
            },
            ingested: false,
        });
        newFiles.push(metadata);
    }

    console.log(`Discovered ${newFiles.length} new files in ${config.name}`);

    if (newFiles.length > 0 && !dryRun) {
        await db.collection<SourceFile>("source_files").insertMany(newFiles);
    }

    return newFiles;
}
