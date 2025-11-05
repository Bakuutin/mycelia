#!/usr/bin/env python3
"""
Conversation extraction console application.

This script processes transcripts to extract conversations using LLM analysis.
"""

import argparse
import logging
import os
import signal
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

import pytz
import yaml
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

import json
import re

from lib.resources import call_resource
from lib.llm import get_llm
from lib.hist import mark_buckets_as, get_ranges, date_to_bucket, SCALE_TO_RESOLUTION


# Signal handling for graceful shutdown
signal.signal(signal.SIGINT, signal.SIG_DFL)

# Setup logging
logger = logging.getLogger('convos')

bucketsEntered = set()
bucketsExited = set()


def setup_logging():
    """Setup logging configuration similar to daemon.py"""
    log_dir = os.path.expanduser('~/Library/mycelia/logs')
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, 'convos.log')

    console = logging.StreamHandler()
    console.setLevel(logging.INFO)

    file_handler = logging.FileHandler(log_file)
    file_handler.setLevel(logging.DEBUG)

    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    console.setFormatter(formatter)
    file_handler.setFormatter(formatter)

    logging.basicConfig(level=logging.DEBUG, handlers=[console, file_handler])
    logger.info(f"Logging to {log_file}")

def utc(dt: datetime | int) -> datetime:
    """Convert datetime or timestamp to UTC timezone."""
    if isinstance(dt, int):
        dt = datetime.fromtimestamp(dt)
    if dt.tzinfo is None:
        return pytz.UTC.localize(dt)
    return dt.astimezone(pytz.UTC)

def allowed_gap(length: int) -> timedelta:
    """Calculate allowed gap between transcripts based on content length."""
    if length < 500:
        return timedelta(minutes=45)
    elif length < 20000:
        return timedelta(minutes=5)
    else:
        return timedelta(seconds=40)

def get_silence_message(gap: timedelta) -> str:
    """Generate silence message for gaps in conversation."""
    m = gap.total_seconds() / 60
    s = gap.total_seconds() % 60
    return f'silence for {m:.0f}m {s:.0f}s'

def get_timestamp_message(timestamp: datetime) -> str:
    """Generate timestamp message for conversation chunks."""
    return f'time: {utc(timestamp).isoformat()}'

scale = "1day"

def iterate_transcripts(not_later_than: datetime | None = None, batch_size: int = 100):
    """
    Iterate through all transcripts in reverse chronological order.
    Yields one transcript at a time.
    """
    known_ranges = [
        r for r in get_ranges("conversations", scale) if r.done
    ]

    def shift_if_in_known_range(cursor: datetime) -> datetime:
        for range in known_ranges:
            if range.start is not None and range.end is not None:
                if range.start <= cursor <= range.end:
                    return range.start
        return cursor

    cursor = not_later_than or datetime.now(pytz.UTC) + timedelta(days=1)

    while cursor:
        cursor = shift_if_in_known_range(cursor)

        transcripts = call_resource(
            "tech.mycelia.mongo",
            {
                "action": "find",
                "collection": "transcriptions",
                "query": {"start": {"$lt": cursor}},
                "options": {
                    "sort": {"start": -1},
                    "limit": batch_size,
                },
            }
        )
        logger.debug(f"Fetched {len(transcripts)} transcripts")

        if len(transcripts) < 2:
            return

        # Handle edge case where last few transcripts have same timestamp
        while len(transcripts) >= 2 and transcripts[-1]["start"] == transcripts[-2]["start"]:
            transcripts = transcripts[:-1]

        if len(transcripts) < 2:
            return

        cursor = transcripts[-1]["start"]

        for transcript in transcripts:
            yield {
                'start': transcript["start"],
                'end': transcript["end"],
                'text': ''.join(s["text"] for s in transcript["segments"]).strip(),
            }

def iterate_conversations(not_later_than: datetime | None = None):
    """
    Group transcripts into conversation chunks based on timing gaps.
    """
    buffer = []
    total_len = 0
    last_timestamp = None

    for transcript in iterate_transcripts(not_later_than):
        if not last_timestamp:
            last_timestamp = transcript["start"]

        gap = (last_timestamp - transcript["start"])

        if buffer:
            if total_len > 100 and gap > allowed_gap(total_len):
                yield sorted(buffer, key=lambda x: x["start"])
                buffer = []
                total_len = 0

        buffer.append(transcript)
        total_len += len(transcript["text"])
        last_timestamp = transcript["start"]

    if buffer:
        yield sorted(buffer, key=lambda x: x["start"])

def chunk_to_prompt(chunk: list[dict]):
    """Convert conversation chunk to LLM prompt format."""
    earliest = chunk[0]["start"]
    latest = chunk[0]["end"]
    strings = [get_timestamp_message(earliest)]

    for c in chunk:
        gap = (c["start"] - latest)
        if gap > timedelta(seconds=30):
            strings.append(get_timestamp_message(latest))
            strings.append(get_silence_message(gap))
            strings.append(get_timestamp_message(c["start"]))
        strings.append(c["text"])
        latest = max(latest, c["end"])

    strings.append(get_timestamp_message(latest))
    return "\n".join(strings), earliest, latest

class Conversation(BaseModel):
    """Pydantic model for conversation data."""
    title: str = Field(description="Descriptive title for the conversation")
    summary: str = Field(description="Summary of what was discussed, key points, decisions, outcomes, etc.")
    entities: List[str] = Field(default_factory=list, description="People, places, things mentioned")
    start: datetime = Field(description="ISO 8601 timestamp when conversation started")
    end: datetime = Field(description="ISO 8601 timestamp when conversation ended")
    emoji: str = Field(description="Single emoji representing the conversation")

class ExtractConversationsInput(BaseModel):
    """Input model for conversation extraction."""
    conversations: List[Conversation] = Field(description="List of conversations extracted from the transcript")

def setup_llm_tools(model: str = "small"):
    """Setup LLM tools and prompts for conversation extraction."""
    extract_conversations_tool = {
        "name": "extract_conversations",
        "description": "Extract and return the conversations from the transcript",
        "parameters": ExtractConversationsInput.model_json_schema()
    }

    llm = get_llm(model)
    tool_llm = llm.bind_tools([extract_conversations_tool], tool_choice="extract_conversations")

    prompts_path = Path(__file__).parent / "prompts.yml"
    with open(prompts_path, "r") as f:
        prompts = yaml.safe_load(f)

    system_prompt = prompts["topics"]["system"]

    return tool_llm, system_prompt

def create_conversation_object(conv, conv_start, conv_end, now, model: str = "small"):
    """Create a conversation object from extracted conversation data"""
    return {
        'name': conv.title,
        'details': conv.summary,
        'icon': {'text': conv.emoji},
        'timeRanges': [{
            'start': conv_start,
            'end': conv_end,
        }],
        'createdAt': now,
        'updatedAt': now,
        'metadata': {
            'extractedWith': {
                'model': model,
                'timestamp': now,
            }
        }
    }

def create_entity_object(entity_name, now):
    """Create an entity object"""
    return {
        'name': entity_name,
        'createdAt': now,
        'updatedAt': now,
    }

def create_mentioned_relationship(entity_id, conversation_id, entity_name, conversation_title, now):
    """Create a 'mentioned in' relationship object"""
    return {
        'name': 'mentioned in',
        'isRelationship': True,
        'relationship': {
            'subject': entity_id,
            'object': conversation_id,
            'symmetrical': False
        },
        'createdAt': now,
        'updatedAt': now,
    }

def find_or_create_entity(entity_name, now):
    """Find existing entity or create new one"""
    # Check if entity already exists
    existing = call_resource("tech.mycelia.mongo", {
        "action": "findOne",
        "collection": "objects",
        "query": {"name": entity_name}
    })

    if existing:
        return existing['_id']

    # Create new entity
    entity_obj = create_entity_object(entity_name, now)
    result = call_resource("tech.mycelia.mongo", {
        "action": "insertOne",
        "collection": "objects",
        "doc": entity_obj
    })
    return result['insertedId']

def check_conversations_exist(start: datetime, end: datetime) -> bool:
    """Check if conversations already exist for this time range."""
    existing = call_resource("tech.mycelia.mongo", {
        "action": "findOne",
        "collection": "objects",
        "query": {
            "timeRanges": {
                "$elemMatch": {
                    "start": {"$gte": start, "$lte": end},
                    "end": {"$gte": start, "$lte": end}
                }
            }
        }
    })
    return existing is not None

def delete_conversations_in_range(start: datetime, end: datetime) -> int:
    """Delete existing conversations and their relationships in a time range."""
    conversations = call_resource("tech.mycelia.mongo", {
        "action": "find",
        "collection": "objects",
        "query": {
            "timeRanges": {
                "$elemMatch": {
                    "start": {"$gte": start, "$lte": end},
                    "end": {"$gte": start, "$lte": end}
                }
            }
        }
    })
    
    if not conversations:
        return 0
    
    conversation_ids = [conv['_id'] for conv in conversations]
    
    call_resource("tech.mycelia.mongo", {
        "action": "deleteMany",
        "collection": "objects",
        "query": {"_id": {"$in": conversation_ids}}
    })
    
    call_resource("tech.mycelia.mongo", {
        "action": "deleteMany",
        "collection": "objects",
        "query": {
            "isRelationship": True,
            "relationship.object": {"$in": conversation_ids}
        }
    })
    
    logger.info(f"Deleted {len(conversation_ids)} existing conversations and their relationships")
    return len(conversation_ids)

def process_conversation_chunk(chunk, tool_llm, system_prompt, model: str = "small", force: bool = False):
    """Process a single conversation chunk and extract conversations."""
    prompt, chunk_start, chunk_end = chunk_to_prompt(chunk)

    dur = int((chunk_end - chunk_start).total_seconds())
    hours = dur // 3600
    minutes = (dur % 3600) // 60
    seconds = (dur % 60)
    dur_str = f'{hours}h {minutes}m {seconds}s' if hours else f'{minutes}m {seconds}s'

    logger.info(f"Processing chunk: {chunk_start.strftime('%Y-%m-%d %H:%M')} -> {chunk_end.strftime('%Y-%m-%d %H:%M')}")
    logger.info(f"Duration: {dur_str}, Length: {len(prompt)} chars")
    
    if not force and check_conversations_exist(chunk_start, chunk_end):
        logger.info("Conversations already exist for this time range, skipping (use --force to recreate)")
        return -1
    
    if force:
        deleted_count = delete_conversations_in_range(chunk_start, chunk_end)
        if deleted_count > 0:
            logger.info(f"Force mode: recreating conversations for this time range")

    try:
        response = tool_llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=prompt)
        ])

        extracted_conversations = []
        if response.tool_calls and len(response.tool_calls) > 0:
            tool_call = response.tool_calls[0]
            extracted_conversations = ExtractConversationsInput.model_validate(tool_call["args"]).conversations
            logger.info(f"Found {len(extracted_conversations)} conversations from tool_calls")
        else:
            logger.error(f"No tool_calls returned from LLM despite tool_choice='extract_conversations'")
            logger.error(f"Response type: {type(response).__name__}, has content: {hasattr(response, 'content')}")

            if hasattr(response, 'content') and response.content:
                logger.warning("Attempting to parse conversations from response content as fallback")
                try:
                    json_match = re.search(r'\[.*\]', response.content, re.DOTALL)
                    if json_match:
                        json_data = json.loads(json_match.group(0))
                        for conv_dict in json_data:
                            try:
                                start_time = conv_dict.get("start_time") or conv_dict.get("start") or datetime.now(pytz.UTC).isoformat()
                                end_time = conv_dict.get("end_time") or conv_dict.get("end") or datetime.now(pytz.UTC).isoformat()
                                entities = conv_dict.get("entities", [])
                                if not entities:
                                    people = conv_dict.get("people", [])
                                    places = conv_dict.get("places", [])
                                    things = conv_dict.get("things", [])
                                    entities = people + places + things
                                if entities and isinstance(entities[0], dict):
                                    entities = [e.get("name", e.get("text", str(e))) for e in entities]
                                extracted_conversations.append(Conversation(
                                    title=conv_dict.get("title", ""),
                                    summary=conv_dict.get("summary", ""),
                                    entities=entities,
                                    start=start_time,
                                    end=end_time,
                                    emoji=conv_dict.get("emoji", "💬")
                                ))
                            except Exception as e:
                                logger.debug(f"Failed to parse conversation: {e}")
                        if extracted_conversations:
                            logger.info(f"Parsed {len(extracted_conversations)} conversations from JSON")
                except Exception as e:
                    logger.debug(f"Failed to parse JSON from content: {e}")

        if not extracted_conversations:
            logger.warning("Attempting to parse conversations from markdown format as fallback")
            try:
                sections = re.split(r'^## ', response.content, flags=re.MULTILINE)
                for section in sections[1:]:
                    try:
                        lines = section.strip().split('\n')
                        title_line = lines[0] if lines else ""

                        start_time = None
                        end_time = None
                        entities_list = []
                        summary_text = ""

                        for i, line in enumerate(lines[1:], 1):
                            if 'Summary:' in line:
                                summary_text = line.split(':', 1)[1].strip() if ':' in line else ""
                            elif 'Start Time:' in line:
                                start_time = line.split(':', 1)[1].strip() if ':' in line else None
                            elif 'End Time:' in line:
                                end_time = line.split(':', 1)[1].strip() if ':' in line else None
                            elif line.strip().startswith('*'):
                                entity = line.strip().replace('*', '').split(':', 1)[0].strip()
                                if entity:
                                    entities_list.append(entity)

                        if title_line and (start_time or end_time):
                            extracted_conversations.append(Conversation(
                                title=title_line,
                                summary=summary_text or "No summary available",
                                entities=entities_list,
                                start=start_time or datetime.now(pytz.UTC).isoformat(),
                                end=end_time or datetime.now(pytz.UTC).isoformat(),
                                emoji="💬"
                            ))
                    except Exception as md_e:
                        logger.debug(f"Failed to parse markdown section: {md_e}")
                if extracted_conversations:
                    logger.info(f"Parsed {len(extracted_conversations)} conversations from markdown")
            except Exception as md_error:
                logger.debug(f"Failed to parse markdown from content: {md_error}")

        if not extracted_conversations:
            logger.error("No conversations found in chunk after all parsing attempts")
            if hasattr(response, 'content') and response.content:
                logger.debug(f"Response content preview: {response.content[:500]}...")
            return 0

        now = datetime.now(pytz.UTC)
        objects_to_create = []
        relationships_to_create = []
        entity_to_id_map = {}  # Track entity names to object IDs

        # Phase 1: Create conversation objects and collect entities
        for conv in extracted_conversations:
            conv_start, conv_end = sorted([utc(conv.start), utc(conv.end)])

            # Create conversation object
            conv_obj = create_conversation_object(conv, conv_start, conv_end, now, model)
            objects_to_create.append(conv_obj)

            # Process entities for this conversation
            for entity_name in conv.entities:
                if not entity_name or not entity_name.strip():
                    continue

                # Track entity for relationship creation
                if entity_name not in entity_to_id_map:
                    entity_to_id_map[entity_name] = None  # Will be filled after object creation

        # Phase 2: Create entity objects
        for entity_name in entity_to_id_map:
            entity_id = find_or_create_entity(entity_name, now)
            entity_to_id_map[entity_name] = entity_id
            logger.info(f"Entity '{entity_name}' -> Object ID: {entity_id}")

        # Phase 3: Batch insert all objects
        conversation_ids = []
        if objects_to_create:
            result = call_resource("tech.mycelia.mongo", {
                "action": "insertMany",
                "collection": "objects",
                "docs": objects_to_create
            })
            conversation_ids = result['insertedIds']
            logger.info(f"Created {len(conversation_ids)} conversation objects")

        # Phase 4: Create relationships
        conv_idx = 0
        for conv in extracted_conversations:
            if conv_idx >= len(conversation_ids):
                logger.warning(f"Conversation {conv_idx} not in conversation_ids")
                break
            conversation_id = conversation_ids[conv_idx]
            conversation_title = conv.title

            # Create "mentioned in" relationships for entities
            for entity_name in conv.entities:
                if not entity_name or not entity_name.strip():
                    continue

                entity_id = entity_to_id_map[entity_name]
                if entity_id is not None: # Only create relationship if entity was found
                    relationship = create_mentioned_relationship(
                        entity_id, conversation_id, entity_name, conversation_title, now
                    )
                    relationships_to_create.append(relationship)

            conv_idx += 1

        # Phase 5: Batch insert relationships
        if relationships_to_create:
            result = call_resource("tech.mycelia.mongo", {
                "action": "insertMany",
                "collection": "objects",
                "docs": relationships_to_create
            })
            logger.info(f"Created {len(result['insertedIds'])} entity mention relationships")

        return len(extracted_conversations)

    except Exception as e:
        logger.error(f"Error processing chunk: {e}")
        return 0

def extract_conversations(limit: Optional[int] = None, not_later_than: Optional[datetime] = None, model: str = "small"):
    """Main function to extract conversations from transcripts."""
    logger.info("=" * 60)
    logger.info("Starting conversation extraction")
    logger.info("=" * 60)

    tool_llm, system_prompt = setup_llm_tools(model)

    processed = 0
    total_conversations = 0
    cursor = not_later_than
    current_bucket = None
    previous_bucket = None
    delta = SCALE_TO_RESOLUTION[scale]

    try:
        conv_iterator = iterate_conversations(cursor)

        for chunk in conv_iterator:
            if limit and processed >= limit:
                logger.info(f"Reached limit of {limit} chunks")
                break

            previous_bucket = current_bucket
            chunk_start = chunk[0]["start"]
            chunk_bucket = date_to_bucket(chunk_start, scale)

            if current_bucket is not None and chunk_bucket < current_bucket:
                bucket_end = current_bucket + delta
                mark_buckets_as("done", "conversations", current_bucket, bucket_end, scale=scale)
                logger.info(f"Marked bucket as done: {current_bucket} -> {bucket_end}")

            current_bucket = chunk_bucket

            conversations_found = process_conversation_chunk(chunk, tool_llm, system_prompt, model)
            total_conversations += conversations_found
            processed += 1
            cursor = chunk_start

            logger.info(f"Processed {processed} chunks, found {total_conversations} total conversations")

        if current_bucket is not None:
            bucket_end = current_bucket + delta
            if previous_bucket != current_bucket and previous_bucket is not None:
                bucketsExited.add(previous_bucket)
                bucketsEntered.add(current_bucket)

                # mark all buckets that had been both entered and exited as done
                for bucket in bucketsEntered & bucketsExited:
                    mark_buckets_as("done", "conversations", bucket, bucket + delta, scale=scale)
                    logger.info(f"Marked bucket as done: {bucket} -> {bucket + delta}")

    except Exception as e:
        logger.error(f"Error in conversation extraction: {e}")
        raise

    logger.info("=" * 60)
    logger.info(f"Conversation extraction complete: {processed} chunks processed, {total_conversations} conversations found")
    logger.info("=" * 60)


def main():
    """Main function with argument parsing."""
    parser = argparse.ArgumentParser(description="Extract conversations from transcripts")
    parser.add_argument('--limit', type=int, default=None, help='Limit number of conversation chunks to process')
    parser.add_argument('--not-later-than', type=int, help='Process transcripts not later than this timestamp')
    parser.add_argument('--model', type=str, choices=['small', 'medium', 'large'], default='small', help='LLM size to use for extraction')
    args = parser.parse_args()

    setup_logging()

    not_later_than = None
    if args.not_later_than:
        try:
            not_later_than = datetime.fromtimestamp(args.not_later_than, tz=pytz.UTC)
        except ValueError:
            logger.error(f"Invalid datetime format: {args.not_later_than}")
            return 1

    try:
        extract_conversations(limit=args.limit, not_later_than=not_later_than, model=args.model)
    except Exception as e:
        logger.exception(f"Error in main: {e}")
        return 1

    return 0

if __name__ == '__main__':
    exit(main())
