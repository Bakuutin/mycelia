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
                    "start": {"$lt": end},
                    "end": {"$gt": start}
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
                    "start": {"$lt": end},
                    "end": {"$gt": start}
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
                logger.debug(f"Response content length: {len(response.content)} chars")
                logger.debug(f"Response content preview (first 500 chars):\n{response.content[:500]}")
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
                logger.debug(f"Found {len(sections)} markdown sections (including header)")

                for idx, section in enumerate(sections[1:], 1):
                    try:
                        lines = section.strip().split('\n')
                        section_title = lines[0].split(':')[0].strip() if lines else ""
                        logger.debug(f"Section {idx} header: {section_title[:50]}...")

                        title = None
                        start_time = None
                        end_time = None
                        entities_list = []
                        summary_text = ""
                        in_entities = False
                        in_summary = False

                        for line in lines:
                            stripped = line.strip()

                            # Extract times first (check before other patterns)
                            if '**Start:**' in line:
                                start_match = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})', line)
                                if start_match:
                                    start_time = start_match.group(1)
                                    logger.debug(f"Extracted start time: {start_time}")
                                else:
                                    logger.debug(f"Found **Start:** but couldn't extract time from: {line[:100]}")
                            elif '**End:**' in line:
                                end_match = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})', line)
                                if end_match:
                                    end_time = end_match.group(1)
                                    logger.debug(f"Extracted end time: {end_time}")
                                else:
                                    logger.debug(f"Found **End:** but couldn't extract time from: {line[:100]}")
                            elif '**Title:**' in line:
                                title = line.split('**Title:**', 1)[1].strip()
                            elif '**Time:**' in line:
                                time_part = line.split('**Time:**', 1)[1].strip()
                                time_match = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\s+to\s+[~]?(\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})', time_part)
                                if time_match:
                                    start_time = time_match.group(1)
                                    end_part = time_match.group(2)
                                    if 'T' in end_part:
                                        end_time = end_part
                                    else:
                                        start_date = start_time.split('T')[0]
                                        end_time = f"{start_date}T{end_part}"
                            elif '**Summary:**' in line:
                                in_summary = True
                                in_entities = False
                                summary_start = line.split('**Summary:**', 1)[1].strip()
                                if summary_start:
                                    summary_text = summary_start
                            elif '**Key Entities:**' in line:
                                in_entities = True
                                in_summary = False
                            elif in_summary and stripped and not stripped.startswith('**'):
                                summary_text += " " + stripped
                            elif in_entities and (stripped.startswith('-') or stripped.startswith('*')):
                                entity_match = re.match(r'^[-*]\s+(?:People|Topics|Actions|Distance|Time|Activities|Location|Locations mentioned):\s*(.+)', stripped)
                                if entity_match:
                                    entity_text = entity_match.group(1)
                                    entities = [e.strip() for e in entity_text.split(',')]
                                    entities_list.extend(entities)

                        if not title:
                            title = section_title

                        if title and (start_time or end_time):
                            conv_start = start_time or chunk_start.isoformat()
                            conv_end = end_time or chunk_end.isoformat()

                            extracted_conversations.append(Conversation(
                                title=title,
                                summary=summary_text.strip() if summary_text else "No summary available",
                                entities=entities_list[:10],
                                start=conv_start,
                                end=conv_end,
                                emoji="💬"
                            ))
                            logger.debug(f"Extracted conversation: {title}")
                        else:
                            logger.debug(f"Skipped section - missing title or times. Title: {title}, Start: {start_time}, End: {end_time}")
                    except Exception as md_e:
                        logger.debug(f"Failed to parse markdown section {idx}: {md_e}", exc_info=True)
                if extracted_conversations:
                    logger.info(f"Parsed {len(extracted_conversations)} conversations from markdown")
                else:
                    logger.warning("Markdown parsing found 0 conversations")
            except Exception as md_error:
                logger.warning(f"Failed to parse markdown from content: {md_error}", exc_info=True)

        if not extracted_conversations:
            logger.error("No conversations found in chunk after all parsing attempts")
            if hasattr(response, 'content') and response.content:
                debug_file = os.path.expanduser('~/Library/mycelia/logs/llm_response_debug.txt')
                try:
                    with open(debug_file, 'w') as f:
                        f.write(f"Timestamp: {datetime.now(pytz.UTC).isoformat()}\n")
                        f.write(f"Model: {model}\n")
                        f.write(f"Response Type: {type(response).__name__}\n")
                        f.write(f"Has tool_calls: {hasattr(response, 'tool_calls') and bool(response.tool_calls)}\n")
                        f.write(f"Content Length: {len(response.content)}\n")
                        f.write("\n" + "="*80 + "\n")
                        f.write("FULL RESPONSE CONTENT:\n")
                        f.write("="*80 + "\n\n")
                        f.write(response.content)
                    logger.error(f"Saved full LLM response to {debug_file} for inspection")
                except Exception as e:
                    logger.debug(f"Failed to save debug file: {e}")
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
            inserted_ids = result.get('insertedIds', {})
            if not inserted_ids:
                logger.error(f"insertMany returned no insertedIds. Result: {result}")
                return 0

            if isinstance(inserted_ids, dict):
                conversation_ids = [inserted_ids[i] for i in sorted(inserted_ids.keys())]
            elif isinstance(inserted_ids, list):
                conversation_ids = inserted_ids
            else:
                logger.error(f"Unexpected insertedIds type: {type(inserted_ids)}. Value: {inserted_ids}")
                return 0

            logger.info(f"Created {len(conversation_ids)} conversation objects")

        # Phase 4: Create relationships
        if len(extracted_conversations) != len(conversation_ids):
            logger.error(f"Mismatch: {len(extracted_conversations)} conversations extracted but {len(conversation_ids)} IDs returned")
            return 0

        conv_idx = 0
        for conv in extracted_conversations:
            if conv_idx >= len(conversation_ids):
                logger.warning(f"Conversation {conv_idx} not in conversation_ids (total: {len(conversation_ids)})")
                break
            conversation_id = conversation_ids[conv_idx]
            conversation_title = conv.title

            # Create "mentioned in" relationships for entities
            for entity_name in conv.entities:
                if not entity_name or not entity_name.strip():
                    continue

                entity_id = entity_to_id_map.get(entity_name)
                if entity_id is not None:
                    relationship = create_mentioned_relationship(
                        entity_id, conversation_id, entity_name, conversation_title, now
                    )
                    relationships_to_create.append(relationship)
                else:
                    logger.warning(f"Entity '{entity_name}' not found in entity_to_id_map")

            conv_idx += 1

        # Phase 5: Batch insert relationships
        if relationships_to_create:
            logger.debug(f"Creating {len(relationships_to_create)} relationships")
            result = call_resource("tech.mycelia.mongo", {
                "action": "insertMany",
                "collection": "objects",
                "docs": relationships_to_create
            })
            inserted_ids = result.get('insertedIds', {})
            if isinstance(inserted_ids, dict):
                inserted_count = len(inserted_ids)
            elif isinstance(inserted_ids, list):
                inserted_count = len(inserted_ids)
            else:
                inserted_count = 0
            logger.info(f"Created {inserted_count} entity mention relationships")

        return len(extracted_conversations)

    except Exception as e:
        logger.error(f"Error processing chunk: {type(e).__name__}: {e}", exc_info=True)
        return 0

def extract_conversations(limit: Optional[int] = None, not_later_than: Optional[datetime] = None, model: str = "small", force: bool = False):
    """Main function to extract conversations from transcripts."""
    logger.info("=" * 60)
    logger.info("Starting conversation extraction")
    if force:
        logger.info("Force mode enabled: will recreate existing conversations")
    logger.info("=" * 60)

    tool_llm, system_prompt = setup_llm_tools(model)

    processed = 0
    skipped = 0
    total_conversations = 0
    cursor = not_later_than
    delta = SCALE_TO_RESOLUTION[scale]

    bucket_ranges = {}

    try:
        conv_iterator = iterate_conversations(cursor)

        for chunk in conv_iterator:
            if limit and processed >= limit:
                logger.info(f"Reached limit of {limit} chunks")
                break

            chunk_start = chunk[0]["start"]
            chunk_end = chunk[-1]["end"]
            chunk_bucket = date_to_bucket(chunk_start, scale)

            conversations_found = process_conversation_chunk(chunk, tool_llm, system_prompt, model, force)

            if conversations_found == -1:
                skipped += 1
                logger.debug(f"Skipped chunk in bucket {chunk_bucket}")
            else:
                total_conversations += conversations_found
                processed += 1

                if chunk_bucket not in bucket_ranges:
                    bucket_ranges[chunk_bucket] = {"start": chunk_start, "end": chunk_end}
                else:
                    bucket_ranges[chunk_bucket]["start"] = min(bucket_ranges[chunk_bucket]["start"], chunk_start)
                    bucket_ranges[chunk_bucket]["end"] = max(bucket_ranges[chunk_bucket]["end"], chunk_end)

            cursor = chunk_start

            if (processed + skipped) % 10 == 0:
                logger.info(f"Progress: {processed} processed, {skipped} skipped, {total_conversations} conversations found")

        for bucket, range_info in bucket_ranges.items():
            bucket_end = bucket + delta
            mark_buckets_as("done", "conversations", bucket, bucket_end, scale=scale)
            logger.info(f"Marked bucket as done: {bucket.strftime('%Y-%m-%d %H:%M')} -> {bucket_end.strftime('%Y-%m-%d %H:%M')}")

    except Exception as e:
        logger.error(f"Error in conversation extraction: {e}")
        raise

    logger.info("=" * 60)
    logger.info(f"Conversation extraction complete:")
    logger.info(f"  - Chunks processed: {processed}")
    logger.info(f"  - Chunks skipped: {skipped}")
    logger.info(f"  - Conversations found: {total_conversations}")
    logger.info(f"  - Buckets marked done: {len(bucket_ranges)}")
    logger.info("=" * 60)


def main():
    """Main function with argument parsing."""
    parser = argparse.ArgumentParser(
        description="Extract conversations from transcripts",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process new conversations only (skip existing)
  uv run python/convos.py --limit 10

  # Force recreation of all conversations
  uv run python/convos.py --limit 10 --force

  # Process from a specific timestamp
  uv run python/convos.py --not-later-than 1699564800
        """
    )
    parser.add_argument('--limit', type=int, default=None, help='Limit number of conversation chunks to process')
    parser.add_argument('--not-later-than', type=int, help='Process transcripts not later than this timestamp')
    parser.add_argument('--model', type=str, choices=['small', 'medium', 'large'], default='small', help='LLM size to use for extraction')
    parser.add_argument('--force', action='store_true', help='Force recreation of existing conversations (deletes and recreates)')
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
        extract_conversations(
            limit=args.limit,
            not_later_than=not_later_than,
            model=args.model,
            force=args.force
        )
    except Exception as e:
        logger.exception(f"Error in main: {e}")
        return 1

    return 0

if __name__ == '__main__':
    exit(main())
