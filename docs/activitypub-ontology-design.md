# ActivityPub Ontology Design for Mycelia with Fedify

## Overview

This document outlines the design for a federated, graph-based ontology system for Mycelia using [Fedify](https://fedify.dev/) - a TypeScript ActivityPub server framework. The goal is to replace rigid, collection-based data models (separate `people`, `conversations`, `events` collections) with a unified, extensible ActivityPub-compliant system where entities can have multiple types and arbitrary properties.

By using Fedify, Mycelia gains:
- **Standards compliance**: Full ActivityPub, ActivityStreams 2.0 implementation
- **Type safety**: Pre-built TypeScript types for Activity Vocabulary
- **Federation ready**: Potential to federate with Mastodon, Pixelfed, etc.
- **Battle-tested**: Used by production fediverse applications

## Core Principles

1. **ActivityPub Native**: Use Fedify's Activity Vocabulary types as the foundation
2. **Flexible Typing**: Objects can have multiple types simultaneously (e.g., both Person and Organization)
3. **Property-based Schema**: Leverage ActivityStreams 2.0, FOAF, Schema.org vocabularies
4. **Explicit Relationships**: First-class relationship objects connecting entities
5. **Derivation Tracking**: Track what created/derived from what (provenance)
6. **MongoDB Storage**: Store ActivityPub objects in MongoDB with efficient indexing
7. **Federation Optional**: Design for federation but keep it optional initially

## Installation

Add Fedify to your Deno project:

```typescript
// backend/deno.json
{
  "imports": {
    "@fedify/fedify": "jsr:@fedify/fedify@^1.8.0"
  }
}
```

## Data Model

### ActivityPub Objects Collection

Store all ActivityPub objects in a unified `objects` collection. These are standard ActivityStreams 2.0 objects with Fedify's type system:

```typescript
import { 
  type Object as APObject,
  type Person,
  type Note,
  type Collection,
  type Activity
} from "@fedify/fedify";

interface StoredObject {
  _id: ObjectId;
  
  // ActivityPub/ActivityStreams properties
  // Using JSON-LD @context
  "@context": string | string[] | Record<string, any>;
  
  // Type(s) from ActivityStreams vocabulary
  // Can be single string or array for multiple types
  type: string | string[];  // e.g., "Person", ["Note", "Article"]
  
  // Unique ActivityPub ID (IRI)
  id: string;  // e.g., "https://mycelia.tech/objects/507f1f77bcf86cd799439011"
  
  // Core ActivityStreams properties
  name?: string | Record<string, string>;  // Can be localized
  summary?: string | Record<string, string>;
  content?: string | Record<string, string>;
  published?: string;  // ISO 8601 datetime
  updated?: string;    // ISO 8601 datetime
  
  // Media attachments
  attachment?: any[];
  icon?: any;
  image?: any;
  
  // Relationships (can be IRIs or embedded objects)
  attributedTo?: string | string[] | APObject | APObject[];
  inReplyTo?: string | string[] | APObject | APObject[];
  replies?: string | Collection;
  
  // Collections
  followers?: string | Collection;
  following?: string | Collection;
  likes?: string | Collection;
  shares?: string | Collection;
  
  // Temporal properties
  startTime?: string;
  endTime?: string;
  
  // Custom Mycelia extensions examples
  "mycelia:icon"?: string;  // Emoji representation
  "mycelia:timeRanges"?: Array<{ start: string; end: string }>;
  "mycelia:derivedFrom"?: string[];  // IRIs of source objects
  "mycelia:derivationMethod"?: string;
  "mycelia:confidence"?: number;
  
  // Access control
  to?: string | string[];      // Public, followers, specific actors
  cc?: string | string[];      // Carbon copy
  bto?: string | string[];     // Blind to
  bcc?: string | string[];     // Blind carbon copy
  audience?: string | string[];
  
  // Internal MongoDB metadata
  _internal: {
    created: Date;
    updated: Date;
    localId: ObjectId;  // Original MongoDB ID
    visibility: "private" | "unlisted" | "public";
    indexed: boolean;
  };
}
```

### Using Fedify's Type System

Fedify provides rich TypeScript types for all ActivityPub objects:

```typescript
import {
  Person,
  Note,
  Article,
  Event,
  Place,
  Relationship,
  Collection,
  OrderedCollection,
} from "@fedify/fedify";

// Person (replaces old people collection)
const person = new Person({
  id: new URL("https://mycelia.tech/users/alice"),
  name: "Alice Smith",
  preferredUsername: "alice",
  summary: "Software developer and lifelong learner",
  icon: new Image({
    url: new URL("https://mycelia.tech/avatars/alice.jpg"),
    mediaType: "image/jpeg",
  }),
  // FOAF properties via extension
  "foaf:mbox": "alice@example.com",
});

// Note/Article (replaces conversations/events)
const note = new Note({
  id: new URL("https://mycelia.tech/notes/1234"),
  attributedTo: person.id,
  content: "Just had a great conversation about...",
  published: new Date("2025-10-20T14:00:00Z"),
  // Custom time ranges
  "mycelia:timeRanges": [
    { start: "2025-10-20T14:00:00Z", end: "2025-10-20T15:30:00Z" }
  ],
});
```

### Relationships in ActivityPub

ActivityPub handles relationships in two ways:

1. **Direct properties**: Embedded in objects (e.g., `attributedTo`, `inReplyTo`)
2. **Relationship objects**: Explicit `Relationship` type objects

```typescript
import { Relationship } from "@fedify/fedify";

// ActivityStreams Relationship object
const relationship = new Relationship({
  id: new URL("https://mycelia.tech/relationships/123"),
  subject: person1.id,      // The person/thing in the relationship
  object: person2.id,       // The other party
  relationship: "knows",    // Predicate (FOAF vocabulary)
  
  // Optional temporal bounds
  startTime: new Date("2020-01-01"),
  
  // Custom properties
  "mycelia:confidence": 0.85,
  "mycelia:derivedFrom": ["https://mycelia.tech/conversations/456"],
});
```

For Mycelia-specific needs, we can also store simplified relationships:

```typescript
interface MyceliaRelationship {
  _id: ObjectId;
  type: "Relationship";
  
  // ActivityPub IRI
  id: string;
  
  subject: string;     // IRI of source object
  object: string;      // IRI of target object  
  relationship: string;  // Relationship type/predicate
  
  // Temporal
  startTime?: string;
  endTime?: string;
  
  // Mycelia extensions
  "mycelia:confidence"?: number;
  "mycelia:strength"?: number;
  "mycelia:derivedFrom"?: string[];
  "mycelia:derivationMethod"?: string;
  
  // Internal
  _internal: {
    created: Date;
    updated: Date;
    symmetric?: boolean;
  };
}
```

### Common Relationship Predicates

Standard predicates to use consistently:

```typescript
const PREDICATES = {
  // FOAF relationships
  KNOWS: "foaf:knows",
  MEMBER_OF: "foaf:member",
  
  // Schema.org relationships  
  PARTICIPANT: "schema:participant",
  AUTHOR: "schema:author",
  ABOUT: "schema:about",
  MENTIONS: "schema:mentions",
  
  // Temporal relationships
  DURING: "temporal:during",
  BEFORE: "temporal:before",
  AFTER: "temporal:after",
  
  // Custom Mycelia relationships
  PARTICIPATED_IN: "mycelia:participatedIn",
  OCCURRED_DURING: "mycelia:occurredDuring",
  DERIVED_FROM: "mycelia:derivedFrom",
  RELATED_TO: "mycelia:relatedTo",
  HAS_TOPIC: "mycelia:hasTopic",
};
```

### Common Object Types with Fedify

Examples of how to create different types of objects:

```typescript
import {
  Person,
  Note,
  Article,
  Event,
  Place,
  Document,
  Audio,
  Image,
} from "@fedify/fedify";

// Person (replaces people collection)
const person = new Person({
  id: new URL("https://mycelia.tech/actors/alice"),
  name: "Alice Smith",
  preferredUsername: "alice",
  summary: "Software developer",
  inbox: new URL("https://mycelia.tech/actors/alice/inbox"),
  outbox: new URL("https://mycelia.tech/actors/alice/outbox"),
  followers: new URL("https://mycelia.tech/actors/alice/followers"),
  following: new URL("https://mycelia.tech/actors/alice/following"),
  
  // Extensions
  "foaf:mbox": "alice@example.com",
  "mycelia:icon": "👤",
});

// Conversation as Note with custom time ranges
const conversation = new Note({
  id: new URL("https://mycelia.tech/notes/conv123"),
  name: "Project planning discussion",
  content: "We discussed Q4 roadmap and priorities...",
  published: new Date("2025-10-20T14:00:00Z"),
  
  // Participants as tags/mentions
  tag: [
    { type: "Mention", href: "https://mycelia.tech/actors/alice" },
    { type: "Mention", href: "https://mycelia.tech/actors/bob" },
  ],
  
  // Mycelia extensions
  "mycelia:icon": "💬",
  "mycelia:type": "Conversation",
  "mycelia:timeRanges": [
    { start: "2025-10-20T14:00:00Z", end: "2025-10-20T15:30:00Z" }
  ],
});

// Event type (ActivityStreams has Event built-in)
const event = new Event({
  id: new URL("https://mycelia.tech/events/appt456"),
  name: "Doctor appointment",
  startTime: new Date("2025-10-21T09:00:00Z"),
  endTime: new Date("2025-10-21T09:30:00Z"),
  location: new Place({
    name: "Medical Center",
    address: "123 Medical Center Dr",
  }),
  "mycelia:icon": "🏥",
});

// Transcript segment (derived from audio)
const transcript = new Document({
  id: new URL("https://mycelia.tech/transcripts/seg789"),
  mediaType: "text/plain",
  content: "This is what was said...",
  
  // Temporal properties
  startTime: new Date("2025-10-20T14:05:30Z"),
  endTime: new Date("2025-10-20T14:05:45Z"),
  
  // Provenance
  "mycelia:derivedFrom": ["https://mycelia.tech/audio/chunk123"],
  "mycelia:derivationMethod": "whisper-transcription",
  "mycelia:speaker": "https://mycelia.tech/actors/alice",
  "mycelia:confidence": 0.95,
});

// Audio recording
const audioChunk = new Audio({
  id: new URL("https://mycelia.tech/audio/chunk123"),
  url: new URL("https://mycelia.tech/files/audio123.wav"),
  mediaType: "audio/wav",
  duration: "PT1H30M",  // ISO 8601 duration
  published: new Date("2025-10-20T14:00:00Z"),
});
```

## Migration Strategy

### Phase 1: Parallel System (Recommended Start)

Run both old and new systems in parallel:

1. Create `things` and `relationships` collections
2. Keep existing collections (`people`, `conversations`, `events`) 
3. Add write-through: writes go to both old and new collections
4. Reads come from old collections initially
5. Gradually switch reads to new collections once validated
6. Remove old collections after full validation

### Phase 2: Gradual Feature Migration

Migrate features one at a time:

1. **People**: Migrate first (simplest)
   - Convert `people` → `things` with `types: ["Person"]`
   - Map `name` → `foaf:name`, `icon` → `mycelia:icon`

2. **Conversations**: Migrate second
   - Convert to `things` with `types: ["Conversation"]`
   - Convert `participants` array → `Relationship` objects
   - Map `title` → `dc:title`, `summary` → `mycelia:summary`

3. **Events**: Migrate third
   - Similar to conversations
   - Map temporal properties to Schema.org vocabulary

4. **Transcriptions**: Keep or migrate
   - Could stay as separate collection for performance
   - Or become `things` with type `["TranscriptSegment"]`

### Phase 3: New Features

Build new features exclusively on the ontology:

- Named entity extraction → creates `things` with appropriate types
- Topic modeling → creates topic `things` with `mycelia:hasTopic` relationships
- Automatic relationship discovery
- Rich querying across entity types

## Database Indexes

Essential indexes for performance:

```typescript
// Things collection
db.things.createIndex({ types: 1 });
db.things.createIndex({ created: -1 });
db.things.createIndex({ updated: -1 });
db.things.createIndex({ "properties.foaf:name": 1 }, { sparse: true });
db.things.createIndex({ "properties.schema:startDate": 1 }, { sparse: true });
db.things.createIndex({ "properties.mycelia:timeRanges.start": 1 }, { sparse: true });

// Compound indexes for common queries
db.things.createIndex({ types: 1, created: -1 });
db.things.createIndex({ types: 1, "properties.foaf:name": 1 });

// Relationships collection
db.relationships.createIndex({ from: 1, predicate: 1 });
db.relationships.createIndex({ to: 1, predicate: 1 });
db.relationships.createIndex({ predicate: 1 });
db.relationships.createIndex({ from: 1, to: 1, predicate: 1 }, { unique: true });

// For bidirectional queries
db.relationships.createIndex({ from: 1 });
db.relationships.createIndex({ to: 1 });
```

## Query Patterns

### Finding Things by Type

```typescript
// Find all people
const people = await db.collection("things").find({
  types: "Person"
}).toArray();

// Find all conversations
const conversations = await db.collection("things").find({
  types: "Conversation"
}).toArray();

// Find things that are both Person and Organization
const hybrid = await db.collection("things").find({
  types: { $all: ["Person", "Organization"] }
}).toArray();
```

### Finding Related Things

```typescript
// Find all participants in a conversation
const participants = await db.collection("relationships").aggregate([
  { $match: { from: conversationId, predicate: "schema:participant" } },
  { $lookup: {
      from: "things",
      localField: "to",
      foreignField: "_id",
      as: "person"
  }},
  { $unwind: "$person" }
]).toArray();

// Find all conversations a person participated in
const conversations = await db.collection("relationships").aggregate([
  { $match: { to: personId, predicate: "schema:participant" } },
  { $lookup: {
      from: "things",
      localField: "from",
      foreignField: "_id",
      as: "conversation"
  }},
  { $unwind: "$conversation" },
  { $match: { "conversation.types": "Conversation" } }
]).toArray();
```

### Time-based Queries

```typescript
// Find things active during a time range
const activeThings = await db.collection("things").find({
  $or: [
    {
      "properties.schema:startDate": { $lte: endDate },
      "properties.schema:endDate": { $gte: startDate }
    },
    {
      "properties.mycelia:timeRanges": {
        $elemMatch: {
          start: { $lte: endDate },
          end: { $gte: startDate }
        }
      }
    }
  ]
}).toArray();
```

### Graph Traversal

```typescript
// Find all things connected to a person (2 levels deep)
const connectedThings = await db.collection("relationships").aggregate([
  { $match: { $or: [{ from: personId }, { to: personId }] } },
  { $graphLookup: {
      from: "relationships",
      startWith: { $cond: [
        { $eq: ["$from", personId] },
        "$to",
        "$from"
      ]},
      connectFromField: "to",
      connectToField: "from",
      as: "connections",
      maxDepth: 1
  }},
  { $lookup: {
      from: "things",
      localField: "to",
      foreignField: "_id",
      as: "thing"
  }}
]).toArray();
```

## TypeScript Types

### Core Types

```typescript
// frontend/src/types/ontology.ts
import { ObjectId } from "bson";
import { z } from "zod";

export const zThing = z.object({
  _id: z.instanceof(ObjectId),
  types: z.array(z.string()),
  created: z.date(),
  updated: z.date(),
  properties: z.record(z.any()),
  visibility: z.enum(["private", "shared", "public"]).optional(),
  shareToken: z.string().optional(),
  derivedFrom: z.array(z.instanceof(ObjectId)).optional(),
  derivationMethod: z.string().optional(),
});

export type Thing = z.infer<typeof zThing>;

export const zRelationship = z.object({
  _id: z.instanceof(ObjectId),
  from: z.instanceof(ObjectId),
  to: z.instanceof(ObjectId),
  predicate: z.string(),
  created: z.date(),
  updated: z.date(),
  properties: z.record(z.any()).optional(),
  symmetric: z.boolean().optional(),
  derivedFrom: z.array(z.instanceof(ObjectId)).optional(),
  derivationMethod: z.string().optional(),
});

export type Relationship = z.infer<typeof zRelationship>;
```

### Type Guards and Helpers

```typescript
// frontend/src/lib/ontology.ts

export function hasType(thing: Thing, type: string): boolean {
  return thing.types.includes(type);
}

export function hasTypes(thing: Thing, types: string[]): boolean {
  return types.every(type => thing.types.includes(type));
}

export function getProperty<T = any>(
  thing: Thing,
  key: string,
  defaultValue?: T
): T | undefined {
  return thing.properties[key] ?? defaultValue;
}

export function setProperty(
  thing: Thing,
  key: string,
  value: any
): Thing {
  return {
    ...thing,
    properties: {
      ...thing.properties,
      [key]: value,
    },
    updated: new Date(),
  };
}

// Type-specific helpers
export function isPersonThing(thing: Thing): boolean {
  return hasType(thing, "Person");
}

export function isConversationThing(thing: Thing): boolean {
  return hasType(thing, "Conversation");
}

export function getPersonName(thing: Thing): string | undefined {
  if (!isPersonThing(thing)) return undefined;
  return getProperty(thing, "foaf:name");
}

export function getTitle(thing: Thing): string | undefined {
  return getProperty(thing, "dc:title") ?? getProperty(thing, "schema:name");
}

export function getIcon(thing: Thing): string | undefined {
  return getProperty(thing, "mycelia:icon");
}
```

## Access Control and Privacy in ActivityPub

### Understanding ActivityPub Audience Targeting

ActivityPub uses specific properties to control who can see an object. Based on the [ActivityStreams 2.0 Vocabulary](https://www.w3.org/TR/activitystreams-vocabulary/), these properties define the audience:

| Property | Visibility | Description |
|----------|-----------|-------------|
| `to` | Public in response | Primary recipients - visible in object JSON |
| `cc` | Public in response | Secondary recipients (carbon copy) - visible in object JSON |
| `bto` | Private | "Blind to" - recipients not shown in object JSON |
| `bcc` | Private | "Blind carbon copy" - recipients not shown in object JSON |
| `audience` | Public in response | Indirect audience - visible in object JSON |

**Special ActivityPub IRIs:**

- `https://www.w3.org/ns/activitystreams#Public` - Public to everyone
- Actor's followers collection URL - Visible to all followers

### Access Control Patterns

#### 1. Public Object

Visible to everyone on the internet:

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Note",
  "id": "https://mycelia.tech/notes/123",
  "content": "Hello world!",
  "published": "2025-10-20T14:00:00Z",
  "attributedTo": "https://mycelia.tech/actors/alice",
  
  "to": ["https://www.w3.org/ns/activitystreams#Public"]
}
```

#### 2. Unlisted Object

Not shown in public timelines but accessible via direct link:

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Note",
  "id": "https://mycelia.tech/notes/124",
  "content": "Semi-private thought",
  "published": "2025-10-20T14:00:00Z",
  "attributedTo": "https://mycelia.tech/actors/alice",
  
  "to": ["https://mycelia.tech/actors/alice/followers"],
  "cc": ["https://www.w3.org/ns/activitystreams#Public"]
}
```

#### 3. Followers-Only Object

Only visible to followers:

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Note",
  "id": "https://mycelia.tech/notes/125",
  "content": "Private note for my followers",
  "published": "2025-10-20T14:00:00Z",
  "attributedTo": "https://mycelia.tech/actors/alice",
  
  "to": ["https://mycelia.tech/actors/alice/followers"]
}
```

#### 4. Direct Message (Private)

Only visible to specific recipients:

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Note",
  "id": "https://mycelia.tech/notes/126",
  "content": "Hey Bob, private message here",
  "published": "2025-10-20T14:00:00Z",
  "attributedTo": "https://mycelia.tech/actors/alice",
  
  "to": ["https://mycelia.tech/actors/bob"]
}
```

#### 5. Private with Hidden Recipients

Recipients are private (using `bto`/`bcc`):

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Note",
  "id": "https://mycelia.tech/notes/127",
  "content": "Announcement with hidden recipient list",
  "published": "2025-10-20T14:00:00Z",
  "attributedTo": "https://mycelia.tech/actors/alice",
  
  "bto": [
    "https://mycelia.tech/actors/bob",
    "https://mycelia.tech/actors/charlie"
  ]
}
```

### Implementing Access Control with Fedify

#### 1. Authorization Middleware

Check access before serving objects:

```typescript
// backend/app/lib/fedify/authorization.ts

import type { Context } from "@fedify/fedify";
import { getRootDB } from "@/lib/mongo/core.server.ts";

export async function checkObjectAccess(
  objectId: string,
  requesterId: string | null
): Promise<boolean> {
  const db = await getRootDB();
  const object = await db.collection("objects").findOne({ id: objectId });
  
  if (!object) return false;
  
  // Public objects are always accessible
  if (object.to?.includes("https://www.w3.org/ns/activitystreams#Public") ||
      object.cc?.includes("https://www.w3.org/ns/activitystreams#Public")) {
    return true;
  }
  
  // If no requester (not authenticated), deny private objects
  if (!requesterId) return false;
  
  // Owner can always access their own objects
  if (object.attributedTo === requesterId) {
    return true;
  }
  
  // Check if requester is in to, cc, bto, or bcc
  const allRecipients = [
    ...(object.to || []),
    ...(object.cc || []),
    ...(object.bto || []),
    ...(object.bcc || []),
  ];
  
  if (allRecipients.includes(requesterId)) {
    return true;
  }
  
  // Check if requester is in a collection (e.g., followers)
  for (const recipient of allRecipients) {
    if (recipient.includes("/followers")) {
      // Extract actor from followers URL
      const actorId = recipient.replace("/followers", "");
      const isFollower = await checkIsFollower(actorId, requesterId);
      if (isFollower) return true;
    }
  }
  
  return false;
}

async function checkIsFollower(
  actorId: string,
  followerId: string
): Promise<boolean> {
  const db = await getRootDB();
  
  // Check if there's a Follow relationship
  const follow = await db.collection("objects").findOne({
    type: "Follow",
    actor: followerId,
    object: actorId,
    // Optionally check if accepted
  });
  
  return !!follow;
}

// Sanitize object for requester (remove bto/bcc if not owner)
export function sanitizeObject(
  object: any,
  requesterId: string | null
): any {
  const isOwner = object.attributedTo === requesterId;
  
  if (!isOwner) {
    // Remove blind recipients from response
    const { bto, bcc, ...sanitized } = object;
    return sanitized;
  }
  
  return object;
}
```

#### 2. Protected Object Dispatcher

Integrate authorization into Fedify dispatchers:

```typescript
// backend/app/lib/fedify/federation.server.ts

import { createFederation, Person, Note } from "@fedify/fedify";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { checkObjectAccess, sanitizeObject } from "./authorization.ts";

export const federation = createFederation<void>({
  baseUrl: new URL(Deno.env.get("BASE_URL") || "https://mycelia.tech"),
  
  // Authentication: verify HTTP Signatures
  authenticator: async (ctx, identifier) => {
    // Fedify will verify HTTP Signatures automatically
    // This returns the authenticated actor ID
    return identifier;
  },
});

// Protected object dispatcher
federation.setObjectDispatcher(
  [Note, "/@{identifier}/notes/{id}"],
  async (ctx, values) => {
    const db = await getRootDB();
    const objectId = `https://mycelia.tech/@${values.identifier}/notes/${values.id}`;
    const doc = await db.collection("objects").findOne({ id: objectId });
    
    if (!doc) return null;
    
    // Get authenticated actor from context (via HTTP Signature)
    const requesterId = ctx.getActor()?.id?.href || null;
    
    // Check if requester has access
    const hasAccess = await checkObjectAccess(objectId, requesterId);
    
    if (!hasAccess) {
      // Return 403 Forbidden or 404 Not Found
      return null;  // Fedify will return 404
    }
    
    // Sanitize object (remove bto/bcc if not owner)
    const sanitized = sanitizeObject(doc, requesterId);
    
    // Create Note object
    const note = new Note({
      id: new URL(sanitized.id),
      name: sanitized.name,
      content: sanitized.content,
      published: sanitized.published ? new Date(sanitized.published) : undefined,
      attributedTo: new URL(sanitized.attributedTo),
      to: sanitized.to,
      cc: sanitized.cc,
      // Don't include bto/bcc (already removed by sanitizeObject)
    });
    
    return note;
  }
);
```

#### 3. Creating Objects with Access Control

Helper functions for creating objects with proper audience targeting:

```typescript
// backend/app/lib/objects/create.ts

import { getRootDB } from "@/lib/mongo/core.server.ts";
import { ObjectId } from "mongodb";

export type Visibility = "public" | "unlisted" | "followers" | "private" | "direct";

export async function createNote(params: {
  actorId: string;
  content: string;
  name?: string;
  visibility: Visibility;
  recipients?: string[];  // For direct messages
}) {
  const db = await getRootDB();
  const noteId = new ObjectId();
  const iri = `https://mycelia.tech/notes/${noteId.toString()}`;
  
  // Determine audience based on visibility
  let to: string[] = [];
  let cc: string[] = [];
  
  switch (params.visibility) {
    case "public":
      to = ["https://www.w3.org/ns/activitystreams#Public"];
      cc = [`${params.actorId}/followers`];
      break;
      
    case "unlisted":
      to = [`${params.actorId}/followers`];
      cc = ["https://www.w3.org/ns/activitystreams#Public"];
      break;
      
    case "followers":
      to = [`${params.actorId}/followers`];
      break;
      
    case "private":
      to = [params.actorId];  // Only self
      break;
      
    case "direct":
      to = params.recipients || [];
      break;
  }
  
  const note = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    id: iri,
    name: params.name,
    content: params.content,
    published: new Date().toISOString(),
    attributedTo: params.actorId,
    to,
    cc,
    
    _internal: {
      created: new Date(),
      updated: new Date(),
      localId: noteId,
      visibility: params.visibility,
      indexed: false,
    },
  };
  
  await db.collection("objects").insertOne(note);
  
  return note;
}
```

#### 4. Relationship Access Control

Protect relationship queries:

```typescript
// backend/app/lib/objects/relationships.ts

export async function getRelationships(params: {
  subjectId?: string;
  objectId?: string;
  predicate?: string;
  requesterId: string | null;
}) {
  const db = await getRootDB();
  
  const query: any = { type: "Relationship" };
  if (params.subjectId) query.subject = params.subjectId;
  if (params.objectId) query.object = params.objectId;
  if (params.predicate) query.relationship = params.predicate;
  
  const relationships = await db.collection("objects").find(query).toArray();
  
  // Filter based on access control
  const accessible = [];
  for (const rel of relationships) {
    const hasAccess = await checkObjectAccess(rel.id, params.requesterId);
    if (hasAccess) {
      accessible.push(sanitizeObject(rel, params.requesterId));
    }
  }
  
  return accessible;
}
```

### HTTP Signatures for Authentication

Fedify automatically verifies HTTP Signatures on incoming requests:

```typescript
// When a remote server fetches an object, they sign the request
// Fedify verifies the signature and provides the authenticated actor

federation.setObjectDispatcher(
  [Note, "/@{identifier}/notes/{id}"],
  async (ctx, values) => {
    // Get the authenticated actor (verified via HTTP Signature)
    const actor = ctx.getActor();
    
    if (actor) {
      console.log("Request from authenticated actor:", actor.id);
      // Use actor.id for access control
    } else {
      console.log("Unauthenticated request");
      // Only allow access to public objects
    }
    
    // ... rest of dispatcher logic
  }
);
```

### MongoDB Access Control Indexes

Optimize access control queries with proper indexes:

```typescript
// Create indexes for efficient access checks
db.objects.createIndex({ to: 1 });
db.objects.createIndex({ cc: 1 });
db.objects.createIndex({ bto: 1 });
db.objects.createIndex({ bcc: 1 });
db.objects.createIndex({ attributedTo: 1 });
db.objects.createIndex({ type: 1, actor: 1, object: 1 });  // For Follow relationships

// Compound index for common queries
db.objects.createIndex({ type: 1, to: 1 });
db.objects.createIndex({ attributedTo: 1, "_internal.visibility": 1 });
```

### Access Control Best Practices

1. **Default to Private**: When in doubt, restrict access
2. **Verify Signatures**: Always verify HTTP Signatures for remote requests
3. **Sanitize Responses**: Remove `bto`/`bcc` from responses to non-owners
4. **Check Collection Membership**: Properly verify followers, group members, etc.
5. **Cache Access Checks**: Cache follower relationships for performance
6. **Audit Logging**: Log access attempts for security monitoring
7. **Rate Limiting**: Protect against brute-force access attempts

### Example: Complete Protected Conversation

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "mycelia": "https://mycelia.tech/ns/",
      "icon": "mycelia:icon",
      "timeRanges": {
        "@id": "mycelia:timeRanges",
        "@type": "@json"
      }
    }
  ],
  "type": ["Note", "mycelia:Conversation"],
  "id": "https://mycelia.tech/notes/conv-123",
  "name": "Private Team Discussion",
  "content": "Confidential discussion about project...",
  "published": "2025-10-20T14:00:00Z",
  "attributedTo": "https://mycelia.tech/actors/alice",
  
  "icon": "🔒",
  "timeRanges": [
    {
      "start": "2025-10-20T14:00:00Z",
      "end": "2025-10-20T15:30:00Z"
    }
  ],
  
  "to": [
    "https://mycelia.tech/actors/bob",
    "https://mycelia.tech/actors/charlie"
  ],
  
  "_internal": {
    "created": "2025-10-20T14:00:00.000Z",
    "updated": "2025-10-20T14:00:00.000Z",
    "localId": "507f1f77bcf86cd799439011",
    "visibility": "direct",
    "indexed": false
  }
}
```

Only Alice (creator), Bob, and Charlie can access this conversation.

## Fedify Integration with Custom Vocabulary

### Setting Up Federation with Extended Context

Create a Fedify `Federation` instance that uses the Mycelia extended context:

```typescript
// backend/app/lib/fedify/federation.server.ts
import { createFederation, Person, Note } from "@fedify/fedify";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { MYCELIA_CONTEXT } from "./context.ts";

export const federation = createFederation<void>({
  // Domain for your Mycelia instance
  baseUrl: new URL(Deno.env.get("BASE_URL") || "https://mycelia.tech"),
  
  // Add custom context expansion
  contextLoader: async (url: string) => {
    if (url === "https://mycelia.tech/ns/context") {
      return MYCELIA_CONTEXT;
    }
    // Fall back to default context loading
    return null;
  },
});

// Actor (Person) dispatcher - how to fetch a person with FOAF properties
federation.setActorDispatcher("/actors/{identifier}", async (ctx, identifier) => {
  const db = await getRootDB();
  const doc = await db.collection("objects").findOne({
    type: "Person",
    preferredUsername: identifier,
  });
  
  if (!doc) return null;
  
  // Create Person with standard and custom properties
  const person = new Person({
    id: new URL(doc.id),
    name: doc.name,
    preferredUsername: doc.preferredUsername,
    summary: doc.summary,
    inbox: new URL(`${doc.id}/inbox`),
    outbox: new URL(`${doc.id}/outbox`),
    followers: new URL(`${doc.id}/followers`),
    following: new URL(`${doc.id}/following`),
  });
  
  // Add custom Mycelia properties
  if (doc["mycelia:icon"]) {
    person["mycelia:icon"] = doc["mycelia:icon"];
  }
  
  // Add FOAF properties
  if (doc["foaf:mbox"]) {
    person["foaf:mbox"] = doc["foaf:mbox"];
  }
  
  return person;
});

// Object dispatcher - how to fetch notes with custom properties
federation.setObjectDispatcher(
  [Note, "/@{identifier}/notes/{id}"],
  async (ctx, values) => {
    const db = await getRootDB();
    const doc = await db.collection("objects").findOne({
      id: `https://mycelia.tech/@${values.identifier}/notes/${values.id}`,
    });
    
    if (!doc) return null;
    
    const note = new Note({
      id: new URL(doc.id),
      name: doc.name,
      content: doc.content,
      published: doc.published ? new Date(doc.published) : undefined,
      attributedTo: new URL(doc.attributedTo),
    });
    
    // Add Mycelia custom properties
    if (doc["mycelia:icon"]) {
      note["mycelia:icon"] = doc["mycelia:icon"];
    }
    
    if (doc["mycelia:timeRanges"]) {
      note["mycelia:timeRanges"] = doc["mycelia:timeRanges"];
    }
    
    // Add tags/mentions
    if (doc.tag) {
      note.tag = doc.tag;
    }
    
    return note;
  }
);

// Inbox listener - handle incoming activities
federation.setInboxListeners("/actors/{identifier}/inbox", "/inbox")
  .on(Note, async (ctx, note) => {
    // Handle incoming Note
    const db = await getRootDB();
    await db.collection("objects").insertOne({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Note",
      id: note.id?.href,
      content: note.content,
      published: note.published?.toISOString(),
      attributedTo: note.attributedToId?.href,
      _internal: {
        created: new Date(),
        updated: new Date(),
        visibility: "public",
        indexed: false,
      },
    });
  });
```

### MCP Resource for Objects

Extend the MCP resource pattern to work with ActivityPub objects:

```typescript
// backend/app/lib/fedify/objects.server.ts

import { z } from "zod";
import type { Resource } from "@/lib/auth/resources.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { ObjectId } from "mongodb";

export interface ObjectsRequest {
  action: 
    | "get"
    | "find"
    | "create"
    | "update"
    | "delete"
    | "findRelated";
  
  // For get
  id?: string;      // ActivityPub IRI
  localId?: string; // MongoDB ObjectId
  
  // For find
  type?: string | string[];
  filters?: Record<string, any>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  offset?: number;
  
  // For create/update
  object?: any;  // ActivityPub object
  
  // For findRelated
  predicate?: string;
  direction?: "incoming" | "outgoing" | "both";
}

export class ObjectsResource implements Resource<ObjectsRequest, any> {
  code = "tech.mycelia.objects";
  description = "ActivityPub objects management for Mycelia ontology";
  
  async use(input: ObjectsRequest): Promise<any> {
    const db = await getRootDB();
    
    switch (input.action) {
      case "get":
        if (input.id) {
          return db.collection("objects").findOne({ id: input.id });
        }
        if (input.localId) {
          return db.collection("objects").findOne({ 
            "_internal.localId": new ObjectId(input.localId) 
          });
        }
        throw new Error("Must provide either id or localId");
      
      case "find":
        const query: any = {};
        if (input.type) {
          query.type = Array.isArray(input.type)
            ? { $in: input.type }
            : input.type;
        }
        if (input.filters) {
          Object.assign(query, input.filters);
        }
        return db.collection("objects")
          .find(query)
          .sort(input.sort || { "_internal.created": -1 })
          .limit(input.limit || 100)
          .skip(input.offset || 0)
          .toArray();
      
      case "create":
        const newObject = {
          ...input.object,
          _internal: {
            created: new Date(),
            updated: new Date(),
            localId: new ObjectId(),
            visibility: input.object._internal?.visibility || "private",
            indexed: false,
          },
        };
        await db.collection("objects").insertOne(newObject);
        return newObject;
      
      case "update":
        return db.collection("objects").findOneAndUpdate(
          { id: input.id },
          { 
            $set: { 
              ...input.object,
              "_internal.updated": new Date(),
            } 
          },
          { returnDocument: "after" }
        );
      
      case "delete":
        return db.collection("objects").deleteOne({ id: input.id });
      
      case "findRelated":
        // Find objects related via embedded properties or Relationship objects
        const baseObject = await db.collection("objects").findOne({ id: input.id });
        if (!baseObject) return [];
        
        // Check embedded relationships (attributedTo, inReplyTo, etc.)
        const relatedIds: string[] = [];
        if (baseObject.attributedTo) {
          relatedIds.push(...(Array.isArray(baseObject.attributedTo) 
            ? baseObject.attributedTo 
            : [baseObject.attributedTo]));
        }
        if (baseObject.inReplyTo) {
          relatedIds.push(...(Array.isArray(baseObject.inReplyTo) 
            ? baseObject.inReplyTo 
            : [baseObject.inReplyTo]));
        }
        
        // Also check Relationship objects
        const relQuery: any = input.direction === "incoming" 
          ? { object: input.id }
          : input.direction === "outgoing"
          ? { subject: input.id }
          : { $or: [{ subject: input.id }, { object: input.id }] };
        
        if (input.predicate) {
          relQuery.relationship = input.predicate;
        }
        
        const relationships = await db.collection("objects")
          .find({ type: "Relationship", ...relQuery })
          .toArray();
        
        relationships.forEach(rel => {
          if (rel.subject !== input.id) relatedIds.push(rel.subject);
          if (rel.object !== input.id) relatedIds.push(rel.object);
        });
        
        // Fetch all related objects
        return db.collection("objects")
          .find({ id: { $in: relatedIds } })
          .toArray();
      
      default:
        throw new Error(`Unknown action: ${input.action}`);
    }
  }
}
```

## UI Patterns with ActivityPub Objects

### Universal Object Editor

Create a flexible UI component that adapts to object types:

```typescript
// frontend/src/components/ObjectEditor.tsx
import type { APObject } from "@/types/activitypub";

interface ObjectEditorProps {
  object: APObject;
  onChange: (updated: APObject) => void;
}

export function ObjectEditor({ object, onChange }: ObjectEditorProps) {
  const types = Array.isArray(object.type) ? object.type : [object.type];
  const isPerson = types.includes("Person");
  const isNote = types.includes("Note");
  const isEvent = types.includes("Event");
  
  return (
    <div className="space-y-4">
      {/* Type selector */}
      <TypeBadges types={types} />
      
      {/* Icon picker */}
      <IconPicker 
        value={object["mycelia:icon"]} 
        onChange={(icon) => onChange({ ...object, "mycelia:icon": icon })} 
      />
      
      {/* Person-specific fields */}
      {isPerson && (
        <>
          <Input 
            label="Name"
            value={object.name || ""}
            onChange={(e) => onChange({ ...object, name: e.target.value })}
          />
          <Input 
            label="Username"
            value={object.preferredUsername || ""}
            onChange={(e) => onChange({ ...object, preferredUsername: e.target.value })}
          />
          <Textarea
            label="Bio"
            value={object.summary || ""}
            onChange={(e) => onChange({ ...object, summary: e.target.value })}
          />
        </>
      )}
      
      {/* Note/Article fields */}
      {isNote && (
        <>
          <Input 
            label="Title"
            value={object.name || ""}
            onChange={(e) => onChange({ ...object, name: e.target.value })}
          />
          <Textarea
            label="Content"
            value={object.content || ""}
            onChange={(e) => onChange({ ...object, content: e.target.value })}
          />
        </>
      )}
      
      {/* Event fields */}
      {isEvent && (
        <>
          <Input 
            label="Event Name"
            value={object.name || ""}
            onChange={(e) => onChange({ ...object, name: e.target.value })}
          />
          <DateTimeInput
            label="Start Time"
            value={object.startTime ? new Date(object.startTime) : null}
            onChange={(date) => onChange({ 
              ...object, 
              startTime: date?.toISOString() 
            })}
          />
          <DateTimeInput
            label="End Time"
            value={object.endTime ? new Date(object.endTime) : null}
            onChange={(date) => onChange({ 
              ...object, 
              endTime: date?.toISOString() 
            })}
          />
        </>
      )}
      
      {/* Relationships/mentions */}
      <RelationshipsEditor objectId={object.id} />
    </div>
  );
}
```

### Fetching and Displaying Objects

```typescript
// frontend/src/components/ObjectView.tsx
import { useEffect, useState } from "react";
import { callResource } from "@/lib/api";
import type { APObject } from "@/types/activitypub";

export function ObjectView({ objectId }: { objectId: string }) {
  const [object, setObject] = useState<APObject | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    callResource("tech.mycelia.objects", {
      action: "get",
      id: objectId,
    })
      .then(setObject)
      .finally(() => setLoading(false));
  }, [objectId]);
  
  if (loading) return <div>Loading...</div>;
  if (!object) return <div>Object not found</div>;
  
  const types = Array.isArray(object.type) ? object.type : [object.type];
  
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-start gap-3">
        {object["mycelia:icon"] && (
          <span className="text-2xl">{object["mycelia:icon"]}</span>
        )}
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{object.name}</h2>
          <div className="flex gap-2 mt-1">
            {types.map(type => (
              <span key={type} className="text-xs bg-muted px-2 py-1 rounded">
                {type}
              </span>
            ))}
          </div>
          {object.summary && (
            <p className="text-sm text-muted-foreground mt-2">{object.summary}</p>
          )}
          {object.content && (
            <div className="prose mt-3" dangerouslySetInnerHTML={{ __html: object.content }} />
          )}
        </div>
      </div>
    </div>
  );
}
```

## JSON-LD Context and Vocabulary Extension

### Understanding @context

The `@context` in ActivityPub objects defines the vocabulary being used. As per the [ActivityStreams 2.0 Core](https://www.w3.org/TR/activitystreams-core/) specification, this allows semantic interpretation of properties.

### Standard ActivityStreams Context

The base ActivityStreams context provides common social vocabulary:

```json
{
  "@context": "https://www.w3.org/ns/activitystreams"
}
```

### Mycelia Extended Context

Mycelia extends the ActivityStreams vocabulary with custom properties:

```typescript
// backend/app/lib/fedify/context.ts

export const MYCELIA_CONTEXT = {
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "mycelia": "https://mycelia.tech/ns/",
      "foaf": "http://xmlns.com/foaf/0.1/",
      "schema": "http://schema.org/",
      "dc": "http://purl.org/dc/terms/",
    }
  ]
};
```

### Complete Example with Extended Context

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "mycelia": "https://mycelia.tech/ns/",
      "foaf": "http://xmlns.com/foaf/0.1/",
      "icon": "mycelia:icon",
      "timeRanges": {
        "@id": "mycelia:timeRanges",
        "@type": "@json"
      },
      "mbox": "foaf:mbox"
    }
  ],
  "type": "Note",
  "id": "https://mycelia.tech/notes/123",
  "name": "Project Planning Discussion",
  "content": "We discussed Q4 roadmap...",
  "published": "2025-10-20T14:00:00Z",
  "attributedTo": "https://mycelia.tech/actors/alice",
  
  "icon": "💬",
  "timeRanges": [
    {
      "start": "2025-10-20T14:00:00Z",
      "end": "2025-10-20T15:30:00Z"
    }
  ],
  
  "tag": [
    {
      "type": "Mention",
      "href": "https://mycelia.tech/actors/bob",
      "name": "@bob"
    }
  ]
}
```

### Vocabulary Namespace Definitions

```typescript
// backend/app/lib/fedify/vocabularies.ts

export const VOCAB_NAMESPACES = {
  // Core ActivityStreams
  as: "https://www.w3.org/ns/activitystreams#",
  
  // External vocabularies
  foaf: "http://xmlns.com/foaf/0.1/",
  schema: "http://schema.org/",
  dc: "http://purl.org/dc/terms/",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  
  // Mycelia custom namespace
  mycelia: "https://mycelia.tech/ns/",
} as const;

// ActivityStreams Core Types (from W3C vocabulary)
export const AS_TYPES = {
  // Core types
  Object: "as:Object",
  Link: "as:Link",
  Activity: "as:Activity",
  IntransitiveActivity: "as:IntransitiveActivity",
  Collection: "as:Collection",
  OrderedCollection: "as:OrderedCollection",
  CollectionPage: "as:CollectionPage",
  OrderedCollectionPage: "as:OrderedCollectionPage",
  
  // Actor types
  Application: "as:Application",
  Group: "as:Group",
  Organization: "as:Organization",
  Person: "as:Person",
  Service: "as:Service",
  
  // Object types
  Article: "as:Article",
  Audio: "as:Audio",
  Document: "as:Document",
  Event: "as:Event",
  Image: "as:Image",
  Note: "as:Note",
  Page: "as:Page",
  Place: "as:Place",
  Profile: "as:Profile",
  Relationship: "as:Relationship",
  Tombstone: "as:Tombstone",
  Video: "as:Video",
  
  // Activity types
  Accept: "as:Accept",
  Add: "as:Add",
  Announce: "as:Announce",
  Arrive: "as:Arrive",
  Block: "as:Block",
  Create: "as:Create",
  Delete: "as:Delete",
  Dislike: "as:Dislike",
  Flag: "as:Flag",
  Follow: "as:Follow",
  Ignore: "as:Ignore",
  Invite: "as:Invite",
  Join: "as:Join",
  Leave: "as:Leave",
  Like: "as:Like",
  Listen: "as:Listen",
  Move: "as:Move",
  Offer: "as:Offer",
  Question: "as:Question",
  Reject: "as:Reject",
  Read: "as:Read",
  Remove: "as:Remove",
  TentativeReject: "as:TentativeReject",
  TentativeAccept: "as:TentativeAccept",
  Travel: "as:Travel",
  Undo: "as:Undo",
  Update: "as:Update",
  View: "as:View",
} as const;

// Mycelia-specific types (extending ActivityStreams)
export const MYCELIA_TYPES = {
  TranscriptSegment: "mycelia:TranscriptSegment",
  Conversation: "mycelia:Conversation",
  AudioRecording: "mycelia:AudioRecording",
  TimelineEntry: "mycelia:TimelineEntry",
} as const;

// ActivityStreams Core Properties
export const AS_PROPERTIES = {
  // Core properties
  id: "as:id",
  type: "as:type",
  actor: "as:actor",
  object: "as:object",
  target: "as:target",
  result: "as:result",
  origin: "as:origin",
  instrument: "as:instrument",
  
  // Content properties
  content: "as:content",
  name: "as:name",
  summary: "as:summary",
  
  // Temporal properties
  published: "as:published",
  updated: "as:updated",
  startTime: "as:startTime",
  endTime: "as:endTime",
  duration: "as:duration",
  
  // Relationship properties
  attributedTo: "as:attributedTo",
  inReplyTo: "as:inReplyTo",
  replies: "as:replies",
  tag: "as:tag",
  
  // Media properties
  attachment: "as:attachment",
  icon: "as:icon",
  image: "as:image",
  url: "as:url",
  mediaType: "as:mediaType",
  
  // Collection properties
  items: "as:items",
  orderedItems: "as:orderedItems",
  totalItems: "as:totalItems",
  first: "as:first",
  last: "as:last",
  next: "as:next",
  prev: "as:prev",
  current: "as:current",
  
  // Audience targeting
  to: "as:to",
  cc: "as:cc",
  bcc: "as:bcc",
  bto: "as:bto",
  audience: "as:audience",
  
  // Actor properties
  inbox: "as:inbox",
  outbox: "as:outbox",
  following: "as:following",
  followers: "as:followers",
  liked: "as:liked",
  preferredUsername: "as:preferredUsername",
  
  // Place properties
  location: "as:location",
  latitude: "as:latitude",
  longitude: "as:longitude",
  altitude: "as:altitude",
  radius: "as:radius",
  units: "as:units",
} as const;

// Mycelia custom properties
export const MYCELIA_PROPERTIES = {
  icon: "mycelia:icon",  // Emoji icon (different from as:icon)
  timeRanges: "mycelia:timeRanges",
  derivedFrom: "mycelia:derivedFrom",
  derivationMethod: "mycelia:derivationMethod",
  confidence: "mycelia:confidence",
  speaker: "mycelia:speaker",
  transcriptSegments: "mycelia:transcriptSegments",
  audioSource: "mycelia:audioSource",
} as const;
```

### Property Usage Examples

#### Person with FOAF Properties

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "foaf": "http://xmlns.com/foaf/0.1/",
      "mbox": "foaf:mbox",
      "homepage": "foaf:homepage",
      "mycelia": "https://mycelia.tech/ns/",
      "icon": "mycelia:icon"
    }
  ],
  "type": "Person",
  "id": "https://mycelia.tech/actors/alice",
  "name": "Alice Smith",
  "preferredUsername": "alice",
  "summary": "Software developer and lifelong learner",
  "inbox": "https://mycelia.tech/actors/alice/inbox",
  "outbox": "https://mycelia.tech/actors/alice/outbox",
  
  "mbox": "mailto:alice@example.com",
  "homepage": "https://alice.example.com",
  "icon": "👩‍💻"
}
```

#### Note/Conversation with Custom Time Ranges

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "mycelia": "https://mycelia.tech/ns/",
      "icon": "mycelia:icon",
      "timeRanges": {
        "@id": "mycelia:timeRanges",
        "@type": "@json"
      }
    }
  ],
  "type": ["Note", "mycelia:Conversation"],
  "id": "https://mycelia.tech/notes/conv-123",
  "name": "Project Planning Discussion",
  "content": "<p>We discussed Q4 roadmap and key priorities...</p>",
  "published": "2025-10-20T14:00:00Z",
  "attributedTo": "https://mycelia.tech/actors/alice",
  
  "icon": "💬",
  "timeRanges": [
    {
      "start": "2025-10-20T14:00:00Z",
      "end": "2025-10-20T15:30:00Z"
    }
  ],
  
  "tag": [
    {
      "type": "Mention",
      "href": "https://mycelia.tech/actors/bob",
      "name": "@bob"
    },
    {
      "type": "Mention",
      "href": "https://mycelia.tech/actors/charlie",
      "name": "@charlie"
    }
  ]
}
```

#### Transcript with Derivation Properties

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "mycelia": "https://mycelia.tech/ns/",
      "derivedFrom": {
        "@id": "mycelia:derivedFrom",
        "@type": "@id"
      },
      "derivationMethod": "mycelia:derivationMethod",
      "confidence": {
        "@id": "mycelia:confidence",
        "@type": "http://www.w3.org/2001/XMLSchema#float"
      },
      "speaker": {
        "@id": "mycelia:speaker",
        "@type": "@id"
      }
    }
  ],
  "type": ["Document", "mycelia:TranscriptSegment"],
  "id": "https://mycelia.tech/transcripts/seg-789",
  "mediaType": "text/plain",
  "content": "This is what was discussed during the meeting...",
  "startTime": "2025-10-20T14:05:30Z",
  "endTime": "2025-10-20T14:05:45Z",
  "published": "2025-10-20T14:05:45Z",
  
  "derivedFrom": ["https://mycelia.tech/audio/chunk-123"],
  "derivationMethod": "whisper-large-v3",
  "confidence": 0.95,
  "speaker": "https://mycelia.tech/actors/alice"
}
```

#### Activity: Creating a Conversation

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "mycelia": "https://mycelia.tech/ns/",
      "icon": "mycelia:icon"
    }
  ],
  "type": "Create",
  "id": "https://mycelia.tech/activities/create-456",
  "actor": "https://mycelia.tech/actors/alice",
  "published": "2025-10-20T14:00:00Z",
  "object": {
    "type": "Note",
    "id": "https://mycelia.tech/notes/conv-123",
    "name": "Project Planning Discussion",
    "content": "Discussion notes...",
    "icon": "💬"
  }
}
```

### Vocabulary Summary Table

| Vocabulary | Namespace | Primary Use in Mycelia | Example Properties |
|------------|-----------|------------------------|-------------------|
| **ActivityStreams** | `https://www.w3.org/ns/activitystreams#` | Core social objects and activities | `type`, `name`, `content`, `published`, `actor`, `object` |
| **FOAF** | `http://xmlns.com/foaf/0.1/` | Person metadata and relationships | `mbox`, `homepage`, `knows`, `member` |
| **Schema.org** | `http://schema.org/` | Rich structured data | `birthDate`, `description`, `location`, `participant` |
| **Dublin Core** | `http://purl.org/dc/terms/` | Metadata and attribution | `title`, `created`, `creator`, `subject` |
| **Mycelia** | `https://mycelia.tech/ns/` | Custom timeline and memory properties | `icon`, `timeRanges`, `derivedFrom`, `confidence`, `speaker` |

### Key ActivityStreams Types for Mycelia

Based on the [W3C ActivityStreams Vocabulary](https://www.w3.org/TR/activitystreams-vocabulary/), these are the most relevant types:

**Actor Types:**
- `Person` - Individual users/participants
- `Group` - Collections of people (e.g., family, team)
- `Organization` - Companies, institutions
- `Service` - Automated services/bots

**Object Types:**
- `Note` - Short text content (conversations, thoughts)
- `Article` - Long-form content
- `Document` - Text documents (transcripts)
- `Audio` - Audio recordings
- `Event` - Calendar events, appointments
- `Place` - Geographic locations
- `Relationship` - Connections between entities

**Activity Types for Timeline:**
- `Create` - Created new content
- `Update` - Modified existing content
- `Delete` - Removed content
- `Add` - Added to collection
- `Remove` - Removed from collection
- `Like` - Favorited/liked content
- `Announce` - Shared/boosted content
- `Arrive` - Arrived at location
- `Leave` - Left location
- `Listen` - Listened to audio
- `Read` - Read article/document
- `View` - Viewed content

## Integrating with Remix

Add Fedify middleware to your Remix server:

```typescript
// backend/server.ts
import { federation } from "@/lib/fedify/federation.server.ts";

// Add Fedify routes before Remix
server.use(async (req, res, next) => {
  // Check if request is for ActivityPub endpoints
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (
    url.pathname.startsWith("/actors/") ||
    url.pathname.startsWith("/@") ||
    url.pathname === "/.well-known/webfinger"
  ) {
    // Handle with Fedify
    const response = await federation.fetch(req.url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    });
    
    if (response.status !== 404) {
      // Fedify handled it
      res.status(response.status);
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      res.send(await response.text());
      return;
    }
  }
  
  // Pass to Remix
  next();
});
```

## Implementation Checklist

### Phase 1: Setup Fedify (Week 1)
- [ ] Install Fedify: `@fedify/fedify` in backend/deno.json
- [ ] Create `objects` collection in MongoDB
- [ ] Set up Fedify Federation instance
- [ ] Configure actor dispatcher for Person objects
- [ ] Configure object dispatcher for Note/Event objects
- [ ] Add Fedify middleware to Remix server
- [ ] Create `ObjectsResource` MCP resource
- [ ] **Implement access control authorization middleware**
- [ ] **Add HTTP Signatures verification**
- [ ] Add database indexes for objects collection (including `to`, `cc`, `bto`, `bcc`)
- [ ] Write unit tests for object CRUD and access control

### Phase 2: Type System & Helpers (Week 1-2)
- [ ] Create ActivityPub type definitions in `frontend/src/types/activitypub.ts`
- [ ] Create ActivityPub type definitions in `backend/app/types/activitypub.ts`
- [ ] Build helper functions for type checking
- [ ] Build helper functions for property access
- [ ] Create Zod schemas for validation
- [ ] Write tests for type helpers

### Phase 3: Migration Tools (Week 2-3)
- [ ] Write migration script: `people` → Person objects
- [ ] Write migration script: `conversations` → Note objects
- [ ] Write migration script: `events` → Event objects
- [ ] Generate proper ActivityPub IRIs for all objects
- [ ] Migrate participant relationships
- [ ] Add reverse migration for rollback
- [ ] Test migrations on staging data
- [ ] Validate migrated data integrity

### Phase 4: UI Components (Week 3-4)
- [ ] Build `ObjectEditor` component
- [ ] Build `ObjectView` component  
- [ ] Build `TypeBadges` component
- [ ] Build `RelationshipsEditor` component
- [ ] Update `ConversationDetailPage` to use objects
- [ ] Update `PeoplePage` to use objects
- [ ] Update `EventsPage` to use objects
- [ ] Add object search/filter UI

### Phase 5: Federation Features (Week 4-5, Optional)
- [ ] Implement inbox handling for incoming activities
- [ ] Implement outbox for publishing activities
- [ ] Add WebFinger support
- [ ] Add HTTP Signatures for authentication
- [ ] Test federation with Mastodon instance
- [ ] Add follower/following collections
- [ ] Add remote object fetching

### Phase 6: Advanced Features (Week 5+)
- [ ] Implement graph traversal queries
- [ ] Add full-text search across object properties
- [ ] Build property templates for common types
- [ ] Add automatic relationship extraction from content
- [ ] Implement derivation/provenance tracking
- [ ] Add activity streams (timeline of activities)
- [ ] Build federation admin UI

## Practical Next Steps

### 1. Start Simple: Read-Only Fedify Integration

Begin with read-only ActivityPub support - just expose existing data:

```typescript
// backend/app/lib/fedify/readonly-federation.server.ts
import { createFederation, Person } from "@fedify/fedify";
import { getRootDB } from "@/lib/mongo/core.server.ts";

export const federation = createFederation({
  baseUrl: new URL(Deno.env.get("BASE_URL") || "http://localhost:5173"),
});

// Expose existing people as ActivityPub Person objects
federation.setActorDispatcher("/actors/{id}", async (ctx, id) => {
  const db = await getRootDB();
  const person = await db.collection("people").findOne({ 
    _id: new ObjectId(id) 
  });
  
  if (!person) return null;
  
  return new Person({
    id: new URL(`https://mycelia.tech/actors/${id}`),
    name: person.name,
    summary: person.details,
    // Note: These collections don't exist yet, just placeholders
    inbox: new URL(`https://mycelia.tech/actors/${id}/inbox`),
    outbox: new URL(`https://mycelia.tech/actors/${id}/outbox`),
  });
});
```

### 2. Gradual Migration Strategy

Don't migrate everything at once. Start with one collection:

```typescript
// migration-scripts/migrate-people-to-objects.ts

import { getRootDB } from "@/lib/mongo/core.server.ts";

async function migratePeopleToObjects() {
  const db = await getRootDB();
  const people = await db.collection("people").find({}).toArray();
  
  const objects = people.map(person => ({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Person",
    id: `https://mycelia.tech/actors/${person._id.toString()}`,
    name: person.name,
    summary: person.details,
    "mycelia:icon": person.icon,
    
    // ActivityPub required fields
    inbox: `https://mycelia.tech/actors/${person._id.toString()}/inbox`,
    outbox: `https://mycelia.tech/actors/${person._id.toString()}/outbox`,
    followers: `https://mycelia.tech/actors/${person._id.toString()}/followers`,
    following: `https://mycelia.tech/actors/${person._id.toString()}/following`,
    
    // Internal metadata
    _internal: {
      created: person.createdAt,
      updated: person.updatedAt,
      localId: person._id,
      visibility: "private",
      indexed: false,
      oldCollection: "people",  // Track where it came from
    },
  }));
  
  // Insert into objects collection
  const result = await db.collection("objects").insertMany(objects);
  
  console.log(`Migrated ${result.insertedCount} people to objects collection`);
  
  // Don't delete old collection yet - run in parallel for safety
}
```

### 3. Dual-Write Pattern

Write to both old and new collections during transition:

```typescript
// backend/app/lib/objects/dual-write.ts

export async function createPerson(data: { name: string; details?: string; icon?: string }) {
  const db = await getRootDB();
  const now = new Date();
  
  // Write to old collection
  const oldResult = await db.collection("people").insertOne({
    name: data.name,
    details: data.details,
    icon: data.icon,
    createdAt: now,
    updatedAt: now,
  });
  
  // Write to new objects collection
  const personObject = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Person",
    id: `https://mycelia.tech/actors/${oldResult.insertedId.toString()}`,
    name: data.name,
    summary: data.details,
    "mycelia:icon": data.icon,
    inbox: `https://mycelia.tech/actors/${oldResult.insertedId.toString()}/inbox`,
    outbox: `https://mycelia.tech/actors/${oldResult.insertedId.toString()}/outbox`,
    followers: `https://mycelia.tech/actors/${oldResult.insertedId.toString()}/followers`,
    following: `https://mycelia.tech/actors/${oldResult.insertedId.toString()}/following`,
    _internal: {
      created: now,
      updated: now,
      localId: oldResult.insertedId,
      visibility: "private",
      indexed: false,
    },
  };
  
  await db.collection("objects").insertOne(personObject);
  
  return { oldId: oldResult.insertedId, objectId: personObject.id };
}
```

## Benefits of Using Fedify

1. **Standards Compliance**: Automatic JSON-LD, ActivityStreams 2.0 compliance
2. **Type Safety**: Rich TypeScript types for all ActivityPub objects
3. **HTTP Signatures**: Built-in authentication for federated requests
4. **WebFinger**: Automatic WebFinger support for actor discovery
5. **Interoperability**: Tested with Mastodon, Pleroma, and other fediverse software
6. **Extensibility**: Easy to add custom properties and object types
7. **Future-Proof**: As fediverse evolves, Fedify will keep up with standards

## Key Differences from Traditional Approach

| Aspect | Traditional (Old) | ActivityPub with Fedify (New) |
|--------|------------------|-------------------------------|
| Collections | Separate: `people`, `conversations`, `events` | Unified: `objects` |
| Identifiers | MongoDB ObjectId | ActivityPub IRI (URL) |
| Types | Implicit (by collection) | Explicit `type` property |
| Relationships | Array references or separate collection | ActivityPub properties + Relationship objects |
| Flexibility | Fixed schema per collection | Flexible properties with known vocabularies |
| Interop | Mycelia-only | Can federate with Mastodon, etc. |
| Standards | Custom | ActivityPub, ActivityStreams 2.0, JSON-LD |

## Open Questions

1. **Federation Scope**: Should Mycelia federate publicly or stay private with ActivityPub for internal structure only?
2. **Property Validation**: Validate properties against schemas for known types, or allow anything?
3. **Relationship Storage**: Store relationships embedded in objects or as separate Relationship objects?
4. **IRI Format**: Use `/actors/{id}`, `/@{username}`, or custom format?
5. **Property Updates**: Keep history/versions when properties change?
6. **Type Hierarchy**: Support type inheritance (e.g., "Organization" extends "Agent")?
7. **Performance**: At what scale do we need to consider graph database instead of MongoDB?
8. **Collections**: Should we implement ActivityPub Collections for followers/following, or just reference objects?

## References

### Fedify
- [Fedify Documentation](https://fedify.dev/)
- [Fedify GitHub](https://github.com/fedify-dev/fedify)
- [Fedify Tutorials](https://fedify.dev/tutorial)
- [Fedify API Reference](https://jsr.io/@fedify/fedify)

### Standards
- [ActivityPub Specification](https://www.w3.org/TR/activitypub/)
- [ActivityStreams 2.0 Vocabulary](https://www.w3.org/TR/activitystreams-vocabulary/)
- [JSON-LD](https://json-ld.org/)
- [WebFinger](https://webfinger.net/)

### Vocabularies
- [FOAF Vocabulary](http://xmlns.com/foaf/spec/)
- [Schema.org](https://schema.org/)
- [Dublin Core](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/)
- [RDF Primer](https://www.w3.org/TR/rdf11-primer/)

### Inspiration
- [Mastodon](https://docs.joinmastodon.org/spec/activitypub/)
- [PeerTube ActivityPub](https://docs.joinpeertube.org/api/activitypub)
- [Pixelfed](https://docs.pixelfed.org/)

---

## Summary

This design provides a path to modernize Mycelia's data model using:

1. **W3C Standards**: [ActivityStreams 2.0 Vocabulary](https://www.w3.org/TR/activitystreams-vocabulary/) as the foundation
2. **Fedify Framework**: Battle-tested [TypeScript ActivityPub implementation](https://github.com/fedify-dev/fedify)
3. **Semantic Flexibility**: JSON-LD `@context` allows mixing standard and custom vocabularies
4. **Gradual Migration**: Run parallel systems during transition
5. **Future Federation**: Optional federation with the wider fediverse (Mastodon, etc.)

### Key Advantages

✅ **Standards-Based**: Uses W3C ActivityPub/ActivityStreams specs  
✅ **Secure Access Control**: Built-in privacy using `to`/`cc`/`bto`/`bcc` audience targeting  
✅ **HTTP Signatures**: Cryptographic authentication for remote requests  
✅ **Extensible**: Easy to add custom properties via `mycelia:` namespace  
✅ **Interoperable**: Can federate with existing fediverse software  
✅ **Type-Safe**: Fedify provides TypeScript types for all standard objects  
✅ **Property-Based**: Objects defined by what properties they have, not rigid schemas  
✅ **Multiple Types**: Single object can be both `Note` and `mycelia:Conversation`  
✅ **Rich Relationships**: Model complex relationships using ActivityStreams Relationship objects  
✅ **Privacy Levels**: Support for public, unlisted, followers-only, and direct messages  

### Implementation Path

**Phase 1**: Install Fedify, create `objects` collection, expose existing data read-only  
**Phase 2**: Define TypeScript types and vocabulary constants  
**Phase 3**: Migrate data with dual-write pattern  
**Phase 4**: Update UI to use new ontology  
**Phase 5** (Optional): Enable federation features  
**Phase 6**: Advanced graph queries and derivation tracking  

**Next Step**: Start with Phase 1 of the implementation checklist - install Fedify and set up a basic Federation instance to expose existing people as ActivityPub Person objects.

