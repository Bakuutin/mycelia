# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the standalone React frontend for Mycelia, a self-hosted AI memory and timeline system. The frontend is a Single Page Application (SPA) built with Deno, React, TypeScript, Vite, and D3.js for interactive timeline visualization.

## Development Commands

```bash
# Install dependencies (Deno handles this automatically)
deno install

# Start development server (http://localhost:3001)
deno task dev


# Build for production
deno task build

# Preview production build
deno task preview

# Type check without emitting files
deno task type-check

# Lint code
deno lint
```

## Architecture

### Tech Stack
- **Deno** for runtime and package management
- **React 18** with TypeScript
- **React Router v7** for client-side routing
- **Vite** with @deno/vite-plugin for build tooling and dev server
- **Zustand** for state management
- **D3.js** for timeline visualization with zoom/pan
- **Tailwind CSS v4** for styling
- **Radix UI** for accessible component primitives
- **Zod** for runtime validation
- **React Hook Form** with Zod resolvers for form handling

### Project Structure

```
src/
├── components/        # Reusable React components
│   ├── ui/           # Radix UI-based primitive components
│   ├── forms/        # Form components
│   └── SettingsLayout.tsx  # Settings tab navigation layout
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
│   └── log/        # Debug logging layer
├── pages/            # Route page components
│   └── settings/     # Settings sub-pages
│       ├── GeneralSettingsPage.tsx    # Appearance & time settings
│       ├── APISettingsPage.tsx       # API configuration
│       ├── LLMSettingsPage.tsx        # LLM models management
│       ├── CreateLLMPage.tsx          # Add new LLM model
│       └── LLMDetailPage.tsx          # Edit LLM model
├── stores/           # Zustand state stores
│   ├── timelineRange.ts  # Timeline date range with URL sync
│   └── settingsStore.ts  # App settings (API endpoint, credentials)
└── types/            # TypeScript type definitions
    └── llm.ts        # LLM model types and schemas
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

### Settings Multi-Page Structure

The Settings section uses a tabbed layout with nested routing:

**Settings Layout** (`src/components/SettingsLayout.tsx`):
- Tab-based navigation with sidebar
- Three main sections: General, API, LLMs
- Clean, organized layout with descriptions

**Settings Pages:**
- **General Settings** (`/settings`) - Appearance and time format
- **API Settings** (`/settings/api`) - API configuration and authentication  
- **LLMs Settings** (`/settings/llms`) - LLM models management

**LLM Models Management:**
- Full CRUD functionality for LLM models
- Form validation with Zod schemas
- API key visibility toggle
- Provider and endpoint configuration

### Audio Module

`src/modules/audio/`:
- **useAudioItems.ts**: Hook that fetches audio chunks for visible timeline range, manages loaded/in-flight ranges to avoid duplicate requests
- **useTranscripts.ts**: Fetches transcriptions for audio items
- **player.tsx**: Web Audio API-based player with chunked streaming
- **TimelineItems.tsx**: Renders audio waveforms/items on timeline

### Import Conventions

Use `@/` alias for all imports (configured in `deno.json` import map):
```typescript
import { Component } from '@/components/Component'
import { useTimeline } from '@/hooks/useTimeline'
import type { TimelineItem } from '@/types/timeline'
```

Dependencies are managed through Deno's import map in `deno.json`:
- npm packages are prefixed with `npm:` in the import map
- Standard library packages use `jsr:@std/*`
- The `@/` alias points to `./src/`

### Form Handling

**React Hook Form with Zod:**
- Use `useForm` hook with `zodResolver` for form validation
- Define Zod schemas for runtime validation
- Handle form state, errors, and submission

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
});

const form = useForm({
  resolver: zodResolver(schema),
  defaultValues: { name: '', email: '' }
});
```

### UI Component Conventions

**Date and Time Input:**
- **ALWAYS** use `DateTimePicker` component from `@/components/ui/datetime-picker` for editable date/time fields
- Never use native HTML `<input type="datetime-local">` or `<input type="date">`
- `DateTimePicker` integrates with user's time format preferences (SI time/Gregorian) from settings store
- Uses Unix timestamp input with formatted display

```typescript
import { DateTimePicker } from '@/components/ui/datetime-picker';

<DateTimePicker
  value={startDate}
  onChange={(date) => setStartDate(date)}
  placeholder="Pick a date and time"
/>
```

### Deno-Specific Patterns

**Import Maps:**
- All dependencies defined in `deno.json` imports
- Use `npm:` prefix for npm packages
- Use `jsr:` prefix for JSR packages
- Local imports use `@/` alias

**Development Workflow:**
- Use `deno task` commands for development
- Dependencies resolved automatically by Deno
- No `node_modules` directory (Deno caches in global cache)
- TypeScript support built-in

### Router Structure

**Nested Routes:**
- Settings uses nested routing with `SettingsLayout` as parent
- Routes: `/settings`, `/settings/api`, `/settings/llms`, `/settings/llms/new`, `/settings/llms/:id`
- Each settings page is a separate component in `src/pages/settings/`

**Navigation:**
- Main navigation: Timeline, Objects, Settings
- LLMs moved to Settings sub-page (not in main navigation)
- Settings uses tab-based sidebar navigation

## Code Style

- **TypeScript**: Strict mode enabled, prefer explicit types
- **Interfaces vs Types**: Use `interface` for object shapes, `type` for unions
- **Zod**: Use Zod schemas for runtime validation (e.g., URL params, API responses)
- **No Comments**: Code should be self-documenting with descriptive names
- **Formatting**: Consistent with project conventions (2-space indent, single quotes)
- **Deno**: Use Deno-specific patterns and import maps
