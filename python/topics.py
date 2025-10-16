# %%

from typing import Literal
from lib import call_resource
import os

import pytz


from langchain_ollama import OllamaLLM
from datetime import timedelta, datetime


#

# %%

topics_absolute_start = pytz.UTC.localize(datetime(2024, 12, 10, 5, 0))



def get_earliest_hist_without_topics_start(scale: Literal["5min", "1hour", "1day", "1week"], before_time: datetime | None = None):
    if not before_time:
        # Find the latest histogram entry as the upper bound
        latest_hist = call_resource(
            "tech.mycelia.mongo",
            {
                "action": "findOne",
                "collection": f"histogram_{scale}",
                "query": {},
                "options": {"sort": {"start": -1}},
            },
        )
        if not latest_hist:
            return topics_absolute_start
        before_time = latest_hist['start'] + SCALE_TO_RESOLUTION[scale]

    # Find the latest histogram with topics before the given time
    last_hist_with_topics = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": f"histogram_{scale}",
            "query": {
                "start": {
                    "$lt": before_time,
                },
                "topics": {
                    "$exists": True,
                },
            },
            "options": {"sort": {"start": -1}},
        },
    )

    if not last_hist_with_topics:
        # No processed histograms before this time, start from the beginning
        return topics_absolute_start

    # Find the earliest histogram without topics after the last processed one
    next_hist_without_topics = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": f"histogram_{scale}",
            "query": {
                "start": {
                    "$gte": last_hist_with_topics['start'],
                    "$lt": before_time,
                },
                "topics": {
                    "$exists": False,
                },
            },
            "options": {"sort": {"start": 1}},
        },
    )

    if not next_hist_without_topics:
        # No unprocessed histograms in this range, try earlier
        return topics_absolute_start

    return next_hist_without_topics['start']


# get_earliest_hist_without_topics_start("1day")
# %%

SCALE_TO_RESOLUTION = {
    "5min": timedelta(minutes=5),
    "1hour": timedelta(hours=1),
    "1day": timedelta(days=1),
    "1week": timedelta(weeks=1),
}



#%%
from datetime import timedelta
import re
from bisect import bisect_left

from lib.transcription import known_errors, asterisk_pattern, remove_if_lonely

def get_segments(start, scale: Literal["5min", "1hour", "1day", "1week"]):
    transcripts = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "find",
            "collection": "transcriptions",
            "query": {
                "start": {
                    "$gte": start,
                },
                "end": {
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


# %%
from datetime import datetime
import json
import re
import pandas as pd
import matplotlib.pyplot as plt

# %%

from transformers import AutoTokenizer
tokenizer = AutoTokenizer.from_pretrained("google/gemma-3-4b-it")

from functools import lru_cache

@lru_cache(maxsize=10)
def get_num_tokens(text: str) -> int:
    return len(tokenizer.encode(text))

#%%


# %%

def coerce_json(text: str):
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE)
    m = re.search(r"(\{.*\}|\[.*\])", text, flags=re.DOTALL)
    s = m.group(1) if m else text
    s = re.sub(r",\s*([}\]])", r"\1", s)
    return json.loads(s)


def split_segments_into_blocks(segments, scale: Literal["5min", "1hour", "1day", "1week"]):
    blocks = []
    block = []
    block_tokens = 0
    prev = None
    for s in segments:
        if block and (
            s["start"] - max(prev["end"], block[0]["start"]) > SCALE_TO_RESOLUTION[scale]
        ):
            blocks.append(block)
            block = []
            block_tokens = 0
            prev = None
        block_tokens += get_num_tokens(s["text"])
        block.append(s)
        prev = s

    if block:
        blocks.append(block)

    print(f"Split into {len(blocks)} blocks") 
    return blocks


#%%

ollama_machine = os.getenv('OLLAMA_URL')
assert ollama_machine, "OLLAMA_URL is not set"

llm = OllamaLLM(model="gemma3:12b-it-qat", base_url=ollama_machine)

prompt = """
<start_of_turn>user
Only reply like a poet.

What is the answer to life the universe and everything?<end_of_turn>
<start_of_turn>model
"""

llm.invoke(prompt)


# %%


PROMPT = """
<start_of_turn>user
You are an assistant that summarizes long, chaotic human conversations. 
You are given a transcript of about one hour, plus a list of raw topics mentioned.  

Information about the main speaker:
{{
  "name": "Tigor Bakutin",
  "pronouns": "he/him (non-binary person)",
  "location": "Amsterdam, Netherlands",
  "identity": "Refugee, software developer, entrepreneur, artist, member of the Temple of Satan, vegetarian, autistic, dissociative disorder",
  "roles": [
    "Tech lead building privacy-first systems (Mycelia project)",
    "Community organizer in coliving and rationalist spaces",
    "Writer and translator of philosophy",
    "Musician and experimental artist"
  ],
  "values": [
    "Privacy and digital sovereignty",
    "Transhumanism and posthuman identity",
    "Exploring multiple identities and narratives",
    "Deep conversations and authentic relationships"
  ],
  "importance_signals": [
    "Conversations about work, projects, or startups are highly relevant",
    "Interactions with close friends, community members, or collaborators matter a lot",
    "Family conversations are emotionally intense but often painful",
    "Art, music, and philosophical discussions are central to self-expression",
    "Medical and legal matters have high practical importance"
  ]
}}

Transcript:
{transcript}


Instructions:
- Act like a detective: your job is to identify what *actually mattered* during this hour.  
- Focus only on the most important things (decisions, events, insights, conflicts, strong emotions, or meaningful themes).  
- Ignore filler, small talk, repeated phrases, irrelevant chatter.  
- Group related utterances into coherent topics.  
- Content of a book about zorian in never important.
- Global news are never important unless they affect the main speaker.
- For each important topic, give:
  - **name**: a short, clear label (2–8 words).  
  - **description**: a concise explanation of why it was important and what happened.  
- Write in English.  
- Maximum 10 topics. If nothing important happened, return an empty array.  

Output format (strict JSON):
[
    {{
        "name": "Topic Name",
        "importance": int, number between 0 and 100,
        "description": "Description of the topic"
    }},
    ...
]
<end_of_turn>
<start_of_turn>model
"""

def date_to_bucket(date: datetime, scale: Literal["5min", "1hour", "1day", "1week"]) -> datetime:
    step = SCALE_TO_RESOLUTION[scale].total_seconds()
    return datetime.fromtimestamp((date.timestamp() // step) * step)

errors = []

from time import sleep

def render_segments_for_llm(segments):
    return ''.join(s["text"] for s in segments)

scale = "5min"

# Find the latest histogram to determine where to start processing from newest to oldest
latest_hist = call_resource(
    "tech.mycelia.mongo",
    {
        "action": "findOne",
        "collection": f"histogram_{scale}",
        "query": {},
        "options": {"sort": {"start": -1}},
    },
)

if latest_hist:
    current_time = latest_hist['start'] + SCALE_TO_RESOLUTION[scale]
else:
    current_time = topics_absolute_start

# %%
while current_time > topics_absolute_start:
    try:
        print(f"Processing {scale} before {current_time}")
        start = get_earliest_hist_without_topics_start(scale, current_time)
        if start < topics_absolute_start or start >= current_time:
            break

        print(f"Processing interval starting at {start}")
        segments = get_segments(start, scale)

        if segments:
            try:
                topics = coerce_json(
                    llm.invoke(
                        PROMPT.format(transcript=render_segments_for_llm(segments))
                    )
                )
            except Exception as e:
                print(e)
                errors.append((segments, e))
                current_time = start - SCALE_TO_RESOLUTION[scale] + timedelta(seconds=10)
                continue

            print(
                '{}-{}'.format(
                    segments[0]["start"].isoformat(),
                    segments[-1]["end"].isoformat()
                )
            )
        else:
            print("No segments")
            topics = []

        if topics:
            call_resource(
                "tech.mycelia.mongo",
                {
                    "action": "updateOne",
                    "collection": f"histogram_{scale}",
                    "query": {
                        "start": date_to_bucket(start, scale),
                    },
                    "update": {
                        "$addToSet": {
                            "topics": {"$each": list(topics)},
                        },
                    },
                }
            )

        # Move to the previous interval (go backwards in time)
        current_time = start - SCALE_TO_RESOLUTION[scale] + timedelta(seconds=10)

    except Exception as e:
        print(e)
        errors.append((None, e))
        sleep(5)

# %%
