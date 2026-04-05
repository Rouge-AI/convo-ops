"""Layer 2b — Intelligence Extractor: pulls structured data from the transcript."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from app.config import get_llm
from app.graph.state import ConvoOpsState

SYSTEM_PROMPT = """You are an expert at extracting structured intelligence from meeting transcripts.
Be precise — only include items that are explicitly discussed, not inferred."""

USER_PROMPT = """Extract structured intelligence from this transcript.

Return:
- decisions: key decisions that were made (not just discussed)
- blockers: anything blocking progress or flagged as a problem
- action_items: concrete tasks with an owner, optional deadline, and priority (high/medium/low)
- open_questions: questions raised but not resolved

Transcript:
{transcript}"""


class ActionItem(BaseModel):
    task: str
    owner: str
    deadline: Optional[str] = None
    priority: str  # high | medium | low


class ExtractedIntelligence(BaseModel):
    decisions: list[str]
    blockers: list[str]
    action_items: list[ActionItem]
    open_questions: list[str]


def extractor_node(state: ConvoOpsState) -> dict:
    llm = get_llm()
    result: ExtractedIntelligence = llm.with_structured_output(ExtractedIntelligence).invoke(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT.format(transcript=state["transcript_text"])},
        ]
    )
    return {"extracted_intelligence": result.model_dump()}
