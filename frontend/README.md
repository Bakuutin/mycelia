# Mycelia Frontend

A standalone React SPA for the Mycelia AI memory and timeline system.

## Tech Stack

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
# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run type-check
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
└── package.json        # Dependencies and scripts
```

## API Integration

The frontend connects to the Mycelia backend API server (default: http://localhost:8000). API proxy is configured in `vite.config.ts`:

- `/api/*` - API endpoints
- `/data/*` - Data endpoints

## Features

- **Timeline View** - Interactive timeline with audio, events, and conversations
- **Conversations** - Manage conversation summaries with time intervals
- **Events** - Create and organize life events
- **Dark Mode** - Built-in dark mode support
- **Responsive** - Mobile-friendly interface
