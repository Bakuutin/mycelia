# LLM Provider Routing

Mycelia routes every LLM request through a prioritized list of provider
profiles, mirroring the STT provider routing model. You can register several
OpenAI-compatible providers (OpenRouter, a local Ollama/vLLM box, a corporate
gateway), enable or disable each one, give them priorities, and see their
health — all in **Settings → Inference**.

## Concepts

- **Provider profile** — an OpenAI-compatible route: base URL, API key,
  per-alias model map, optional chat default, prompt-caching settings, an
  `enabled` flag and a `priority` (1–100, lower = preferred).
- **Aliases** — background tasks request `small` / `medium` / `large` instead
  of concrete model IDs. Each provider maps every alias to one of its own
  models, or leaves the alias unmapped (**None**), which excludes that
  provider from serving requests for it.
- **Failover chain** — for each request the backend takes all enabled
  providers that can serve the requested alias or explicit model, sorted by
  priority (ties break on name, then id). The request goes to the first
  provider; on a network error or a non-OK HTTP response it automatically
  retries on the next one down the chain.
- **Model-level fallback** — a task's configured `fallbackModel` is retried
  *within the same provider* before the chain advances to the next route.
- **Environment route** — when `OPENAI_BASE_URL` / `OPENAI_API_KEY` are set in
  the backend environment, they appear as a read-only "Environment LLM" route.
  It participates in routing only when `llmProfiles.includeEnvironment` is on,
  at `llmProfiles.environmentPriority`. It no longer silently overrides the
  configured profiles (migration `0024` preserves the old behavior by
  including it at priority 10 on deployments that had those variables set).

## Per-task models

Tasks (summaries, conversation extraction, tagging, chat) pick either an
alias or an exact model ID. Aliases are resolved per provider at request time,
so failover keeps working; explicit model IDs stay explicit and are never
substituted — a provider that does not have the model simply fails and the
chain moves on.

## Health

`jobs.pipeline_health` probes every **enabled** LLM route in parallel and
reports the aggregate as healthy when at least one route is healthy. Each
route's status, model, priority and latency appear in the `llm` service's
`routes` array — shown on the Jobs page and in Settings → Inference. Disabled
routes are not probed.

## Provenance

Each completion response carries `mycelia_routing` with the requested and
resolved model, the provider that actually served the request, and
`providerAttempts` — every route tried for that request, including the errors
that caused failover. Workers persist this into job artifacts.

## Storage

Everything lives in the server config (`configs` collection) under
`llmProfiles`:

```jsonc
{
  "llmProfiles": {
    "profiles": [
      {
        "id": "openrouter",
        "name": "OpenRouter",
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "sk-or-…",
        "aliases": { "small": "google/gemini-2.5-flash", "large": "anthropic/claude-opus-5" },
        "defaultAlias": "small",
        "enabled": true,
        "priority": 10
      },
      {
        "id": "local",
        "name": "Local vLLM",
        "baseUrl": "http://host.docker.internal:8000/v1",
        "apiKey": "local-no-auth",
        "aliases": { "small": "qwen3-8b" },
        "defaultAlias": "small",
        "enabled": true,
        "priority": 50
      }
    ],
    "includeEnvironment": false,
    "environmentPriority": 50
  }
}
```

`activeProfileId` is deprecated; it is kept in sync with the primary
(highest-priority enabled) profile only so older builds keep working during a
rollback.

Key code:

- `backend/app/lib/llm/provider-routing.ts` — pure selection/resolution logic.
- `backend/app/lib/llm/resource.server.ts` — route resolution, failover loop,
  `models` / `environment_status` actions.
- `backend/app/lib/jobs/service-health.ts` — multi-route health probing.
- `frontend/src/pages/settings/InferenceSettingsPage.tsx` — management UI.
