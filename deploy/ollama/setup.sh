#!/bin/bash
# Ollama Remote Server Setup Script
# Usage: ./setup.sh [OPTIONS]
#
# Options:
#   --preset PRESET  - Model preset (see below)
#   --models LIST    - Custom comma-separated model list
#   --port PORT      - Port to expose (default: 11434)
#   --bind ADDRESS   - Bind address (default: 0.0.0.0)
#
# Presets (based on available RAM/VRAM):
#   tiny      - 4GB   - llama3.2:3b
#   small     - 8GB   - qwen2.5:7b
#   medium    - 16GB  - llama3.3:70b-instruct-q4_K_M
#   large     - 32GB  - llama3.3:70b
#   xlarge    - 48GB+ - llama4:scout

set -e

# Default configuration
PRESET="${PRESET:-small}"
MODELS=""
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[OLLAMA]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

show_presets() {
    echo ""
    echo "Available model presets:"
    echo ""
    echo "  Preset    RAM/VRAM    Model                          Description"
    echo "  ────────────────────────────────────────────────────────────────────"
    echo "  tiny      4GB         llama3.2:3b                    Fast, basic tasks"
    echo "  small     8GB         qwen2.5:7b                     Good balance (default)"
    echo "  medium    16GB        llama3.3:70b-instruct-q4_K_M   Quantized 70B"
    echo "  large     32GB        llama3.3:70b                   Full 70B model"
    echo "  xlarge    48GB+       llama4:scout                   Latest Llama 4"
    echo ""
    echo "Usage: ./setup.sh --preset medium"
    echo "       ./setup.sh --models 'qwen2.5:7b,llama3.2:3b'"
    echo ""
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --preset) PRESET="$2"; shift 2 ;;
        --models) MODELS="$2"; shift 2 ;;
        --port) OLLAMA_PORT="$2"; shift 2 ;;
        --bind) OLLAMA_HOST="$2"; shift 2 ;;
        --help|-h) show_presets; exit 0 ;;
        *) error "Unknown option: $1. Use --help for usage." ;;
    esac
done

# Model presets mapping
get_models_for_preset() {
    case $1 in
        tiny)   echo "llama3.2:3b" ;;
        small)  echo "qwen2.5:7b" ;;
        medium) echo "llama3.3:70b-instruct-q4_K_M" ;;
        large)  echo "llama3.3:70b" ;;
        xlarge) echo "llama4:scout" ;;
        *)      error "Unknown preset: $1. Use --help to see available presets." ;;
    esac
}

# Use custom models or preset
if [[ -z "$MODELS" ]]; then
    MODELS=$(get_models_for_preset "$PRESET")
    info "Using preset '$PRESET'"
fi

log "Starting Ollama setup..."
log "Models: $MODELS"
log "Port: $OLLAMA_PORT"
log "Bind: $OLLAMA_HOST"

# Detect OS and system info
OS=$(uname -s)
ARCH=$(uname -m)
log "Detected: $OS $ARCH"

# Show system memory
if [[ "$OS" == "Linux" ]]; then
    TOTAL_MEM=$(free -g | awk '/^Mem:/{print $2}')
    info "System RAM: ${TOTAL_MEM}GB"

    # Check for GPU
    if command -v nvidia-smi &> /dev/null; then
        GPU_MEM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1)
        info "GPU VRAM: ${GPU_MEM}MB"
    fi
elif [[ "$OS" == "Darwin" ]]; then
    TOTAL_MEM=$(($(sysctl -n hw.memsize) / 1024 / 1024 / 1024))
    info "System RAM: ${TOTAL_MEM}GB"
fi

# Install Ollama
install_ollama() {
    if command -v ollama &> /dev/null; then
        log "Ollama already installed: $(ollama --version)"
        return 0
    fi

    log "Installing Ollama..."

    if [[ "$OS" == "Linux" ]]; then
        curl -fsSL https://ollama.com/install.sh | sh
    elif [[ "$OS" == "Darwin" ]]; then
        if command -v brew &> /dev/null; then
            brew install ollama
        else
            error "Please install Homebrew first or download Ollama manually"
        fi
    else
        error "Unsupported OS: $OS"
    fi

    log "Ollama installed successfully"
}

# Configure systemd service (Linux only)
setup_systemd() {
    if [[ "$OS" != "Linux" ]]; then
        return 0
    fi

    log "Setting up systemd service..."

    sudo mkdir -p /etc/systemd/system/ollama.service.d

    # Create override configuration
    sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << EOF
[Service]
Environment="OLLAMA_HOST=$OLLAMA_HOST:$OLLAMA_PORT"
Environment="OLLAMA_ORIGINS=*"
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable ollama
    sudo systemctl restart ollama

    log "Systemd service configured"
}

# Start Ollama manually (macOS or no systemd)
start_ollama_manual() {
    if [[ "$OS" == "Linux" ]] && systemctl is-active --quiet ollama; then
        log "Ollama is running via systemd"
        return 0
    fi

    log "Starting Ollama server..."

    # Export environment
    export OLLAMA_HOST="$OLLAMA_HOST:$OLLAMA_PORT"
    export OLLAMA_ORIGINS="*"

    # Start in background
    nohup ollama serve > /tmp/ollama.log 2>&1 &

    # Wait for server to start
    for i in {1..30}; do
        if curl -s "http://localhost:$OLLAMA_PORT/api/tags" > /dev/null 2>&1; then
            log "Ollama server started"
            return 0
        fi
        sleep 1
    done

    error "Failed to start Ollama server. Check /tmp/ollama.log"
}

# Pull models
pull_models() {
    log "Pulling models..."

    IFS=',' read -ra MODEL_ARRAY <<< "$MODELS"
    for model in "${MODEL_ARRAY[@]}"; do
        model=$(echo "$model" | xargs)  # trim whitespace
        log "Pulling: $model (this may take a while...)"
        ollama pull "$model"
    done

    log "All models pulled"
}

# Show status and connection info
show_status() {
    local IP

    # Get public IP
    IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "YOUR_SERVER_IP")

    echo ""
    echo "=========================================="
    echo -e "${GREEN}Ollama Server Ready!${NC}"
    echo "=========================================="
    echo ""
    echo "Server URL: http://$IP:$OLLAMA_PORT"
    echo "API Base:   http://$IP:$OLLAMA_PORT/v1"
    echo ""
    echo "Available models:"
    ollama list
    echo ""
    echo "Test command:"
    echo "  curl http://$IP:$OLLAMA_PORT/api/tags"
    echo ""
    echo "For Mycelia, run:"
    echo "  deno task cli llm ollama-setup http://$IP:$OLLAMA_PORT"
    echo "=========================================="
}

# Main
main() {
    install_ollama

    if [[ "$OS" == "Linux" ]] && command -v systemctl &> /dev/null; then
        setup_systemd
    else
        start_ollama_manual
    fi

    # Wait a bit for server to be fully ready
    sleep 2

    pull_models
    show_status
}

main
