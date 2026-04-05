"""Layer 2c — Action Planner: converts extracted intelligence into a ranked, agent-routable plan."""
from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.config import get_fast_llm
from app.graph.state import ConvoOpsState

SYSTEM_PROMPT = """You are an expert at creating actionable execution plans from meeting intelligence.
Focus on tasks that can be fully automated by software agents."""

USER_PROMPT = """Create a prioritised action plan from this meeting.

Available agents:
  - github_issue  → creates a GitHub issue; data must include: title (str), body (str), labels (list[str]), assignees (list[str])
  - email         → drafts a follow-up email (stub for now)
  - slack         → sends a Slack message (stub for now)

Conversation type: {conversation_type}
Execution profile: {execution_profile}

Extracted intelligence:
{extracted_intelligence}

Transcript (for additional context):
{transcript}

Rules:
1. Every action_item with a clear owner should become a github_issue for a {conversation_type} meeting.
2. Each blocker should also become a github_issue labelled "blocker".
3. Rank by priority: high → medium → low.
4. Keep titles concise (≤ 72 chars)."""


class PlannedAction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    title: str
    description: str
    agent: str          # github_issue | email | slack
    priority: str       # high | medium | low
    data: dict = Field(default_factory=dict)  # agent-specific payload


class ActionPlan(BaseModel):
    actions: list[PlannedAction]


def planner_node(state: ConvoOpsState) -> dict:
    llm = get_fast_llm()
    result: ActionPlan = llm.with_structured_output(ActionPlan, method="function_calling").invoke(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": USER_PROMPT.format(
                    conversation_type=state.get("conversation_type", "unknown"),
                    execution_profile=state.get("execution_profile", "general"),
                    extracted_intelligence=state.get("extracted_intelligence", {}),
                    transcript=state["transcript_text"],
                ),
            },
        ]
    )
    return {"action_plan": [a.model_dump() for a in result.actions]}
