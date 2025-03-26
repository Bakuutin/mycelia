import { promises as fs } from "fs";
import path from "path";
import { MongoClient, ObjectId } from "mongodb";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { hostname, platform } from "os";

const IS_AUDIO_RE = /\.(m4a|mp3|wav|opus)$/i;

// Function to check if a file is an audio file
function isAudioFile(filePath: string): boolean {
  return IS_AUDIO_RE.test(filePath);
}

// Function to check if a file is already discovered
async function isDiscovered(filePath: string): Promise<boolean> {
  return !!(await sourceFiles.findOne({ path: filePath }));
}

// Placeholder for getting OS metadata
async function getOsMetadata(filePath: string): Promise<Metadata> {
  // Implement logic to retrieve metadata
  return { path: filePath, created: new Date() };
}

interface Importer {
  discover(): Promise<Metadata[]>;
  getStart(metadata: Metadata): Date;
  ingest(metadata: Metadata): Promise<void>;
  run(): Promise<void>;
}

export class FileSystemImporter implements Importer {
  root: string;

  constructor(root: string) {
    this.root = root;
  }

  async shouldDiscover(filePath: string): Promise<boolean> {
    return isAudioFile(filePath) && !(await isDiscovered(filePath));
  }

  getStart(metadata: Metadata): Date {
    if (!metadata.created) {
      throw new Error("Metadata created date is missing");
    }
    return metadata.created;
  }

  async discover(): Promise<Metadata[]> {
    const results: Metadata[] = [];
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(this.root, entry.name);
      if (entry.isFile() && await this.shouldDiscover(fullPath)) {
        results.push(await getOsMetadata(fullPath));
      }
    }
    return results;
  }

  async ingest(metadata: Metadata): Promise<void> {
    metadata.ingested = false;
    metadata.platform = {
      system: platform(),
      node: hostname(),
    };
    metadata.start = this.getStart(metadata);
    console.debug(`adding ${metadata.path} to source_files`);
    await sourceFiles.insertOne(metadata);
  }

  async run(): Promise<void> {
    const newFiles = await this.discover();
    for (const item of newFiles) {
      await this.ingest(item);
    }
  }
}

async function ingestsMissingSources(limit?: number) {
  const query = sourceFiles.find({ ingested: false }).sort({ start: -1 });
  if (limit) {
    query.limit(limit);
  }
  for await (const source of query) {
    if (source.ingestion?.error) {
      console.log(`Skipping ${source._id} due to previous error`);
      continue;
    }
    try {
      // Implement ingestSource logic here
      await sourceFiles.updateOne({ _id: source._id }, {
        $set: { ingested: true },
      });
    } catch (e: unknown) {
      console.error(`Error ingesting ${source._id}`, e);
      await sourceFiles.updateOne({ _id: source._id }, {
        $set: {
          ingestion: { error: (e as Error).message, last_attempt: new Date() },
        },
      });
    }
  }
}
