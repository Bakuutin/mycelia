#!/bin/bash
# Mycelia Server Connection Helper
# Creates SSH tunnel to remote Mycelia services
#
# First time: edit .server.conf with your server details
# Then just run: ./connect.sh
#
# Or override: ./connect.sh user@host:port

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/.server.conf"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Default values
SSH_PORT="22"
SSH_HOST=""
SSH_USER="root"

# Load config if exists
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
elif [[ -f "$CONFIG_FILE.example" ]]; then
    echo -e "${YELLOW}Config not found. Creating from example...${NC}"
    cp "$CONFIG_FILE.example" "$CONFIG_FILE"
    echo "Edit your server details:"
    echo "  $0 -c"
    exit 1
fi

# Parse command line arguments (override config)
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            SSH_PORT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Mycelia Server Connection"
            echo ""
            echo "Usage: $0 [OPTIONS] [user@host[:port]]"
            echo ""
            echo "Options:"
            echo "  -p, --port PORT    SSH port"
            echo "  -c, --config       Edit server config"
            echo "  -s, --setup        Run setup on server"
            echo "  -t, --tools        Install tools on server"
            echo ""
            echo "Config file: $CONFIG_FILE"
            echo ""
            echo "Examples:"
            echo "  $0                          # Use config file"
            echo "  $0 root@myserver.com:32701  # Override"
            echo "  $0 -c                       # Edit config"
            exit 0
            ;;
        -c|--config)
            ${EDITOR:-nano} "$CONFIG_FILE"
            exit 0
            ;;
        -s|--setup)
            # Load config and run setup on server
            echo -e "${BLUE}Running Ollama setup on server...${NC}"
            ssh -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
                "apt update && apt install -y curl && curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/ollama/setup.sh | bash"
            exit 0
            ;;
        -t|--tools)
            # Install tools on server
            echo -e "${BLUE}Installing tools on server...${NC}"
            ssh -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
                "curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/server-tools.sh | bash"
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

# Check if we have host
if [[ -z "$SSH_HOST" ]]; then
    echo -e "${YELLOW}No server configured!${NC}"
    echo ""
    echo "Option 1: Edit config file"
    echo "  $0 -c"
    echo ""
    echo "Option 2: Provide server directly"
    echo "  $0 root@your-server.com:22"
    echo ""
    exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           Mycelia Server Connection                           ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}Server:${NC} $SSH_USER@$SSH_HOST:$SSH_PORT"
echo ""
echo -e "${BLUE}Port forwarding:${NC}"
echo "  localhost:11434 → Ollama"
echo "  localhost:8081  → Whisper"
echo "  localhost:8085  → Diarization"
echo ""
echo -e "${YELLOW}Tip:${NC} Keep this terminal open while working"
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
