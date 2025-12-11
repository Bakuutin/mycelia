#!/bin/bash
# Mycelia Server Connection Helper
# Creates SSH tunnel to remote Mycelia services
#
# Usage:
#   ./connect.sh                     # Interactive mode
#   ./connect.sh user@host           # Standard SSH (port 22)
#   ./connect.sh user@host:port      # Custom SSH port
#   ./connect.sh -p 32701 user@host  # Explicit port

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           Mycelia Server Connection Helper                    ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Parse arguments
SSH_PORT="22"
SSH_HOST=""
SSH_USER="root"

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            SSH_PORT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS] [user@]host[:port]"
            echo ""
            echo "Options:"
            echo "  -p, --port PORT    SSH port (default: 22)"
            echo ""
            echo "Examples:"
            echo "  $0 root@myserver.com"
            echo "  $0 root@provider.akash.pub:32701"
            echo "  $0 -p 32701 root@provider.akash.pub"
            exit 0
            ;;
        *)
            # Parse user@host:port format
            if [[ "$1" == *"@"* ]]; then
                SSH_USER="${1%%@*}"
                remainder="${1#*@}"
            else
                remainder="$1"
            fi

            if [[ "$remainder" == *":"* ]]; then
                SSH_HOST="${remainder%%:*}"
                SSH_PORT="${remainder#*:}"
            else
                SSH_HOST="$remainder"
            fi
            shift
            ;;
    esac
done

# Interactive mode if no host provided
if [[ -z "$SSH_HOST" ]]; then
    echo -e "${BLUE}Enter your server details:${NC}"
    echo ""
    read -p "Server hostname (e.g., provider.4090.akash.pub): " SSH_HOST
    read -p "SSH port [22]: " input_port
    SSH_PORT="${input_port:-22}"
    read -p "Username [root]: " input_user
    SSH_USER="${input_user:-root}"
fi

echo ""
echo -e "${GREEN}Connecting to:${NC} $SSH_USER@$SSH_HOST:$SSH_PORT"
echo ""
echo -e "${YELLOW}Port forwarding:${NC}"
echo "  Ollama:       localhost:11434 → server:11434"
echo "  Whisper:      localhost:8081  → server:8081"
echo "  Diarization:  localhost:8085  → server:8085"
echo ""
echo -e "${BLUE}After connection, configure Mycelia with:${NC}"
echo ""
echo "  cd backend"
echo "  deno task cli llm ollama-setup http://localhost:11434"
echo ""
echo "Press Ctrl+C to disconnect"
echo ""
echo "───────────────────────────────────────────────────────────────"

# Connect with port forwarding
exec ssh -p "$SSH_PORT" \
    -L 11434:localhost:11434 \
    -L 8081:localhost:8081 \
    -L 8085:localhost:8085 \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=3 \
    "$SSH_USER@$SSH_HOST"
