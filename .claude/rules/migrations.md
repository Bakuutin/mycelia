---
paths: backend/migrations/*.ts
---

# Migration Rules

- NEVER EDIT HISTORICAL MIGRATIONS.
- If you need to change the schema or data, ALWAYS add a new migration file with the next sequential prefix.
- Treat existing migrations (e.g. `0001_init.ts`) as immutable once applied in any environment.
