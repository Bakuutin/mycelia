#!/bin/bash
# First-run setup script for Mycelia
# Creates .env, generates secrets, and optionally starts services
#
# Usage:
#   ./scripts/setup.sh              # Create .env with generated SECRET_KEY
#   ./scripts/setup.sh --start      # Also run docker compose up -d
#   ./scripts/setup.sh --with-tokens # Also generate API tokens (requires Docker)
#   ./scripts/setup.sh --with-tokens --start  # Full setup with tokens and start

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

# Parse arguments
START_SERVICES=false
GENERATE_TOKENS=false
FORCE=false

for arg in "$@"; do
    case $arg in
        --start) START_SERVICES=true ;;
        --with-tokens) GENERATE_TOKENS=true ;;
        --force) FORCE=true ;;
        --help|-h)
            echo "Usage: ./scripts/setup.sh [OPTIONS]"
            echo ""
            echo "First-run setup script for Mycelia"
            echo ""
            echo "Options:"
            echo "  --start        Start services after setup (docker compose up -d)"
            echo "  --with-tokens  Generate API tokens (requires Docker, starts MongoDB temporarily)"
            echo "  --force        Overwrite existing .env without prompting"
            echo "  --help, -h     Show this help message"
            echo ""
            echo "Examples:"
            echo "  ./scripts/setup.sh                      # Basic setup"
            echo "  ./scripts/setup.sh --start              # Setup and start services"
            echo "  ./scripts/setup.sh --with-tokens --start # Full setup with API tokens"
            exit 0
            ;;
    esac
done

echo "Mycelia First-Run Setup"
echo "========================"
echo ""

# Check for .env.example
if [[ ! -f "$ENV_EXAMPLE" ]]; then
    echo "Error: .env.example not found at $ENV_EXAMPLE"
    exit 1
fi

# Handle existing .env
if [[ -f "$ENV_FILE" ]]; then
    if [[ "$FORCE" == true ]]; then
        echo "Overwriting existing .env (--force)"
    else
        echo "Warning: .env already exists!"
        echo ""
        echo "Options:"
        echo "  1. To sync new variables from .env.example, run: ./scripts/sync-env.sh"
        echo "  2. To overwrite .env completely, run: ./scripts/setup.sh --force"
        echo ""
        read -p "Overwrite existing .env? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted. Use ./scripts/sync-env.sh to add missing variables."
            exit 0
        fi
    fi
fi

# Copy .env.example to .env
echo "Creating .env from .env.example..."
cp "$ENV_EXAMPLE" "$ENV_FILE"

# Generate SECRET_KEY
echo "Generating SECRET_KEY..."
SECRET_KEY=$(openssl rand -hex 32)
if [[ "$(uname)" == "Darwin" ]]; then
    # macOS sed requires empty string for -i
    sed -i '' "s/^SECRET_KEY=.*/SECRET_KEY=$SECRET_KEY/" "$ENV_FILE"
else
    sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$SECRET_KEY/" "$ENV_FILE"
fi
echo "  SECRET_KEY generated"

# Generate API tokens if requested
if [[ "$GENERATE_TOKENS" == true ]]; then
    echo ""
    echo "Generating API tokens (this requires Docker)..."
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        echo "Error: Docker is not installed or not in PATH"
        echo "Skipping token generation. You can generate tokens later via /setup page."
        GENERATE_TOKENS=false
    else
        # Pull images first if needed
        echo "  Pulling required images..."
        docker compose -f "$PROJECT_ROOT/docker-compose.yml" pull mongo backend --quiet 2>/dev/null || true
        
        # Start MongoDB temporarily
        echo "  Starting MongoDB..."
        docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d mongo redis --wait 2>/dev/null
        
        # Wait for MongoDB to be ready
        echo "  Waiting for MongoDB to be ready..."
        sleep 3
        
        # Generate tokens
        echo "  Running token-create..."
        TOKEN_OUTPUT=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" run --rm backend deno run -A server.ts token-create 2>&1)
        
        # Parse output for MYCELIA_CLIENT_ID and MYCELIA_TOKEN
        CLIENT_ID=$(echo "$TOKEN_OUTPUT" | grep -E "^MYCELIA_CLIENT_ID=" | cut -d= -f2)
        TOKEN=$(echo "$TOKEN_OUTPUT" | grep -E "^MYCELIA_TOKEN=" | cut -d= -f2)
        
        if [[ -n "$CLIENT_ID" && -n "$TOKEN" ]]; then
            # Update .env with tokens
            if [[ "$(uname)" == "Darwin" ]]; then
                sed -i '' "s/^MYCELIA_CLIENT_ID=.*/MYCELIA_CLIENT_ID=$CLIENT_ID/" "$ENV_FILE"
                sed -i '' "s/^MYCELIA_TOKEN=.*/MYCELIA_TOKEN=$TOKEN/" "$ENV_FILE"
            else
                sed -i "s/^MYCELIA_CLIENT_ID=.*/MYCELIA_CLIENT_ID=$CLIENT_ID/" "$ENV_FILE"
                sed -i "s/^MYCELIA_TOKEN=.*/MYCELIA_TOKEN=$TOKEN/" "$ENV_FILE"
            fi
            echo "  MYCELIA_CLIENT_ID and MYCELIA_TOKEN generated"
        else
            echo "  Warning: Could not parse token output. You may need to generate tokens manually."
            echo "  Token command output:"
            echo "$TOKEN_OUTPUT" | head -20
        fi
        
        # Stop MongoDB if we're not starting services
        if [[ "$START_SERVICES" != true ]]; then
            echo "  Stopping temporary containers..."
            docker compose -f "$PROJECT_ROOT/docker-compose.yml" down 2>/dev/null
        fi
    fi
fi

echo ""
echo "Setup complete!"
echo ""

# Start services if requested
if [[ "$START_SERVICES" == true ]]; then
    echo "Starting services..."
    docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d
    echo ""
    echo "Services started! Open https://localhost:4433 in your browser."
    if [[ "$GENERATE_TOKENS" != true ]]; then
        echo ""
        echo "Note: Visit /setup to generate API credentials on first visit."
    fi
else
    echo "Next steps:"
    echo "  1. Review and customize .env if needed"
    echo "  2. Run: docker compose up -d"
    echo "  3. Open https://localhost:4433 in your browser"
    if [[ "$GENERATE_TOKENS" != true ]]; then
        echo "  4. Visit /setup to generate API credentials"
    fi
fi
