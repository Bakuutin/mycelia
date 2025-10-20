# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the standalone React frontend for Mycelia, a self-hosted AI memory and timeline system. The frontend is a Single Page Application (SPA) built with React, TypeScript, Vite, and D3.js for interactive timeline visualization.

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check without emitting files
npm run type-check

# Lint code
npm run lint
```

## Architecture

### Tech Stack
- **React 18** with TypeScript
- **React Router v7** for client-side routing
- **Vite** for build tooling and dev server
- **Zustand** for state management
- **D3.js** for timeline visualization with zoom/pan
- **Tailwind CSS v4** for styling
- **Radix UI** for accessible component primitives
- **Zod** for runtime validation

### Project Structure

```
src/
├── components/        # Reusable React components
│   ├── ui/           # Radix UI-based primitive components
│   └── forms/        # Form components
├── core/             # Core type definitions (Layer, Tool, Config)
├── hooks/            # Custom React hooks
│   ├── useTimeline.ts    # Timeline zoom/pan with D3
│   └── useTheme.ts       # Dark mode management
├── lib/              # Utility functions
│   ├── api.ts        # API client with OAuth2 integration
│   ├── auth.ts       # JWT token exchange
│   └── utils.ts      # Helper functions
├── modules/          # Feature modules (Layer system)
│   ├── audio/        # Audio playback and transcription display
│   ├── events/       # Event timeline layer
│   ├── time/         # Time formatting (SI units, Gregorian)
│   ├── ranges/       # Range utilities
│   ├── map/          # Map visualization layer
│   └── log/          # Debug logging layer
├── pages/            # Route page components
├── stores/           # Zustand state stores
│   ├── timelineRange.ts  # Timeline date range with URL sync
│   └── settingsStore.ts  # App settings (API endpoint, credentials)
└── types/            # TypeScript type definitions
```

## Key Concepts

### Modular Timeline System

The timeline is built on a **Layer** and **Tool** architecture defined in `src/core/core.ts`:

- **Layer**: A React component that renders on the timeline canvas (e.g., audio items, events, map data). Receives `scale` (D3 time scale), `transform` (zoom state), and `width` props.
- **Tool**: A React component that provides UI controls for the timeline (e.g., audio player controls).
- **Config**: Object containing arrays of layers and tools to enable.

Layers are registered in individual modules (e.g., `src/modules/audio/index.tsx`, `src/modules/events/index.tsx`) and composed in the timeline page.

### State Management

**Zustand stores:**
- `timelineRange.ts`: Manages timeline start/end dates, synchronized with URL query params (`?start=...&end=...`). Provides `setRange()`, `duration`, and `center` computed properties.
- `settingsStore.ts`: Persists API endpoint, client ID, and client secret to localStorage.

### Timeline Visualization

`src/hooks/useTimeline.ts` implements D3-based zoom/pan:
- Creates a `d3.scaleTime()` mapping dates to pixels
- Handles zoom events and updates the timeline range store
- Debounces range updates to avoid excessive re-renders
- Supports synchronized zooming across multiple timeline layers

### API Integration

`src/lib/api.ts` provides `ApiClient` class:
- Exchanges OAuth2 client credentials for JWT tokens
- Caches JWT with 6-hour expiry
- Provides `get()`, `post()`, `put()`, `delete()` methods
- Special `callResource()` method for resource-based API calls using EJSON serialization

**Backend connection:**
- Vite dev server proxies `/api/*` and `/data/*` to backend (default: `http://localhost:8000`)
- Configure proxy target in `vite.config.ts`

### Audio Module

`src/modules/audio/`:
- **useAudioItems.ts**: Hook that fetches audio chunks for visible timeline range, manages loaded/in-flight ranges to avoid duplicate requests
- **useTranscripts.ts**: Fetches transcriptions for audio items
- **player.tsx**: Web Audio API-based player with chunked streaming
- **TimelineItems.tsx**: Renders audio waveforms/items on timeline

### Import Conventions

Use `@/` alias for all imports:
```typescript
import { Component } from '@/components/Component'
import { useTimeline } from '@/hooks/useTimeline'
import type { TimelineItem } from '@/types/timeline'
```

## Code Style

- **TypeScript**: Strict mode enabled, prefer explicit types
- **Interfaces vs Types**: Use `interface` for object shapes, `type` for unions
- **Zod**: Use Zod schemas for runtime validation (e.g., URL params, API responses)
- **No Comments**: Code should be self-documenting with descriptive names
- **Formatting**: Consistent with project conventions (2-space indent, single quotes)
