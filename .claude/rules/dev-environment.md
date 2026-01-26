---
# No paths = applies globally (always)
---

# Dev Environment (Docker)

- **Frontend and backend run in Docker** with hot reload (frontend and backend dirs are volume-mounted).
- **Assume they are already running.** You can check the app in the browser or hit APIs without starting anything.
- **Only if services are not running:** run `docker compose up -d`. Do not start frontend/backend manually outside Docker for normal dev.
