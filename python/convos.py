#%%
from datetime import timedelta, datetime
from lib import call_resource
from lib.llm import small_llm # ChatOpenAI 
import pytz


#%%


def iterate_transcripts(not_later_than: datetime | None = None, batch_size: int = 100):
    """
    Goes through all transcripts in reverse chronological order, yielding one transcript at a time.
    """
    cursor = not_later_than or datetime.now(pytz.UTC) + timedelta(days=1)
    while True:
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
        print(f"Fetched {len(transcripts)} transcripts")
        while True:
            # edge case if the last few transcripts have the same timestamp
            if len(transcripts) < 2:
                return
            if transcripts[-1]["start"] == transcripts[-2]["start"]:
                transcripts = transcripts[:-1]
            else:
                cursor = transcripts[-1]["start"]
                break
        for transcript in transcripts:
            yield {
                'start': transcript["start"],
                'end': transcript["end"],
                'text': ''.join(s["text"] for s in transcript["segments"]).strip(),
            }
            


#%%

transcript_iterator = iterate_transcripts()

next(transcript_iterator)

#%%


def allowed_gap(length: int) -> timedelta:
    if length < 500:
        return timedelta(minutes=45)
    elif length < 20000:
        return timedelta(minutes=5)
    else:
        return timedelta(seconds=40)

def get_silence_message(gap: timedelta) -> str:
    m = gap.total_seconds() / 60
    s = gap.total_seconds() % 60
    return f'silence for {m:.0f}m {s:.0f}s'

def get_timestamp_message(timestamp: datetime) -> str:
    return f'time: {utc(timestamp).isoformat()}'


def iterate_conversations(
    not_later_than: datetime | None = None,
):

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
# %%


#%%
# %%
# %%
a = int(datetime.fromisoformat('2025-10-05T17:15:45.000+00:00').timestamp())
b = int(datetime.fromisoformat('2025-10-05T19:13:36.000+00:00').timestamp())

a, b
# %%

from pydantic import BaseModel, Field
from typing import List
from pathlib import Path
import yaml
from langchain_core.messages import SystemMessage, HumanMessage


def utc(dt: datetime | int) -> datetime:
    if isinstance(dt, int):
        dt = datetime.fromtimestamp(dt)
    if dt.tzinfo is None:
        return pytz.UTC.localize(dt)
    return dt.astimezone(pytz.UTC)



class Conversation(BaseModel):
    title: str = Field(description="Descriptive title for the conversation")
    summary: str = Field(description="Summary of what was discussed, key points, decisions, outcomes, etc.")
    entities: List[str] = Field(default_factory=list, description="People, places, things mentioned")
    start: datetime = Field(description="ISO 8601 timestamp when conversation started")
    end: datetime = Field(description="ISO 8601 timestamp when conversation ended")
    emoji: str = Field(description="Single emoji representing the conversation")


class ExtractConversationsInput(BaseModel):
    conversations: List[Conversation] = Field(description="List of conversations extracted from the transcript")

extract_conversations_tool = {
    "name": "extract_conversations",
    "description": "Extract and return the conversations from the transcript",
    "parameters": ExtractConversationsInput.model_json_schema()
}

tool_llm = small_llm.bind_tools([extract_conversations_tool], tool_choice="extract_conversations")

prompts_path = Path(__file__).parent / "prompts.yml"
with open(prompts_path, "r") as f:
    prompts = yaml.safe_load(f)

SYSTEM_PROMPT = prompts["topics"]["system"]

#%%
errors = []

cursor = None

#%%


conv_iterator = iterate_conversations(cursor)

#%%

def chunk_to_prompt(chunk: list[dict]):
    earliest = chunk[0]["start"]
    latest = chunk[0]["end"]
    strings = [
        get_timestamp_message(earliest),
    ]

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


i = 0
while True:
    i += 1
    if i > 1:
        break
    chunk = next(conv_iterator)


    prompt, chunk_start, chunk_end = chunk_to_prompt(chunk)

    dur = int((chunk_end - chunk_start).total_seconds())
    hours = dur // 3600
    minutes = (dur % 3600) // 60
    seconds = (dur % 60)
    dur_str = f'{hours}h {minutes}m {seconds}s' if hours else f'{minutes}m {seconds}s'

    print(chunk_start.strftime('%Y-%m-%d %H:%M'), '->', chunk_end.strftime('%Y-%m-%d %H:%M'))
    print('duration', dur_str, 'len', len(prompt), 'chars')

    response = tool_llm.invoke([
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=prompt)
    ])

    if response.tool_calls:
        tool_call = response.tool_calls[0]
        extracted_conversations = ExtractConversationsInput.model_validate(tool_call["args"]).conversations
        print(f'found {len(extracted_conversations)} conversations')
        for conv in extracted_conversations:
            conv_start, conv_end = sorted([utc(conv.start), utc(conv.end)]) # sometimes llm swaps start and end
            
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
    else:
        print("No conversations found")
    
    cursor = chunk_start


from tqdm import tqdm


for conv in tqdm(call_resource(
    "tech.mycelia.mongo",
    {
        "action": "find",
        "collection": "conversations",
        "query": {},
    })):
    changed = False
    for time_range in conv["timeRanges"]:
        time_range_start, time_range_end = [utc(time_range["start"]), utc(time_range["end"])]
        if time_range_start > time_range_end:
            changed = True
            time_range["start"], time_range["end"] = time_range_end, time_range_start
    if changed:
        print(conv["_id"])
        call_resource(
            "tech.mycelia.mongo",
            {
                "action": "updateOne",
                "collection": "conversations",
                "query": {"_id": conv["_id"]},
                "update": {"$set": {"timeRanges": conv["timeRanges"]}},
            }
        )
