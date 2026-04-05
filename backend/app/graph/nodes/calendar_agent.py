"""Layer 4 — Calendar Agent: schedules meetings via Calendar MCP."""
from __future__ import annotations

import json
import os
import shlex
from datetime import datetime, timezone
from typing import Any

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
        raise ValueError("GCAL_MCP_HEADERS_JSON must be a JSON object.")
    return {str(k): str(v) for k, v in parsed.items()}


def _mcp_config() -> dict:
    transport = os.environ.get("GCAL_MCP_TRANSPORT", "stdio").lower()

    if transport in {"streamable_http", "http", "sse"}:
        url = os.environ.get("GCAL_MCP_URL", "").strip()
        if not url:
            raise ValueError("Missing GCAL_MCP_URL for remote Calendar MCP transport.")

        headers = _parse_headers(os.environ.get("GCAL_MCP_HEADERS_JSON"))
        token = os.environ.get("GCAL_MCP_AUTH_TOKEN", "").strip()
        if token and "Authorization" not in headers:
            headers["Authorization"] = f"Bearer {token}"

        return {
            "calendar": {
                "transport": "sse" if transport == "sse" else "streamable_http",
                "url": url,
                "headers": headers or None,
            }
        }

    if transport == "stdio":
        command = os.environ.get("GCAL_MCP_COMMAND", "npx")
        raw_args = os.environ.get("GCAL_MCP_ARGS", "-y mcp-google-calendar")
        args = shlex.split(raw_args, posix=(os.name != "nt"))
        return {
            "calendar": {
                "transport": "stdio",
                "command": command,
                "args": args,
            }
        }

    raise ValueError("Unsupported GCAL_MCP_TRANSPORT. Use 'streamable_http', 'sse', or 'stdio'.")


def _mcp_fallback_configs() -> list[dict]:
    """Return preferred MCP config first, then safe fallbacks."""
    primary = _mcp_config()
    transport = os.environ.get("GCAL_MCP_TRANSPORT", "stdio").lower()

    if transport in {"streamable_http", "http"}:
        url = os.environ.get("GCAL_MCP_URL", "").strip()
        headers = _parse_headers(os.environ.get("GCAL_MCP_HEADERS_JSON"))
        token = os.environ.get("GCAL_MCP_AUTH_TOKEN", "").strip()
        if token and "Authorization" not in headers:
            headers["Authorization"] = f"Bearer {token}"

        # Some providers expose only SSE despite streamable-http docs.
        sse_fallback = {
            "calendar": {
                "transport": "sse",
                "url": url,
                "headers": headers or None,
            }
        }
        return [primary, sse_fallback]

    return [primary]


def _flatten_exception_messages(exc: Exception) -> str:
    """Flatten nested exception groups into readable leaf messages."""
    messages: list[str] = []

    def walk(err: BaseException) -> None:
        sub_errors: Any = getattr(err, "exceptions", None)
        if sub_errors and isinstance(sub_errors, (list, tuple)):
            for sub in sub_errors:
                walk(sub)
            return
        text = str(err).strip() or err.__class__.__name__
        messages.append(text)

    walk(exc)
    unique_messages = []
    seen = set()
    for message in messages:
        if message not in seen:
            unique_messages.append(message)
            seen.add(message)
    return " | ".join(unique_messages) if unique_messages else str(exc)


AGENT_PROMPT = """You are an execution agent that schedules meetings.

Create exactly one calendar event with these details:
- Title: {title}
- Start (ISO-8601): {start_time}
- End (ISO-8601): {end_time}
- Timezone: {timezone}
- Attendees: {attendees}
- Location: {location}
- Description / Agenda:
{description}

Use available calendar tools to create the event and invite attendees.
Do not ask for confirmation. Return event link/id when complete."""


async def calendar_agent_node(state: ConvoOpsState) -> dict:
    meeting_actions = [
        action for action in state.get("approved_actions", []) if action.get("agent") == "meeting"
    ]

    if not meeting_actions:
        return {
            "execution_results": [],
            "audit_trail": [
                {
                    "step": "calendar_agent",
                    "note": "No meeting actions were approved; skipped.",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            ],
        }

    results: list[dict] = []

    try:
        agent = None
        last_connect_error: Exception | None = None
        for config in _mcp_fallback_configs():
            try:
                client = MultiServerMCPClient(config)
                tools = await client.get_tools()
                agent = create_react_agent(get_llm(), tools)
                break
            except Exception as connect_exc:
                last_connect_error = connect_exc

        if agent is None:
            raise RuntimeError(
                "Unable to connect to Calendar MCP. "
                f"Details: {_flatten_exception_messages(last_connect_error or RuntimeError('Unknown error'))}"
            )

        for action in meeting_actions:
            data = action.get("data", {})
            title = data.get("title", action.get("title", "Follow-up Meeting"))
            attendees = data.get("attendees", [])
            start_time = data.get("start_time", "")
            end_time = data.get("end_time", "")
            timezone_name = data.get("timezone", "UTC")
            location = data.get("location", "")
            description = data.get("description", action.get("description", ""))

            if not start_time or not end_time:
                results.append(
                    {
                        "action_id": action["id"],
                        "action_title": action["title"],
                        "agent": "meeting",
                        "status": "failed",
                        "result": "Missing start_time or end_time for meeting action.",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )
                continue

            prompt = AGENT_PROMPT.format(
                title=title,
                start_time=start_time,
                end_time=end_time,
                timezone=timezone_name,
                attendees=attendees,
                location=location,
                description=description,
            )

            try:
                response = await agent.ainvoke({"messages": [HumanMessage(content=prompt)]})
                last_message = response["messages"][-1].content
                status = "scheduled"
            except Exception as exc:
                last_message = f"Failed to schedule meeting: {exc}"
                status = "failed"

            results.append(
                {
                    "action_id": action["id"],
                    "action_title": action["title"],
                    "agent": "meeting",
                    "status": status,
                    "result": last_message,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )

    except Exception as exc:
        now = datetime.now(timezone.utc).isoformat()
        error_text = _flatten_exception_messages(exc)
        for action in meeting_actions:
            results.append(
                {
                    "action_id": action["id"],
                    "action_title": action["title"],
                    "agent": "meeting",
                    "status": "failed",
                    "result": f"Calendar MCP unavailable: {error_text}",
                    "timestamp": now,
                }
            )

    scheduled_count = sum(1 for result in results if result.get("status") == "scheduled")
    failed_count = sum(1 for result in results if result.get("status") == "failed")

    return {
        "execution_results": results,
        "audit_trail": [
            {
                "step": "calendar_agent",
                "meetings_scheduled": scheduled_count,
                "meetings_failed": failed_count,
                "action_ids": [action["id"] for action in meeting_actions],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ],
    }
