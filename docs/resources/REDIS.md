# Redis Resource (`redis`)

The `redis` resource provides access to Redis for caching, locking, and stream-based messaging.

## Actions
- **Key-Value**: `set`, `get`, `del`.
- **Hashes**: `hset`, `hget`, `hgetall`.
- **Streams**: `xadd`, `xread`, `xreadgroup`, `xgroup`, `xack`, `xdel`, `xrange`, `xlen`, `xtrim`.
- **Pipeline**: `pipeline` (Execute multiple operations atomically).

## Policy Paths
Paths are the raw Redis keys.
- `access_logs`: Path for access logging stream.
- `job_queue:*`: Path pattern for background jobs.

## Special Behavior
- `hset` always includes an `expire` operation to ensure cache TTL is maintained.
- `pipeline` actions are matched against policies for every operation contained within the pipeline.

