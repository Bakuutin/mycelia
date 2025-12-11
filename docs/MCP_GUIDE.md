# MCP & Chat Guide

Mycelia provides two ways for AI to interact with your data:

| Feature | MCP (CLI/API) | Chat (Frontend) |
|---------|---------------|-----------------|
| **Endpoint** | `/mcp` | `/api/chat` |
| **Use case** | Programmatic access, external tools | Interactive conversations |
| **Tools available** | All resources | mongo, timeline, objects |
| **Protocol** | JSON-RPC 2.0 | AI SDK streaming |
| **Model selection** | Any configured | Uses "medium" model |

## Setup

### 1. Start Backend

```bash
cd backend
deno task dev
```

Server runs on `http://localhost:5173`

### 2. Configure LLM Models (via Frontend)

1. Open `http://localhost:5173` (or frontend at port 3001)
2. Go to **Settings → LLM Models**
3. Click **Add Model**

**Required models:** Configure at least one of these aliases:
- `small` - Fast, cheap model for simple tasks
- `medium` - **Default for Chat** - balanced model (recommended: `gpt-4o-mini`, `claude-sonnet-4-20250514`)
- `large` - Most capable model for complex tasks

**Example configurations:**

| Alias | Provider | Model Name | Base URL |
|-------|----------|------------|----------|
| small | OpenAI | gpt-4o-mini | https://api.openai.com/v1 |
| medium | OpenAI | gpt-4o | https://api.openai.com/v1 |
| large | Anthropic | claude-sonnet-4-20250514 | https://api.anthropic.com/v1 |

**For local models (Ollama, LM Studio):**
- Base URL: `http://localhost:11434/v1` (Ollama)
- API Key: `ollama` or any string
- Model Name: `llama3.2`, `mistral`, etc.

### 3. Create API Token (for CLI)

```bash
cd backend
deno run -A --env server.ts token-create
```

Add to `backend/.env`:
```
MYCELIA_TOKEN=mycelia_xxxxx...
MYCELIA_CLIENT_ID=xxxxx...
```

## Chat (Frontend)

Access at: **http://localhost:5173/chat** (or via frontend)

Features:
- Streaming responses
- Tool calling (queries your data automatically)
- Chat history persistence
- Configurable system prompts (Settings → Prompts)

**How it works:**
1. Uses the `medium` model by default
2. AI has access to: MongoDB, Timeline, Objects
3. Messages saved to `messages` collection
4. Chat sessions saved to `chats` collection

## Messenger (Multi-Platform)

Access at: **http://localhost:5173/messaging**

Unified interface for viewing chats from multiple platforms:
- **Telegram** - Import via export data
- **Signal** - Basic message support
- **Mycelia** - Native AI chats

See [MESSENGER_GUIDE.md](MESSENGER_GUIDE.md) for import instructions and customization.

## MCP CLI

For programmatic access without the frontend.

### List Tools

```bash
cd backend
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp list
```

### Call Tools

```bash
# Count documents
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call mongo.count \
  -a '{"collection":"audio_chunks","query":{}}'

# Find documents
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call mongo.find \
  -a '{"collection":"audio_chunks","query":{"vad.has_speech":true},"options":{"limit":5}}'

# LLM completion
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call llm.chatCompletion \
  -a '{"model":"medium","messages":[{"role":"user","content":"Hello!"}]}'
```

## Available Tools

| Tool | Actions | Description |
|------|---------|-------------|
| **mongo** | find, findOne, count, insertOne, updateOne, deleteOne, aggregate... | Database operations |
| **llm** | chatCompletion | AI completions via configured models |
| **timeline** | query | Timeline data access |
| **objects** | get, list | Object storage |
| **fs** | read, write | File operations |
| **redis** | get, set | Cache operations |
| **apikeys** | create, revoke | API key management |

## Recommended Models

| Use Case | Provider | Model | Why |
|----------|----------|-------|-----|
| **General (medium)** | OpenAI | gpt-4o | Best balance of speed/quality |
| **Fast (small)** | OpenAI | gpt-4o-mini | Quick responses, low cost |
| **Complex (large)** | Anthropic | claude-sonnet-4-20250514 | Best reasoning |
| **Local/Private** | Ollama | llama3.2 | No data leaves your machine |

## Ports Reference

| Service | Port |
|---------|------|
| Backend (dev) | 5173 |
| Frontend (dev) | 3001 |
| Frontend (Docker) | 8080 |
| STT Server | 8081 |
| Diarization | 8085 |
| MongoDB | 27017 |
| Redis | 6379 |



