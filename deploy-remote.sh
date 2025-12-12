#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== Mycelia Remote Deployment ===${NC}"

# Check for .server.conf
if [ ! -f deploy/.server.conf ]; then
    if [ -f deploy/.server.conf.example ]; then
        echo -e "${YELLOW}No deploy/.server.conf found. Creating from example...${NC}"
        cp deploy/.server.conf.example deploy/.server.conf
        echo -e "${RED}Please edit deploy/.server.conf with your server details!${NC}"
        exit 1
    else
        echo -e "${RED}Error: deploy/.server.conf not found.${NC}"
        exit 1
    fi
fi

# Load Config
source deploy/.server.conf

if [ -z "$SERVER_HOST" ]; then
    echo -e "${RED}Error: SERVER_HOST not set in deploy/.server.conf${NC}"
    exit 1
fi

SSH_PORT=${SSH_PORT:-22}
SSH_USER=${SSH_USER:-root}
REMOTE="$SSH_USER@$SERVER_HOST"
REMOTE_DIR="~/mycelia-inference"

echo -e "${BLUE}Deploying to: ${GREEN}$REMOTE${NC}"

# Check connection
echo -e "${BLUE}Checking connection...${NC}"
if ! ssh -p $SSH_PORT -o BatchMode=yes -o ConnectTimeout=5 $REMOTE "echo 'Connection OK'" &> /dev/null; then
    echo -e "${RED}Cannot connect to $REMOTE on port $SSH_PORT.${NC}"
    echo -e "Please ensure:"
    echo -e "1. You have SSH access. Try running this manually to accept the host key:"
    echo -e "   ${YELLOW}ssh -p $SSH_PORT $REMOTE${NC}"
    echo -e "2. If that works, run this script again."
    exit 1
fi

# Ensure rsync is installed on remote (needed for minimal images)
echo -e "${BLUE}Checking remote prerequisites...${NC}"
ssh -p $SSH_PORT $REMOTE "command -v rsync >/dev/null || (echo 'Installing rsync...' && apt-get update && apt-get install -y rsync)"

# Sync files
echo -e "${BLUE}Syncing files...${NC}"
# Exclude git, models, cache, etc to speed up sync
rsync -avz -e "ssh -p $SSH_PORT" \
    --exclude '.git' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude '.DS_Store' \
    --exclude '.env' \
    deploy/ \
    python/ \
    scripts/ \
    docker-compose.inference.yml \
    $REMOTE:$REMOTE_DIR/

# Sync .env if it exists locally, but don't overwrite if it exists remotely
if [ -f .env ]; then
    echo -e "${BLUE}Syncing .env file...${NC}"
    rsync -avz -e "ssh -p $SSH_PORT" .env $REMOTE:$REMOTE_DIR/.env
else
    echo -e "${YELLOW}No local .env found. Remote setup will require manual config or use .env.example${NC}"
    rsync -avz -e "ssh -p $SSH_PORT" .env.example $REMOTE:$REMOTE_DIR/.env.example
fi

# Run Setup remotely
echo -e "${BLUE}Running remote setup...${NC}"
ssh -p $SSH_PORT -t $REMOTE << EOF
    cd $REMOTE_DIR

    # Make scripts executable
    chmod +x scripts/*.sh setup.sh connect.sh server-tools.sh

    # Run Setup (installs Docker, Drivers etc)
    # We pass --no-tools to skip heavy zsh/tmux if just deploying stack, or keep it if user wants full env.
    # Let's default to full setup for "straightforward" request.
    ./setup.sh --gpu

    # Start Inference Stack
    echo -e "\n${GREEN}Starting Inference Stack...${NC}"
    ./scripts/start-inference.sh
EOF

echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo -e "You can access the server via:"
echo -e "  ssh -p $SSH_PORT $REMOTE"
