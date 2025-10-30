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

The frontend connects to the Mycelia backend API server (default: http://localhost:5173). Configure the backend URL and credentials in the settings page.

## Features

- **Timeline View** - Interactive timeline with audio, events, and objects
- **Events** - Create and organize life events
- **Dark Mode** - Built-in dark mode support
- **Responsive** - Mobile-friendly interface
