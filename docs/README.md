# Mycelia Documentation

This directory contains detailed documentation for Mycelia developers and contributors.

**New users**: Start with the [main README](../README.md) for quick setup.

---

## Documentation Index

### Setup & Configuration

| Document | Description |
|----------|-------------|
| [LLM_DEVELOPER_GUIDE.md](LLM_DEVELOPER_GUIDE.md) | Configure local or hosted LLMs (Ollama, OpenRouter) |
| [JOB_QUEUE.md](JOB_QUEUE.md) | Background job system, histogram recalculation |

### Features

| Document | Description |
|----------|-------------|
| [TIMELINE_SUMMARY.md](TIMELINE_SUMMARY.md) | Timeline view and summarization features |
| [MESSENGER_SYSTEM.md](MESSENGER_SYSTEM.md) | Messenger platform integration |
| [HISTOGRAMS.md](HISTOGRAMS.md) | Timeline histogram visualization |

### Architecture

| Document | Description |
|----------|-------------|
| [objects.md](objects.md) | Data model (temporal graph, relationships) |
| [PROCESSING_AND_ARTIFACTS.md](PROCESSING_AND_ARTIFACTS.md) | Processing pipeline and artifact system |

### Roadmap & Planning

| Document | Description |
|----------|-------------|
| [DX_ROADMAP.md](DX_ROADMAP.md) | Developer experience roadmap (16 weeks) |
| [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md) | Implementation tasks by phase |
| [ONBOARDING_FLOW.md](ONBOARDING_FLOW.md) | User onboarding design |

---

## Quick Links by Role

### Backend Engineers
1. [PROCESSING_AND_ARTIFACTS.md](PROCESSING_AND_ARTIFACTS.md) - Architecture and data models
2. [JOB_QUEUE.md](JOB_QUEUE.md) - Job system implementation
3. [objects.md](objects.md) - Database schema

### Frontend Engineers
1. [ONBOARDING_FLOW.md](ONBOARDING_FLOW.md) - UI flows and decision points
2. [TIMELINE_SUMMARY.md](TIMELINE_SUMMARY.md) - Timeline component details
3. [HISTOGRAMS.md](HISTOGRAMS.md) - Visualization implementation

### DevOps
1. [DX_ROADMAP.md](DX_ROADMAP.md) - Phase 0 Foundation section
2. [JOB_QUEUE.md](JOB_QUEUE.md) - Infrastructure requirements

---

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Backend | 5173 | http://localhost:5173 |
| Frontend | 3001 | http://localhost:3001 |
| Whisper STT | 8081 | http://localhost:8081 |
| Diarization | 8085 | http://localhost:8085 |
| MongoDB | 27017 | mongodb://localhost:27017 |
| Redis | 6379 | redis://localhost:6379 |

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `MYCELIA_URL` | Backend URL | `http://localhost:5173` |
| `MYCELIA_FRONTEND_HOST` | Frontend URL | `http://localhost:3001` |
| `MYCELIA_TOKEN` | API token (auto-generated) | - |
| `MYCELIA_CLIENT_ID` | Client ID (auto-generated) | - |
| `MONGO_URL` | MongoDB connection | `mongodb://localhost:27017?directConnection=true` |
| `REDIS_PASSWORD` | Redis password | `password` |
| `STT_SERVER_URL` | Whisper server URL | `http://localhost:8081` |
| `DIARIZATION_SERVER_URL` | Diarization server URL | `http://localhost:8085` |
| `OTEL_CONSOLE` | Enable OpenTelemetry console logging | `false` |

### Diarization (`diarizator/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `HF_TOKEN` | HuggingFace API token (required) | - |
| `COMPUTE_MODE` | `cpu` or `cuda` | `cpu` |
| `SPEAKER_SERVICE_PORT` | Service port | `8085` |

---

## Contributing

See the [main README](../README.md#contributing) for contribution guidelines.
