# Database Migrations

This document explains how to manage database migrations in Mycelia.

## Overview

Mycelia uses a custom migration system built on top of MongoDB. Migration files are stored in `backend/migrations/` and are numbered sequentially (e.g., `0001_init.ts`, `0002_messengers_setup.ts`).

## Migration Rules

⚠️ **NEVER EDIT HISTORICAL MIGRATIONS**

- Once a migration has been applied to any environment, it is considered immutable
- If you need to make changes to the schema or data, ALWAYS create a new migration file with a sequential prefix
- Historical migrations (like `0001_init.ts`) cannot be modified

## Running Migrations

### In Docker (Production/Development)

From the project root directory (`/srv/mycelia`):

```bash
# Apply all pending migrations
docker compose exec backend deno run -A server.ts migrate-up

# Check migration status
docker compose exec backend deno run -A server.ts migrate-status

# Rollback the last migration
docker compose exec backend deno run -A server.ts migrate-down

# Rollback multiple migrations (e.g., last 3)
docker compose exec backend deno run -A server.ts migrate-down -n 3

# Migrate to a specific version
docker compose exec backend deno run -A server.ts migrate-to -m 0012_update_chat_system_prompt.ts
```

### Local Development (without Docker)

From the `backend/` directory:

```bash
# Apply all pending migrations
deno run -A server.ts migrate-up

# Check migration status
deno run -A server.ts migrate-status

# Rollback the last migration
deno run -A server.ts migrate-down

# Migrate to a specific version
deno run -A server.ts migrate-to -m 0012_update_chat_system_prompt.ts
```

## Creating New Migrations

1. Create a new file in `backend/migrations/` with the next sequential number
2. Follow the naming pattern: `XXXX_description.ts`
3. Export `up` and `down` functions:

```typescript
import { Db, ObjectId } from "mongodb";

export const up = async (db: Db) => {
  // Your migration logic here
  console.log("Applying migration...");
  
  const collection = db.collection("your_collection");
  // ... perform updates
  
  console.log("Migration completed successfully");
};

export const down = async (db: Db) => {
  // Rollback logic (optional but recommended)
  console.log("Rolling back migration...");
  
  // ... revert changes
  
  console.log("Rollback completed");
};
```

## Migration Status

The `migrate-status` command shows:
- Total number of migrations
- Applied migrations (marked with ✓)
- Pending migrations (marked with ○)

Example output:
```
Migration Status:
Total migrations: 12
Applied: 11
Pending: 1

Applied migrations:
  ✓ 0001_init.ts
  ✓ 0002_messengers_setup.ts
  ...

Pending migrations:
  ○ 0012_update_chat_system_prompt.ts
```

## Helper Functions

Common migration helpers are available in `backend/utils/migrations.ts`:

- `ensureCollectionExists(db, collectionName)` - Create collection if it doesn't exist
- `ensureGridFSBucketExists(db, bucketName)` - Create GridFS bucket collections
- `ensureIndexExists(db, collectionName, indexSpec, options)` - Create index if it doesn't exist

## Troubleshooting

**Migration fails midway:**
- Migrations are not transactional in MongoDB
- You may need to manually fix the data and re-run
- Check the `migrations` collection to see what was recorded

**Migration already applied:**
- Check `migrate-status` to see current state
- The system tracks applied migrations in the `migrations` collection

**Need to skip a migration:**
- Use `migrate-to` to migrate to a specific version
- Be cautious about data consistency
