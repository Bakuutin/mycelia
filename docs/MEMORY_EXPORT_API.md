# Portable memory export API

Mycelia exposes a dedicated, read-only resource for product integrations that
need portable user memory without general database access. It is available at
`POST /api/resource/memory-export` and uses the same bearer-token authentication
as other resources.

The contract exposes only `objects`, `transcriptions`, `messages`, and `chats`.
It does not expose audio or GridFS, Redis, credentials, jobs, prompts,
configuration, access logs, or any write operation. System, tool, developer,
and function messages are filtered by the server. Responses use fixed field
projections so new internal fields do not become exportable by accident.

## Authorization

Create a dedicated API key with only these policies:

```json
[
  { "resource": "memory-export/objects", "action": "read", "effect": "allow" },
  { "resource": "memory-export/transcriptions", "action": "read", "effect": "allow" },
  { "resource": "memory-export/messages", "action": "read", "effect": "allow" },
  { "resource": "memory-export/chats", "action": "read", "effect": "allow" }
]
```

Do not grant the integration `db/**`, `mongo`, filesystem, Redis, jobs, config,
or wildcard policies. Keep the token in the integration process environment and
send it only over TLS (or to the local development endpoint).

## Cursor pagination

Count an allowed collection:

```json
{ "action": "count", "collection": "objects" }
```

Start an `_id`-ordered export (page size must be 1 through 1000):

```json
{ "action": "getFirstBatch", "collection": "objects", "batchSize": 250 }
```

If `hasMore` is true, continue with the returned cursor and the same collection:

```json
{
  "action": "getMore",
  "collection": "objects",
  "cursorId": "returned-opaque-id",
  "batchSize": 250
}
```

Cursors expire after 30 minutes and are bound to the principal and collection
that created them. Consumers must finish one cursor before starting a fresh
snapshot of that collection. An empty `cursorId` with `hasMore: false` marks the
last page.
