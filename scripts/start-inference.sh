#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Inference Stack Startup ===${NC}"

# Check for .env file
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "${YELLOW}No .env file found. Creating one from .env.example...${NC}"
        cp .env.example .env
        echo -e "${YELLOW}Please edit .env and add your HF_TOKEN!${NC}"
    else
        echo -e "${RED}Error: No .env or .env.example file found.${NC}"
        exit 1
    fi
fi

# Check for HF_TOKEN
if grep -q "hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" .env || ! grep -q "HF_TOKEN" .env; then
    echo -e "${RED}ERROR: HF_TOKEN is not configured in .env${NC}"
    echo -e "${YELLOW}1. Get your token at: https://huggingface.co/settings/tokens${NC}"
    echo -e "${YELLOW}2. Open .env and replace hf_xxxxxxxx... with your token${NC}"
    echo -e "${YELLOW}3. Ensure you have accepted the model terms on HuggingFace${NC}"
    # exit 1  <-- Optional: enforce exit, or just warn. Let's warn for now as Whisper/Ollama might work without it.
    echo -e "${YELLOW}Diarization service will fail to start without a valid token.${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Detect GPU
HAS_GPU=false
if command -v nvidia-smi &> /dev/null; then
    if nvidia-smi &> /dev/null; then
        HAS_GPU=true
        echo -e "${GREEN}✓ NVIDIA GPU detected${NC}"
    else
        echo -e "${YELLOW}! nvidia-smi found but failed to run. Assuming no GPU.${NC}"
    fi
else
    echo -e "${YELLOW}! No NVIDIA GPU detected (nvidia-smi not found).${NC}"
fi

# Select Profile
if [ "$HAS_GPU" = true ]; then
    PROFILE="gpu"
    echo -e "${BLUE}Starting stack with GPU acceleration...${NC}"
else
    PROFILE="cpu-only" # Use cpu-only profile for pure CPU mode, or 'cpu' if services support both
    # In my docker-compose, 'cpu-only' calls the cpu-specific images/services if defined, or reuse main service if flexible.
    # Looking at docker-compose.inference.yml:
    # whisper-stt-cpu has profile 'cpu-only'
    # diarization-cpu has profile 'cpu' and 'cpu-only'
    # ollama has profile 'cpu', 'cpu-only'

    echo -e "${YELLOW}Starting stack in CPU-only mode...${NC}"
fi

# Start Services
# We use docker-compose.inference.yml
COMPOSE_FILE="docker-compose.inference.yml"

echo -e "${BLUE}Running: docker compose -f $COMPOSE_FILE --profile $PROFILE up -d${NC}"
docker compose -f $COMPOSE_FILE --profile $PROFILE up -d

# Wait for healthchecks
echo -e "${BLUE}Waiting for services to be healthy...${NC}"

check_health() {
    local url=$1
    local name=$2
    local max_retries=30
    local retry=0

    echo -n "Waiting for $name..."
    while [ $retry -lt $max_retries ]; do
        if curl -s -o /dev/null -f "$url"; then
            echo -e " ${GREEN}OK${NC}"
            return 0
        fi
        echo -n "."
        sleep 2
        retry=$((retry+1))
    done
    echo -e " ${RED}Failed${NC}"
    return 1
}

# Whisper
check_health "http://localhost:8081/health" "Whisper STT"

# Diarization
check_health "http://localhost:8085/health" "Diarization"

# Ollama
# Ollama might take longer to pull models if not present, but we check basic API
check_health "http://localhost:11434/api/tags" "Ollama"

echo -e "\n${GREEN}=== Stack Deployed Successfully ===${NC}"
echo -e "Services available at:"
echo -e "  • Whisper STT:  ${BLUE}http://localhost:8081${NC}"
echo -e "  • Diarization:  ${BLUE}http://localhost:8085${NC}"
echo -e "  • Ollama:       ${BLUE}http://localhost:11434${NC}"
echo -e ""
echo -e "To stop services:"
echo -e "  docker compose -f $COMPOSE_FILE --profile $PROFILE down"
