import { Db, MongoClient } from "mongodb";
import * as path from "@std/path";

const MIGRATIONS_DIR = "migrations";
const CHANGELOG_COLLECTION = "migrations";

export interface Migration {
  up(db: Db, client: MongoClient): Promise<void>;
  down(db: Db, client: MongoClient): Promise<void>;
}

async function getAppliedMigrations(db: Db): Promise<string[]> {
  const collection = db.collection(CHANGELOG_COLLECTION);
  const applied = await collection.find({}).sort({ appliedAt: 1 }).toArray();
  return applied.map((doc) => doc.fileName);
}

async function getAppliedMigrationsSet(db: Db): Promise<Set<string>> {
  const applied = await getAppliedMigrations(db);
  return new Set(applied);
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

async function ensureChangelogCollection(db: Db): Promise<void> {
  const collections = await db.listCollections({ name: CHANGELOG_COLLECTION }).toArray();
  if (collections.length === 0) {
    await db.createCollection(CHANGELOG_COLLECTION);
  }
}

async function loadMigration(file: string): Promise<Migration> {
  const filePath = path.toFileUrl(path.resolve(Deno.cwd(), MIGRATIONS_DIR, file)).href;
  const migrationModule = await import(filePath);
  return migrationModule as Migration;
}

async function callDown(migration: Migration, db: Db, client: MongoClient): Promise<void> {
  if (typeof migration.down !== "function") {
    throw new Error(`Migration does not export a 'down' function`);
  }

  const downFn = migration.down as (db: Db, client?: MongoClient) => Promise<void>;
  await downFn(db, client);
}

export async function up(db: Db, client: MongoClient): Promise<string[]> {
  await ensureChangelogCollection(db);

  const applied = await getAppliedMigrationsSet(db);
  const allFiles = await listMigrationFiles();
  const pending = allFiles.filter((f) => !applied.has(f));

  const migrated: string[] = [];

  for (const file of pending) {
    console.log(`Migrating up: ${file}`);
    
    try {
      const migration = await loadMigration(file);

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
      throw error;
    }
  }

  return migrated;
}

export async function down(db: Db, client: MongoClient, count = 1): Promise<string[]> {
  await ensureChangelogCollection(db);

  const applied = await getAppliedMigrations(db);
  if (applied.length === 0) {
    console.log("No migrations to rollback");
    return [];
  }

  const rolledBack: string[] = [];
  const toRollback = applied.slice(-count).reverse();

  for (const file of toRollback) {
    console.log(`Migrating down: ${file}`);
    
    try {
      const migration = await loadMigration(file);
      await callDown(migration, db, client);

      await db.collection(CHANGELOG_COLLECTION).deleteOne({ fileName: file });

      rolledBack.push(file);
      console.log(`Rolled back: ${file}`);
    } catch (error) {
      console.error(`Failed to rollback ${file}:`, error);
      throw error;
    }
  }

  return rolledBack;
}

export async function to(db: Db, client: MongoClient, targetFile: string): Promise<string[]> {
  await ensureChangelogCollection(db);

  const allFiles = await listMigrationFiles();
  const targetIndex = allFiles.indexOf(targetFile);
  
  if (targetIndex === -1) {
    throw new Error(`Migration ${targetFile} not found`);
  }

  const applied = await getAppliedMigrations(db);
  const appliedSet = new Set(applied);
  const appliedIndex = applied.length > 0 
    ? allFiles.indexOf(applied[applied.length - 1])
    : -1;

  if (targetIndex === appliedIndex) {
    console.log(`Already at migration ${targetFile}`);
    return [];
  }

  const migrated: string[] = [];

  if (targetIndex > appliedIndex) {
    const toApply = allFiles.slice(appliedIndex + 1, targetIndex + 1);
    for (const file of toApply) {
      console.log(`Migrating up: ${file}`);
      
      try {
        const migration = await loadMigration(file);

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
        throw error;
      }
    }
  } else {
    const toRollback = applied.filter((file) => {
      const fileIndex = allFiles.indexOf(file);
      return fileIndex > targetIndex;
    }).reverse();

    for (const file of toRollback) {
      console.log(`Migrating down: ${file}`);
      
      try {
        const migration = await loadMigration(file);
        await callDown(migration, db, client);

        await db.collection(CHANGELOG_COLLECTION).deleteOne({ fileName: file });

        migrated.push(file);
        console.log(`Rolled back: ${file}`);
      } catch (error) {
        console.error(`Failed to rollback ${file}:`, error);
        throw error;
      }
    }
  }

  return migrated;
}

export async function status(db: Db): Promise<{
  applied: string[];
  pending: string[];
  all: string[];
}> {
  await ensureChangelogCollection(db);

  const allFiles = await listMigrationFiles();
  const applied = await getAppliedMigrations(db);
  const appliedSet = new Set(applied);
  const pending = allFiles.filter((f) => !appliedSet.has(f));

  return {
    applied,
    pending,
    all: allFiles,
  };
}

