# Database Documentation

## Voice identity collections

- `diarization_runs`: generation provenance and lifecycle (`building`, `ready`, `active`, `superseded`, `failed`).
- `diarizations`: intervals with `runId`, `generation`, `embeddingSpaceId`, `lifecycleStatus` and tri-state `speakerIdentity`.
- `speaker_annotations`: manual interval labels projected by overlap; these override automatic identity.
- `speaker_calibrations`: thresholds and validation metrics for a profile revision/embedding space.
- `speaker_profiles`: includes `revision`, `embeddingSpaceId` and enrollment provenance.

See [VOICE_IDENTITY_RUNBOOK.md](VOICE_IDENTITY_RUNBOOK.md) for migration and purge invariants.

This document describes the database structure, collections, fields, and relationships for the Mycelia system.

## Overview

The Mycelia system uses multiple databases:

1. **MongoDB** (Primary) - Main backend database for audio, transcriptions, objects, chats, and more
2. **SQLite** (Diarizator) - Speaker recognition database for the diarizator service
3. **GridFS** (MongoDB) - Large file storage for audio files

## MongoDB Database (Primary)

### Connection

- **Connection String**: Set via `MONGO_URL` environment variable
- **Database Name**: Set via `DATABASE_NAME` environment variable
- **Location**: `backend/app/lib/mongo/core.server.ts`

### Collections

#### Core Audio Collections

##### `audio_chunks`
Stores processed audio chunks from recordings and uploads.

**Fields:**
- `_id`: ObjectId - Unique chunk identifier
- `original_id`: ObjectId - Reference to `source_files._id` (the recording session)
- `index`: Number - Sequential index within the recording (0, 1, 2, ...)
- `start`: Date - Timestamp when this chunk was recorded
- `format`: String - Audio format ("opus", "pcm", "float32")
- `ingested_at`: Date - When chunk was stored
- `transcribed_at`: Date - When transcription completed (null if not transcribed)
- `transcription_sequence_id`: ObjectId - Reference to `transcription_sequences._id`
- `processing_by`: String - Worker ID currently processing (null if available)
- `vad`: Object - Voice Activity Detection results
  - `has_speech`: Boolean - Whether speech was detected
  - `speech_duration`: Number - Duration of speech in seconds
- `data`: Binary - Audio data (stored in GridFS `audio-files` bucket)

**Indexes:**
- `audio_chunks_pending_work`: Composite index on `transcribed_at`, `processing_by`, `vad.has_speech`, `start` (partial filter for unprocessed chunks with speech)
- `processing_by`: Index on worker ID
- `transcribed_at`: Index for transcription status
- `start_1`: Index on start timestamp
- `original_id`: Index for finding all chunks in a recording

**Relationships:**
- `original_id` → `source_files._id` (many-to-one)
- `transcription_sequence_id` → `transcription_sequences._id` (many-to-one)

##### `source_files`
Represents an original audio file or recording session.

**Fields:**
- `_id`: ObjectId - Unique source file identifier
- `start`: Date - When recording started
- `size`: Number - File size in bytes
- `filename`: String - Original filename (for uploads)
- `ingested`: Boolean - Whether file has been processed into chunks
- `ingested_at`: Date - When ingestion completed
- `processing_status`: String - Status of processing ("pending", "complete", "error")
- `metadata`: Object - Additional metadata (mime type, etc.)

**Relationships:**
- One `source_files` → Many `audio_chunks` (via `audio_chunks.original_id`)

##### `transcription_sequences`
Groups audio chunks into sequences for transcription processing.

**Fields:**
- `_id`: ObjectId - Unique sequence identifier
- `original_id`: ObjectId - Reference to `source_files._id`
- `fromIndex`: Number - Starting chunk index
- `toIndex`: Number - Ending chunk index
- `chunk_count`: Number - Number of chunks in sequence
- `start`: Date - Start timestamp
- `end`: Date - End timestamp
- `state`: String - Processing state ("ready", "processing", "completed", "error")
- `is_continuation`: Boolean - Whether this continues a previous sequence
- `createdAt`: Date
- `updatedAt`: Date

**Indexes:**
- `original_id_state_start`: Composite index for finding sequences by recording and state
- `state_created_at`: Index for finding sequences by state and creation time
- `original_id_latest`: Index for finding latest sequence for a recording

**Relationships:**
- `original_id` → `source_files._id` (many-to-one)
- One `transcription_sequences` → Many `audio_chunks` (via `audio_chunks.transcription_sequence_id`)

##### `transcriptions`
Stores transcribed text segments from audio.

**Fields:**
- `_id`: ObjectId - Unique transcription identifier
- `transcription_sequence_id`: ObjectId - Reference to `transcription_sequences._id`
- `chunk_id`: ObjectId - Reference to `conversation_chunks._id` (if assigned to a conversation)
- `start`: Date - Start timestamp of the segment
- `end`: Date - End timestamp of the segment
- `text`: String - Transcribed text
- `segments`: Array - Detailed segments with timestamps
  - `start`: Number - Start time in seconds
  - `end`: Number - End time in seconds
  - `text`: String - Segment text
- `language`: String - Detected language code
- `createdAt`: Date

**Indexes:**
- `segments.text_text`: Text search index on segment text
- `chunk_id_created_at`: Index for finding unassigned transcriptions

**Relationships:**
- `transcription_sequence_id` → `transcription_sequences._id` (many-to-one)
- `chunk_id` → `conversation_chunks._id` (many-to-one, nullable)

##### `diarizations`
Stores speaker diarization results (who spoke when).

**Fields:**
- `_id`: ObjectId - Unique diarization identifier
- `transcription_id`: ObjectId - Reference to `transcriptions._id`
- `speakers`: Array - Speaker information
- `segments`: Array - Speaker segments with timestamps
- `createdAt`: Date

**Relationships:**
- `transcription_id` → `transcriptions._id` (one-to-one)

#### Conversation Collections

##### `conversation_chunks`
Groups transcriptions into logical conversation chunks for summarization and processing.

**Fields:**
- `_id`: ObjectId - Unique chunk identifier
- `original_id`: ObjectId - Reference to `source_files._id`
- `chunkKey`: String - Unique key for the chunk
- `start`: Date - Start timestamp
- `end`: Date - End timestamp
- `transcriptionIds`: Array[ObjectId] - References to `transcriptions._id`
- `totalTextLength`: Number - Total character count
- `transcriptionCount`: Number - Number of transcriptions
- `state`: String - State ("open", "ready", "processing", "completed", "error", "empty")
- `lastActivityAt`: Date - Last time a transcription was added
- `summary`: String - Generated summary (if completed)
- `summaryPromptId`: ObjectId - Reference to `prompts._id` used for summarization
- `createdAt`: Date
- `updatedAt`: Date

**Indexes:**
- `state_last_activity`: Composite index for finding stale open chunks
- `original_id_state`: Index for finding active chunks for a recording

**Relationships:**
- `original_id` → `source_files._id` (many-to-one)
- `transcriptionIds` → `transcriptions._id` (one-to-many)
- `summaryPromptId` → `prompts._id` (many-to-one)

#### Knowledge Graph Collections

##### `objects`
Stores entities in the knowledge graph (people, events, places, relationships, promises, etc.).

**Fields:**
- `_id`: ObjectId - Unique object identifier
- `name`: String - Object name
- `aliases`: Array[String] - Alternative names
- `details`: String - Description/details
- `icon`: Object - Visual icon (text emoji or base64 image)
- `color`: String - Color code for visual representation
- `isPerson`: Boolean - True if this is a person
- `isEvent`: Boolean - True if this is an event
- `isRelationship`: Boolean - True if this is a relationship between two objects
- `isPromise`: Boolean - True if this is a promise/commitment
- `isConversation`: Boolean - True if this represents a conversation
- `relationship`: Object - Relationship structure (only when `isRelationship: true`)
  - `subject`: ObjectId - The "from" entity (source of relationship)
  - `object`: ObjectId - The "to" entity (target of relationship)
  - `symmetrical`: Boolean - True if relationship goes both ways
- `location`: Object - Geographic coordinates (for places/events)
  - `latitude`: Number
  - `longitude`: Number
- `timeRanges`: Array[Object] - Time periods when object/relationship was active
  - `start`: Date - Start date/time
  - `end`: Date - End date/time (optional, null for ongoing)
  - `name`: String - Optional label for the time period
- `summaries`: Array[Object] - Generated summaries
- `metadata`: Object - Additional structured data
- `version`: Number - Version number for optimistic locking
- `createdAt`: Date
- `updatedAt`: Date

**Indexes:**
- `text_search_index`: Text search index on `name`, `aliases`, `details`

**Relationships:**
- One `objects` → Many `object_history` (via `object_history.objectId`)
- Relationships connect objects via `relationship.subject` and `relationship.object` fields

**Object References:**
- **References TO an object**: Count of relationships where `relationship.object` = objectId (where this object is the target)
- **References FROM an object**: Count of relationships where `relationship.subject` = objectId (where this object is the source)

##### `object_history`
Tracks changes to objects over time.

**Fields:**
- `_id`: ObjectId - Unique history entry identifier
- `objectId`: ObjectId - Reference to `objects._id`
- `timestamp`: Date - When change occurred
- `action`: String - Action type ("create", "update", "delete")
- `userId`: String - User who made the change
- `version`: Number - Object version at time of change
- `field`: String - Field that was changed (null for create/delete)
- `oldValue`: Any - Previous value
- `newValue`: Any - New value

**Indexes:**
- `object_id`: Composite index on `objectId` and `timestamp`

**Relationships:**
- `objectId` → `objects._id` (many-to-one)

#### Messaging Collections

##### `chats`
Represents chat conversations from various platforms.

**Fields:**
- `_id`: ObjectId - Unique chat identifier
- `platform`: String - Platform name ("mycelia", "telegram", etc.)
- `externalId`: String - Platform-specific chat ID
- `type`: String - Chat type ("private", "group", "channel", etc.)
- `title`: String - Chat title/name
- `lastMessageDate`: Date - Timestamp of last message
- `metadata`: Object - Platform-specific metadata
- `createdAt`: Date
- `updatedAt`: Date

**Indexes:**
- `platform_external_id_unique`: Unique composite index on `platform` and `externalId`
- `last_message_date_sort`: Index for sorting by last message date

**Relationships:**
- One `chats` → Many `messages` (via `messages.chatId`)

##### `messages`
Stores individual chat messages.

**Fields:**
- `_id`: ObjectId - Unique message identifier
- `platform`: String - Platform name
- `chatId`: ObjectId - Reference to `chats._id`
- `externalId`: String - Platform-specific message ID
- `senderId`: String - Sender identifier
- `text`: String - Message text content
- `timestamp`: Date - Message timestamp
- `metadata`: Object - Platform-specific metadata
- `createdAt`: Date

**Indexes:**
- `platform_chat_message_unique`: Unique composite index on `platform`, `chatId`, `externalId`
- `chat_history`: Composite index on `chatId` and `timestamp` for chat history queries
- `sender_history`: Composite index on `senderId` and `timestamp` for sender queries
- `by_chat_time`: Composite index on `chatId` and `createdAt`

**Relationships:**
- `chatId` → `chats._id` (many-to-one)

#### Configuration Collections

##### `prompts`
Stores prompt templates for LLM operations.

**Fields:**
- `_id`: ObjectId - Unique prompt identifier
- `name`: String - Prompt name (unique)
- `text`: String - Prompt text
- `description`: String - Optional description
- `createdAt`: Date
- `updatedAt`: Date

**Relationships:**
- Referenced by `configs.prompts` (prompt mapping)
- Referenced by `conversation_chunks.summaryPromptId`

##### `configs`
Stores server configuration.

**Fields:**
- `_id`: ObjectId - Server config ID (fixed: `000000000000000000000000`)
- `prompts`: Object - Map of task keys to prompt ObjectIds
- `features`: Object - Feature flags (boolean values)
- `createdAt`: Date
- `updatedAt`: Date

#### Job Queue Collections

##### `jobs`
Tracks background processing jobs.

**Fields:**
- `_id`: ObjectId - Unique job identifier
- `type`: String - Job type ("transcription", "summarization", "diarization", etc.)
- `state`: String - Job state ("pending", "running", "completed", "failed")
- `progress`: Number - Progress percentage (0-100)
- `input`: Object - Job input parameters
- `output`: Object - Job output/results
- `error`: String - Error message (if failed)
- `createdAt`: Date
- `startedAt`: Date
- `completedAt`: Date

**Indexes:**
- `type_state`: Composite index on `type`, `state`, `createdAt`
- `created_at_desc`: Index on `createdAt` (descending)
- `state`: Composite index on `state` and `createdAt`

#### Authentication Collections

##### `api_keys`
Stores API keys for authentication.

**Fields:**
- `_id`: ObjectId - Unique key identifier
- `key`: String - API key hash
- `name`: String - Key name/description
- `permissions`: Array[String] - Permission scopes
- `createdAt`: Date
- `expiresAt`: Date (optional)

#### Histogram Collections

##### `histogram_5min`, `histogram_1hour`, `histogram_1day`, `histogram_1week`
Time-series data for different resolutions.

**Fields:**
- `_id`: ObjectId - Unique entry identifier
- `timestamp`: Date - Time bucket
- `count`: Number - Count for this bucket
- `metadata`: Object - Additional metrics

### GridFS Buckets

#### `audio-files`
Stores large audio files that don't fit in regular documents.

**Usage:**
- Audio chunk data is stored here when chunks are created
- Referenced by `audio_chunks.data` field

### Data Flow Relationships

```
source_files (1)
  └── audio_chunks (many)
        ├── transcription_sequences (many)
        │     └── transcriptions (many)
        │           ├── diarizations (1)
        │           └── conversation_chunks (many)
        │                 └── prompts (1, via summaryPromptId)
```

```
chats (1)
  └── messages (many)
```

```
objects (1)
  └── object_history (many)
```

## SQLite Database (Diarizator)

### Location
- **Path**: `/app/data/speakers.db` (in Docker) or `diarizator/src/simple_speaker_recognition/data/speakers.db` (local)
- **Configuration**: `diarizator/src/simple_speaker_recognition/database/__init__.py`

### Tables

#### `users`
Multi-user support for speaker recognition.

**Columns:**
- `id`: Integer (Primary Key, Auto-increment)
- `username`: String(100) (Unique, Not Null)
- `created_at`: DateTime

**Relationships:**
- One `users` → Many `speakers`
- One `users` → Many `annotations`

#### `speakers`
Speaker profiles with embeddings.

**Columns:**
- `id`: String(100) (Primary Key) - User-defined speaker ID
- `name`: String(200) (Not Null)
- `user_id`: Integer (Foreign Key → `users.id`)
- `created_at`: DateTime
- `updated_at`: DateTime
- `embedding_version`: Integer (Default: 1)
- `embedding_config`: Text (JSON) - Embedding method configuration
- `embedding_data`: Text (JSON) - Serialized embedding vector
- `audio_segments_metadata`: Text (JSON) - References to audio segments
- `notes`: Text - Optional notes
- `audio_sample_count`: Integer (Default: 0)
- `total_audio_duration`: Float (Default: 0.0)

**Constraints:**
- Unique constraint on `(user_id, name)`

**Relationships:**
- `user_id` → `users.id` (many-to-one)
- One `speakers` → Many `enrollment_sessions`
- One `speakers` → Many `annotations`
- One `speakers` → Many `speaker_audio_segments`

#### `enrollment_sessions`
Tracks speaker enrollment sessions.

**Columns:**
- `id`: Integer (Primary Key, Auto-increment)
- `speaker_id`: String(100) (Foreign Key → `speakers.id`)
- `audio_file_path`: String(500) (Not Null)
- `duration_seconds`: Float
- `speech_duration_seconds`: Float
- `quality_score`: Float (0.0 to 1.0)
- `snr_db`: Float - Signal-to-noise ratio in dB
- `created_at`: DateTime
- `enrollment_method`: String(50) - 'live_recording' or 'file_upload'

**Relationships:**
- `speaker_id` → `speakers.id` (many-to-one)

#### `speaker_audio_segments`
Individual audio segments used for speaker enrollment.

**Columns:**
- `id`: Integer (Primary Key, Auto-increment)
- `speaker_id`: String(100) (Foreign Key → `speakers.id`)
- `audio_file_path`: String(500) (Not Null)
- `original_file_path`: String(500)
- `start_time`: Float (Not Null) - Start time in original file
- `end_time`: Float (Not Null) - End time in original file
- `duration_seconds`: Float (Not Null)
- `quality_score`: Float (0.0 to 1.0)
- `embedding`: Text (JSON) - Individual segment embedding
- `transcription`: Text
- `created_at`: DateTime

**Relationships:**
- `speaker_id` → `speakers.id` (many-to-one)

#### `annotations`
Audio segment annotations for training/validation.

**Columns:**
- `id`: Integer (Primary Key, Auto-increment)
- `audio_file_path`: String(500) (Not Null)
- `audio_file_hash`: String(32) - MD5 hash
- `audio_file_name`: String(255)
- `start_time`: Float (Not Null)
- `end_time`: Float (Not Null)
- `speaker_id`: String(100) (Foreign Key → `speakers.id`, Nullable)
- `speaker_label`: String(100) - For unknown speakers
- `deepgram_speaker_label`: String(50) - Original Deepgram label
- `label`: String(20) (Not Null) - 'CORRECT', 'INCORRECT', 'UNCERTAIN'
- `confidence`: Float (0.0 to 1.0)
- `transcription`: Text
- `user_id`: Integer (Foreign Key → `users.id`)
- `created_at`: DateTime
- `notes`: Text

**Relationships:**
- `speaker_id` → `speakers.id` (many-to-one, nullable)
- `user_id` → `users.id` (many-to-one)

#### `processing_jobs`
Background processing job tracking.

**Columns:**
- `id`: Integer (Primary Key, Auto-increment)
- `job_type`: String(50) (Not Null) - 'enrollment', 'export', 'annotation', etc.
- `status`: String(20) (Not Null, Default: 'pending') - 'pending', 'running', 'completed', 'failed'
- `input_data`: Text (JSON)
- `output_data`: Text (JSON)
- `progress`: Float (Default: 0.0) - 0.0 to 100.0
- `error_message`: Text
- `created_at`: DateTime
- `started_at`: DateTime
- `completed_at`: DateTime

#### `export_history`
Export operation history.

**Columns:**
- `id`: Integer (Primary Key, Auto-increment)
- `user_id`: Integer (Foreign Key → `users.id`)
- `export_type`: String(50) (Not Null) - 'single_speaker', 'bulk', 'annotations'
- `format_type`: String(20) (Not Null) - 'concatenated', 'segments', 'metadata'
- `file_path`: String(500)
- `file_size_bytes`: Integer
- `speaker_ids`: Text (JSON array)
- `created_at`: DateTime
- `downloaded_at`: DateTime
- `cleaned_up`: Boolean (Default: false)

**Relationships:**
- `user_id` → `users.id` (many-to-one)

### Relationship Diagram

```
users (1)
  ├── speakers (many)
  │     ├── enrollment_sessions (many)
  │     ├── speaker_audio_segments (many)
  │     └── annotations (many)
  └── annotations (many)
```
