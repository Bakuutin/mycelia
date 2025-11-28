# LLM Developer Guide

Use this note when you need to decide whether to run Mycelia's LLM stack on your own GPU or hook it up to OpenRouter's hosted models.

## Pick a Path
- **Run it yourself** if you want full data control, already operate a GPU workstation, or need offline capability. Target a quantized Llama 3.3 70B build—the best quality that still fits enthusiast hardware.
- **Use OpenRouter** if you want instant access to frontier (proprietary or MoE) models, million-token context windows, or just don't have ≥24 GB of VRAM. No extra services to host; you only manage an API key.

Everything in Mycelia talks to `llm_models` (Mongo collection) via alias names (`small`, `medium`, `large`). Configure whichever path you choose, then keep using the aliases everywhere else (e.g., `uv run python -m convos.cli --model medium`).

---

## Option A — Local Inference

### Hardware Cheat Sheet
| Hardware tier | Recommended model | Notes |
| --- | --- | --- |
| RTX 3060 12 GB / similar | Llama 3.2 3B dense | Fast, good for smoke tests. |
| RTX 3080/3090/4070 Ti (16‑24 GB) | Llama 3.1 8B or Llama 3.3 70B (Q2) | Keep context ≤8K. |
| RTX 4090 24 GB or M3 Ultra 128 GB unified | Llama 3.3 70B (Q4\_K\_M) | Sweet spot for solo developers; expect ~8‑12 tok/s. |
| 2× RTX 4090 or 1× A100 40 GB | Llama 3.3 70B (Q4) or Llama 4 Scout (Q4) | Comfortable context up to 16K. |
| H100 80 GB | Llama 4 Scout (INT4) | Handles long-context MoE runs. |

> Tip: Llama 4 Maverick only makes sense in cloud clusters (≥200 GB VRAM). Prefer OpenRouter for it.

### Bring Up a Local Server (example with Ollama)
1. Install Ollama and download a quantized build that matches your GPU:
   ```bash
   ollama pull meta-llama/Meta-Llama-3.3-70B-Instruct-q4_K_M
   ```
2. Start the server (serves an OpenAI-compatible `/v1/chat/completions` API):
   ```bash
   OLLAMA_NUM_GPU=1 ollama serve
   ```
3. Smoke-test locally:
   ```bash
   curl http://localhost:11434/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"meta-llama/Meta-Llama-3.3-70B-Instruct-q4_K_M","messages":[{"role":"user","content":"Say hi"}]}'
   ```

Use another runtime (llama.cpp, LM Studio, vLLM) if you prefer—just make sure it exposes the OpenAI chat schema with a stable base URL.

### Register the Model with Mycelia
1. Open the frontend → `Settings → LLMs → Add LLM Model`.
2. Enter:
   - **Alias** `small` / `medium` / `large` (match how you plan to call it).
   - **Model name** `meta-llama/Meta-Llama-3.3-70B-Instruct-q4_K_M`.
   - **Provider** `local`.
   - **Base URL** `http://localhost:11434/v1`.
   - **API key** leave blank (Ollama trusts localhost) or supply a token if your gateway enforces one.
3. Save. Repeat for each alias you want (many teams wire `small` → 8B, `medium` → 70B Q4, `large` → same model but running on beefier hardware).

Now every pipeline (`uv run python -m convos.cli --model large`, the timeline UI, MCP agents, etc.) automatically fans out to your local server.

---

## Option B — OpenRouter (Hosted Models)

### When to Prefer It
- Need 1–2 M token context windows (Gemini Flash, Grok 4 Fast, Claude Sonnet 4.5).
- Want MoE quality (Llama 4 Scout / Maverick) without owning multiple H100s.
- Care about summarization price efficiency (input-heavy workloads).

### Setup
1. Create an OpenRouter key at https://openrouter.ai.
2. Register each model under `Settings → LLMs → Add LLM Model`:
   - **Alias** e.g., `small`, `medium`, `large`, `summary`.
   - **Model name** `openrouter:google/gemini-2.5-flash` (or whichever identifier you need).
   - **Provider** `openrouter`.
   - **Base URL** `https://openrouter.ai/api/v1`.
   - **API key** paste your secret key.
3. Optional: lock down usage by scoping aliases (e.g., run summarization jobs with `--model summary`).

### Recommended OpenRouter Models
| Use case | Model | Why |
| --- | --- | --- |
| Everyday summarization (≤1 M ctx) | `openrouter:google/gemini-2.5-flash` | $0.15/M input tokens, high reliability. |
| Budget summarization | `openrouter:google/gemini-2.0-flash-lite-001` | ~$0.009 per 100k-token job. |
| DeepSeek ecosystem users | `openrouter:deepseek/deepseek-chat-v3.1` | 128K ctx, multilingual, low latency. |
| Very long docs (≤2 M ctx) | `openrouter:x-ai/grok-4-fast` | Cheap for book-scale inputs. |
| Maximum accuracy / legal | `openrouter:anthropic/claude-sonnet-4.5` | 1 M ctx, strongest guardrails. |
| Self-serve MoE | `openrouter:meta-llama/llama-4-scout` or `…/llama-4-maverick` | Skip the hardware burden; same APIs power the UI and Python stack. |

Example config snippet for summarization-heavy runs:
```yaml
# config/models.yaml
llms:
  summary:
    model: openrouter:google/gemini-2.5-flash
    baseUrl: https://openrouter.ai/api/v1
    apiKey: ${OPENROUTER_API_KEY}
```

Point the `summary` alias at this entry (UI or direct Mongo insert) and run:
```bash
cd python
uv run python -m convos.cli --model summary --limit 20
```

---

## Switching Paths Later
- Update aliases instead of changing every script. Just edit the `llm_models` record (UI or `tech.mycelia.mongo` resource) and rerun jobs.
- Keep at least one lightweight local alias (`small`) so developer tooling still works when the internet or OpenRouter is unavailable.
- For bulk updates, export/import the `llm_models` collection with your preferred Mongo tool—no code changes are required.

That’s it: decide on your hardware (or hosted) plan, register the model once, and Mycelia routes every LLM request through the aliases you defined.
