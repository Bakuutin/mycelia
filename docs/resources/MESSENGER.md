# Messenger Resource (`messenger`)

The `messenger` resource handles the import of communication data from external platforms (Telegram, WhatsApp, etc.).

## Actions
- `upsertMessage` / `upsertMessageBatch`: Import one or many messages.
- `upsertChat` / `upsertChatBatch`: Create or update conversation metadata.
- `upsertContact` / `upsertContactBatch`: Create or update contact information.

## Policy Paths
- `messenger/messages`: Access to message imports.
- `messenger/chats`: Access to chat imports.
- `messenger/contacts`: Access to contact imports.

## Automation Features
- **Auto-Creation**: Importing a message automatically creates the corresponding chat and sender (as a "Person" object) if they don't already exist.
- **Deduplication**: Uses `externalId` and `platform` to ensure messages are not duplicated on re-import.
- **Batch Processing**: Highly optimized batch actions use MongoDB `bulkWrite` for performance.

