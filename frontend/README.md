# Mycelia Frontend

A standalone React SPA for the Mycelia AI memory and timeline system.

## Tech Stack

- **Deno** - Runtime and package manager
- **React 18** - UI framework
- **React Router v7** - Client-side routing
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **D3.js** - Timeline visualization
- **Radix UI** - Accessible component primitives

## Development

```bash
# Install dependencies (Deno handles this automatically)
deno install

# Start development server (http://localhost:3001)
deno task dev

# Build for production
deno task build

# Preview production build
deno task preview

# Type check
deno task type-check

# Lint
deno lint
```

## Docker (Production)

Build and run via the root docker-compose (recommended):

```bash
# From repo root
docker compose build frontend
docker compose up -d frontend
```

Served at http://localhost:8080.

## Project Structure

```
frontend/
├── src/
│   ├── components/     # Reusable React components
│   ├── pages/          # Page components for routes
│   ├── lib/            # Utility functions and helpers
│   ├── hooks/          # Custom React hooks
│   ├── stores/         # Zustand state stores
│   ├── types/          # TypeScript type definitions
│   ├── App.tsx         # Root application component
│   ├── main.tsx        # Entry point
│   └── index.css       # Global styles
├── index.html          # HTML template
├── vite.config.ts      # Vite configuration
├── tsconfig.json       # TypeScript configuration
├── deno.json           # Deno configuration and import maps
└── package.json        # npm compatibility and scripts
```

## API Integration

The frontend connects to the Mycelia backend API server (default:
http://localhost:5173). Configure the backend URL and credentials in the
settings page.

The standalone RAG runtime is never called from the browser directly. Smart
Search and Knowledge settings both use the authenticated backend Resource `rag`,
so runtime endpoints and internal credentials remain server-side.

## Knowledge search

- `/search` provides hybrid (default), semantic, and lexical search with kind,
  date/time, exact source, message platform/sender, result-limit, and evidence
  diversity controls. It shows canonical MongoDB revalidation, evidence/source
  revision IDs, links back to Mycelia records, and distinguishes degraded
  retrieval from an authoritative empty result. Message evidence opens a bounded
  window around the exact message and highlights it; a deleted, malformed, or
  wrong-chat target fails visibly instead of opening unrelated recent content.
- `/settings/knowledge` shows Qdrant and projection state, build progress,
  per-source coverage and lag, errors, paginated chunk inspection, and the active
  inference contract (profile, pinned revisions, tokenizer/instructions,
  dimensions/normalization, executor/load state, compatibility, and reranker
  state). It also exposes pause, resume, reconcile, and confirmed blue/green
  rebuild controls.
- Qdrant is a rebuildable projection; MongoDB remains the canonical source. Mem0
  and other memory integrations are intentionally outside this interface.

## Features

- **Timeline View** - Interactive timeline with audio, events, and objects
- **Smart Search** - Hybrid Qdrant-backed retrieval with canonical provenance
- **Knowledge Operations** - Inspect, reconcile, pause, resume, and rebuild the
  RAG projection
- **Events** - Create and organize life events
- **Dark Mode** - Built-in dark mode support
- **Responsive** - Mobile-friendly interface
