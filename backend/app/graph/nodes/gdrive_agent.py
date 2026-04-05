"""Layer 4 — Google Drive Agent: creates term sheet docs via Drive MCP."""
from __future__ import annotations

import json
import os
import shlex
from datetime import datetime, timezone

from langchain_core.messages import HumanMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent

from app.config import get_llm
from app.graph.state import ConvoOpsState


def _parse_headers(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("GDRIVE_MCP_HEADERS_JSON must be a JSON object.")
    return {str(k): str(v) for k, v in parsed.items()}


def _mcp_config() -> dict:
    transport = os.environ.get("GDRIVE_MCP_TRANSPORT", "stdio").lower()

    if transport in {"streamable_http", "http", "sse"}:
        url = os.environ.get("GDRIVE_MCP_URL", "").strip()
        if not url:
            raise ValueError("Missing GDRIVE_MCP_URL for remote Google Drive MCP transport.")

        headers = _parse_headers(os.environ.get("GDRIVE_MCP_HEADERS_JSON"))
        token = os.environ.get("GDRIVE_MCP_AUTH_TOKEN", "").strip()
        if token and "Authorization" not in headers:
            headers["Authorization"] = f"Bearer {token}"

        return {
            "gdrive": {
                "transport": "sse" if transport == "sse" else "streamable_http",
                "url": url,
                "headers": headers or None,
            }
        }

    if transport == "stdio":
        command = os.environ.get("GDRIVE_MCP_COMMAND", "npx")
        raw_args = os.environ.get("GDRIVE_MCP_ARGS", "-y mcp-google-drive")
        args = shlex.split(raw_args, posix=(os.name != "nt"))
        return {
            "gdrive": {
                "transport": "stdio",
                "command": command,
                "args": args,
            }
        }

    raise ValueError(
        "Unsupported GDRIVE_MCP_TRANSPORT. Use 'streamable_http', 'sse', or 'stdio'."
    )


AGENT_PROMPT = """You are an execution agent that creates term sheet documents.

Create exactly one Google Doc for a VC follow-up term sheet with these details:
- Document title: {document_title}
- Target folder id: {folder_id_text}
- Share with: {share_with}
- Content:
{content}

Use available Google Drive/Docs tools to create the document.
Only move/place it into a folder if a valid folder id is provided.
If no folder id is provided, create it in My Drive root.
If share_with is provided, share the document with those emails.
Do not ask for confirmation. Return document URL/id when complete."""


async def gdrive_agent_node(state: ConvoOpsState) -> dict:
    term_sheet_actions = [
        action
        for action in state.get("approved_actions", [])
        if action.get("agent") == "term_sheet"
    ]

    if not term_sheet_actions:
        return {
            "execution_results": [],
            "audit_trail": [
                {
                    "step": "gdrive_agent",
                    "note": "No term_sheet actions were approved; skipped.",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            ],
        }

    results: list[dict] = []

    try:
        client = MultiServerMCPClient(_mcp_config())
        tools = await client.get_tools()
        agent = create_react_agent(get_llm(), tools)

        for action in term_sheet_actions:
            data = action.get("data", {})
            document_title = data.get("document_title", action.get("title", "Term Sheet"))
            folder_id = str(data.get("folder_id", "")).strip()
            share_with = data.get("share_with", [])
            content = data.get("content", action.get("description", ""))
            folder_id_text = folder_id if folder_id else "(not provided)"

            prompt = AGENT_PROMPT.format(
                document_title=document_title,
                folder_id_text=folder_id_text,
                share_with=share_with,
                content=content,
            )

            try:
                response = await agent.ainvoke({"messages": [HumanMessage(content=prompt)]})
                last_message = response["messages"][-1].content
                status = "created"
            except Exception as exc:
                last_message = f"Failed to create term sheet doc: {exc}"
                status = "failed"

            results.append(
                {
                    "action_id": action["id"],
                    "action_title": action["title"],
                    "agent": "term_sheet",
                    "status": status,
                    "result": last_message,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )

    except Exception as exc:
        now = datetime.now(timezone.utc).isoformat()
        for action in term_sheet_actions:
            results.append(
                {
                    "action_id": action["id"],
                    "action_title": action["title"],
                    "agent": "term_sheet",
                    "status": "failed",
                    "result": f"Google Drive MCP unavailable: {exc}",
                    "timestamp": now,
                }
            )

    created_count = sum(1 for result in results if result.get("status") == "created")
    failed_count = sum(1 for result in results if result.get("status") == "failed")

    return {
        "execution_results": results,
        "audit_trail": [
            {
                "step": "gdrive_agent",
                "docs_created": created_count,
                "docs_failed": failed_count,
                "action_ids": [action["id"] for action in term_sheet_actions],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ],
    }
