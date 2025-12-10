import { up } from "./migrator.ts";
import { getRootDB } from "./core.server.ts";
import { Db } from "mongodb";

export async function ensureAllCollectionsExist(db: Db): Promise<string[]> {
  console.log("Running database migrations...");
  try {
    const migrated = await up(db, db.client as any);
    if (migrated.length > 0) {
      console.log(`Applied ${migrated.length} migrations.`);
      return migrated;
    } else {
      console.log("No new migrations to apply.");
      return [];
    }
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}
