# Ollama Remote Server Deployment

Deploy Ollama on a remote server for LLM processing in Mycelia.

## Quick Start

### 1. Connect to your server

```bash
ssh your-server
```

### 2. Run setup script

```bash
# Download and run with default preset (small/8GB)
curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/mycelia/main/deploy/ollama/setup.sh | bash

# Or with a specific preset
curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/mycelia/main/deploy/ollama/setup.sh | \
  bash -s -- --preset medium
```

### 3. Connect to Mycelia

```bash
cd backend
deno task cli llm ollama-setup http://YOUR_SERVER_IP:11434
```

## Model Presets

Choose a preset based on your server's RAM/VRAM:

| Preset | RAM/VRAM | Model | Description |
|--------|----------|-------|-------------|
| `tiny` | 4GB | `llama3.2:3b` | Fast, basic tasks |
| `small` | 8GB | `qwen2.5:7b` | Good balance (default) |
| `medium` | 16GB | `llama3.3:70b-instruct-q4_K_M` | Quantized 70B |
| `large` | 32GB | `llama3.3:70b` | Full 70B model |
| `xlarge` | 48GB+ | `llama4:scout` | Latest Llama 4 Scout |

### Usage Examples

```bash
# Use a preset
./setup.sh --preset medium

# Custom model list
./setup.sh --models "qwen2.5:7b,llama3.2:3b"

# Custom port
./setup.sh --preset small --port 8080

# Show all options
./setup.sh --help
```

## Model Details

### Llama 4 Scout (`xlarge` preset)
- **Model**: `llama4:scout`
- **Requirements**: 48GB+ VRAM (multi-GPU recommended)
- **Best for**: Complex reasoning, code generation, long context

### Llama 3.3 70B (`large` preset)
- **Model**: `llama3.3:70b`
- **Requirements**: 32GB+ VRAM
- **Best for**: High-quality outputs, detailed analysis

### Llama 3.3 70B Quantized (`medium` preset)
- **Model**: `llama3.3:70b-instruct-q4_K_M`
- **Requirements**: 16GB VRAM/RAM
- **Best for**: Good quality with lower resource usage

### Qwen 2.5 7B (`small` preset)
- **Model**: `qwen2.5:7b`
- **Requirements**: 8GB VRAM/RAM
- **Best for**: Balanced speed and quality, recommended for most users

### Llama 3.2 3B (`tiny` preset)
- **Model**: `llama3.2:3b`
- **Requirements**: 4GB VRAM/RAM
- **Best for**: Fast responses, simple tasks, low-resource servers

## Manual Installation

### Option A: Native Installation (Linux)

```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Configure for remote access
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf << EOF
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
EOF

# 3. Restart service
sudo systemctl daemon-reload
sudo systemctl restart ollama

# 4. Pull your model
ollama pull llama3.3:70b-instruct-q4_K_M
```

### Option B: Docker Compose

```bash
# 1. Download files
mkdir -p ~/ollama && cd ~/ollama
curl -O https://raw.githubusercontent.com/YOUR_REPO/mycelia/main/deploy/ollama/docker-compose.yml

# 2. Start with GPU support
OLLAMA_MODELS="llama3.3:70b-instruct-q4_K_M" docker compose up -d

# Without GPU (remove deploy.resources section from docker-compose.yml first)
docker compose up -d
```

## Firewall Configuration

```bash
# UFW (Ubuntu)
sudo ufw allow 11434/tcp

# firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=11434/tcp
sudo firewall-cmd --reload

# iptables
sudo iptables -A INPUT -p tcp --dport 11434 -j ACCEPT
```

## Mycelia Integration

### Via CLI (Recommended)

```bash
cd backend

# Auto-setup: creates small/medium/large aliases
deno task cli llm ollama-setup http://YOUR_SERVER_IP:11434

# Or add model manually
deno task cli llm add \
  --alias small \
  --name llama3.3:70b-instruct-q4_K_M \
  --provider ollama \
  --base-url http://YOUR_SERVER_IP:11434/v1 \
  --api-key ollama

# Test
deno task cli llm test small
```

### Via UI

1. Open Settings → LLM Settings
2. Click "Add Model"
3. Fill in:
   - **Alias**: `small` (or `medium`, `large`)
   - **Name**: Model name from Ollama (e.g., `llama3.3:70b-instruct-q4_K_M`)
   - **Provider**: `ollama`
   - **Base URL**: `http://YOUR_SERVER_IP:11434/v1`
   - **API Key**: `ollama` (any value works)

### Via MongoDB

```javascript
db.llm_models.insertOne({
  alias: "small",
  name: "llama3.3:70b-instruct-q4_K_M",
  provider: "ollama",
  baseUrl: "http://YOUR_SERVER_IP:11434/v1",
  apiKey: "ollama"
})
```

## Verification

```bash
# List available models
curl http://YOUR_SERVER_IP:11434/api/tags

# Test native API
curl http://YOUR_SERVER_IP:11434/api/generate -d '{
  "model": "llama3.3:70b-instruct-q4_K_M",
  "prompt": "Hello!",
  "stream": false
}'

# Test OpenAI-compatible API
curl http://YOUR_SERVER_IP:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.3:70b-instruct-q4_K_M",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Monitoring

```bash
# Logs (systemd)
journalctl -u ollama -f

# Logs (Docker)
docker logs -f ollama

# Running models and memory usage
ollama ps

# GPU usage (if available)
nvidia-smi -l 1
```

## Stopping the Server

```bash
# systemd
sudo systemctl stop ollama

# Docker
docker compose down

# Full cleanup (Docker, removes model data)
docker compose down -v
```

## Troubleshooting

### Model not responding
```bash
# Check if model is loaded
ollama list

# Reload model
ollama run llama3.3:70b-instruct-q4_K_M
```

### Connection refused
```bash
# Check if server is listening
ss -tlnp | grep 11434

# Verify OLLAMA_HOST setting
cat /etc/systemd/system/ollama.service.d/override.conf
```

### Out of memory
- Use a smaller model or quantized version
- Check: `free -h` or `nvidia-smi`
- Consider using `medium` or `small` preset

### Slow performance
- Ensure GPU is being used: `nvidia-smi`
- Use quantized models (Q4_K_M) for better speed
- Check if other processes are using GPU memory
