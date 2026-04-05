"""FastAPI routes for ConvoOps."""
from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from langgraph.types import Command
from pydantic import BaseModel

from app.graph.builder import get_graph
from app.graph.nodes.gdrive_agent import gdrive_agent_node
from app.graph.nodes.github_agent import github_agent_node
from app.graph.nodes.gmail_agent import gmail_agent_node

router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────

class ApproveRequest(BaseModel):
    approved_actions: list[dict]  # list of action dicts from the pending_approval.action_plan


# ── Helper ────────────────────────────────────────────────────────────────────

def _thread_config(run_id: str) -> dict:
    return {"configurable": {"thread_id": run_id}}


def _get_interrupt_data(graph, config: dict) -> dict | None:
    """Return the interrupt payload if the graph is paused, else None."""
    snapshot = graph.get_state(config)
    if not snapshot.next:
        return None
    for task in snapshot.tasks:
        if hasattr(task, "interrupts") and task.interrupts:
            return task.interrupts[0].value
    return None


async def _execute_incremental_actions(
    existing_state: dict[str, Any], approved_actions: list[dict]
) -> tuple[list[dict], list[dict]]:
    """Run execution agents directly for additional approved actions after completion."""
    if not approved_actions:
        return list(existing_state.get("execution_results", [])), list(existing_state.get("audit_trail", []))

    state_for_agents = {
        "approved_actions": approved_actions,
        "execution_results": [],
        "audit_trail": [],
    }

    merged_results = list(existing_state.get("execution_results", []))
    merged_audit = list(existing_state.get("audit_trail", []))

    for node in (github_agent_node, gmail_agent_node, gdrive_agent_node):
        node_output = await node(state_for_agents)
        node_results = node_output.get("execution_results", [])
        node_audit = node_output.get("audit_trail", [])

        merged_results.extend(node_results)
        merged_audit.extend(node_audit)

        # Allow subsequent nodes to see accumulated state if needed.
        state_for_agents["execution_results"] = merged_results
        state_for_agents["audit_trail"] = merged_audit

    supported_agents = {"github_issue", "email", "term_sheet"}
    unsupported = [a for a in approved_actions if a.get("agent") not in supported_agents]
    if unsupported:
        now = datetime.now(timezone.utc).isoformat()
        unsupported_results = [
            {
                "action_id": action.get("id", "unknown"),
                "action_title": action.get("title", "Unsupported action"),
                "agent": action.get("agent", "unknown"),
                "status": "failed",
                "result": f"Unsupported action agent: {action.get('agent')}",
                "timestamp": now,
            }
            for action in unsupported
        ]
        merged_results.extend(unsupported_results)
        merged_audit.append(
            {
                "step": "incremental_execution",
                "unsupported_agents": [a.get("agent") for a in unsupported],
                "action_ids": [a.get("id") for a in unsupported],
                "timestamp": now,
            }
        )

    return merged_results, merged_audit


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/runs", summary="Upload a PDF transcript and start a ConvoOps run")
async def start_run(pdf: UploadFile = File(...)) -> JSONResponse:
    """
    1. Saves the uploaded PDF to a temp file.
    2. Invokes the graph (runs ingest → classifier/extractor/planner → supervisor).
    3. Graph pauses at the supervisor HITL node.
    4. Returns the run_id and the action plan pending human approval.
    """
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    # Write uploaded PDF to a temp file (stays on disk until the run completes)
    suffix = f"_{pdf.filename}"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await pdf.read())
        pdf_path = tmp.name

    run_id = str(uuid.uuid4())
    config = _thread_config(run_id)
    graph = get_graph()

    try:
        await graph.ainvoke(
            {
                "pdf_path": pdf_path,
                "transcript_text": "",
                "execution_results": [],
                "audit_trail": [],
            },
            config=config,
        )
    except Exception as exc:
        os.unlink(pdf_path)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    interrupt_data = _get_interrupt_data(graph, config)
    if interrupt_data is None:
        # Graph completed without interruption (edge case)
        state = graph.get_state(config).values
        return JSONResponse(
            {"run_id": run_id, "status": "completed", "state": state}
        )

    return JSONResponse(
        {
            "run_id": run_id,
            "status": "pending_approval",
            "pending_approval": interrupt_data,
        }
    )


@router.get("/runs/{run_id}", summary="Get the current status of a run")
async def get_run(run_id: str) -> JSONResponse:
    graph = get_graph()
    config = _thread_config(run_id)
    snapshot = graph.get_state(config)

    if not snapshot:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")

    interrupt_data = _get_interrupt_data(graph, config)

    if interrupt_data:
        status = "pending_approval"
    elif snapshot.next:
        status = "running"
    else:
        status = "completed"

    return JSONResponse(
        {
            "run_id": run_id,
            "status": status,
            "pending_approval": interrupt_data,
            "state": {
                k: v
                for k, v in snapshot.values.items()
                if k not in ("pdf_path", "transcript_text")  # omit large fields
            },
        }
    )


@router.post("/runs/{run_id}/approve", summary="Submit human approval and resume the graph")
async def approve_run(run_id: str, body: ApproveRequest) -> JSONResponse:
    """
    Resume the paused graph with the human's decision.

    Pass the full action objects from `pending_approval.action_plan` that you
    want to execute in `approved_actions`.  Pass an empty list to reject all.
    """
    graph = get_graph()
    config = _thread_config(run_id)
    snapshot = graph.get_state(config)

    if not snapshot:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")

    interrupt_data = _get_interrupt_data(graph, config)

    if not interrupt_data:
        if snapshot.next:
            raise HTTPException(
                status_code=409,
                detail="Run is currently running. Please wait and retry.",
            )

        # Run already completed: support incremental execution for newly selected actions.
        try:
            prev_results = list(snapshot.values.get("execution_results", []))
            prev_audit = list(snapshot.values.get("audit_trail", []))
            merged_results, merged_audit = await _execute_incremental_actions(
                snapshot.values,
                body.approved_actions,
            )

            # Persist only incremental deltas so subsequent approve calls continue from latest state.
            delta_results = merged_results[len(prev_results):]
            delta_audit = merged_audit[len(prev_audit):]
            if delta_results or delta_audit:
                graph.update_state(
                    config,
                    {
                        "execution_results": delta_results,
                        "audit_trail": delta_audit,
                    },
                )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return JSONResponse(
            {
                "run_id": run_id,
                "status": "completed",
                "execution_results": merged_results,
                "audit_trail": merged_audit,
            }
        )

    try:
        await graph.ainvoke(
            Command(resume={"approved_actions": body.approved_actions}),
            config=config,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    final_state = graph.get_state(config).values
    return JSONResponse(
        {
            "run_id": run_id,
            "status": "completed",
            "execution_results": final_state.get("execution_results", []),
            "audit_trail": final_state.get("audit_trail", []),
        }
    )


@router.get("/runs/{run_id}/audit", summary="Get the full audit trail for a run")
async def get_audit(run_id: str) -> JSONResponse:
    graph = get_graph()
    config = _thread_config(run_id)
    snapshot = graph.get_state(config)

    if not snapshot:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")

    return JSONResponse(
        {
            "run_id": run_id,
            "audit_trail": snapshot.values.get("audit_trail", []),
        }
    )
