"""Layer 2a — Context Classifier: determines the call type and sets the execution profile."""
from __future__ import annotations

from pydantic import BaseModel

from app.config import get_fast_llm
from app.graph.state import ConvoOpsState

SYSTEM_PROMPT = """You are an expert at classifying business meeting conversations.
Analyse the transcript and return a structured classification."""

USER_PROMPT = """Classify this meeting transcript.

conversation_type options:
  - standup         → daily engineering stand-up or scrum meeting
  - vc_call         → investor / VC pitch or fundraising discussion
  - client_requirements → requirements gathering with a client
  - general_meeting → any other business meeting

execution_profile options (maps to which agents run downstream):
  - ticket_and_notify  → for standups; creates tickets, pings Slack
  - doc_and_email      → for VC/founder calls; drafts memos and follow-up emails
  - spec_draft         → for requirements calls; produces spec documents
  - general            → fallback

Transcript:
{transcript}"""


class ConversationClassification(BaseModel):
    conversation_type: str
    confidence: float
    participants: list[str]
    domain: str
    execution_profile: str


def classifier_node(state: ConvoOpsState) -> dict:
    llm = get_fast_llm()
    result: ConversationClassification = llm.with_structured_output(ConversationClassification).invoke(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT.format(transcript=state["transcript_text"])},
        ]
    )
    return {
        "conversation_type": result.conversation_type,
        "confidence": result.confidence,
        "participants": result.participants,
        "domain": result.domain,
        "execution_profile": result.execution_profile,
    }
