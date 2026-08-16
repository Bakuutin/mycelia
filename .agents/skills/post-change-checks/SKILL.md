---
name: post-change-checks
description: After code or config changes, update README/DEVELOPMENT.md to reflect new state, check doc consistency, and run linters. Use after modifying docker-compose.yml, .env.example, project structure, features, scripts, ports, commands, or any user-facing behavior.
---

# Post-Change Checks

After making substantive changes, run through these checks before finishing.

## 1. Documentation Updates

Identify which docs may be affected by the change:

| Change type                | Docs to check                                          |
| -------------------------- | ------------------------------------------------------ |
| New/changed env vars       | `.env.example`, README (Configuration), DEVELOPMENT.md |
| Port changes               | DEVELOPMENT.md (ports table), `docs/NETWORKING.md`     |
| New scripts/commands       | README (Quick Start / CLI), DEVELOPMENT.md             |
| Docker/compose changes     | README (Quick Start), DEVELOPMENT.md (Docker section)  |
| New features/roadmap items | README (Roadmap)                                       |
| New dependencies           | README (Prerequisites), DEVELOPMENT.md (Tech Stack)    |
| Project structure changes  | DEVELOPMENT.md (Project Structure tree)                |
| New docs added             | Link from README or DEVELOPMENT.md where relevant      |

**Update only what changed** - don't rewrite unrelated sections.

## 2. Consistency Checks

After updating docs, verify:

- [ ] Commands in docs actually work (correct paths, flags, service names)
- [ ] Port numbers match between `docker-compose.yml`, `.env.example`, docs
- [ ] Env var names match between `.env.example`, `docker-compose.yml`, docs
- [ ] Service names in docs match `docker-compose.yml`
- [ ] File paths referenced in docs exist
- [ ] No user-specific absolute paths — use `~` (tilde) per project convention
- [ ] `uv run` used everywhere instead of `python` (project convention)

## 3. Lint Check

Run `ReadLints` on all files you edited to catch introduced errors. Fix any you
introduced.

## When to Skip

- Pure refactors with no user-facing or config changes
- Changes only to test files
- Changes deep inside a single module with no doc surface
