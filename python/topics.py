# %%

import yaml
from bisect import bisect_left
from datetime import timedelta, datetime
from pathlib import Path
from time import sleep
from typing import Literal
import argparse

import pytz
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from lib import call_resource
from lib.llm import get_llm
from lib.transcription import known_errors, asterisk_pattern, remove_if_lonely
from lib.hist import Scale, SCALE_TO_RESOLUTION, date_to_bucket

# %%


# %%


# %%

def find_histogram_without_topics(scale: Scale, no_later_than: datetime | None = None):
    query = {"topics": {"$exists": False}}
    if no_later_than:
        query["start"] = {"$lte": no_later_than}

    return call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": f"histogram_{scale}",
            "query": query,
            "options": {"sort": {"start": -1}},
        },
    )


def find_latest_transcript(no_later_than: datetime | None = None):
    query = {}
    if no_later_than:
        query["start"] = {"$lt": no_later_than}

    return call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": "transcriptions",
            "query": query,
            "options": {"sort": {"start": -1}},
        },
    )

def find_next_interval_without_topics(scale: Scale, no_later_than: datetime | None = None) -> datetime | None:
    cursor = no_later_than
    while True:
        hist = find_histogram_without_topics(scale, cursor)
        cursor = hist["start"] + SCALE_TO_RESOLUTION[scale]
        transcript = find_latest_transcript(cursor)
        if not transcript:
            # no transcript earlier than the current cursor
            return None
        if transcript["start"] < hist["start"]:
            # transcript is in the past
            cursor = transcript["start"]
            continue

        return hist["start"]
        # we found the next interval without topics but with transcript

find_next_interval_without_topics("5min")
#%%

def get_segments(start, scale: Scale):
    transcripts = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "find",
            "collection": "transcriptions",
            "query": {
                "start": {
                    "$gte": start,
                    "$lte": date_to_bucket(start + SCALE_TO_RESOLUTION[scale], scale),
                },
            },
            "options": {
                "sort": {"start": 1},
                "limit": max(10000, SCALE_TO_RESOLUTION[scale].total_seconds()),
            },
        },
    )
    segments = []

    for transcript in transcripts:
        for s in transcript["segments"]:
            if s["text"].strip() in known_errors or asterisk_pattern.match(s["text"].strip()):
                continue
            segments.append({
                'start': transcript["start"] + timedelta(seconds=s["start"]),
                'end': transcript["start"] + timedelta(seconds=s["end"]),
                'text': s["text"].replace("\n", " "),
            })
            if s["text"].strip() in remove_if_lonely:
                segments[-1]['suspect'] = True

    segments = sorted(segments, key=lambda x: x["start"])

    non_suspect_times = [seg["start"] for seg in segments if not seg.get("suspect")]
    filtered_segments = []
    for seg in segments:
        if seg.get("suspect"):
            if not non_suspect_times:
                continue
            i = bisect_left(non_suspect_times, seg["start"])
            if i == 0:
                nearest = non_suspect_times[0]
            elif i == len(non_suspect_times):
                nearest = non_suspect_times[-1]
            else:
                before = non_suspect_times[i - 1]
                after = non_suspect_times[i]
                nearest = before if (seg["start"] - before) <= (after - seg["start"]) else after
            if abs((seg["start"] - nearest).total_seconds()) > 20:
                continue
        filtered_segments.append(seg)
    segments = filtered_segments

    return segments

#%%



def split_segments_into_blocks(segments, scale: Scale):
    blocks = []
    block = []
    prev = None
    for s in segments:
        if block and (
            s["start"] - max(prev["end"], block[0]["start"]) > SCALE_TO_RESOLUTION[scale]
        ):
            blocks.append(block)
            block = []
            prev = None
        block.append(s)
        prev = s

    if block:
        blocks.append(block)

    print(f"Split into {len(blocks)} blocks")
    return blocks

#%%

class Topic(BaseModel):
    name: str = Field(description="A short, clear label (2–8 words)")
    importance: int = Field(description="Number between 0 and 100")
    description: str = Field(description="Concise explanation of why it was important and what happened")

class ExtractTopicsInput(BaseModel):
    topics: list[Topic] = Field(description="List of important topics from the transcript. Return empty list if nothing important happened.")


extract_topics_tool = {
    "name": "extract_topics",
    "description": "Extract and return the most important topics from the conversation transcript",
    "parameters": ExtractTopicsInput.model_json_schema()
}

tool_llm = get_llm("small").bind_tools([extract_topics_tool], tool_choice="extract_topics")

prompts_path = Path(__file__).parent / "prompts.yml"
with open(prompts_path, "r") as f:
    prompts = yaml.safe_load(f)

SYSTEM_PROMPT = prompts["topics"]["system"]

errors = []

def render_segments_for_llm(segments):
    return ''.join(s["text"] for s in segments)

scale = "5min"

def run(model: Literal["small", "medium", "large"]) -> None:
    global tool_llm
    tool_llm = get_llm(model).bind_tools([extract_topics_tool], tool_choice="extract_topics")
    while True:
        try:
            current_time = find_next_interval_without_topics(scale)

            if current_time is None:
                print("No intervals without topics found, waiting...")
                sleep(5)
                continue

            segments = get_segments(current_time, scale)
            print(f"Processing interval starting at {current_time} with {len(segments)} segments")

            topics = []
            if segments:
                response = tool_llm.invoke([
                    SystemMessage(content=SYSTEM_PROMPT),
                    HumanMessage(content=render_segments_for_llm(segments))
                ])
                if response.tool_calls:
                    tool_call = response.tool_calls[0]
                    extracted_topics = ExtractTopicsInput.model_validate(tool_call["args"])
                    topics = [topic.model_dump() for topic in extracted_topics.topics]
                print(f"Found {len(topics)} topics for {segments[0]['start'].isoformat()} - {segments[-1]['end'].isoformat()}")
            else:
                print("No segments in interval, marking as processed with zero topics")

            call_resource(
                "tech.mycelia.mongo",
                {
                    "action": "updateOne",
                    "collection": f"histogram_{scale}",
                    "query": {"start": date_to_bucket(current_time, scale)},
                    "update": {"$set": {"topics": topics}},
                }
            )

        except Exception as e:
            print(f"Error in main loop: {e}")
            errors.append(e)
            sleep(5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract important topics for histogram intervals")
    parser.add_argument("--model", choices=["small", "medium", "large"], default="small")
    args = parser.parse_args()
    run(args.model)
