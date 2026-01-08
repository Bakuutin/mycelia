# GridFS Resource (`fs`)

The `fs` resource manages large binary file storage using MongoDB's GridFS.

## Actions
- `upload`: Save a new file. Returns a unique `ObjectId`.
- `download`: Retrieve file contents as a `Uint8Array`.
- `find`: Search for file metadata.

## Policy Paths
Paths are structured as `fs/<bucket_name>`.
- `fs/uploads`: Default bucket for user recordings.
- `fs/chunks`: Used for internal audio processing segments.

## Usage Example
```typescript
const fs = await auth.getResource<FsRequest, any>("fs");

const fileId = await fs({
  action: "upload",
  bucket: "uploads",
  filename: "recording.mp3",
  data: audioBuffer,
  metadata: { userId: "user-1" }
});
```

