from datetime import datetime
from typing import List

from pydantic import BaseModel, Field


class Conversation(BaseModel):
    title: str = Field(description="Descriptive title for the conversation")
    summary: str = Field(description="Summary of what was discussed, key points, decisions, outcomes, etc.")
    entities: List[str] = Field(default_factory=list, description="People, places, things mentioned")
    start: datetime = Field(description="ISO 8601 timestamp when conversation started")
    end: datetime = Field(description="ISO 8601 timestamp when conversation ended")
    emoji: str = Field(description="Single emoji representing the conversation")


class ExtractConversationsInput(BaseModel):
    conversations: List[Conversation] = Field(description="List of conversations extracted from the transcript")


__all__ = ["Conversation", "ExtractConversationsInput"]
