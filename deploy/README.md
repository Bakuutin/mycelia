# Mycelia Remote Server Deployment

Deploy all Mycelia AI services (Ollama, Whisper STT, Diarization) on a remote GPU server.

## Services Overview

| Service | Port | Description | GPU Required |
|---------|------|-------------|--------------|
| **Ollama** | 11434 | LLM inference (summaries, chat) | Recommended |
| **Whisper** | 8081 | Speech-to-text transcription | Recommended |
| **Diarization** | 8085 | Speaker recognition | Recommended |

## Quick Start

### 1. Server Requirements

**Minimum (CPU-only):**
- 16GB RAM
- 50GB disk space
- Ubuntu 22.04+

**Recommended (GPU):**
- 24GB+ VRAM (RTX 3090, RTX 4090, A100)
- 32GB RAM
- 100GB disk space
- NVIDIA drivers + Docker with nvidia-container-toolkit

### 2. Connect to Server

```bash
ssh root@YOUR_SERVER_IP
```

### 3. Install Prerequisites

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install NVIDIA Container Toolkit (for GPU)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Verify GPU is available
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### 4. Clone Repository

```bash
git clone https://github.com/mycelia-tech/mycelia.git
cd mycelia/deploy
```

### 5. Configure Environment

```bash
cp .env.example .env
nano .env
```

Required variables:
```bash
# Hugging Face token (required for diarization)
# Get from: https://huggingface.co/settings/tokens
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxx

# Ollama models to pull
OLLAMA_MODELS=qwen2.5:7b

# Optional: API key for Whisper authentication
API_KEY=your-secret-key
```

### 6. Start Services

```bash
# Start all services with GPU
docker compose --profile gpu up -d

# Or CPU-only (slower, no Whisper)
docker compose --profile cpu up -d

# Check status
docker compose ps
```

### 7. Open Firewall

```bash
# Open required ports
sudo ufw allow 11434/tcp  # Ollama
sudo ufw allow 8081/tcp   # Whisper
sudo ufw allow 8085/tcp   # Diarization
sudo ufw reload
```

### 8. Verify Services

```bash
# Check all services
curl http://localhost:11434/api/tags      # Ollama
curl http://localhost:8081/docs           # Whisper
curl http://localhost:8085/health         # Diarization

# From your local machine
curl http://YOUR_SERVER_IP:11434/api/tags
curl http://YOUR_SERVER_IP:8085/health
```

### 9. Connect Mycelia

On your local machine:

```bash
cd backend

# Configure LLM
deno task cli llm ollama-setup http://YOUR_SERVER_IP:11434

# Update .env with service URLs
echo "STT_SERVER_URL=http://YOUR_SERVER_IP:8081" >> .env
echo "DIARIZATION_SERVER_URL=http://YOUR_SERVER_IP:8085" >> .env
```

---

## Individual Service Setup

### Ollama Only

See [ollama/README.md](./ollama/README.md) for standalone Ollama setup.

```bash
cd ollama
./setup.sh --preset medium
```

### Whisper Only

```bash
# Build and run
docker build -t whisper ../python/whisper_server
docker run -d --gpus all -p 8081:8087 \
  -e API_KEY=your-key \
  --name whisper whisper
```

### Diarization Only

```bash
# Build and run
cd ../diarizator
docker compose --profile gpu up -d diarization-service-gpu
```

---

## Port Reference

| Port | Service | Protocol | Required |
|------|---------|----------|----------|
| 11434 | Ollama API | TCP | Yes |
| 8081 | Whisper API | TCP | Yes |
| 8085 | Diarization API | TCP | Yes |
| 22 | SSH | TCP | Yes (for access) |

### Verify Ports (on server)

```bash
# Check listening ports
ss -tlnp | grep -E '11434|8081|8085'

# Check firewall
sudo ufw status

# Check from outside (on local machine)
nc -zv YOUR_SERVER_IP 11434
nc -zv YOUR_SERVER_IP 8081
nc -zv YOUR_SERVER_IP 8085
```

---

## Service Configuration

### Ollama Models

```bash
# Pull additional models
docker exec ollama ollama pull llama3.3:70b-instruct-q4_K_M
docker exec ollama ollama pull mistral:7b

# List models
docker exec ollama ollama list
```

### Whisper Configuration

The Whisper server uses `large-v3` model by default. To change:

```bash
# Edit server.py before building
model_size = "medium"  # or "small", "base", "tiny"
```

### Diarization Configuration

Requires accepting Hugging Face model terms:
1. https://huggingface.co/pyannote/speaker-diarization-3.1
2. https://huggingface.co/pyannote/segmentation-3.0
3. https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM

---

## Monitoring

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f ollama
docker compose logs -f whisper
docker compose logs -f diarization
```

### Resource Usage

```bash
# Container stats
docker stats

# GPU usage
nvidia-smi -l 1

# Ollama model memory
docker exec ollama ollama ps
```

### Health Checks

```bash
# Quick health check script
curl -s http://localhost:11434/api/tags > /dev/null && echo "✓ Ollama OK" || echo "✗ Ollama FAIL"
curl -s http://localhost:8081/docs > /dev/null && echo "✓ Whisper OK" || echo "✗ Whisper FAIL"
curl -s http://localhost:8085/health > /dev/null && echo "✓ Diarization OK" || echo "✗ Diarization FAIL"
```

---

## Troubleshooting

### GPU Not Detected

```bash
# Check NVIDIA driver
nvidia-smi

# Check Docker GPU support
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi

# If fails, reinstall nvidia-container-toolkit
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Out of GPU Memory

```bash
# Check GPU memory
nvidia-smi

# Use smaller models
OLLAMA_MODELS=qwen2.5:7b docker compose up -d ollama

# Or run services one at a time
docker compose stop whisper  # Free GPU memory
```

### Service Won't Start

```bash
# Check logs
docker compose logs servicename

# Common issues:
# - HF_TOKEN not set (diarization)
# - Port already in use
# - Insufficient disk space
```

### Connection Refused

```bash
# Check service is running
docker compose ps

# Check it's listening
ss -tlnp | grep PORT

# Check firewall
sudo ufw status

# Check cloud firewall (AWS/GCP/Hetzner console)
```

---

## Stopping Services

```bash
# Stop all
docker compose down

# Stop specific service
docker compose stop ollama

# Full cleanup (removes data)
docker compose down -v
```

---

## Security Notes

⚠️ **Warning:** These services are exposed without authentication by default.

For production:
1. Use a firewall to restrict access to known IPs
2. Set API_KEY for Whisper authentication
3. Put services behind a reverse proxy with auth
4. Or use SSH tunneling:
   ```bash
   ssh -L 11434:localhost:11434 -L 8081:localhost:8081 -L 8085:localhost:8085 server
   ```
