import { Db, MongoClient } from "mongodb";
import * as path from "@std/path";

const MIGRATIONS_DIR = "migrations";
const CHANGELOG_COLLECTION = "migrations";

export interface Migration {
  up(db: Db, client: MongoClient): Promise<void>;
  down(db: Db, client: MongoClient): Promise<void>;
}

async function getAppliedMigrations(db: Db): Promise<Set<string>> {
  const collection = db.collection(CHANGELOG_COLLECTION);
  const applied = await collection.find({}).sort({ appliedAt: 1 }).toArray();
  return new Set(applied.map((doc) => doc.fileName));
}

async function listMigrationFiles(): Promise<string[]> {
  const migrationsDir = path.resolve(Deno.cwd(), MIGRATIONS_DIR);
  const files: string[] = [];
  
  try {
    for await (const entry of Deno.readDir(migrationsDir)) {
      if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        files.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn(`Migrations directory not found at ${migrationsDir}`);
      return [];
    }
    throw error;
  }

  return files.sort();
}

export async function up(db: Db, client: MongoClient): Promise<string[]> {
  const collections = await db.listCollections({ name: CHANGELOG_COLLECTION }).toArray();
  if (collections.length === 0) {
    await db.createCollection(CHANGELOG_COLLECTION);
  }

  const applied = await getAppliedMigrations(db);
  const allFiles = await listMigrationFiles();
  const pending = allFiles.filter((f) => !applied.has(f));

  const migrated: string[] = [];

  for (const file of pending) {
    console.log(`Migrating up: ${file}`);
    const filePath = path.toFileUrl(path.resolve(Deno.cwd(), MIGRATIONS_DIR, file)).href;
    
    try {
      const migrationModule = await import(filePath);
      const migration: Migration = migrationModule; // imports exports directly

      if (typeof migration.up !== "function") {
        throw new Error(`Migration ${file} does not export an 'up' function`);
      }

      await migration.up(db, client);

      await db.collection(CHANGELOG_COLLECTION).insertOne({
        fileName: file,
        appliedAt: new Date(),
      });

      migrated.push(file);
      console.log(`Migrated: ${file}`);
    } catch (error) {
      console.error(`Failed to migrate ${file}:`, error);
      throw error; // Stop migration on failure
    }
  }

  return migrated;
}

