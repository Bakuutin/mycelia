# Messenger Feature Guide

Mycelia's Messenger module provides a unified interface for viewing and managing conversations from multiple messaging platforms.

## Overview

| Feature | Description |
|---------|-------------|
| **Unified View** | View chats from Telegram, Signal, and Mycelia native in one place |
| **Platform Registry** | Extensible architecture for adding new platforms |
| **Custom Rendering** | Platform-specific message rendering (phone calls, video messages, etc.) |
| **Data Import** | Import chat history from platform exports |

## Quick Start

### 1. Access the Messenger

Navigate to: **http://localhost:5173/messaging** (or via frontend at port 3001)

### 2. Interface Layout

The messenger uses a resizable two-panel layout:

- **Left Panel**: Chat list sorted by last message date
- **Right Panel**: Message thread for selected chat

### 3. Supported Platforms

| Platform | ID | Features |
|----------|-----|----------|
| **Mycelia** | `mycelia` | Native AI-powered chats |
| **Telegram** | `telegram` | Phone calls, video messages, file sharing |
| **Signal** | `signal` | Basic message support |

## Data Schema

### Chat Document

```typescript
{
  _id: ObjectId,
  platform: string,      // 'telegram', 'signal', 'mycelia'
  externalId: string | number, // Platform-specific ID
  name: string,          // Chat/group name
  type: 'private' | 'group' | 'channel',
  lastMessageDate: Date,
  createdAt: Date,
  updatedAt: Date,
  raw: any               // Platform-specific raw data
}
```

### Message Document

```typescript
{
  _id: ObjectId,
  chatId: ObjectId,      // Reference to chat
  senderId: ObjectId,    // Reference to Person (optional)
  platform: string,
  externalId: string | number,
  text: string,          // Message text content
  media: [{
    type: 'image' | 'video' | 'audio' | 'file' | 'sticker',
    url: string,         // Storage URL
    fileId: string,      // GridFS ID
    path: string,        // Local path
    mimeType: string,
    fileName: string,
    fileSize: number
  }],
  timestamp: Date,
  replyToId: ObjectId,   // Internal reply reference
  replyToExternalId: string | number,
  forwardedFrom: {
    name: string,
    id: string | number
  },
  raw: any,              // Platform-specific raw data
  createdAt: Date,
  updatedAt: Date
}
```

## Importing Data

### Telegram Import

1. **Export your Telegram data:**
   - Open Telegram Desktop → Settings → Advanced → Export Telegram data
   - Select "JSON" format
   - Include the chats you want to import

2. **Run the import script:**

```bash
cd python
uv run tg.py
```

3. **Configure the import:**

Edit `python/tg.py` to set:
- `export_dir`: Path to your Telegram export folder
- Target chat ID (optional, defaults to first chat)

```python
export_dir = Path('/path/to/your/DataExport/')

# Optional: Filter specific chat by ID
for chat in data['chats']['list']:
    if chat['id'] == YOUR_CHAT_ID:
        target_chat = chat
        break
```

4. **Upload media files (optional):**

Uncomment the media upload sections in `tg.py` to upload photos and files to GridFS.

### Import Process

The script performs:
1. **Upsert chat** - Creates or updates the chat document
2. **Batch upsert messages** - Imports messages in batches of 100
3. **Deduplication** - Uses `platform + chatId + externalId` as unique key

## Database Indexes

The migration creates these indexes for performance:

### Chats Collection

| Index | Fields | Purpose |
|-------|--------|---------|
| `platform_external_id_unique` | `{ platform: 1, externalId: 1 }` | Unique constraint |
| `last_message_date_sort` | `{ lastMessageDate: -1 }` | Chat list sorting |

### Messages Collection

| Index | Fields | Purpose |
|-------|--------|---------|
| `platform_chat_message_unique` | `{ platform: 1, chatId: 1, externalId: 1 }` | Unique constraint |
| `chat_history` | `{ chatId: 1, timestamp: -1 }` | Chat message retrieval |
| `sender_history` | `{ senderId: 1, timestamp: -1 }` | Message by sender lookup |

## Running Migrations

Apply the messengers migration:

```bash
cd backend
deno task migrate
```

Or run specific migration:

```bash
deno run -A --env migrations/run.ts up 0002_messengers_setup
```

## Extending the Platform Registry

### Adding a New Platform

1. **Create platform file:**

```typescript
// frontend/src/modules/messenger/platforms/myplatform.tsx
import type { Platform } from "../core/types.ts";
import { defaultPlatform } from "./default.tsx";
import { MessageCircle } from "lucide-react";

export const myPlatform: Platform = {
  ...defaultPlatform,  // Inherit default rendering
  id: "myplatform",
  name: "My Platform",
  icon: MessageCircle,
  // Optional: Override MessageComponent for custom rendering
  // MessageComponent: MyCustomMessageComponent,
};
```

2. **Register the platform:**

```typescript
// frontend/src/pages/MessengerPage.tsx
import { myPlatform } from "@/modules/messenger/platforms/myplatform.tsx";

// In the platform registration section:
registry.register(myPlatform);
```

### Custom Message Rendering

For platform-specific message types (e.g., phone calls, stickers):

```typescript
const MyPlatformMessageComponent: Platform["MessageComponent"] = ({ message }) => {
  const raw = message.raw;

  // Handle special message types
  if (raw?.type === "phone_call") {
    return (
      <div className="flex items-center gap-2">
        <PhoneCall className="w-4 h-4" />
        <span>Phone call - {raw.duration}s</span>
      </div>
    );
  }

  // Fall back to default renderer
  return <defaultPlatform.MessageComponent message={message} />;
};
```

## API Access

### Querying Chats

```typescript
// Using MCP/Resource API
const chats = await callResource("mongo", {
  action: "find",
  collection: "chats",
  query: { platform: "telegram" },
  options: { sort: { lastMessageDate: -1 } }
});
```

### Querying Messages

```typescript
const messages = await callResource("mongo", {
  action: "find",
  collection: "messages",
  query: { chatId: { $oid: "CHAT_ID_HERE" } },
  options: {
    sort: { timestamp: -1 },
    limit: 100
  }
});
```

## Troubleshooting

### Messages not appearing

1. Check that the chat's `_id` matches the message's `chatId`
2. Verify `timestamp` field is a valid date
3. Check browser console for errors

### Import duplicating messages

The import script uses upsert with unique key `{ platform, chatId, externalId }`. If duplicates appear:
- Verify `externalId` is being set correctly
- Run migration to ensure unique index exists

### Platform icon not showing

Ensure the platform is registered before the component mounts:

```typescript
// Register early, before component render
registry.register(myPlatform);
```

## Architecture

```
frontend/src/modules/messenger/
├── core/
│   ├── registry.ts        # Platform registry singleton
│   ├── types.ts           # Platform interface definitions
│   └── useMessageRenderer.ts  # Hook for message rendering
├── components/
│   ├── ChatListItem.tsx   # Chat list item component
│   └── MessageBubble.tsx  # Message wrapper component
└── platforms/
    ├── default.tsx        # Base message renderer
    ├── mycelia.tsx        # Mycelia platform
    ├── telegram.tsx       # Telegram platform
    └── signal.tsx         # Signal platform
```

## Related Documentation

- [MCP Guide](MCP_GUIDE.md) - API access and tool usage
- [Objects](objects.md) - Linking messages to Person objects
