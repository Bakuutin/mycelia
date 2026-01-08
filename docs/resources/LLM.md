# LLM Resource (`llm`)

The `llm` resource provides a unified interface for AI chat completions, abstracting away different inference providers (OpenAI, Anthropic, Local vLLM, etc.).

## Actions
- `completions`: Create a chat completion (supports streaming and tool calling).

## Policy Paths
- `llm/chat`: The standard path for chat completions.

## Configuration
The resource retrieves its base URL and API key from the system configuration (`getServerConfig`). It expects an OpenAI-compatible API endpoint.

## Features
- **Streaming**: Supports Server-Sent Events (SSE) for real-time text generation.
- **Tool Calling**: Pass function definitions for the model to invoke.
- **Telemetry**: Automatically tracks request counts, durations, and errors using OpenTelemetry.

