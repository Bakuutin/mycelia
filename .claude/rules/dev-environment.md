---
# No paths = applies globally (always)
---

# Dev Environment (Docker)

- **Frontend and backend run in Docker** with hot reload (frontend and backend dirs are volume-mounted).
- **Assume they are already running.** You can check the app in the browser or hit APIs without starting anything.
- **Only if services are not running:** run `docker compose up -d`. Do not start frontend/backend manually outside Docker for normal dev.

## Path Conventions

- **Always use generic paths in examples and documentation** - use `~` (tilde) for home directory instead of user-specific absolute paths like `/Users/pk`.
- Examples: `~/.mycelia/data/mongo` instead of `/Users/pk/.mycelia/data/mongo`
- This applies to `.env.example`, documentation, comments, and any example code.
