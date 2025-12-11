#!/bin/bash
# Mycelia Server Tools Setup
# Installs: zsh, oh-my-zsh, tmux, btop, GPU monitoring aliases
#
# Usage on server:
#   curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/server-tools.sh | bash

set -e

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           Installing Server Tools                             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Install packages
echo "[1/4] Installing packages..."
apt update
apt install -y zsh tmux htop ncdu tree jq curl wget git

# Install btop
if ! command -v btop &> /dev/null; then
    apt install -y btop 2>/dev/null || {
        echo "btop not in apt, trying snap..."
        snap install btop 2>/dev/null || echo "btop install failed, using htop"
    }
fi

# Install Oh My Zsh
echo "[2/4] Installing Oh My Zsh..."
if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
fi

# Configure zsh
echo "[3/4] Configuring zsh..."
cat > ~/.zshrc << 'ZSHRC'
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git docker docker-compose)
source $ZSH/oh-my-zsh.sh

# GPU monitoring
alias gpu='nvidia-smi'
alias gpuw='watch -n 1 nvidia-smi'
alias gpuq='nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv'

# Docker
alias dc='docker compose'
alias dps='docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
alias dlogs='docker compose logs -f'
alias dstop='docker compose down'
alias drestart='docker compose restart'

# System
alias ll='ls -la'
alias df='df -h'
alias free='free -h'

# Mycelia
alias mycelia='cd ~/mycelia/deploy'
alias mup='cd ~/mycelia/deploy && docker compose up -d'
alias mdown='cd ~/mycelia/deploy && docker compose down'
alias mlogs='cd ~/mycelia/deploy && docker compose logs -f'
alias mps='cd ~/mycelia/deploy && docker compose ps'
alias mrestart='cd ~/mycelia/deploy && docker compose restart'

# Quick status
mstatus() {
    echo "═══════════════════════════════════════════"
    echo "                   GPU"
    echo "═══════════════════════════════════════════"
    nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv 2>/dev/null || echo "No GPU"
    echo ""
    echo "═══════════════════════════════════════════"
    echo "                 DOCKER"
    echo "═══════════════════════════════════════════"
    docker ps --format "table {{.Names}}\t{{.Status}}" 2>/dev/null || echo "Docker not running"
    echo ""
    echo "═══════════════════════════════════════════"
    echo "                 OLLAMA"
    echo "═══════════════════════════════════════════"
    ollama list 2>/dev/null || curl -s localhost:11434/api/tags 2>/dev/null | jq -r '.models[].name' 2>/dev/null || echo "Ollama not running"
    echo ""
    echo "═══════════════════════════════════════════"
    echo "                SERVICES"
    echo "═══════════════════════════════════════════"
    echo -n "Ollama:      "; curl -s localhost:11434/api/tags > /dev/null 2>&1 && echo "✓ OK" || echo "✗ DOWN"
    echo -n "Whisper:     "; curl -s localhost:8081/docs > /dev/null 2>&1 && echo "✓ OK" || echo "✗ DOWN"
    echo -n "Diarization: "; curl -s localhost:8085/health > /dev/null 2>&1 && echo "✓ OK" || echo "✗ DOWN"
}
ZSHRC

# Configure tmux
echo "[4/4] Configuring tmux..."
cat > ~/.tmux.conf << 'TMUX'
# Better prefix
set -g prefix C-a
unbind C-b
bind C-a send-prefix

# Mouse support
set -g mouse on

# Split panes
bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"

# Easy reload
bind r source-file ~/.tmux.conf \; display "Reloaded!"

# Start windows at 1
set -g base-index 1
setw -g pane-base-index 1

# Status bar
set -g status-style bg=black,fg=white
set -g status-left '#[fg=green]#S '
set -g status-right '#[fg=yellow]GPU: #(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader 2>/dev/null || echo "N/A") #[fg=cyan]MEM: #(nvidia-smi --query-gpu=memory.used --format=csv,noheader 2>/dev/null || echo "N/A") #[fg=white]| %H:%M'
set -g status-right-length 80

# Colors
set -g default-terminal "screen-256color"

# Quick pane switching
bind -n M-Left select-pane -L
bind -n M-Right select-pane -R
bind -n M-Up select-pane -U
bind -n M-Down select-pane -D
TMUX

# Change default shell
chsh -s $(which zsh) 2>/dev/null || true

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           ✓ Server Tools Installed!                           ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "COMMANDS:"
echo "  mstatus    - Show GPU, Docker, Services status"
echo "  gpu/gpuw   - nvidia-smi / watch mode"
echo "  btop       - Beautiful system monitor"
echo "  mup/mdown  - Start/stop Mycelia services"
echo "  mlogs      - View logs"
echo ""
echo "TMUX:"
echo "  tmux new -s mycelia    - Create session"
echo "  Ctrl+A, |              - Split vertical"
echo "  Ctrl+A, -              - Split horizontal"
echo "  Ctrl+A, d              - Detach"
echo ""
echo "Run 'exec zsh' to switch to zsh now"
echo ""
