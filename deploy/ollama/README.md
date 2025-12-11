# Ollama Remote Server Deployment

Deploy Ollama on a remote server for LLM processing in Mycelia.

## TL;DR - Complete Setup in 5 Minutes

```bash
# 1. On your remote server (SSH)
curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/ollama/setup.sh -o setup.sh
chmod +x setup.sh
./setup.sh --preset medium   # Choose preset based on your server RAM

# 2. Note the server IP shown at the end

# 3. On your local machine (Mycelia backend)
cd backend
deno task cli llm ollama-setup http://YOUR_SERVER_IP:11434

# 4. Done! Test it
deno task cli llm test small
```

---

## Step-by-Step Guide

### Step 1: Choose Your Server

You need a server with enough RAM/VRAM for your chosen model:

| Preset | Min RAM | Min VRAM | Monthly Cost (approx) |
|--------|---------|----------|----------------------|
| `tiny` | 4GB | 4GB | $5-10 |
| `small` | 8GB | 8GB | $20-40 |
| `medium` | 16GB | 16GB | $50-100 |
| `large` | 32GB | 32GB | $150-300 |
| `xlarge` | 48GB+ | 48GB+ | $300+ |

**Recommended providers:**
- [Hetzner](https://hetzner.com) - Best price/performance for EU
- [Vast.ai](https://vast.ai) - Cheap GPU rentals
- [Lambda Labs](https://lambdalabs.com) - High-end GPUs
- [DigitalOcean](https://digitalocean.com) - Simple setup

### Step 2: Connect to Your Server

```bash
ssh root@YOUR_SERVER_IP
```

### Step 3: Download Setup Script

```bash
# Download the script
curl -fsSL https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/ollama/setup.sh -o setup.sh
chmod +x setup.sh
```

### Step 4: Choose and Run Preset

Choose based on your server's RAM/VRAM:

```bash
# 4GB RAM - Fast, basic tasks
./setup.sh --preset tiny

# 8GB RAM - Good balance, recommended for most (DEFAULT)
./setup.sh --preset small

# 16GB RAM - Llama 3.3 70B quantized, great quality
./setup.sh --preset medium

# 32GB RAM - Full Llama 3.3 70B
./setup.sh --preset large

# 48GB+ RAM - Latest Llama 4 Scout
./setup.sh --preset xlarge
```

Or use custom models:
```bash
./setup.sh --models "qwen2.5:7b,llama3.2:3b"
```

**The script will:**
1. ✅ Install Ollama
2. ✅ Configure it for remote access
3. ✅ Download chosen model(s)
4. ✅ Start the server
5. ✅ Show connection details

### Step 5: Open Firewall & Verify Ports

#### Required Ports

| Port | Protocol | Description |
|------|----------|-------------|
| **11434** | TCP | Ollama API (required) |
| 22 | TCP | SSH access (you probably already have this) |

#### Open Port on Ubuntu/Debian

```bash
# Check if UFW is active
sudo ufw status

# If UFW is active, open port 11434
sudo ufw allow 11434/tcp
sudo ufw reload

# Verify the rule was added
sudo ufw status | grep 11434
```

#### Open Port on CentOS/RHEL

```bash
sudo firewall-cmd --permanent --add-port=11434/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

#### Verify Port is Open (on server)

```bash
# Check if Ollama is listening on the port
ss -tlnp | grep 11434
# Expected output: LISTEN 0 ... *:11434 ... users:(("ollama",...))

# Alternative check
netstat -tlnp | grep 11434

# Check if service is running
systemctl status ollama
```

#### Verify Port is Accessible (from your local machine)

```bash
# Simple connectivity test
nc -zv YOUR_SERVER_IP 11434
# Expected: Connection to YOUR_SERVER_IP 11434 port [tcp/*] succeeded!

# Or using curl
curl -s http://YOUR_SERVER_IP:11434/api/tags
# Expected: JSON with models list

# Or using telnet
telnet YOUR_SERVER_IP 11434
# Type: GET /api/tags HTTP/1.0 [Enter][Enter]
```

#### Troubleshooting Port Issues

```bash
# On server: Check if Ollama binds to all interfaces (not just localhost)
cat /etc/systemd/system/ollama.service.d/override.conf
# Should show: OLLAMA_HOST=0.0.0.0:11434

# Check cloud provider firewall (AWS/GCP/Hetzner/etc)
# Most providers have a separate firewall in their web console
# Make sure to allow inbound TCP 11434 there too!

# Test locally on server first
curl http://localhost:11434/api/tags
# If this works but remote doesn't → firewall issue
# If this fails → Ollama not running or misconfigured
```

### Step 6: Verify Server is Running

From your **local machine**, test the connection:

```bash
curl http://YOUR_SERVER_IP:11434/api/tags
```

You should see a JSON response with your model(s).

### Step 7: Connect Mycelia to Ollama

#### Option A: CLI (Recommended)

```bash
cd backend

# Quick setup - automatically creates small/medium/large aliases
deno task cli llm ollama-setup http://YOUR_SERVER_IP:11434

# Verify it works
deno task cli llm test small
```

#### Option B: Frontend UI

1. Open Mycelia frontend: `http://localhost:5173`
2. Go to **Settings** → **LLM Settings**
3. Click **"Add Model"**
4. Fill in the form:

| Field | Value |
|-------|-------|
| **Alias** | `small` |
| **Model Name** | `qwen2.5:7b` (or your model) |
| **Provider** | `ollama` |
| **Base URL** | `http://YOUR_SERVER_IP:11434/v1` |
| **API Key** | `ollama` |

5. Click **Save**
6. Test by going to **Chat** and sending a message

### Step 8: Verify Everything Works

```bash
# List configured models
deno task cli llm list

# Test the model
deno task cli llm test small

# Or test via curl
curl http://localhost:5173/llm/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "small",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Model Presets Reference

| Preset | RAM | Model | Speed | Quality | Best For |
|--------|-----|-------|-------|---------|----------|
| `tiny` | 4GB | `llama3.2:3b` | ⚡⚡⚡⚡ | ⭐⭐ | Quick tests, simple tasks |
| `small` | 8GB | `qwen2.5:7b` | ⚡⚡⚡ | ⭐⭐⭐ | Daily use, summaries |
| `medium` | 16GB | `llama3.3:70b-instruct-q4_K_M` | ⚡⚡ | ⭐⭐⭐⭐ | Quality analysis |
| `large` | 32GB | `llama3.3:70b` | ⚡ | ⭐⭐⭐⭐⭐ | Best quality |
| `xlarge` | 48GB+ | `llama4:scout` | ⚡ | ⭐⭐⭐⭐⭐ | Cutting edge |

### Model Details

#### Llama 4 Scout (`xlarge`)
- Latest multimodal model from Meta
- Excellent reasoning and code generation
- Requires high-end GPU (A100, H100)

#### Llama 3.3 70B (`large`)
- Full precision 70B parameter model
- Best quality for complex tasks
- Needs 32GB+ VRAM

#### Llama 3.3 70B Q4_K_M (`medium`)
- 4-bit quantized version of 70B
- 80% of quality, 50% of memory
- Great balance for most users

#### Qwen 2.5 7B (`small`)
- Fast and capable 7B model
- Excellent for summarization
- Recommended starting point

#### Llama 3.2 3B (`tiny`)
- Smallest viable model
- Very fast responses
- Good for testing and simple tasks

---

## Multiple Models Setup

You can configure multiple models with different aliases:

```bash
# On server - pull multiple models
./setup.sh --models "qwen2.5:7b,llama3.3:70b-instruct-q4_K_M"

# In Mycelia - add each as different alias
deno task cli llm add --alias small --name qwen2.5:7b --provider ollama \
  --base-url http://SERVER:11434/v1 --api-key ollama

deno task cli llm add --alias medium --name llama3.3:70b-instruct-q4_K_M --provider ollama \
  --base-url http://SERVER:11434/v1 --api-key ollama
```

---

## Docker Deployment (Alternative)

If you prefer Docker:

```bash
# On server
mkdir -p ~/ollama && cd ~/ollama
curl -O https://raw.githubusercontent.com/mycelia-tech/mycelia/refs/heads/olama-setup/deploy/ollama/docker-compose.yml

# Start with your chosen model
OLLAMA_MODELS="llama3.3:70b-instruct-q4_K_M" docker compose up -d

# Check logs
docker logs -f ollama
```

**Note:** For GPU support, ensure nvidia-container-toolkit is installed.

---

## Management Commands

### On the Server

```bash
# Check status
systemctl status ollama

# View logs
journalctl -u ollama -f

# List loaded models
ollama list

# Check memory usage
ollama ps

# Pull additional model
ollama pull mistral:7b

# Remove model
ollama rm llama3.2:3b

# Restart server
sudo systemctl restart ollama
```

### In Mycelia

```bash
# List models
deno task cli llm list

# Add model
deno task cli llm add --alias NAME --name MODEL --provider ollama \
  --base-url http://SERVER:11434/v1 --api-key ollama

# Test model
deno task cli llm test ALIAS

# Remove model
deno task cli llm remove ALIAS
```

---

## Troubleshooting

### "Connection refused"

1. Check server is running:
   ```bash
   ssh server "systemctl status ollama"
   ```

2. Check firewall:
   ```bash
   ssh server "sudo ufw status"
   ```

3. Check binding:
   ```bash
   ssh server "ss -tlnp | grep 11434"
   ```

### "Model not found"

1. Check model is pulled:
   ```bash
   ssh server "ollama list"
   ```

2. Pull it manually:
   ```bash
   ssh server "ollama pull qwen2.5:7b"
   ```

### Slow responses

1. Check GPU is being used:
   ```bash
   ssh server "nvidia-smi"
   ```

2. Check model isn't swapping:
   ```bash
   ssh server "ollama ps"
   ```

3. Consider smaller model or quantized version

### Out of memory

1. Use smaller preset:
   ```bash
   ./setup.sh --preset small  # instead of medium/large
   ```

2. Or use quantized model:
   ```bash
   ./setup.sh --models "llama3.3:70b-instruct-q4_K_M"  # instead of llama3.3:70b
   ```

---

## Stopping the Server

### Temporary Stop
```bash
# systemd
sudo systemctl stop ollama

# Docker
docker compose stop
```

### Complete Cleanup
```bash
# Remove Ollama (Linux)
sudo systemctl stop ollama
sudo rm /usr/local/bin/ollama
sudo rm -rf /usr/share/ollama
sudo userdel ollama
sudo groupdel ollama

# Docker cleanup
docker compose down -v  # -v removes model data
```

---

## Security Notes

⚠️ **Warning:** This setup exposes Ollama without authentication. For production:

1. Use a firewall to restrict access to known IPs
2. Put behind a reverse proxy with auth (nginx + basic auth)
3. Use SSH tunnel instead of exposing publicly:
   ```bash
   ssh -L 11434:localhost:11434 server
   # Then use http://localhost:11434 as base URL
   ```
