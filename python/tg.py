#%%
from bs4 import BeautifulSoup
from bson import ObjectId
from pydantic import BaseModel
from typing import Optional, List, Union
from datetime import datetime
from pathlib import Path
import json
from lib.resources import call_resource
from lib.api import session, ensure_authorized
from lib.config import get_url
import base64
from tqdm import tqdm

export_dir = Path('/Users/igor/Downloads/Telegram Lite/DataExport_2025-12-09 (1)/')

data_file = export_dir / 'result.json'

with open(data_file, 'r') as f:
    data = json.load(f)

def upload_file_to_gridfs(file_path: Path):
    if not file_path.exists():
        print(f"File not found: {file_path}")
        return None
        
    ensure_authorized()
    with open(file_path, "rb") as f:
        file_content = f.read()
        
    encoded = base64.b64encode(file_content).decode('utf-8')
    
    # Metadata
    metadata = {
        "original_path": str(file_path),
        "source": "telegram_import"
    }
    
    payload = {
        "file": encoded,
        "filename": file_path.name,
        "metadata": metadata
    }
    
    upload_url = get_url("api", "files", "upload")
    try:
        response = session.post(upload_url, json=payload)
        response.raise_for_status()
        return response.json().get("file_id")
    except Exception as e:
        print(f"Failed to upload {file_path}: {e}")
        return None

#%%

print(list(data.keys())) 
# ['about', 'personal_information', 'profile_pictures', 'stories', 'contacts', 'frequent_contacts', 'other_data', 'chats', 'left_chats']

# %%

data['chats']['list'][0].keys()
# ['name', 'type', 'id', 'messages']

# %%
# Select a chat to import (e.g., the first one for testing)
# We can filter by name if needed

target_chat = None
for chat in data['chats']['list']:
    if chat['id'] == 84380711:
        target_chat = chat
        break

if not target_chat:
    target_chat = data['chats']['list'][0]

messages = target_chat['messages']

print(f"Importing chat: {target_chat.get('name', 'Unknown')} (ID: {target_chat['id']})")
print(f"Total messages: {len(messages)}")

#%%
#%%

# {'id': 2117043,
#  'type': 'message',
#  'date': '2025-03-13T10:58:53',
#  'date_unixtime': '1741859933',
#  'from': 'Petr Korolev',
#  'from_id': 'user84380711',
#  'text': 'Привет, Паша сказал мы даже с тобой виделись где-то?',
#  'text_entities': [{'type': 'plain',
#    'text': 'Привет, Паша сказал мы даже с тобой виделись где-то?'}]}
# %%
# 1. Create or Update Chat
# Mapping Telegram chat to our Chat schema

chat_doc = {
    "platform": "telegram",
    "externalId": target_chat['id'], # Preserve original type (likely number for TG)
    "name": target_chat.get('name'),
    "createdAt": datetime.now().isoformat(),
    "updatedAt": datetime.now().isoformat(),
    "raw": {k: v for k, v in target_chat.items() if k != 'messages'}
}

# Using mongo resource directly to upsert the chat
# We want to find by platform+externalId, or insert
upsert_chat_result = call_resource("mongo", {
    "action": "updateOne",
    "collection": "chats",
    "query": {
        "platform": "telegram",
        "externalId": target_chat['id']
    },
    "update": {
        "$set": chat_doc
    },
    "options": {
        "upsert": True
    }
})

print("Chat upsert result:", upsert_chat_result)
#%%
# We need the _id of the chat for the messages
# If upserted, we might get upsertedId. If updated, we need to fetch it.
if upsert_chat_result.get('upsertedId'):
    chat_id = upsert_chat_result['upsertedId']
else:
    # Fetch the chat to get the ID
    fetched_chat = call_resource("mongo", {
        "action": "findOne",
        "collection": "chats",
        "query": {
            "platform": "telegram",
            "externalId": target_chat['id']
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
        
    msg_external_id = msg['id'] # Preserve original type
    timestamp = datetime.fromtimestamp(int(msg['date_unixtime']))
    
    # Handle media
    media_items = []
    
    # # Check for photo
    # if 'photo' in msg:
    #     photo_path = export_dir / msg['photo']
    #     file_id = upload_file_to_gridfs(photo_path)
    #     if file_id:
    #         media_items.append({
    #             "type": "image",
    #             "url": f"/api/files/{file_id}",
    #             "fileId": file_id,
    #             "path": msg['photo'],
    #             "fileName": Path(msg['photo']).name
    #         })

    # # Check for file
    # if 'file' in msg:
    #     file_path = export_dir / msg['file']
    #     file_id = upload_file_to_gridfs(file_path)
    #     if file_id:
    #         # Determine type
    #         media_type = "file"
    #         if msg.get('media_type') in ['voice_message', 'audio_file']:
    #             media_type = "audio"
    #         elif msg.get('media_type') in ['video_message', 'video_file', 'animation']:
    #             media_type = "video"
    #         elif msg.get('media_type') == 'sticker':
    #             media_type = "sticker"
                
    #         media_items.append({
    #             "type": media_type,
    #             "url": f"/api/files/{file_id}",
    #             "fileId": file_id,
    #             "path": msg['file'],
    #             "fileName": Path(msg['file']).name,
    #             "mimeType": msg.get('mime_type')
    #         })

    message_doc = {
        "chatId": chat_id,
        "platform": "telegram",
        "externalId": msg_external_id,
        "timestamp": timestamp,
        "text": msg.get('text'), # Changed from content
        "raw": msg, # Store full raw message
        "createdAt": datetime.now(),
        "updatedAt": datetime.now(),
        "type": "message" # Explicit type for discrimination if needed
    }
    
    if media_items:
        message_doc["media"] = media_items
    
    # Add to bulk operations (upsert based on platform + chatId + externalId)
    # Using updateOne with upsert to avoid duplicates
    operations.append({
        "updateOne": {
            "filter": {
                "platform": "telegram",
                "chatId": chat_id,
                "externalId": msg_external_id
            },
            "update": {
                "$set": message_doc
            },
            "upsert": True
        }
    })

    if len(operations) >= batch_size:
        call_resource("mongo", {
            "action": "bulkWrite",
            "collection": "messages",
            "operations": operations
        })
        operations = []

# Flush remaining
if operations:
    call_resource("mongo", {
        "action": "bulkWrite",
        "collection": "messages",
        "operations": operations
    })

print("Import complete.")


#%%

messages[0]
# %%


# %%
