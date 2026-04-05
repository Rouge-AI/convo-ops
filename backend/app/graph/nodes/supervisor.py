"""Layer 3 — Supervisor (HITL): interrupts the graph and waits for human approval."""
from __future__ import annotations

from datetime import datetime, timezone

from langgraph.types import interrupt

from app.graph.state import ConvoOpsState


def supervisor_node(state: ConvoOpsState) -> dict:
    """
    Pauses the graph here and surfaces the full action plan to the human operator.

    The caller resumes the graph by calling:
        graph.invoke(Command(resume={"approved_actions": [...]}), config=config)

    approved_actions is a list of action dicts (same shape as action_plan items)
    that the human has reviewed and approved.  Pass an empty list to reject all.
    """
    pending = {
        "conversation_type": state.get("conversation_type"),
        "confidence": state.get("confidence"),
        "participants": state.get("participants", []),
        "domain": state.get("domain"),
        "execution_profile": state.get("execution_profile"),
        "extracted_intelligence": state.get("extracted_intelligence", {}),
        "action_plan": state.get("action_plan", []),
        "instructions": (
            "Review the action plan above. "
            "Resume with {'approved_actions': [...]} where the list contains "
            "the action dicts you want to execute. "
            "Pass an empty list to reject everything."
        ),
    }

    # ── HITL pause ────────────────────────────────────────────────────────────
    human_decision: dict = interrupt(pending)
    # ─────────────────────────────────────────────────────────────────────────

    approved_actions: list[dict] = human_decision.get("approved_actions", [])

    return {
        "pending_approval": pending,
        "approved_actions": approved_actions,
        "audit_trail": [
            {
                "step": "supervisor",
                "approved_action_ids": [a.get("id") for a in approved_actions],
                "rejected_action_ids": [
                    a.get("id")
                    for a in state.get("action_plan", [])
                    if a.get("id") not in {x.get("id") for x in approved_actions}
                ],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ],
    }
