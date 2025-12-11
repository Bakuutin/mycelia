#!/bin/bash
# Mycelia AI Services - Quick Setup Script
# Installs Docker, NVIDIA toolkit, and starts all services
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/olama-setup/deploy/setup.sh | bash
#   # Or with options:
#   ./setup.sh --gpu          # GPU mode (default)
#   ./setup.sh --cpu          # CPU-only mode
#   ./setup.sh --ollama-only  # Only Ollama

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[MYCELIA]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Defaults
MODE="gpu"
SERVICES="all"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --gpu) MODE="gpu"; shift ;;
        --cpu) MODE="cpu"; shift ;;
        --ollama-only) SERVICES="ollama"; shift ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --gpu          GPU mode (default)"
            echo "  --cpu          CPU-only mode"
            echo "  --ollama-only  Only install Ollama"
            exit 0
            ;;
        *) error "Unknown option: $1" ;;
    esac
done

log "Starting Mycelia AI Services Setup"
info "Mode: $MODE"
info "Services: $SERVICES"

# Detect OS
if [[ ! -f /etc/os-release ]]; then
    error "This script requires Linux"
fi
source /etc/os-release
log "Detected OS: $PRETTY_NAME"

# Install Docker if not present
install_docker() {
    if command -v docker &> /dev/null; then
        log "Docker already installed: $(docker --version)"
        return 0
    fi

    log "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo systemctl enable docker
    sudo systemctl start docker

    # Add current user to docker group
    sudo usermod -aG docker $USER
    log "Docker installed. You may need to log out and back in for group changes."
}

# Install NVIDIA Container Toolkit
install_nvidia_toolkit() {
    if [[ "$MODE" != "gpu" ]]; then
        return 0
    fi

    # Check if nvidia-smi works
    if ! command -v nvidia-smi &> /dev/null; then
        warn "NVIDIA driver not found. GPU support will not work."
        warn "Install NVIDIA drivers first, then re-run this script."
        return 1
    fi

    log "NVIDIA driver found: $(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1)"

    # Check if toolkit already installed
    if docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi &> /dev/null; then
        log "NVIDIA Container Toolkit already working"
        return 0
    fi

    log "Installing NVIDIA Container Toolkit..."

    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
        sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

    sudo apt-get update
    sudo apt-get install -y nvidia-container-toolkit
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker

    # Verify
    if docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi; then
        log "NVIDIA Container Toolkit installed successfully"
    else
        error "NVIDIA Container Toolkit installation failed"
    fi
}

# Clone repository
clone_repo() {
    if [[ -d "mycelia" ]]; then
        log "Repository already exists, pulling latest..."
        cd mycelia
        git pull origin olama-setup || true
    else
        log "Cloning Mycelia repository..."
        git clone -b olama-setup https://github.com/mycelia-tech/mycelia.git
        cd mycelia
    fi
}

# Setup environment
setup_env() {
    cd deploy

    if [[ ! -f .env ]]; then
        log "Creating .env file..."
        cp .env.example .env

        # Prompt for HF token if diarization will be used
        if [[ "$SERVICES" == "all" ]]; then
            echo ""
            warn "Diarization requires a Hugging Face token."
            echo "Get one from: https://huggingface.co/settings/tokens"
            echo "And accept terms at:"
            echo "  - https://huggingface.co/pyannote/speaker-diarization-3.1"
            echo "  - https://huggingface.co/pyannote/segmentation-3.0"
            echo ""
            read -p "Enter HF_TOKEN (or press Enter to skip): " HF_TOKEN
            if [[ -n "$HF_TOKEN" ]]; then
                sed -i "s/HF_TOKEN=.*/HF_TOKEN=$HF_TOKEN/" .env
            fi
        fi

        # Ask for Ollama models
        echo ""
        info "Choose Ollama model preset:"
        echo "  1) tiny   - 4GB  - llama3.2:3b"
        echo "  2) small  - 8GB  - qwen2.5:7b (default)"
        echo "  3) medium - 16GB - llama3.3:70b-instruct-q4_K_M"
        echo "  4) large  - 32GB - llama3.3:70b"
        echo "  5) xlarge - 48GB - llama4:scout"
        read -p "Select [1-5, default=2]: " preset

        case $preset in
            1) OLLAMA_MODELS="llama3.2:3b" ;;
            3) OLLAMA_MODELS="llama3.3:70b-instruct-q4_K_M" ;;
            4) OLLAMA_MODELS="llama3.3:70b" ;;
            5) OLLAMA_MODELS="llama4:scout" ;;
            *) OLLAMA_MODELS="qwen2.5:7b" ;;
        esac

        sed -i "s/OLLAMA_MODELS=.*/OLLAMA_MODELS=$OLLAMA_MODELS/" .env
        log "Selected model: $OLLAMA_MODELS"
    fi
}

# Start services
start_services() {
    log "Starting services (this may take a while on first run)..."

    if [[ "$SERVICES" == "ollama" ]]; then
        docker compose --profile $MODE up -d ollama ollama-setup
    else
        docker compose --profile $MODE up -d
    fi

    log "Waiting for services to be ready..."
    sleep 10

    # Show status
    docker compose ps
}

# Configure firewall
setup_firewall() {
    if command -v ufw &> /dev/null; then
        log "Configuring UFW firewall..."
        sudo ufw allow 11434/tcp  # Ollama
        sudo ufw allow 8081/tcp   # Whisper
        sudo ufw allow 8085/tcp   # Diarization
        sudo ufw reload || true
    fi
}

# Show final status
show_status() {
    local IP
    IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "YOUR_SERVER_IP")

    echo ""
    echo "╔═══════════════════════════════════════════════════════════════════════╗"
    echo -e "║              ${GREEN}✓ Mycelia AI Services Ready!${NC}                            ║"
    echo "╚═══════════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "SERVICE URLS:"
    echo "  Ollama:       http://$IP:11434"
    if [[ "$SERVICES" == "all" ]]; then
        echo "  Whisper:      http://$IP:8081"
        echo "  Diarization:  http://$IP:8085"
    fi
    echo ""
    echo "───────────────────────────────────────────────────────────────────────"
    echo ""
    echo "CONNECT TO MYCELIA (on your local machine):"
    echo ""
    echo "  cd backend"
    echo ""
    echo "  # Add LLM"
    echo "  deno task cli llm ollama-setup http://$IP:11434"
    echo ""
    if [[ "$SERVICES" == "all" ]]; then
        echo "  # Update .env"
        echo "  echo 'STT_SERVER_URL=http://$IP:8081' >> .env"
        echo "  echo 'DIARIZATION_SERVER_URL=http://$IP:8085' >> .env"
        echo ""
    fi
    echo "  # Test"
    echo "  deno task cli llm test small"
    echo ""
    echo "───────────────────────────────────────────────────────────────────────"
    echo ""
    echo "MANAGEMENT:"
    echo ""
    echo "  View logs:     docker compose logs -f"
    echo "  Stop:          docker compose down"
    echo "  Restart:       docker compose restart"
    echo "  GPU usage:     nvidia-smi"
    echo ""
}

# Main
main() {
    install_docker
    install_nvidia_toolkit
    clone_repo
    setup_env
    start_services
    setup_firewall
    show_status
}

main
