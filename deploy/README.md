# Mycelia Remote Server Deployment

Deploy Ollama, Whisper STT, and Diarization on a remote GPU server.

## Quick Start (5 minutes)

### Step 1: Configure Your Server

```bash
cd deploy

# Create config from example
cp .server.conf.example .server.conf

# Edit with your server details
nano .server.conf
```

Fill in your server info:
```bash
SERVER_HOST=your-server.example.com
SSH_PORT=22        # or custom port like 32701 for Akash
SSH_USER=root
```

### Step 2: Install Ollama on Server

```bash
./connect.sh --setup
```

This will SSH to your server and install Ollama with default model (qwen2.5:7b).

### Step 3: Install Dev Tools (Optional)

```bash
./connect.sh --tools
```

Installs: zsh, oh-my-zsh, tmux, btop, GPU monitoring aliases.

### Step 4: Connect & Work

```bash
./connect.sh
```

This creates SSH tunnel with port forwarding. Keep this terminal open.

### Step 5: Configure Mycelia (New Terminal)

```bash
cd backend
deno task cli llm ollama-setup http://localhost:11434
deno task cli llm test small
```

**Done!** 🎉

---

## Complete Step-by-Step Guide

### Prerequisites

**On your local machine:**
- SSH client
- Git
- Deno (for Mycelia backend)

**On remote server:**
- Ubuntu 20.04+ or Debian 11+
- NVIDIA GPU with drivers installed
- SSH access

### 1. Get a GPU Server

**Recommended specs:**

| Preset | Min VRAM | Min RAM | Model |
|--------|----------|---------|-------|
| tiny | 4GB | 8GB | llama3.2:3b |
| small | 8GB | 16GB | qwen2.5:7b |
| medium | 16GB | 32GB | llama3.3:70b-q4 |
| large | 32GB | 64GB | llama3.3:70b |

**Providers:**
- [Akash Network](https://akash.network) — Decentralized, cheap ($0.30-0.50/hr for RTX 4090)
- [Vast.ai](https://vast.ai) — Cheap GPU rentals
- [RunPod](https://runpod.io) — Easy setup
- [Lambda Labs](https://lambdalabs.com) — High-end GPUs
- [Hetzner](https://hetzner.com) — Good for EU

### 2. Configure Connection

```bash
cd ~/repo/mycelia/deploy

# Create your config
cp .server.conf.example .server.conf
nano .server.conf
```

Example for Akash:
```bash
SERVER_HOST=provider.4090.qc.akash.pub
SSH_PORT=32701
SSH_USER=root
```

Example for standard VPS:
```bash
SERVER_HOST=123.45.67.89
SSH_PORT=22
SSH_USER=root
```

### 3. Install Ollama

```bash
# One command - installs Ollama + pulls model
./connect.sh --setup
```

Or with custom model:
```bash
# SSH to server first
./connect.sh

# On server, run with preset
curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/ollama/setup.sh | bash -s -- --preset medium
```

**Model presets:**
- `--preset tiny` — 4GB — llama3.2:3b
- `--preset small` — 8GB — qwen2.5:7b (default)
- `--preset medium` — 16GB — llama3.3:70b-instruct-q4_K_M
- `--preset large` — 32GB — llama3.3:70b
- `--preset xlarge` — 48GB — llama4:scout

### 4. Install Server Tools (Recommended)

```bash
./connect.sh --tools
```

This installs:
- **zsh** + Oh My Zsh
- **tmux** (with nice config)
- **btop** (beautiful system monitor)
- **Aliases**: `gpu`, `gpuw`, `mstatus`, `mup`, `mdown`, `mlogs`

### 5. Connect with Port Forwarding

```bash
./connect.sh
```

This opens SSH tunnel forwarding:
- `localhost:11434` → Ollama
- `localhost:8081` → Whisper (if installed)
- `localhost:8085` → Diarization (if installed)

**Keep this terminal open while working!**

### 6. Configure Mycelia Backend

In a **new terminal**:

```bash
cd ~/repo/mycelia/backend

# Add Ollama server
deno task cli llm ollama-setup http://localhost:11434

# Test
deno task cli llm test small

# List configured models
deno task cli llm list
```

### 7. (Optional) Add Whisper & Diarization

On the server:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install NVIDIA Container Toolkit
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt-get update && apt-get install -y nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker
systemctl restart docker

# Clone and start services
cd ~
git clone https://github.com/mycelia-tech/mycelia.git
cd mycelia && git checkout olama-setup
cd deploy
cp .env.example .env
nano .env  # Add HF_TOKEN for diarization

# Start services
docker compose up -d whisper diarization
```

On your local machine, add to backend `.env`:
```bash
echo 'STT_SERVER_URL=http://localhost:8081' >> ~/repo/mycelia/backend/.env
echo 'DIARIZATION_SERVER_URL=http://localhost:8085' >> ~/repo/mycelia/backend/.env
```

---

## Command Reference

### connect.sh

```bash
./connect.sh              # Connect with port forwarding
./connect.sh --setup      # Install Ollama on server
./connect.sh --tools      # Install zsh/tmux/btop on server
./connect.sh -c           # Edit server config
./connect.sh --help       # Show help
```

### Server Aliases (after --tools)

```bash
# GPU
gpu       # nvidia-smi
gpuw      # watch nvidia-smi
btop      # beautiful system monitor

# Services
mstatus   # Show all: GPU, Docker, Ollama, Services
mup       # Start docker services
mdown     # Stop docker services
mlogs     # View logs
mps       # Service status

# tmux
tmux new -s work     # Create session
tmux attach -t work  # Reconnect
Ctrl+A, d            # Detach (session keeps running)
Ctrl+A, |            # Split vertical
Ctrl+A, -            # Split horizontal
```

### Mycelia CLI

```bash
cd backend

deno task cli llm list                          # List models
deno task cli llm test small                    # Test model
deno task cli llm add --alias NAME ...          # Add model manually
deno task cli llm remove NAME                   # Remove model
deno task cli llm ollama-setup http://host:port # Quick Ollama setup
```

---

## Services & Ports

| Service | Port | Description |
|---------|------|-------------|
| Ollama | 11434 | LLM inference |
| Whisper | 8081 | Speech-to-text |
| Diarization | 8085 | Speaker recognition |

---

## Troubleshooting

### "Connection refused"

1. Check SSH tunnel is running (`./connect.sh`)
2. Check service is running on server: `curl localhost:11434/api/tags`

### "Permission denied" on server

```bash
# If using non-root user, may need sudo for docker
sudo usermod -aG docker $USER
# Then logout/login
```

### GPU not detected

```bash
# On server
nvidia-smi  # Should show GPU

# For Docker
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### Out of memory

Use smaller model:
```bash
# On server
ollama rm qwen2.5:7b
ollama pull llama3.2:3b
```

### Slow responses

1. Check GPU is being used: `nvidia-smi` (should show ollama process)
2. Use quantized model: `llama3.3:70b-instruct-q4_K_M` instead of `llama3.3:70b`

---

## File Structure

```
deploy/
├── .server.conf.example  # Server config template
├── .server.conf          # Your server config (gitignored)
├── connect.sh            # Connection helper
├── server-tools.sh       # Install zsh/tmux/btop
├── docker-compose.yml    # Whisper + Diarization
├── .env.example          # Docker env template
└── ollama/
    ├── setup.sh          # Ollama installer
    ├── docker-compose.yml
    └── README.md
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Remote GPU Server                         │
│  ┌───────────┐  ┌───────────┐  ┌─────────────────────────┐ │
│  │  Ollama   │  │  Whisper  │  │      Diarization        │ │
│  │  :11434   │  │   :8081   │  │         :8085           │ │
│  │ (native)  │  │ (docker)  │  │       (docker)          │ │
│  └───────────┘  └───────────┘  └─────────────────────────┘ │
│                         │                                   │
│                      GPU (CUDA)                             │
└─────────────────────────────────────────────────────────────┘
                          │
                    SSH Tunnel (connect.sh)
                          │
┌─────────────────────────────────────────────────────────────┐
│                    Local Machine                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Mycelia Backend                            ││
│  │  http://localhost:11434  (Ollama)                      ││
│  │  http://localhost:8081   (Whisper)                     ││
│  │  http://localhost:8085   (Diarization)                 ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```
