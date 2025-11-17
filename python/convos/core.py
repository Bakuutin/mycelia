"""Core conversation processing logic."""

from datetime import datetime
from pytz import UTC

from bson import ObjectId

from pydantic import BaseModel, ValidationError
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from pydantic import Field
from lib.resources import call_resource

from convos.prompts import chunk_to_prompt
from convos.prompts import get_prompts
from convos.objects import find_or_create_entity
from convos.config import logger
from lib.llm import get_llm

from typing import TypedDict

from langchain_openai import ChatOpenAI


entity_to_id_map = {}

class Utterance(TypedDict):
    start: datetime
    end: datetime
    text: str


class Segment(BaseModel):
    title: str = Field(description="Short Title")
    start: datetime = Field(description="ISO 8601 timestamp when conversation started")
    end: datetime = Field(description="ISO 8601 timestamp when conversation ended")


class Conversation(BaseModel):
    summary: str = Field(description="Summary of what was discussed, key points, decisions, outcomes, etc.")
    agreed_upon_something: bool = Field(description="Whether the conversation resulted in an agreement or decision")
    entities: list[str] = Field(default_factory=list, description="People, places, things mentioned")
    emoji: str = Field(description="Single emoji representing the conversation")


def get_structured_output(messages: list[SystemMessage | HumanMessage | AIMessage], Output: type[BaseModel], llm: ChatOpenAI) -> BaseModel:
    response = llm.with_structured_output(Output.model_json_schema(), include_raw=True).invoke([
        *messages,
        HumanMessage(f'Reply only with the JSON object formatted {Output.model_json_schema()} and nothing else.'),
    ])

    try:
        return Output.model_validate(response['parsed'])
    except ValidationError:
        logger.info("Error getting structured output, refining")
        refined = llm.with_structured_output(Output.model_json_schema(), include_raw=True).invoke([
            HumanMessage('I have a JSON response, but it is not following the schema. Please fix it:'),
            HumanMessage(content=response['raw'].content),
            HumanMessage(f'Format this JSON to the schema: {Output.model_json_schema()}.'),
        ])
        return Output.model_validate(refined['parsed'])


def clip(x,lower, upper):
    return max(lower, min(x, upper))


def get_segments(chunk: list[Utterance], model: str = "small") -> list[tuple[Segment, list[Utterance]]]:
    prompt, chunk_start, chunk_end = chunk_to_prompt(chunk)

    system_prompts = get_prompts()
    llm = get_llm(model)

    class Output(BaseModel):
        segments: list[Segment]

    response: Output = get_structured_output([
        SystemMessage(system_prompts["segments"]["pre"]["text"]),
        HumanMessage(content=prompt),
    ], Output, llm)

    result = []

    for segment in response.segments:
        segment.start = clip(segment.start, chunk_start, chunk_end)
        segment.end = clip(segment.end, chunk_start, chunk_end)
        segment_utterances = [u for u in chunk if u["start"] < segment.end and u["end"] > segment.start]
        if not segment_utterances:
            logger.warning(
                "Skipping segment '%s' (%s -> %s); no utterances overlap this range",
                segment.title,
                segment.start,
                segment.end,
            )
            continue
        result.append((segment, segment_utterances))

    return result


def process_conversation_chunk(chunk: list[Utterance], model: str = "small") -> int:
    if not chunk:
        logger.warning("Received empty chunk for conversation processing; skipping")
        return 0

    chunk_start = chunk[0]["start"]
    chunk_end = chunk[-1]["end"]

    segments = get_segments(chunk, model=model)
    if not segments:
        logger.info(
            "Chunk %s -> %s (%d utterances) yielded no segments",
            chunk_start,
            chunk_end,
            len(chunk),
        )
        return 0

    logger.info(
        "Processing chunk %s -> %s (%d utterances) into %d segments",
        chunk_start,
        chunk_end,
        len(chunk),
        len(segments),
    )

    total = 0

    for segment, utterances in segments:
        process_segment(segment, utterances, model=model)
        total += 1

    return total


def create_relationship(conversation_id, mentioned_entity_name):
    call_resource("tech.mycelia.objects", {
        "action": "create",
        "object": {
            'isRelationship': True,
            'name': 'mentioned in',
            'relationship': {
                'subject': ObjectId(conversation_id),
                'object': find_or_create_entity(mentioned_entity_name),
                'symmetrical': False,
            },
        }
    })

def process_segment(segment: Segment, utterances: list[Utterance], model: str = "small"):
    prompt, chunk_start, chunk_end = chunk_to_prompt(utterances)

    system_prompts = get_prompts()
    llm = get_llm(model)

    conversation: Conversation = get_structured_output([
        SystemMessage(system_prompts["conversation"]["pre"]["text"]),
        HumanMessage(content=prompt),
        AIMessage(content=system_prompts["conversation"]["post"]["text"])
    ], Conversation, llm)

    result = call_resource("tech.mycelia.objects", {
        "action": "create",
        "object": {
            'isConversation': True,
            'name': segment.title,
            'details': conversation.summary,
            'icon': {'text': conversation.emoji},
            'agreed_upon_something': conversation.agreed_upon_something,
            'timeRanges': [{
                'start': segment.start,
                'end': segment.end,
            }],
            'metadata': {
                'extractedWith': {
                    'model': model,  # Use the actual model parameter instead of hardcoded 'small'
                    'timestamp': datetime.now(tz=UTC),
                }
            }
        }
    })

    conversation_id = result['insertedId']

    for entity in conversation.entities:
        create_relationship(conversation_id, entity)

    logger.debug(
        "Conversation created id=%s title='%s' [%s -> %s] emoji=%s agreed=%s entities=%s utterances=%d",
        str(conversation_id),
        segment.title,
        segment.start.isoformat(),
        segment.end.isoformat(),
        conversation.emoji,
        conversation.agreed_upon_something,
        ", ".join(conversation.entities) if conversation.entities else "none",
        len(utterances),
    )
    logger.debug("Conversation summary (%s): %s", segment.title, conversation.summary)
