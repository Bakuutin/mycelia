import { promises as fs } from "fs";
import path from "path";
import { hostname, platform } from "os";

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
