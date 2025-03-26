import { open } from "sqlite";
import sqlite3 from "sqlite3";
import path from "path";
import { hostname, platform } from "os";

export class AppleVoiceMemosImporter implements Importer {
  root: string;

  constructor(root: string) {
    this.root = root;
  }

  getStart(metadata: Metadata): Date {
    if (!metadata.voicememo) {
      throw new Error("Voicememo metadata is missing");
    }
    return appleDateToDate(metadata.voicememo.ZDATE);
  }

  async getSqliteData(): Promise<any[]> {
    const db = await open({
      filename: `${this.root}/CloudRecordings.db`,
      driver: sqlite3.Database,
    });
    try {
      const results: any[] = await db.all(
        "SELECT ZENCRYPTEDTITLE, ZUNIQUEID, ZDATE, ZDURATION, ZPATH FROM ZCLOUDRECORDING",
      );
      return results;
    } finally {
      await db.close();
    }
  }

  async discover(): Promise<Metadata[]> {
    const results: Metadata[] = [];
    const memos = await this.getSqliteData();
    for (const memo of memos) {
      if (!memo.ZPATH) continue;
      const fullPath = path.join(this.root, memo.ZPATH);
      if (await isDiscovered(fullPath)) continue;
      results.push({
        ...await getOsMetadata(fullPath),
        voicememo: {
          ZENCRYPTEDTITLE: memo.ZENCRYPTEDTITLE,
          ZUNIQUEID: memo.ZUNIQUEID,
          ZDATE: memo.ZDATE,
        },
        duration: memo.ZDURATION,
      });
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
    console.info(`discovered ${newFiles.length} new files in '${this.root}'`);
    for (const item of newFiles) {
      await this.ingest(item);
    }
  }
}
