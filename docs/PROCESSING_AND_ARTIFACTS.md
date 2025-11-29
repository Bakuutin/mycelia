# Mycelia Processing System & Artifacts

**Version**: 1.0
**Last Updated**: 2025-11-27
**Status**: Design Document

---

## Executive Summary

This document describes Mycelia's data processing pipeline and artifact management system. The core principle: **modular, auditable, and reusable processing** of personal memory data.

**Key Features**:
- User-controlled processing with custom instructions
- Multiple processing types (summaries, tasks, meetings, etc.)
- Template-based prompt composition
- Persistent artifacts with full metadata
- Re-processing with different models or instructions
- Complete audit trail

---

## Table of Contents

1. [Processing Pipeline Architecture](#processing-pipeline-architecture)
2. [Processing Types & Templates](#processing-types--templates)
3. [Artifacts System](#artifacts-system)
4. [User Workflows](#user-workflows)
5. [Technical Implementation](#technical-implementation)
6. [Privacy & Transparency](#privacy--transparency)

---

## Processing Pipeline Architecture

### Overview

Mycelia's processing system transforms raw audio data into structured, meaningful artifacts through a multi-stage pipeline.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROCESSING PIPELINE                          │
└─────────────────────────────────────────────────────────────────┘

  Raw Audio Files
       │
       ▼
  ┌────────────────┐
  │   Discovery    │  Auto-detect audio sources
  │                │  (Voice Memos, Google Drive, local)
  └────────┬───────┘
           │
           ▼
  ┌────────────────┐
  │   Ingestion    │  Import files to database
  │                │  Create source_file records
  └────────┬───────┘
           │
           ▼
  ┌────────────────┐
  │   Chunking     │  Split to 10-second Opus segments
  │                │  Store in GridFS
  └────────┬───────┘
           │
           ▼
  ┌────────────────┐
  │      VAD       │  Voice Activity Detection
  │                │  Mark chunks with/without speech
  └────────┬───────┘
           │
           ▼
  ┌────────────────┐
  │      STT       │  Speech-to-Text (Whisper)
  │                │  Generate transcripts
  └────────┬───────┘
           │
           ▼
  ┌────────────────┐
  │  Conversation  │  Group adjacent speech
  │  Extraction    │  Extract topics, entities
  └────────┬───────┘
           │
           ▼
  ┌────────────────┐
  │   User-Level   │  Custom processing
  │   Processing   │  Create artifacts
  └────────┬───────┘
           │
           ▼
     Artifacts Database
```

---

### Current Pipeline (Existing)

**Stage 1: Discovery & Ingestion**
- Script: `python/daemon.py`
- Input: Audio source directories
- Output: `source_files` collection
- Status tracking: `status` field (pending, processing, completed, error)

**Stage 2: Chunking**
- Script: `python/chunking.py`
- Input: `source_files` with `status=pending`
- Process: Split to 10-second Opus chunks using ffmpeg
- Output: `audio_chunks` collection + GridFS storage
- Metadata: `start`, `duration`, `source_file_id`

**Stage 3: Voice Activity Detection**
- Script: `python/diarization.py`
- Input: `audio_chunks` with `vad=null`
- Process: Silero VAD model
- Output: `vad.has_speech`, `vad.confidence` fields
- Optimization: Skip chunks without speech for STT

**Stage 4: Speech-to-Text**
- Script: `python/stt.py`
- Input: `audio_chunks` with `transcribed_at=null` and `vad.has_speech=true`
- Process: Call Whisper server (`STT_SERVER_URL`)
- Output: `transcript` field, `transcribed_at` timestamp
- Concurrency: Multiple workers, `processing_by` flag prevents duplication

**Stage 5: Conversation Extraction**
- Script: `python -m convos.cli`
- Input: Transcripts for date range
- Process: Group adjacent speech, call LLM to extract:
  - Conversation title
  - Summary
  - Participants
  - Topics/entities
  - Emoji icon
- Output: `objects` collection (type=conversation)
- Relationships: Link entities and participants

---

### New Pipeline Layer: User-Directed Processing

**Purpose**: Allow users to process time periods with custom instructions and templates.

**Trigger**: User-initiated via UI or API

**Process**:
1. User selects:
   - Time period (`start`, `end`)
   - Processing type (summary, tasks, meeting, etc.)
   - Model (small, medium, large, or specific)
   - Custom instructions (optional)
   - Context (optional)
2. System creates processing job
3. Job queued in BullMQ
4. Worker fetches:
   - Audio chunks for period
   - Transcripts
5. Worker applies processing template:
   - Load YAML template
   - Substitute variables (`{transcript}`, `{start}`, `{end}`, `{context}`)
   - Compile final prompt
6. Worker calls LLM:
   - Send prompt
   - Stream or batch response
   - Parse structured output
7. Worker creates artifact:
   - Store result
   - Save metadata (token count, model, etc.)
   - Link to source chunks
8. User notified (WebSocket or polling)

**Output**: Artifact in database

---

## Processing Types & Templates

### Template System

Templates are YAML files that define:
- Processing type name and description
- Prompt structure (system + user messages)
- Variables to substitute
- Expected output format (JSON schema)
- Post-processing rules

**Template Structure**:
```yaml
name: "Summary"
description: "General summarization of conversations in a time period"
version: "1.0"

variables:
  - name: "start"
    type: "date"
    description: "Start of time period"
  - name: "end"
    type: "date"
    description: "End of time period"
  - name: "transcript"
    type: "text"
    description: "Combined transcript of all audio in period"
  - name: "context"
    type: "text"
    description: "Optional user-provided context"
    required: false

prompt:
  system: |
    You are a helpful assistant that summarizes personal audio recordings.
    Focus on key themes, decisions, and insights.
    Be concise and actionable.

  user: |
    Summarize the following conversations from {start} to {end}.

    {context}

    Transcript:
    {transcript}

    Provide:
    1. Overview (2-3 sentences)
    2. Key themes (bullet points)
    3. Important decisions or action items
    4. Insights or reflections

output_format:
  type: "object"
  properties:
    overview:
      type: "string"
      description: "2-3 sentence overview"
    themes:
      type: "array"
      items:
        type: "string"
      description: "Key themes discussed"
    decisions:
      type: "array"
      items:
        type: "string"
      description: "Important decisions made"
    insights:
      type: "array"
      items:
        type: "string"
      description: "Reflections or insights"

post_processing:
  - action: "markdown_format"
    template: |
      ## Overview
      {overview}

      ## Key Themes
      {themes}

      ## Decisions
      {decisions}

      ## Insights
      {insights}
```

---

### Built-in Templates

#### 1. Summary (`templates/summary.yaml`)

**Purpose**: General overview of conversations in a time period

**Output**:
- Overview (2-3 sentences)
- Key themes
- Important decisions
- Insights

**Use cases**:
- Daily review
- Weekly recap
- Monthly summary

**Example artifact**:
```markdown
## Overview
This week included several work meetings focused on project planning
and a personal conversation about vacation plans. Key decisions were
made regarding Q4 roadmap priorities.

## Key Themes
- Q4 product roadmap
- Team resource allocation
- Summer vacation planning
- Health and fitness goals

## Decisions
- Prioritize mobile app redesign for Q4
- Hire two additional engineers by end of month
- Schedule vacation for August 15-30

## Insights
- Team morale is high despite tight deadlines
- Need to balance work commitments with personal time
- Regular exercise routine has improved focus
```

---

#### 2. Task Extraction (`templates/tasks.yaml`)

**Purpose**: Extract actionable TODO items from conversations

**Output**:
- List of tasks with:
  - Task description
  - Priority (high, medium, low)
  - Due date (if mentioned)
  - Category (work, personal, etc.)
  - Assigned to (if mentioned)

**Use cases**:
- Extract action items from meetings
- Create TODO list from voice notes
- Track commitments made in conversations

**Example artifact**:
```json
{
  "tasks": [
    {
      "description": "Schedule follow-up meeting with design team",
      "priority": "high",
      "due_date": "2025-12-01",
      "category": "work",
      "assigned_to": "me",
      "source": "Meeting on 2025-11-25 at 10:00 AM"
    },
    {
      "description": "Book flight tickets for vacation",
      "priority": "medium",
      "due_date": "2025-12-15",
      "category": "personal",
      "assigned_to": "me",
      "source": "Conversation on 2025-11-26 at 7:30 PM"
    },
    {
      "description": "Review Sarah's proposal and provide feedback",
      "priority": "high",
      "due_date": "2025-11-28",
      "category": "work",
      "assigned_to": "me",
      "source": "Email discussion on 2025-11-24"
    }
  ],
  "total_tasks": 3,
  "high_priority_count": 2
}
```

**UI rendering**:
- Checklist format
- Sort by priority and due date
- Mark as complete (updates artifact metadata)
- Export to calendar or task manager

---

#### 3. Meeting Notes (`templates/meeting.yaml`)

**Purpose**: Structured notes from business meetings

**Output**:
- Meeting metadata (date, duration, participants)
- Agenda items discussed
- Decisions made
- Action items (with owners)
- Next steps

**Use cases**:
- Business meetings
- Client calls
- Team standups
- Project reviews

**Example artifact**:
```markdown
# Meeting: Q4 Planning Session

**Date**: 2025-11-25
**Duration**: 1 hour 15 minutes
**Participants**: Alice (Product), Bob (Engineering), Carol (Design), Me

## Agenda
1. Review Q3 results
2. Discuss Q4 priorities
3. Resource allocation
4. Timeline and milestones

## Discussion Summary
### Q3 Results
- Shipped 8/10 planned features
- User engagement up 25%
- Two features delayed to Q4 (mobile redesign, analytics dashboard)

### Q4 Priorities
Agreed to focus on:
1. Mobile app redesign (highest priority)
2. Analytics dashboard completion
3. Performance optimization
4. User onboarding improvements

### Resource Allocation
- Need to hire 2 additional engineers
- Carol to lead design for mobile app
- Bob to focus on performance optimization

## Decisions
- [x] Prioritize mobile app redesign for Q4
- [x] Delay analytics dashboard to mid-Q4
- [x] Allocate 40% of engineering time to performance
- [x] Budget approved for 2 new hires

## Action Items
- [ ] Alice: Create detailed mobile app spec by Dec 1
- [ ] Bob: Audit codebase for performance bottlenecks by Nov 30
- [ ] Carol: Design mockups for mobile app by Dec 5
- [ ] Me: Post job listings by Nov 28

## Next Steps
- Follow-up meeting: December 10, 2025
- Weekly check-ins every Monday at 10 AM
- Design review scheduled for December 6
```

---

#### 4. Therapy/Psychological Session (`templates/therapy.yaml`)

**Purpose**: Structured analysis for personal reflection or therapy sessions

**Output**:
- Key themes and emotions
- Insights or realizations
- Goals discussed
- Progress on previous goals
- Suggested next steps

**Use cases**:
- Personal therapy sessions
- Self-reflection voice journals
- Coaching sessions
- Mental health tracking

**Privacy note**: This is highly sensitive. System must:
- Allow marking artifacts as "private" (not shareable)
- Support full deletion (not just soft delete)
- Clearly communicate that data stays local if self-hosted

**Example artifact**:
```markdown
# Session Reflection - November 25, 2025

## Emotional Themes
- Anxiety around work deadlines
- Gratitude for supportive relationships
- Frustration with time management
- Optimism about upcoming vacation

## Key Insights
- Recognized pattern: taking on too many commitments leading to burnout
- Insight: Need to practice saying "no" to non-essential requests
- Realization: Exercise routine has significantly improved mood
- Understanding: Work stress stems from perfectionism, not actual workload

## Progress on Previous Goals
✓ Maintained 4x/week exercise routine
✓ Established morning meditation practice
⚠ Partially improved sleep schedule (still working on it)
✗ Haven't set clearer work boundaries yet

## New Goals
1. Practice declining non-essential requests this week
2. Block 2 hours daily for deep work (no interruptions)
3. Schedule vacation time to recharge
4. Continue exercise and meditation routines

## Suggested Next Steps
- Implement "decision filter" for new commitments
- Communicate boundaries to team
- Plan vacation activities that promote relaxation
- Revisit time management system

## Therapist Notes (if applicable)
[Space for therapist to add professional notes]
```

---

#### 5. Custom Processing (`templates/custom.yaml`)

**Purpose**: User-defined processing with custom instructions

**Output**: Flexible, based on user's prompt

**Use cases**:
- Specific analysis needs
- Experimental processing
- Domain-specific extraction (e.g., "extract all book recommendations mentioned")

**Template structure**:
```yaml
name: "Custom Processing"
description: "User-defined processing with custom instructions"

variables:
  - name: "transcript"
    type: "text"
  - name: "instructions"
    type: "text"
    description: "User's custom instructions"
    required: true

prompt:
  system: |
    You are a helpful assistant that processes personal audio transcripts.
    Follow the user's instructions precisely.

  user: |
    {instructions}

    Transcript:
    {transcript}

output_format:
  type: "any"
  description: "Format depends on user instructions"
```

**Example use**:
- User instruction: "Extract all book recommendations mentioned, with who recommended them and why."
- System generates artifact with list of books

---

## Artifacts System

### Artifact Data Model

```typescript
interface Artifact {
  _id: ObjectId;
  user_id: ObjectId;

  // Type and metadata
  type: "summary" | "tasks" | "meeting" | "therapy" | "custom";
  created_at: Date;
  updated_at: Date;

  // Source data
  source_period: {
    start: Date;
    end: Date;
  };
  source_chunks: ObjectId[];  // audio_chunk IDs

  // Processing request
  processing_request: {
    type: string;
    template: string;           // e.g., "summary.yaml"
    model: string;              // e.g., "gpt-4o" or "medium" alias
    instructions: string;       // User's custom instructions
    context: string;            // Additional context provided
  };

  // Result
  result: {
    text: string;               // Markdown or plain text
    structured_data: any;       // JSON object (type-specific)
  };

  // Metadata
  metadata: {
    token_count: {
      input: number;
      output: number;
      total: number;
    };
    processing_time_ms: number;
    model_used: string;         // Actual model name (resolved from alias)
    cost_usd: number;           // Estimated cost
  };

  // Organization
  tags: string[];               // User-defined tags
  visibility: "visible" | "hidden" | "archived" | "private";

  // Versioning
  version: number;              // For re-processed artifacts
  parent_artifact_id: ObjectId | null;  // If re-processed from another

  // Sharing (optional feature)
  shared: boolean;
  shared_links: ObjectId[];     // References to shared_links collection
}
```

---

### Artifact Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                     ARTIFACT LIFECYCLE                          │
└─────────────────────────────────────────────────────────────────┘

  User initiates processing
           │
           ▼
  ┌─────────────────┐
  │  Job Queued     │
  │  Status: queued │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Processing     │
  │  Status: active │
  │  Progress: 50%  │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Completed      │
  │  Artifact saved │
  └────────┬────────┘
           │
           ├─ visible (default)
           ├─ hidden (user action)
           ├─ archived (user action)
           └─ private (sensitive data)

  ┌─────────────────┐
  │  Re-processed   │  User requests re-processing
  │  New artifact   │  with different model/instructions
  │  version: 2     │
  └─────────────────┘
           │
           └─ parent_artifact_id links to original

  ┌─────────────────┐
  │  Deleted        │  Soft delete (mark as deleted)
  │  visibility:    │  or hard delete (remove from DB)
  │  deleted        │
  └─────────────────┘
```

---

### Artifact Organization

**Tags**:
- User-defined labels (e.g., "work", "personal", "family")
- Multiple tags per artifact
- Filterable in UI

**Visibility States**:
- **Visible** (default): Shown in main list
- **Hidden**: Not shown in main list, accessible via filter
- **Archived**: Moved to archive, still searchable
- **Private**: Extra privacy flag (for therapy, sensitive notes)

**Collections/Folders** (future feature):
- Group related artifacts
- E.g., "Q4 2025 Work", "Vacation Planning", "Therapy Sessions"

---

### Artifact Operations

**Create**:
- Via processing job
- Manual creation (future: paste text, upload document)

**Read**:
- List view with filters
- Detail view with full content
- Export (markdown, JSON, PDF)

**Update**:
- Change tags
- Change visibility
- Add notes/comments (future)

**Delete**:
- Soft delete (mark as deleted, hide from UI)
- Hard delete (remove from database, requires confirmation)
- Bulk delete

**Re-process**:
- Create new artifact from same source period
- Allow modification of model, instructions
- Link to original artifact (parent_artifact_id)

**Compare** (future):
- Side-by-side comparison of multiple artifacts from same period
- Useful for comparing models or different instructions

**Share** (optional):
- Generate shareable link
- Password protection
- Expiration time
- View-only mode

---

## User Workflows

### Workflow 1: Daily Summary

**Scenario**: User wants a summary of their day

```
1. User opens Mycelia dashboard
2. Clicks "Process Period" button
3. Modal opens:
   - Time period: Auto-filled with "Today" (00:00 - 23:59)
   - Processing type: Select "Summary"
   - Model: Default (Medium)
   - Instructions: (optional, leave blank)
4. User clicks "Process"
5. Job queued, progress indicator appears
6. After ~30 seconds, notification: "Summary ready!"
7. User clicks notification
8. Artifact detail page opens
9. User reads summary:
   - Overview of the day
   - Key themes (work, personal, family)
   - Important decisions made
   - Reflections
10. User tags artifact: "daily-summary", "2025-11-27"
11. User bookmarks or archives for later reference
```

**Outcome**: Daily summary artifact created and organized

---

### Workflow 2: Extract Tasks from Meeting

**Scenario**: User had a work meeting, wants to extract action items

```
1. User navigates to timeline
2. Selects meeting time period (e.g., 10:00 AM - 11:30 AM)
3. Right-clicks or uses button: "Process Selected Period"
4. Processing modal opens:
   - Time period: Pre-filled with selection
   - Processing type: Select "Task Extraction"
   - Model: Medium
   - Context: "Work meeting about Q4 planning"
5. User clicks "Process"
6. Job completes
7. Artifact shows structured task list:
   - Task: "Schedule follow-up with design team"
     Priority: High, Due: Dec 1
   - Task: "Review budget proposal"
     Priority: Medium, Due: Nov 30
   - Task: "Send meeting notes to team"
     Priority: High, Due: Today
8. User exports tasks to calendar or TODO app
9. Alternatively, marks tasks as complete in Mycelia
```

**Outcome**: Actionable task list extracted and integrated into workflow

---

### Workflow 3: Re-process with Better Model

**Scenario**: User created summary with Small model, wants higher quality

```
1. User views artifact (created with Small model)
2. Reads result, feels it's too brief
3. Clicks "Re-process" button
4. Form opens, pre-filled with:
   - Same time period
   - Same type (Summary)
   - Model: Change to "Large" (Claude 3.5 Opus)
   - Instructions: Same as before
5. User clicks "Re-process"
6. New artifact created (version 2)
7. User compares both versions:
   - Small model: Brief, basic themes
   - Large model: Detailed, nuanced insights
8. User decides to keep Large version, archives Small version
```

**Outcome**: Improved artifact quality through model upgrade

---

### Workflow 4: Custom Analysis

**Scenario**: User wants to extract all book recommendations from past month

```
1. User opens "Process Period"
2. Selects:
   - Time period: Last 30 days
   - Processing type: "Custom"
   - Model: Medium
   - Instructions: "Extract all book recommendations mentioned in conversations. Include who recommended each book and why."
3. User clicks "Process"
4. Job completes
5. Artifact shows:
   - "Atomic Habits" by James Clear
     Recommended by: Sarah (friend)
     Reason: Help with productivity and habit formation
   - "The Innovators" by Walter Isaacson
     Recommended by: Tech podcast host
     Reason: Understand history of computing
   - [... more books ...]
6. User exports as reading list
7. User tags artifact: "reading-list", "books", "recommendations"
```

**Outcome**: Custom extraction based on specific user need

---

### Workflow 5: Weekly Review

**Scenario**: User does weekly review every Sunday

```
1. User creates scheduled processing job:
   - Frequency: Every Sunday at 8 PM
   - Time period: Last 7 days
   - Processing type: Summary
   - Model: Medium
   - Instructions: "Focus on: work progress, personal goals, health habits, social connections"
2. System automatically processes every week
3. User receives notification
4. User reviews summary:
   - Work: Shipped feature X, struggled with bug Y
   - Goals: Exercised 5 days, meditated 4 days
   - Health: Maintained sleep schedule
   - Social: Dinner with friends, family call
5. User reflects and sets intentions for next week
6. User tags: "weekly-review", "2025-W48"
7. Over time, builds archive of weekly reflections
```

**Outcome**: Automated weekly reflection system

---

## Technical Implementation

### Processing Job Queue

**Technology**: BullMQ (Redis-backed job queue)

**Job Schema**:
```typescript
interface ProcessingJob {
  id: string;
  user_id: ObjectId;

  // Request
  type: "summary" | "tasks" | "meeting" | "therapy" | "custom";
  source_period: {
    start: Date;
    end: Date;
  };
  model: string;
  instructions: string;
  context: string;
  template: string;

  // State
  status: "queued" | "active" | "completed" | "failed";
  progress: number;        // 0-100
  error: string | null;

  // Result
  artifact_id: ObjectId | null;

  // Metadata
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}
```

**Queue Configuration**:
- Concurrency: 5 workers (configurable)
- Retry: 3 attempts on failure
- Timeout: 10 minutes per job
- Priority: User-initiated jobs > scheduled jobs

**Job Lifecycle**:
1. User creates job via API: `POST /api/processing/create`
2. Job added to BullMQ queue
3. Worker picks up job
4. Worker updates status: `active`, progress: 10%
5. Worker fetches source data (audio chunks, transcripts)
6. Progress: 30%
7. Worker loads template and compiles prompt
8. Progress: 40%
9. Worker calls LLM
10. Progress: 60-90% (depending on streaming)
11. Worker parses response
12. Worker creates artifact
13. Progress: 100%, status: `completed`
14. User notified via WebSocket

**Error Handling**:
- LLM API error: Retry with exponential backoff
- Timeout: Retry or fail (depending on error)
- Invalid response: Parse as best as possible, flag as partial result
- User notification on failure with error details

---

### Template Rendering Engine

**Process**:
1. Load YAML template from `templates/{type}.yaml`
2. Parse template structure
3. Validate required variables are available
4. Substitute variables in prompt:
   - `{start}` → Formatted date
   - `{end}` → Formatted date
   - `{transcript}` → Combined transcript text
   - `{context}` → User-provided context
   - `{instructions}` → User's custom instructions
5. Compile system and user messages
6. Add output format instruction (JSON schema)
7. Return final prompt

**Example**:
```yaml
# Template
prompt:
  user: |
    Summarize conversations from {start} to {end}.
    {context}
    Transcript: {transcript}

# Variables
start: "November 25, 2025"
end: "November 27, 2025"
context: "Focus on work-related discussions."
transcript: "Meeting at 10 AM: Discussed Q4 roadmap..."

# Compiled Prompt
user: |
  Summarize conversations from November 25, 2025 to November 27, 2025.
  Focus on work-related discussions.
  Transcript: Meeting at 10 AM: Discussed Q4 roadmap...
```

**Template Variable Types**:
- `date`: Format using user's preference (SI or Gregorian)
- `text`: Raw string substitution
- `number`: Numeric formatting
- `list`: Join with newlines or bullets

---

### LLM Integration

**Model Resolution**:
```typescript
function resolveModel(alias: string, user_id: ObjectId): LLMModel {
  // Check if user has custom model for this alias
  const userModel = await db.llm_models.findOne({
    user_id,
    alias,
  });

  if (userModel) return userModel;

  // Fall back to default Mycelia model
  const defaultModel = await db.llm_models.findOne({
    alias,
    user_id: "MYCELIA_DEFAULT",
  });

  return defaultModel;
}
```

**Prompt Construction**:
```typescript
function buildPrompt(template: Template, variables: Variables): Prompt {
  const systemMessage = substituteVariables(template.prompt.system, variables);
  const userMessage = substituteVariables(template.prompt.user, variables);

  // Add output format instruction
  const formatInstruction = `
    Respond in the following JSON format:
    ${JSON.stringify(template.output_format, null, 2)}
  `;

  return {
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage + "\n\n" + formatInstruction },
    ],
  };
}
```

**API Call**:
```typescript
async function callLLM(model: LLMModel, prompt: Prompt): Promise<LLMResponse> {
  const provider = getProvider(model.provider);

  const response = await provider.chat.completions.create({
    model: model.name,
    messages: prompt.messages,
    temperature: 0.7,
    max_tokens: 4000,
    // Optional: streaming
    stream: true,
  });

  // Track usage
  await logUsage({
    user_id: prompt.user_id,
    model: model.name,
    tokens: response.usage,
    cost: calculateCost(model, response.usage),
  });

  return response;
}
```

**Response Parsing**:
```typescript
function parseResponse(response: LLMResponse, template: Template): ParsedResult {
  // Extract JSON from response
  const jsonMatch = response.content.match(/```json\n(.*?)\n```/s);

  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (e) {
      // Fall back to extracting plain text
      return { text: response.content };
    }
  }

  // If no JSON, return as plain text
  return { text: response.content };
}
```

---

### Data Fetching

**Fetch Audio Chunks**:
```typescript
async function fetchAudioChunks(start: Date, end: Date): Promise<AudioChunk[]> {
  return await db.audio_chunks.find({
    start: { $gte: start, $lte: end },
    "vad.has_speech": true,
    transcribed_at: { $ne: null },
  }).toArray();
}
```

**Combine Transcripts**:
```typescript
function combineTranscripts(chunks: AudioChunk[]): string {
  return chunks
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(chunk => {
      const timestamp = formatTime(chunk.start);
      return `[${timestamp}] ${chunk.transcript}`;
    })
    .join("\n\n");
}
```

**Example Combined Transcript**:
```
[2025-11-25 10:00] Good morning everyone, let's start the Q4 planning meeting.

[2025-11-25 10:02] First item on the agenda is reviewing our Q3 results...

[2025-11-25 10:15] I think we should prioritize the mobile app redesign...

[2025-11-25 10:30] Agreed. Let's allocate 40% of engineering time to that...
```

---

### Artifact Storage & Retrieval

**Create Artifact**:
```typescript
async function createArtifact(
  job: ProcessingJob,
  result: ParsedResult,
  metadata: Metadata
): Promise<Artifact> {
  const artifact: Artifact = {
    _id: new ObjectId(),
    user_id: job.user_id,
    type: job.type,
    created_at: new Date(),
    updated_at: new Date(),
    source_period: job.source_period,
    source_chunks: metadata.source_chunks,
    processing_request: {
      type: job.type,
      template: job.template,
      model: job.model,
      instructions: job.instructions,
      context: job.context,
    },
    result: {
      text: formatResult(result, job.template),
      structured_data: result,
    },
    metadata: {
      token_count: metadata.token_count,
      processing_time_ms: metadata.processing_time_ms,
      model_used: metadata.model_used,
      cost_usd: metadata.cost_usd,
    },
    tags: [],
    visibility: "visible",
    version: 1,
    parent_artifact_id: null,
    shared: false,
    shared_links: [],
  };

  await db.artifacts.insertOne(artifact);
  return artifact;
}
```

**List Artifacts**:
```typescript
async function listArtifacts(
  user_id: ObjectId,
  filters: ArtifactFilters,
  pagination: Pagination
): Promise<Artifact[]> {
  const query: any = { user_id };

  // Apply filters
  if (filters.type) query.type = filters.type;
  if (filters.visibility) query.visibility = filters.visibility;
  if (filters.tags) query.tags = { $in: filters.tags };
  if (filters.date_range) {
    query["source_period.start"] = { $gte: filters.date_range.start };
    query["source_period.end"] = { $lte: filters.date_range.end };
  }

  return await db.artifacts
    .find(query)
    .sort({ created_at: -1 })
    .skip(pagination.offset)
    .limit(pagination.limit)
    .toArray();
}
```

---

## Privacy & Transparency

### What is Tracked

**Usage Logs** (stored in `usage_logs` collection):
- Timestamp
- User ID
- Model used
- Token count (input, output, total)
- Request type (summary, tasks, etc.)
- Cost estimate
- Processing duration

**Purpose**: Usage analytics, quota enforcement, cost tracking

---

### What is NOT Tracked

**Never Logged**:
- Audio content
- Transcripts
- LLM prompts
- LLM responses
- Artifact content
- User queries or instructions

**Why**: Privacy commitment. Content is personal and sensitive.

---

### Data Flow Transparency

**Managed Inference Mode**:
```
Audio (local) → Mycelia STT Server → Transcript (local database)
Transcript (local) → Mycelia LLM (OpenRouter) → Artifact (local database)
```
- Audio sent to Mycelia servers for STT
- Transcripts sent to OpenRouter via Mycelia's API key
- Results stored locally

**Self-Hosted Mode**:
```
Audio (local) → User's STT Server → Transcript (local database)
Transcript (local) → User's LLM (local/API) → Artifact (local database)
```
- Everything stays local or under user's control
- Zero data sent to Mycelia

**User Communication**:
- Display data flow diagram in UI
- Link to privacy policy
- Clear badges: "Using Mycelia servers" or "Self-hosted (private)"

---

### Usage Dashboard

**What Users See**:
- Total tokens used this month
- Breakdown by model (Small, Medium, Large)
- Breakdown by processing type (Summary, Tasks, etc.)
- Cost estimate (if using own API keys)
- Quota remaining (if using Mycelia's quota)

**Example UI**:
```
┌────────────────────────────────────────────────┐
│  Usage This Month (November 2025)             │
├────────────────────────────────────────────────┤
│  Total Tokens: 245,832 / 1,000,000 (24.6%)    │
│  Estimated Cost: $0.12 (using Mycelia quota)  │
├────────────────────────────────────────────────┤
│  By Model:                                     │
│    Small:  ████░░░░░░ 40% (98,000 tokens)     │
│    Medium: ██████░░░░ 55% (135,000 tokens)    │
│    Large:  █░░░░░░░░░  5% (12,832 tokens)     │
├────────────────────────────────────────────────┤
│  By Type:                                      │
│    Summaries: 120,000 tokens (48.8%)          │
│    Tasks:      80,000 tokens (32.5%)          │
│    Meetings:   35,000 tokens (14.2%)          │
│    Custom:     10,832 tokens (4.4%)           │
├────────────────────────────────────────────────┤
│  [Export Usage Data]                           │
└────────────────────────────────────────────────┘
```

---

## Future Enhancements

### 1. Collaborative Artifacts
- Share artifacts with team members
- Real-time collaboration on notes
- Comments and annotations

### 2. Advanced Analytics
- Sentiment analysis over time
- Topic trends (what you talk about most)
- Productivity insights (meetings vs. focus time)
- Health correlations (mood vs. sleep, exercise)

### 3. Multi-Modal Processing
- Include photos, documents, emails
- Cross-reference different data types
- Unified timeline view

### 4. Smart Suggestions
- "You haven't created a summary this week. Create one?"
- "This conversation looks like a meeting. Extract tasks?"
- Auto-tagging based on content

### 5. Export & Integration
- Export to Notion, Obsidian, Roam
- Sync tasks to Todoist, Things, etc.
- Calendar integration
- Zapier/Make.com webhooks

### 6. Version Control
- Track artifact changes over time
- Diff view between versions
- Rollback to previous version

### 7. Template Marketplace
- Community-contributed templates
- Domain-specific templates (legal, medical, academic)
- Import/export templates

---

## Appendix: Example API Endpoints

### Processing Endpoints

```
POST /api/processing/create
  Body: {
    type: "summary",
    source_period: { start: Date, end: Date },
    model: "medium",
    instructions: "Focus on work discussions",
    context: "Q4 planning week"
  }
  Response: { job_id: "..." }

GET /api/processing/job/:id
  Response: {
    id: "...",
    status: "active",
    progress: 75,
    artifact_id: null
  }

POST /api/processing/cancel/:id
  Response: { success: true }

GET /api/processing/templates
  Response: [
    { name: "summary", description: "...", variables: [...] },
    { name: "tasks", description: "...", variables: [...] },
    ...
  ]

POST /api/processing/templates/custom
  Body: { name: "...", yaml: "..." }
  Response: { template_id: "..." }
```

### Artifact Endpoints

```
POST /api/artifacts
  Body: { type: "...", result: {...}, ... }
  Response: { artifact_id: "..." }

GET /api/artifacts
  Query: ?type=summary&visibility=visible&tags=work,weekly&limit=20
  Response: { artifacts: [...], total: 42, page: 1 }

GET /api/artifacts/:id
  Response: { artifact: {...} }

PATCH /api/artifacts/:id
  Body: { tags: ["new-tag"], visibility: "archived" }
  Response: { success: true }

DELETE /api/artifacts/:id
  Response: { success: true }

POST /api/artifacts/:id/re-process
  Body: { model: "large", instructions: "..." }
  Response: { new_artifact_id: "...", job_id: "..." }

GET /api/artifacts/:id/export
  Query: ?format=markdown|json|pdf
  Response: File download
```

---

**Document Owner**: Product & Engineering Team
**Review Cycle**: Bi-weekly during implementation
**Last Updated**: 2025-11-27
