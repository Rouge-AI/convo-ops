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
    - email         → sends follow-up email via Gmail MCP; data must include: to (str), cc (str, optional), subject (str), body (str)
    - meeting       → schedules a calendar meeting via Calendar MCP; data must include: title (str), attendees (list[str]), start_time (ISO-8601 str), end_time (ISO-8601 str), timezone (str), location (str, optional), description (str, optional)
    - term_sheet    → creates term sheet document via Google Drive MCP; data must include: document_title (str), content (str), folder_id (str, optional), share_with (list[str], optional)
  - slack         → sends a Slack message (stub for now)

Conversation type: {conversation_type}
Execution profile: {execution_profile}

Extracted intelligence:
{extracted_intelligence}

Transcript (for additional context):
{transcript}

Rules:
1. If execution_profile is "ticket_and_notify", convert owned action_items and blockers to github_issue actions.
2. If execution_profile is "doc_and_email", include at least:
    - one email action that sends a VC follow-up summary and next steps
    - one term_sheet action that creates a draft term sheet document
3. For any flagged next step that clearly needs a meeting/call/sync, include a meeting action.
4. For email actions, use title as subject and description as the main body summary.
5. For term_sheet actions, use title as document title and description as draft content summary.
6. For meeting actions, include agenda/context in description and use ISO-8601 start_time/end_time.
7. Rank by priority: high → medium → low.
8. Keep titles concise (≤ 72 chars)."""


class PlannedAction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    title: str
    description: str
    agent: str          # github_issue | email | meeting | term_sheet | slack
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
