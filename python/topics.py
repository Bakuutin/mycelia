# %%

from lib import call_resource

import pytz


from langchain_ollama import OllamaLLM
from datetime import timedelta, datetime
#

# %%

def get_latest_hist_5m_with_topics_start():
    last_hist_5m_with_topics = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": "histogram_5min",
            "query": {
                "start": {
                    "$gte": pytz.UTC.localize(datetime(2024, 12, 10, 5, 0)),
                },
                "topics": {
                    "$exists": True,
                },
            },
            "options": {"sort": {"start": -1}},
        },
    )

    last_hist_5m_no_topics = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": "histogram_5min",
            "query": {
                "start": {
                    "$gte": last_hist_5m_with_topics['start']
                },
                "topics": {
                    "$exists": False,
                },
            },
            "options": {"sort": {"start": 1}},
        },
    )


    return last_hist_5m_no_topics['start']


get_latest_hist_5m_with_topics_start()
# %%



#%%
from datetime import timedelta
import re
from bisect import bisect_left

known_errors = {
    'Продолжение следует...',
    '.',
    '...',
    'Субтитры сделал DimaTorzok',
    '*',
    'おやすみなさい。',
    '*sad breathing*',
    '*mimics*',
    '- Mm.',
    '- Oh.',
    '- Yeah.',
    'И...',
    'uh',
    'Ну...',
    '-',
}


asterisk_pattern = re.compile(r'^\*.*\*$')

remove_if_lonely = {
    'Thank you.',
    "I'm sorry.",
    'Okay.',
    'All right.',
    'Спасибо.',
    'Дякую.',
    'Gracias.',
    'Obrigado.',
    'Dziękuję.',
}


def get_segments(start):
    transcripts = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "find",
            "collection": "transcriptions",
            "query": {
                "start": {
                    "$gte": start,
                }
            },
            "options": {
                "sort": {"start": 1},
                "limit": 1000,
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


def split_segments_into_blocks(segments):
    blocks = []
    block = []
    block_tokens = 0
    prev = None
    for s in segments:
        if block and (
            s["start"] - prev["end"] > timedelta(minutes=5) or
            block_tokens + get_num_tokens(s["text"]) > 5000 or
            prev and s["start"] - block[0]["start"] > timedelta(minutes=5)
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

ollama_machine = 'http://localhost:4444/'

llm = OllamaLLM(model="gemma3:27b-it-qat", base_url=ollama_machine)

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
You are segmenting a transcript into semantic topics.
You are given a transcript. Read it. Extract all distinct topics mentioned.
Transcript:
{transcript}

Instructions:
Use descriptive topic names 2-10 words long.
i.e "Sad Feelings" not "Emotional state of the speaker"
Be very specific so it is easy to understand what was said.

Use english language.

Ignore
    - filler words
    - greetings and farewell statements
    - expressions of gratitude
    - random vocalizations

Maximum 10 topics. If there are no topics, return an empty array.

Use strict JSON format:
[
    "Topic 1",
    "Topic 2",
    ...
]
<end_of_turn>
<start_of_turn>model
"""



def render_segments_for_llm(segments):
    return ''.join(s["text"] for s in segments)



def date_to_5m_bucket(date: datetime) -> datetime:
    return datetime(date.year, date.month, date.day, date.hour, date.minute // 5 * 5)

errors = []

from time import sleep


while True:
    try:
        start = get_latest_hist_5m_with_topics_start()
        segments = get_segments(start)
        blocks = split_segments_into_blocks(segments)

        for block in blocks:
            try:
                topics = coerce_json(
                    llm.invoke(
                        PROMPT.format(transcript=render_segments_for_llm(block))
                    )
                )
            except Exception as e:
                print(e)
                errors.append((block, e))
                continue
            print(
                '{}-{}'.format(
                    block[0]["start"].strftime("%H:%M:%S"),
                    block[-1]["end"].strftime("%H:%M:%S")
                )
            )
            print(topics)
            if topics:
                call_resource(
                    "tech.mycelia.mongo",
                    {
                        "action": "updateOne",
                        "collection": "histogram_5min",
                        "query": {
                            "start": date_to_5m_bucket(block[0]["start"]),
                        },
                        "update": {
                            "$addToSet": {
                                "topics": {"$each": list(topics)},
                            },
                        },
                    }
                )
    except Exception as e:
        print(e)
        errors.append((None, e))
        sleep(10)
