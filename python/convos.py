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

from lib import call_resource
from lib.llm import small_llm

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


def get_cursor_position(not_later_than: datetime | None = None) -> datetime:
    # check histogram_1d, find the latest one without converstaions.extracted_at 
    query = {"conversations": {"$exists": False}}
    if not_later_than:
        query["start"] = {"$lte": not_later_than}
    
    result = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": "histogram_1d",
            "query": query,
            "options": {"sort": {"start": -1}},
        }
    )

    if not result:
        return None

    return result["start"] + timedelta(days=1)

def iterate_transcripts(not_later_than: datetime | None = None, batch_size: int = 100):
    """
    Iterate through all transcripts in reverse chronological order.
    Yields one transcript at a time.
    """
    cursor = not_later_than or datetime.now(pytz.UTC) + timedelta(days=1)
    # cursor = get_cursor_position(not_later_than)
    while cursor:
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

def setup_llm_tools():
    """Setup LLM tools and prompts for conversation extraction."""
    extract_conversations_tool = {
        "name": "extract_conversations",
        "description": "Extract and return the conversations from the transcript",
        "parameters": ExtractConversationsInput.model_json_schema()
    }

    tool_llm = small_llm.bind_tools([extract_conversations_tool], tool_choice="extract_conversations")

    prompts_path = Path(__file__).parent / "prompts.yml"
    with open(prompts_path, "r") as f:
        prompts = yaml.safe_load(f)

    system_prompt = prompts["topics"]["system"]
    
    return tool_llm, system_prompt

def process_conversation_chunk(chunk, tool_llm, system_prompt):
    """Process a single conversation chunk and extract conversations."""
    prompt, chunk_start, chunk_end = chunk_to_prompt(chunk)

    dur = int((chunk_end - chunk_start).total_seconds())
    hours = dur // 3600
    minutes = (dur % 3600) // 60
    seconds = (dur % 60)
    dur_str = f'{hours}h {minutes}m {seconds}s' if hours else f'{minutes}m {seconds}s'

    logger.info(f"Processing chunk: {chunk_start.strftime('%Y-%m-%d %H:%M')} -> {chunk_end.strftime('%Y-%m-%d %H:%M')}")
    logger.info(f"Duration: {dur_str}, Length: {len(prompt)} chars")

    try:
        response = tool_llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=prompt)
        ])

        if response.tool_calls:
            tool_call = response.tool_calls[0]
            extracted_conversations = ExtractConversationsInput.model_validate(tool_call["args"]).conversations
            logger.info(f"Found {len(extracted_conversations)} conversations")
            
            for conv in extracted_conversations:
                conv_start, conv_end = sorted([utc(conv.start), utc(conv.end)])
                
                now = datetime.now(pytz.UTC)
                
                call_resource(
                    "tech.mycelia.mongo",
                    {
                        "action": "insertOne",
                        "collection": "conversations",
                        "doc": {
                            "title": conv.title,
                            "summary": conv.summary,
                            "entities": conv.entities,
                            "icon": {
                                "text": conv.emoji,
                            },
                            "timeRanges": [
                                {
                                    "start": conv_start,
                                    "end": conv_end,
                                }
                            ],
                            "createdAt": now,
                            "updatedAt": now,
                        },
                    }
                )
            return len(extracted_conversations)
        else:
            logger.info("No conversations found in chunk")
            return 0
            
    except Exception as e:
        logger.error(f"Error processing chunk: {e}")
        return 0

def extract_conversations(limit: Optional[int] = None, not_later_than: Optional[datetime] = None):
    """Main function to extract conversations from transcripts."""
    logger.info("=" * 60)
    logger.info("Starting conversation extraction")
    logger.info("=" * 60)

    tool_llm, system_prompt = setup_llm_tools()
    
    processed = 0
    total_conversations = 0
    cursor = not_later_than

    try:
        conv_iterator = iterate_conversations(cursor)
        
        for chunk in conv_iterator:
            if limit and processed >= limit:
                logger.info(f"Reached limit of {limit} chunks")
                break
                
            conversations_found = process_conversation_chunk(chunk, tool_llm, system_prompt)
            total_conversations += conversations_found
            processed += 1
            cursor = chunk[0]["start"]  # Update cursor to earliest transcript in chunk
            
            logger.info(f"Processed {processed} chunks, found {total_conversations} total conversations")
            
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
    parser.add_argument('--not-later-than', type=str, help='Process transcripts not later than this ISO datetime')
    args = parser.parse_args()
    
    setup_logging()
    
    not_later_than = None
    if args.not_later_than:
        try:
            not_later_than = datetime.fromisoformat(args.not_later_than)
        except ValueError:
            logger.error(f"Invalid datetime format: {args.not_later_than}")
            return 1
    
    try:
        extract_conversations(limit=args.limit, not_later_than=not_later_than)    
    except Exception as e:
        logger.exception(f"Error in main: {e}")
        return 1
    
    return 0

if __name__ == '__main__':
    exit(main())
