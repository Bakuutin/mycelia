#%%
from bs4 import BeautifulSoup
from pydantic import BaseModel
from typing import Optional, List, Union
from datetime import datetime
from pathlib import Path
import json
from lib.resources import call_resource
from tqdm import tqdm

export_dir = Path('/Users/igor/Downloads/Telegram Lite/DataExport_2025-12-09 (1)/')

data_file = export_dir / 'result.json'

with open(data_file, 'r') as f:
    data = json.load(f)

#%%

print(list(data.keys())) 
# ['about', 'personal_information', 'profile_pictures', 'stories', 'contacts', 'frequent_contacts', 'other_data', 'chats', 'left_chats']

# %%

data['chats']['list'][0].keys()
# ['name', 'type', 'id', 'messages']

# %%
# Select a chat to import (e.g., the first one for testing)
# We can filter by name if needed

for chat in data['chats']['list']:
    if chat['id'] == 84380711:
        target_chat = chat
        break

print(f"Importing chat: {target_chat.get('name', 'Unknown')} (ID: {target_chat['id']})")
print(f"Total messages: {len(target_chat.get('messages', []))}")

# %%
# 1. Create or Update Chat
# Mapping Telegram chat to our Chat schema

chat_doc = {
    "platform": "telegram",
    "externalId": str(target_chat['id']),
    "name": target_chat.get('name'),
    "createdAt": datetime.now(),
    "updatedAt": datetime.now(),
    "raw": {k: v for k, v in target_chat.items() if k != 'messages'}
}
chat_doc

#%%

# Using tech.mycelia.mongo resource directly to upsert the chat
# We want to find by platform+externalId, or insert
upsert_chat_result = call_resource("tech.mycelia.mongo", {
    "action": "updateOne",
    "collection": "chats",
    "query": {
        "platform": "telegram",
        "externalId": str(target_chat['id'])
    },
    "update": {
        "$set": chat_doc
    },
    "options": {
        "upsert": True
    }
})

print("Chat upsert result:", upsert_chat_result)

# We need the _id of the chat for the messages
# If upserted, we might get upsertedId. If updated, we need to fetch it.
if upsert_chat_result.get('upsertedId'):
    chat_id = upsert_chat_result['upsertedId']
else:
    # Fetch the chat to get the ID
    fetched_chat = call_resource("tech.mycelia.mongo", {
        "action": "findOne",
        "collection": "chats",
        "query": {
            "platform": "telegram",
            "externalId": str(target_chat['id'])
        }
    })
    chat_id = fetched_chat['_id']

print(f"Chat ObjectID: {chat_id}")

# %%
# 2. Import Messages

messages = target_chat.get('messages', [])
batch_size = 100
operations = []

print("Preparing messages...")

for msg in tqdm(messages):
    # Skip service messages without ID if necessary, but Telegram usually has IDs
    if 'id' not in msg:
        continue
        
    msg_external_id = str(msg['id'])
    timestamp = datetime.fromisoformat(msg['date']) if 'date' in msg else datetime.now()
    
    # Simple content extraction
    content_text = ""
    if isinstance(msg.get('text'), str):
        content_text = msg['text']
    elif isinstance(msg.get('text'), list):
        # Telegram export sometimes has mixed list of strings and objects (links)
        parts = []
        for part in msg['text']:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and 'text' in part:
                parts.append(part['text'])
        content_text = "".join(parts)
        
    # Construct Message doc
    message_doc = {
        "chatId": chat_id,
        "platform": "telegram",
        "externalId": msg_external_id,
        "timestamp": timestamp.isoformat(),
        "content": content_text,
        "raw": msg, # Store full raw message
        "visibilityTier": 3,
        "createdAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
        "type": "message" # Explicit type for discrimination if needed
    }
    
    # Add sender info if available (mapping to senderId is a separate task, storing raw for now)
    if 'from_id' in msg:
        message_doc['raw']['sender_external_id'] = str(msg['from_id'])
    if 'from' in msg:
         message_doc['raw']['sender_name'] = msg['from']

    # Reply info
    if 'reply_to_message_id' in msg:
        message_doc['replyToExternalId'] = str(msg['reply_to_message_id'])

    # Add to bulk operations (upsert based on platform + externalId + chatId)
    # Using updateOne with upsert to avoid duplicates
    operations.append({
        "updateOne": {
            "filter": {
                "platform": "telegram",
                "externalId": msg_external_id,
                "chatId": chat_id
            },
            "update": {
                "$set": message_doc
            },
            "upsert": True
        }
    })

    if len(operations) >= batch_size:
        call_resource("tech.mycelia.mongo", {
            "action": "bulkWrite",
            "collection": "messages",
            "operations": operations
        })
        operations = []

# Flush remaining
if operations:
    call_resource("tech.mycelia.mongo", {
        "action": "bulkWrite",
        "collection": "messages",
        "operations": operations
    })

print("Import complete.")
