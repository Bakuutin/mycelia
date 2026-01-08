# MongoDB Resource (`mongo`)

The `mongo` resource provides direct access to MongoDB collections. It is the most frequently used resource for data persistence.

## Actions
- `find`: Standard query for multiple documents.
- `findOne`: Retrieve a single document.
- `insertOne` / `insertMany`: Add new documents.
- `updateOne` / `updateMany`: Modify existing documents.
- `deleteOne` / `deleteMany`: Remove documents.
- `aggregate`: Run complex aggregation pipelines.
- `bulkWrite`: Perform multiple write operations atomically.
- `count`: Count documents matching a query.
- `createIndex` / `listIndexes`: Manage collection indexes.
- `getFirstBatch` / `getMore`: Cursor-based pagination for large results.

## Policy Paths
Paths are structured as `mongo/<collection_name>`.
- `mongo/audio_chunks`
- `mongo/transcriptions`
- `mongo/users`

## Modifiers

### `filter`
Injects a mandatory filter into all queries and validates documents on insertion. This is the primary mechanism for **multi-tenant isolation**.

**Example Policy:**
```json
{
  "resource": "mongo/audio_chunks",
  "action": "read",
  "effect": "modify",
  "middleware": {
    "code": "filter",
    "arg": { "owner": "user_123" }
  }
}
```
Any `find` or `update` call will have `{ owner: "user_123" }` automatically added to the query criteria. Any `insertOne` will fail if the document doesn't match the filter.

