# API Tests for Modernized Resource-Based Architecture

This directory contains comprehensive tests for the modernized API endpoints
that use the new resource-based architecture instead of the old `auth.db`
pattern.

## Test Files

### Core Resource Tests

- `app/lib/mongo/tests/mongo.test.ts` - Tests for MongoDB resource operations
- `app/lib/mongo/tests/fs.test.ts` - Tests for GridFS file storage operations

### API Endpoint Tests

- `app/routes/api.audio.ingest.test.ts` - Tests for audio file ingestion
  endpoint
- `app/routes/api.files.upload.test.ts` - Tests for general file upload endpoint

### Service Tests

- `app/services/timeline.server.test.ts` - Tests for timeline data fetching
  service

### Data Route Tests

- `app/routes/data.audio.test.ts` - Tests for audio data retrieval endpoint
- `app/routes/data.transcriptions.test.ts` - Tests for transcription data
  retrieval endpoint

## Running Tests

### Run All Tests

```bash
deno run --allow-all scripts/test.ts
```

### Run Individual Test Files

```bash
deno test --allow-all app/routes/api.audio.ingest.test.ts
deno test --allow-all app/routes/api.files.upload.test.ts
deno test --allow-all app/services/timeline.server.test.ts
deno test --allow-all app/routes/data.audio.test.ts
deno test --allow-all app/routes/data.transcriptions.test.ts
```

### Run Core Resource Tests

```bash
deno test --allow-all app/lib/mongo/tests/mongo.test.ts
deno test --allow-all app/lib/mongo/tests/fs.test.ts
```

## Test Coverage

### API Endpoint Tests

- **Form Data Validation**: Tests for parsing and validating multipart form data
- **Authentication**: Tests for proper authentication handling
- **File Upload**: Tests for successful file uploads and error handling
- **Idempotency**: Tests for handling duplicate uploads with same idempotence
  keys
- **Error Handling**: Tests for various error scenarios (invalid data, missing
  files, etc.)

### Service Tests

- **Timeline Data Fetching**: Tests for fetching timeline data with different
  resolutions
- **Data Transformation**: Tests for proper data structure transformation
- **Sorting**: Tests for correct sorting of transcripts by time
- **Empty Data Handling**: Tests for handling empty result sets

### Data Route Tests

- **Parameter Validation**: Tests for URL parameter validation
- **Date Range Queries**: Tests for date-based filtering
- **Pagination**: Tests for limit and pagination functionality
- **Error Responses**: Tests for proper error responses

## Mock Strategy

The tests use a comprehensive mocking strategy:

1. **Resource Mocking**: Mock the MongoDB and GridFS resources to avoid real
   database connections
2. **Authentication Mocking**: Mock the authentication system to test with
   controlled user contexts
3. **File System Mocking**: Mock file upload operations to test without real
   file system access
4. **Request Mocking**: Mock HTTP requests to test endpoint behavior

## Key Testing Patterns

### Resource-Based API Testing

```typescript
// Mock the resource
const mongoResource = new MongoResource();
resourceManager.registerResource(mongoResource);

// Setup mock responses
mongoResource.getRootDB = async () => ({
  collection: fn(() => ({
    find: fn(() => mockData),
    findOne: fn(() => mockItem),
  })),
} as any);
```

### Form Data Testing

```typescript
const formData = new FormData();
formData.append("file", new Blob([data]), "filename.ext");
formData.append("metadata", JSON.stringify(metadata));

const request = new Request("http://localhost/api/endpoint", {
  method: "POST",
  body: formData,
});
```

### Error Testing

```typescript
try {
  await functionUnderTest();
  expect(true).toBe(false); // Should not reach here
} catch (error) {
  expect(error).toBeInstanceOf(Response);
  expect((error as Response).status).toBe(400);
}
```

## Migration from Old API

These tests validate the migration from the old `auth.db` pattern to the new
resource-based API:

### Old Pattern (Deprecated)

```typescript
const collection = auth.db.collection("collection_name");
const result = await collection.find(query);
```

### New Pattern (Current)

```typescript
const mongoResource = await getMongoResource(auth);
const result = await mongoResource({
  action: "find",
  collection: "collection_name",
  query: query,
  options: { sort: { field: 1 }, limit: 10 },
});
```

## Test Data

The tests use realistic test data that mirrors the actual application data
structures:

- **Audio Files**: Mock audio files with proper metadata
- **Transcriptions**: Mock transcription data with segments and language
  probabilities
- **Timeline Data**: Mock timeline items with proper date ranges and totals
- **User Data**: Mock user authentication contexts

## Continuous Integration

These tests are designed to run in CI/CD pipelines and provide:

- **Fast Execution**: All tests run in under 30 seconds
- **Isolation**: Tests don't depend on external services
- **Deterministic**: Tests produce consistent results
- **Comprehensive**: Cover all major functionality paths

## Future Enhancements

- **Performance Tests**: Add tests for API response times
- **Load Tests**: Add tests for concurrent request handling
- **Integration Tests**: Add tests with real database connections
- **Security Tests**: Add tests for authorization and access control
