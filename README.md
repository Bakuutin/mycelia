# Mycelia

Remember everything - A personal timeline and memory management system.

## About

Mycelia is a powerful application for managing and visualizing your personal
timeline. It allows you to:

- Track and organize events on a customizable timeline
- Import and process various data sources
- Play back audio recordings with transcript synchronization
- Manage and search through your personal history

The application uses MongoDB for data storage, Redis for queuing and caching,
and a modern React frontend with Remix and Tailwind CSS.

## Installation

### Install Deno

To run this project, you need to have Deno installed. You can install it using
one of the following methods:

**For Mac/Linux:**

```sh
curl -fsSL https://deno.land/x/install/install.sh | sh
```

**For Windows (PowerShell):**

```sh
irm https://deno.land/install.ps1 | iex
```

**Using Package Managers:**

- **Homebrew (Mac)**: `brew install deno`
- **Chocolatey (Windows)**: `choco install deno`
- **Scoop (Windows)**: `scoop install deno`

For more installation options, visit
[deno.land](https://deno.land/#installation).

### Dependencies

- **MongoDB** (v8)
- **Redis** (v7)
- **Node.js** (v20+)

## Getting Started

```sh
# Install dependencies
deno install

# Create docker data directory
mkdir .docker

# Start MongoDB and Redis services
docker compose up -d

# Set up configuration
cp .env.example .env
# Edit `.env`:
# - For SECRET_KEY: use a random string (32+ characters)
# - For passwords: use strong random passwords
# No need for pre-setup, you can create these values on the fly

# Start the development server
deno run -A --env cmd.ts serve
```

## Environment Configuration

Modify the `.env` file with your settings:

```
MONGO_URL=mongodb://localhost:27017
DATABASE_NAME=mycelia
REDIS_PASSWORD=your_redis_password
SECRET_KEY=your_secret_key
MONGO_INITDB_ROOT_USERNAME=admin
MONGO_INITDB_ROOT_PASSWORD=password
```

## CLI Commands

Mycelia provides several CLI commands to manage your data:

```sh
# Start the development server
deno run -A --env cmd.ts serve

# Import data files
deno run -A --env cmd.ts importers run

# Manage timeline data
deno run -A --env cmd.ts timeline recalculate

# Create authentication tokens
deno run -A --env cmd.ts token create
```

## Development

This project uses:

- **Remix** for server-side rendering and routing
- **React** for UI components
- **Tailwind CSS** for styling
- **Vite** for frontend development
- **TypeScript** for type safety

## License

[MIT License](LICENSE)
