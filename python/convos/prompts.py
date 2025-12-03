"""Prompt formatting for conversation extraction."""

from datetime import timedelta
from pathlib import Path
from bson import ObjectId

from convos.utils import get_silence_message, get_timestamp_message
from lib.resources import call_resource


SERVER_CONFIG_ID = ObjectId("000000000000000000000000")


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


def get_prompts():
    config = call_resource("mongo", {
        "action": "findOne",
        "collection": "configs",
        "query": {"_id": SERVER_CONFIG_ID}
    })

    if not config or not config.get("prompts"):
        raise RuntimeError("Server configuration not found or missing prompts mapping")

    prompt_ids = list(config["prompts"].values())

    prompts_list = call_resource("mongo", {
        "action": "find",
        "collection": "prompts",
        "query": {"_id": {"$in": prompt_ids}}
    })

    prompts_map = {p["_id"]: p for p in prompts_list}

    result = {}
    for key, prompt_id in config["prompts"].items():
        if prompt_id in prompts_map:
            result[key] = prompts_map[prompt_id]["text"]
            
    return result
