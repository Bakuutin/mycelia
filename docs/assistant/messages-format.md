# Understanding Message Data

#messages #chat #format

Messages come from various chat platforms.

## Message Structure

```json
{
  "_id": "ObjectId",
  "chatId": "ObjectId",
  "senderId": "ObjectId",
  "text": "Message content",
  "platform": "mycelia",
  "timestamp": "2024-03-15T10:30:00Z",
  "raw": {
    "role": "user",
    "content": "..."
  }
}
```

## Platforms

- `mycelia`: AI chat conversations (with this assistant)
- `telegram`: Imported Telegram messages
- Others as configured

## Related Collections

- `chats`: Chat/conversation containers
- `objects`: People linked via `senderId`

## Searching Tips

- Filter by `platform` for specific sources
- Use `chatId` to scope to a conversation
- `raw.role` indicates "user" or "assistant"
- Search both `text` and `raw.content`
