# Messenger System

Platform-extensible messenger UI with unified Person objects across platforms.

## Key Files

### Frontend
- `frontend/src/pages/MessengerPage.tsx` - Main messenger interface (`/messaging`, `/messaging/:chatId`)
- `frontend/src/modules/messenger/core/registry.ts` - Platform registry
- `frontend/src/modules/messenger/core/types.ts` - Platform interface
- `frontend/src/modules/messenger/platforms/` - Platform implementations (telegram, signal, mycelia, default)
- `frontend/src/modules/messenger/components/` - MessageBubble, ChatListItem

### Backend
- `backend/app/lib/messenger/sdk.server.ts` - TypeScript SDK: `getOrCreatePersonByMessengerId()`
- `backend/app/lib/messenger/resource.server.ts` - Mongo resource handler
- `backend/app/routes/api.chat.ts` - Chat API (uses messenger SDK)

### Python
- `python/lib/messenger_sdk.py` - Python SDK: `get_or_create_person_by_messenger_id()`
- `python/tg.py` - Telegram import script

## Architecture

**Platform System**: Extensible platform registry for custom message rendering per platform (Telegram, Signal, etc.)

**Person Objects**: All messages link to Person objects via `senderId`. Person objects stored in `objects` collection with `isPerson: true` and `messenger.<platform>.id` field.

**Data Access**: Frontend uses Mongo resource API to fetch chats and messages via `callResource()`.

## Routing

- `/messaging` - Messenger page (no chat selected)
- `/messaging/:chatId` - Messenger page with specific chat selected
