#!/bin/bash
# Mycelia AI Services - Complete Setup Script
# Sets up: Ollama, Whisper, Diarization + zsh, tmux, btop
#
# Usage (on fresh server):
#   curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/ollama/setup.sh | bash
#
# Or with options:
#   ./setup.sh --ollama-only    # Only Ollama (no Whisper/Diarization)
#   ./setup.sh --no-tools       # Skip zsh/tmux/btop
#   ./setup.sh --cpu            # CPU-only mode

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}\n"; }

# Defaults
MODE="gpu"
SERVICES="all"
INSTALL_TOOLS="yes"
OLLAMA_MODEL="qwen2.5:7b"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --gpu) MODE="gpu"; shift ;;
        --cpu) MODE="cpu"; shift ;;
        --ollama-only) SERVICES="ollama"; shift ;;
        --no-tools) INSTALL_TOOLS="no"; shift ;;
        --model) OLLAMA_MODEL="$2"; shift 2 ;;
        --help|-h)
            echo "Mycelia AI Services Setup"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --gpu          GPU mode (default)"
            echo "  --cpu          CPU-only mode"
            echo "  --ollama-only  Only install Ollama"
            echo "  --no-tools     Skip zsh/tmux/btop installation"
            echo "  --model NAME   Ollama model (default: qwen2.5:7b)"
            echo ""
            echo "Model presets:"
            echo "  llama3.2:3b                  - 4GB  (tiny)"
            echo "  qwen2.5:7b                   - 8GB  (small, default)"
            echo "  llama3.3:70b-instruct-q4_K_M - 16GB (medium)"
            echo "  llama3.3:70b                 - 32GB (large)"
            echo "  llama4:scout                 - 48GB (xlarge)"
            exit 0
            ;;
        *) error "Unknown option: $1. Use --help for usage." ;;
    esac
done

echo ""
echo "╔═══════════════════════════════════════════════════════════════════════╗"
echo "║              Mycelia AI Services - Setup Script                       ║"
echo "╚═══════════════════════════════════════════════════════════════════════╝"
echo ""
info "Mode: $MODE"
info "Services: $SERVICES"
info "Model: $OLLAMA_MODEL"
info "Dev tools: $INSTALL_TOOLS"
echo ""

# ============================================
# STEP 1: System Update & Basic Tools
# ============================================
step "Step 1/7: System Update"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common

log "System updated"

# ============================================
# STEP 2: Install Dev Tools (zsh, tmux, btop)
# ============================================
if [[ "$INSTALL_TOOLS" == "yes" ]]; then
    step "Step 2/7: Installing Dev Tools (zsh, tmux, btop)"

    apt-get install -y zsh tmux htop ncdu tree jq

    # Install btop (better htop)
    if ! command -v btop &> /dev/null; then
        # Try apt first (Ubuntu 22.04+)
        apt-get install -y btop 2>/dev/null || {
            # Fallback: install from snap or skip
            warn "btop not in apt, trying snap..."
            snap install btop 2>/dev/null || warn "btop install failed, using htop instead"
        }
    fi

    # Install Oh My Zsh (non-interactive)
    if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
        info "Installing Oh My Zsh..."
        sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
    fi

    # Configure zsh
    cat > ~/.zshrc << 'ZSHRC'
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git docker docker-compose)
source $ZSH/oh-my-zsh.sh

# Aliases
alias ll='ls -la'
alias dc='docker compose'
alias dps='docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
alias dlogs='docker compose logs -f'
alias gpu='nvidia-smi'
alias gpuw='watch -n 1 nvidia-smi'

# Mycelia shortcuts
alias mycelia='cd ~/mycelia/deploy'
alias mup='cd ~/mycelia/deploy && docker compose --profile gpu up -d'
alias mdown='cd ~/mycelia/deploy && docker compose down'
alias mlogs='cd ~/mycelia/deploy && docker compose logs -f'
alias mps='cd ~/mycelia/deploy && docker compose ps'

# Quick status
mstatus() {
    echo "=== Services ==="
    docker ps --format "table {{.Names}}\t{{.Status}}"
    echo ""
    echo "=== GPU ==="
    nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null || echo "No GPU"
}
ZSHRC

    # Configure tmux
    cat > ~/.tmux.conf << 'TMUX'
# Better prefix
set -g prefix C-a
unbind C-b
bind C-a send-prefix

# Mouse support
set -g mouse on

# Split panes with | and -
bind | split-window -h
bind - split-window -v

# Easy reload
bind r source-file ~/.tmux.conf \; display "Reloaded!"

# Start windows at 1
set -g base-index 1
setw -g pane-base-index 1

# Status bar
set -g status-style bg=black,fg=white
set -g status-left '#[fg=green]#S '
set -g status-right '#[fg=yellow]#(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader 2>/dev/null || echo "CPU") #[fg=white]| %H:%M'
set -g status-right-length 50

# Colors
set -g default-terminal "screen-256color"
TMUX

    # Change default shell to zsh
    chsh -s $(which zsh) 2>/dev/null || true

    log "Dev tools installed (zsh, tmux, btop)"
    info "Aliases: mup, mdown, mlogs, mps, mstatus, gpu, gpuw"
else
    step "Step 2/7: Skipping Dev Tools"
fi

# ============================================
# STEP 3: Install Docker
# ============================================
step "Step 3/7: Installing Docker"

if command -v docker &> /dev/null; then
    log "Docker already installed: $(docker --version)"
else
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker 2>/dev/null || true
    systemctl start docker 2>/dev/null || true
    log "Docker installed"
fi

# Verify Docker works
docker ps > /dev/null 2>&1 || {
    # Maybe running in container without systemd
    dockerd &> /tmp/dockerd.log &
    sleep 3
}

docker ps > /dev/null 2>&1 || error "Docker not working. Check logs."
log "Docker is running"

# ============================================
# STEP 4: Setup NVIDIA Container Toolkit
# ============================================
step "Step 4/7: Setting up GPU Support"

if [[ "$MODE" == "gpu" ]]; then
    # Check if nvidia-smi works
    if nvidia-smi &> /dev/null; then
        log "NVIDIA driver found"
        nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader

        # Check if toolkit already works
        if docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi &> /dev/null; then
            log "NVIDIA Container Toolkit already working"
        else
            info "Installing NVIDIA Container Toolkit..."

            curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
                gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null

            curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
                sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
                tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null

            apt-get update
            apt-get install -y nvidia-container-toolkit

            nvidia-ctk runtime configure --runtime=docker 2>/dev/null || true
            systemctl restart docker 2>/dev/null || true

            # Verify
            if docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi &> /dev/null; then
                log "NVIDIA Container Toolkit installed"
            else
                warn "GPU in Docker may not work. Continuing anyway..."
            fi
        fi
    else
        warn "No NVIDIA GPU detected. Falling back to CPU mode."
        MODE="cpu"
    fi
else
    info "CPU mode selected, skipping GPU setup"
fi

# ============================================
# STEP 5: Clone Mycelia Repository
# ============================================
step "Step 5/7: Setting up Mycelia"

cd ~

if [[ -d "mycelia" ]]; then
    info "Mycelia repo exists, updating..."
    cd mycelia
    git fetch origin
    git checkout olama-setup 2>/dev/null || git checkout -b olama-setup origin/olama-setup
    git pull origin olama-setup || true
else
    info "Cloning Mycelia..."
    git clone https://github.com/mycelia-tech/mycelia.git
    cd mycelia
    git checkout olama-setup 2>/dev/null || git checkout -b olama-setup origin/olama-setup
fi

cd deploy
log "Mycelia ready at ~/mycelia/deploy"

# ============================================
# STEP 6: Configure Environment
# ============================================
step "Step 6/7: Configuring Services"

# Create .env if not exists
if [[ ! -f .env ]]; then
    cp .env.example .env
fi

# Set Ollama model
sed -i "s/^OLLAMA_MODELS=.*/OLLAMA_MODELS=$OLLAMA_MODEL/" .env

# Check for HF_TOKEN (needed for diarization)
if [[ "$SERVICES" == "all" ]] && ! grep -q "^HF_TOKEN=hf_" .env; then
    echo ""
    warn "Diarization requires Hugging Face token."
    info "Get one from: https://huggingface.co/settings/tokens"
    info "Accept model terms at:"
    info "  - https://huggingface.co/pyannote/speaker-diarization-3.1"
    info "  - https://huggingface.co/pyannote/segmentation-3.0"
    echo ""
    read -p "Enter HF_TOKEN (or press Enter to skip diarization): " HF_TOKEN_INPUT
    if [[ -n "$HF_TOKEN_INPUT" ]]; then
        sed -i "s/^HF_TOKEN=.*/HF_TOKEN=$HF_TOKEN_INPUT/" .env
        log "HF_TOKEN configured"
    else
        warn "Skipping diarization (no HF_TOKEN)"
        SERVICES="ollama-whisper"
    fi
fi

log "Environment configured"

# ============================================
# STEP 7: Start Services
# ============================================
step "Step 7/7: Starting Services"

info "This may take a while on first run (downloading images and models)..."

if [[ "$SERVICES" == "ollama" ]]; then
    docker compose --profile $MODE up -d ollama
    # Wait and pull model
    sleep 5
    docker exec ollama ollama pull $OLLAMA_MODEL || true
else
    docker compose --profile $MODE up -d
fi

# Wait for services
info "Waiting for services to start..."
sleep 10

# ============================================
# DONE: Show Status
# ============================================
IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo "╔═══════════════════════════════════════════════════════════════════════╗"
echo -e "║              ${GREEN}✓ Mycelia AI Services Ready!${NC}                            ║"
echo "╚═══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "SERVICES:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker compose ps
echo ""
echo "URLs:"
echo "  Ollama:       http://$IP:11434"
[[ "$SERVICES" != "ollama" ]] && echo "  Whisper:      http://$IP:8081"
[[ "$SERVICES" == "all" ]] && echo "  Diarization:  http://$IP:8085"
echo ""
echo "───────────────────────────────────────────────────────────────────────"
echo ""
echo "QUICK COMMANDS (restart shell or run 'source ~/.zshrc' first):"
echo ""
echo "  mstatus    - Show services & GPU status"
echo "  mlogs      - View logs"
echo "  mup        - Start services"
echo "  mdown      - Stop services"
echo "  gpu        - nvidia-smi"
echo "  gpuw       - Watch GPU (updates every second)"
echo "  btop       - Beautiful system monitor"
echo ""
echo "───────────────────────────────────────────────────────────────────────"
echo ""
echo "CONNECT MYCELIA (on your local machine):"
echo ""
echo "  cd backend"
echo "  deno task cli llm ollama-setup http://$IP:11434"
[[ "$SERVICES" != "ollama" ]] && echo "  echo 'STT_SERVER_URL=http://$IP:8081' >> .env"
[[ "$SERVICES" == "all" ]] && echo "  echo 'DIARIZATION_SERVER_URL=http://$IP:8085' >> .env"
echo ""
echo "───────────────────────────────────────────────────────────────────────"
echo ""
echo "Start zsh: exec zsh"
echo "Start tmux: tmux new -s mycelia"
echo ""
