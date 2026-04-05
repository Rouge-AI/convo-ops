"""FastAPI routes for ConvoOps."""
from __future__ import annotations

import os
import tempfile
import uuid
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from langgraph.types import Command
from pydantic import BaseModel

from app.graph.builder import get_graph

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

    if not _get_interrupt_data(graph, config):
        raise HTTPException(
            status_code=409,
            detail="Run is not awaiting approval (already completed or still running).",
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
