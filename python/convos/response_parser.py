from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, List

from .logger import logger
from .models import Conversation, ExtractConversationsInput


def parse_tool_calls(response: Any) -> List[Conversation]:
    tool_calls = getattr(response, "tool_calls", None)
    if not tool_calls:
        return []
    try:
        tool_call = tool_calls[0]
        conversations = ExtractConversationsInput.model_validate(tool_call["args"]).conversations
        logger.info(f"Found {len(conversations)} conversations from tool_calls")
        return conversations
    except Exception as exc:
        logger.error(f"Failed to parse tool call response: {exc}", exc_info=True)
        return []


def parse_json_content(content: str) -> List[Conversation]:
    try:
        json_match = re.search(r"\[.*\]", content, re.DOTALL)
        if not json_match:
            return []
        data = json.loads(json_match.group(0))
    except Exception as exc:
        logger.debug(f"Failed to parse JSON from content: {exc}")
        return []

    conversations: List[Conversation] = []
    for conv_dict in data:
        try:
            start_time = conv_dict.get("start_time") or conv_dict.get("start") or datetime.now(timezone.utc).isoformat()
            end_time = conv_dict.get("end_time") or conv_dict.get("end") or datetime.now(timezone.utc).isoformat()
            entities = conv_dict.get("entities", [])
            if not entities:
                people = conv_dict.get("people", [])
                places = conv_dict.get("places", [])
                things = conv_dict.get("things", [])
                entities = people + places + things
            if entities and isinstance(entities[0], dict):
                entities = [entry.get("name", entry.get("text", str(entry))) for entry in entities]
            conversations.append(
                Conversation(
                    title=conv_dict.get("title", ""),
                    summary=conv_dict.get("summary", ""),
                    entities=entities,
                    start=start_time,
                    end=end_time,
                    emoji=conv_dict.get("emoji", "💬"),
                )
            )
        except Exception as exc:
            logger.debug(f"Failed to parse conversation from JSON: {exc}")

    if conversations:
        logger.info(f"Parsed {len(conversations)} conversations from JSON")
    return conversations


def parse_markdown_content(content: str, chunk_start: datetime, chunk_end: datetime) -> List[Conversation]:
    try:
        sections = re.split(r"^## ", content, flags=re.MULTILINE)
    except re.error as exc:
        logger.warning(f"Failed to parse markdown: {exc}")
        return []

    conversations: List[Conversation] = []
    for section in sections[1:]:
        try:
            lines = section.strip().split("\n")
            section_title = lines[0].split(":")[0].strip() if lines else ""
            title = None
            start_time = None
            end_time = None
            entities_list: List[str] = []
            summary_text = ""
            in_entities = False
            in_summary = False

            for line in lines:
                stripped = line.strip()
                if "**Start:**" in line:
                    match = re.search(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", line)
                    if match:
                        start_time = match.group(1)
                elif "**End:**" in line:
                    match = re.search(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", line)
                    if match:
                        end_time = match.group(1)
                elif "**Title:**" in line:
                    title = line.split("**Title:**", 1)[1].strip()
                elif "**Time:**" in line:
                    time_part = line.split("**Time:**", 1)[1].strip()
                    match = re.search(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\s+to\s+[~]?(\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", time_part)
                    if match:
                        start_time = match.group(1)
                        end_part = match.group(2)
                        if "T" in end_part:
                            end_time = end_part
                        else:
                            start_date = start_time.split("T")[0]
                            end_time = f"{start_date}T{end_part}"
                elif "**Summary:**" in line:
                    in_summary = True
                    in_entities = False
                    summary_start = line.split("**Summary:**", 1)[1].strip()
                    if summary_start:
                        summary_text = summary_start
                elif "**Key Entities:**" in line:
                    in_entities = True
                    in_summary = False
                elif in_summary and stripped and not stripped.startswith("**"):
                    summary_text += f" {stripped}"
                elif in_entities and (stripped.startswith("-") or stripped.startswith("*")):
                    match = re.match(
                        r"^[-*]\s+(?:People|Topics|Actions|Distance|Time|Activities|Location|Locations mentioned):\s*(.+)",
                        stripped,
                    )
                    if match:
                        entity_text = match.group(1)
                        parts = [entry.strip() for entry in entity_text.split(",")]
                        entities_list.extend(parts)

            if not title:
                title = section_title

            if title and (start_time or end_time):
                conv_start = start_time or chunk_start.isoformat()
                conv_end = end_time or chunk_end.isoformat()
                conversations.append(
                    Conversation(
                        title=title,
                        summary=summary_text.strip() if summary_text else "No summary available",
                        entities=entities_list[:10],
                        start=conv_start,
                        end=conv_end,
                        emoji="💬",
                    )
                )
        except Exception as exc:
            logger.debug(f"Failed to parse markdown section: {exc}", exc_info=True)

    if conversations:
        logger.info(f"Parsed {len(conversations)} conversations from markdown")
    else:
        logger.warning("Markdown parsing found 0 conversations")
    return conversations


def extract_conversations_from_response(response: Any, chunk_start: datetime, chunk_end: datetime) -> List[Conversation]:
    conversations = parse_tool_calls(response)
    if conversations:
        return conversations

    content = getattr(response, "content", None)
    if not content:
        return []

    conversations = parse_json_content(content)
    if conversations:
        return conversations

    return parse_markdown_content(content, chunk_start, chunk_end)


__all__ = [
    "extract_conversations_from_response",
    "parse_json_content",
    "parse_markdown_content",
    "parse_tool_calls",
]
