from __future__ import annotations

import operator
from typing import Annotated

from typing_extensions import TypedDict


class ConvoOpsState(TypedDict, total=False):
    # ── Layer 1: Ingestion ─────────────────────────────────────────────────────
    pdf_path: str
    transcript_text: str

    # ── Layer 2a: Context Classifier (parallel node) ───────────────────────────
    conversation_type: str          # standup | vc_call | client_requirements | general_meeting
    confidence: float
    participants: list[str]
    domain: str
    execution_profile: str          # ticket_and_notify | doc_and_email | spec_draft | general

    # ── Layer 2b: Intelligence Extractor (parallel node) ──────────────────────
    extracted_intelligence: dict    # decisions, blockers, action_items, open_questions

    # ── Layer 2c: Action Planner (parallel node) ───────────────────────────────
    action_plan: list[dict]         # ranked list of {id, title, description, agent, priority, data}

    # ── Layer 3: Supervisor HITL ───────────────────────────────────────────────
    pending_approval: dict          # full context surfaced to the human
    approved_actions: list[dict]    # subset approved by human

    # ── Layer 4 & 5: Execution & Audit (accumulated via reducer) ──────────────
    execution_results: Annotated[list[dict], operator.add]
    audit_trail: Annotated[list[dict], operator.add]
