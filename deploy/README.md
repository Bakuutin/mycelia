# Mycelia Remote Server Deployment

Deploy Ollama, Whisper STT, and Diarization on a remote GPU server.

## One-Liner Setup (Copy & Paste)

```bash
apt update && apt install -y curl && curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/setup.sh | bash
```

That's it! The script will install everything: Docker, GPU support, Ollama, Whisper, Diarization, zsh, tmux, btop.

---

## Quick Start Guide

### Step 1: Get a GPU Server

**Recommended specs:**
- GPU: RTX 3090/4090 or better (24GB+ VRAM)
- RAM: 32GB+
- Disk: 100GB+

**Providers:**
- [Akash Network](https://akash.network) - Decentralized, cheap
- [Vast.ai](https://vast.ai) - Cheap GPU rentals
- [RunPod](https://runpod.io) - Easy setup
- [Lambda Labs](https://lambdalabs.com) - High-end GPUs

### Step 2: Connect via SSH

```bash
# Standard server
ssh root@YOUR_SERVER_IP

# Akash/Custom port (example: port 32701)
ssh -p 32701 root@provider.example.com
```

### Step 3: Run Setup

```bash
apt update && apt install -y curl && curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/setup.sh | bash
```

### Step 4: Connect Ports

Choose one method:

#### Option A: SSH Tunnel (Recommended for Akash/restricted ports)

No need to open firewall ports. Run this **on your local machine**:

```bash
# Fill in your server details:
SERVER=provider.example.com
PORT=32701  # SSH port (22 if standard)

# Connect with port forwarding
ssh -p $PORT \
  -L 11434:localhost:11434 \
  -L 8081:localhost:8081 \
  -L 8085:localhost:8085 \
  root@$SERVER
```

Now services are available at `localhost:11434`, etc.

#### Option B: Open Firewall Ports (Standard VPS)

On the server:
```bash
# UFW
ufw allow 11434/tcp && ufw allow 8081/tcp && ufw allow 8085/tcp

# Or iptables
iptables -A INPUT -p tcp --dport 11434 -j ACCEPT
iptables -A INPUT -p tcp --dport 8081 -j ACCEPT
iptables -A INPUT -p tcp --dport 8085 -j ACCEPT
```

### Step 5: Configure Mycelia

On your **local machine**:

```bash
cd backend

# Add LLM (use localhost if using SSH tunnel, or SERVER_IP if ports are open)
deno task cli llm ollama-setup http://localhost:11434

# Add to .env
echo 'STT_SERVER_URL=http://localhost:8081' >> .env
echo 'DIARIZATION_SERVER_URL=http://localhost:8085' >> .env

# Test
deno task cli llm test small
```

---

## 🧙 Connection Wizard

Fill in your details and copy the commands:

### Your Server Info

```
SERVER_HOST = _______________  (e.g., provider.4090.akash.pub)
SSH_PORT    = _______________  (e.g., 32701, or 22 for standard)
```

### Generated Commands

**1. Connect to server:**
```bash
ssh -p SSH_PORT root@SERVER_HOST
```

**2. Install everything:**
```bash
apt update && apt install -y curl && curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/setup.sh | bash
```

**3. Port forwarding (run on LOCAL machine):**
```bash
ssh -p SSH_PORT -L 11434:localhost:11434 -L 8081:localhost:8081 -L 8085:localhost:8085 root@SERVER_HOST
```

**4. Configure Mycelia (run on LOCAL machine):**
```bash
cd ~/repo/mycelia/backend
deno task cli llm ollama-setup http://localhost:11434
echo 'STT_SERVER_URL=http://localhost:8081' >> .env
echo 'DIARIZATION_SERVER_URL=http://localhost:8085' >> .env
```

---

## Services & Ports

| Service | Port | Description |
|---------|------|-------------|
| **Ollama** | 11434 | LLM inference (summaries, chat) |
| **Whisper** | 8081 | Speech-to-text transcription |
| **Diarization** | 8085 | Speaker recognition |

---

## Setup Options

```bash
# Full setup (default)
curl ... | bash

# Only Ollama (faster, less memory)
curl ... | bash -s -- --ollama-only

# Specific model
curl ... | bash -s -- --model llama3.3:70b-instruct-q4_K_M

# Skip dev tools (no zsh/tmux/btop)
curl ... | bash -s -- --no-tools

# CPU-only mode
curl ... | bash -s -- --cpu
```

### Model Presets

| Model | VRAM | Flag |
|-------|------|------|
| `llama3.2:3b` | 4GB | `--model llama3.2:3b` |
| `qwen2.5:7b` | 8GB | (default) |
| `llama3.3:70b-instruct-q4_K_M` | 16GB | `--model llama3.3:70b-instruct-q4_K_M` |
| `llama3.3:70b` | 32GB | `--model llama3.3:70b` |
| `llama4:scout` | 48GB | `--model llama4:scout` |

---

## After Setup

### Useful Commands

```bash
# Switch to zsh (better shell)
exec zsh

# Mycelia shortcuts (after zsh)
mstatus    # Show services & GPU
mup        # Start services
mdown      # Stop services
mlogs      # View logs
mps        # Service status

# GPU monitoring
gpu        # nvidia-smi
gpuw       # Watch GPU live
btop       # Beautiful system monitor

# tmux (keep session running after disconnect)
tmux new -s mycelia     # Create session
tmux attach -t mycelia  # Reconnect
# Ctrl+A, d             # Detach
```

### Verify Services

```bash
# On server
curl localhost:11434/api/tags      # Ollama
curl localhost:8081/docs           # Whisper
curl localhost:8085/health         # Diarization

# Check GPU
nvidia-smi
```

---

## Troubleshooting

### "Connection refused" from local machine

Make sure SSH tunnel is running:
```bash
ssh -p PORT -L 11434:localhost:11434 -L 8081:localhost:8081 -L 8085:localhost:8085 root@SERVER
```

### Services not starting

```bash
# Check logs
docker compose logs -f

# Restart
docker compose restart
```

### GPU not detected

```bash
# Check driver
nvidia-smi

# Check Docker GPU
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### Out of memory

Use smaller model:
```bash
# Edit .env
nano ~/mycelia/deploy/.env
# Change OLLAMA_MODELS=qwen2.5:7b to smaller model

# Restart
docker compose restart ollama
```

---

## Stopping & Cleanup

```bash
# Stop services (keeps data)
cd ~/mycelia/deploy
docker compose down

# Full cleanup (removes everything)
docker compose down -v
rm -rf ~/mycelia
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Remote GPU Server                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   Ollama    │  │   Whisper   │  │   Diarization   │ │
│  │   :11434    │  │    :8081    │  │      :8085      │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
│                         │                               │
│                    Docker + GPU                         │
└─────────────────────────────────────────────────────────┘
                          │
                     SSH Tunnel
                          │
┌─────────────────────────────────────────────────────────┐
│                    Local Machine                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │              Mycelia Backend                        ││
│  │  localhost:11434  localhost:8081  localhost:8085   ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```
