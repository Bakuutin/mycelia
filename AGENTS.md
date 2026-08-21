# Mycelia agent runtime checks

This checkout may be shared by parallel agents. Preserve unrelated changes and
stage only files owned by your task.

Before claiming that a code change is live:

1. Read the "Readiness and reload diagnostics" section in `DEVELOPMENT.md`.
2. Verify the backend and frontend bind mounts point at the current checkout.
3. Verify the effective runtime mode. Dev mode is `APP_MODE=dev`; a running
   production process will not load source edits.
4. Wait for the service's `[READY]` log and verify `docker compose ps` health.
5. If a change is stale, recreate only the affected application service and
   restart nginx. Do not restart MongoDB or Redis for code reloads.
6. Treat startup, listening, healthy, and ready as separate states. Report which
   state was actually verified.
7. For stalled extraction or summarization, inspect Jobs → Pipeline health &
   recovery before resetting anything. Failed history is intentional; use
   `Run now` for source recovery, and remember that automatic retries use
   backoff. Look for `[WATCHDOG]` and `[SELF-HEAL]` in backend logs.

The exact commands and recovery steps are maintained in `DEVELOPMENT.md`.
