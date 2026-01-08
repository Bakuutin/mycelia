# Jobs Resource (`jobs`)

The `jobs` resource provides an interface to the BullMQ-based background processing system.

## Actions
- `enqueue`: Start a new background task.
- `get`: Retrieve the current status, progress, and results of a job.
- `list`: List recent jobs with filtering by type and status.
- `cancel` / `cancel_all`: Stop pending or active jobs.
- `progressUpdate`: Internal action used by workers to report their status.
- `schemas`: Retrieve the JSON schemas for all available job types.

## Policy Paths
- `jobs`: For general job management.
- `jobs/schemas`: Specifically for accessing job definitions.

## Integration
The resource bridges MongoDB (where job metadata is stored for long-term tracking) and Redis (where active BullMQ queues reside).

