"""Layer 4 — Gmail Agent: sends follow-up emails via Gmail MCP."""
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
        raise ValueError("GMAIL_MCP_HEADERS_JSON must be a JSON object.")
    return {str(k): str(v) for k, v in parsed.items()}


def _mcp_config() -> dict:
    transport = os.environ.get("GMAIL_MCP_TRANSPORT", "stdio").lower()

    if transport in {"streamable_http", "http", "sse"}:
        url = os.environ.get("GMAIL_MCP_URL", "").strip()
        if not url:
            raise ValueError("Missing GMAIL_MCP_URL for remote Gmail MCP transport.")

        headers = _parse_headers(os.environ.get("GMAIL_MCP_HEADERS_JSON"))
        token = os.environ.get("GMAIL_MCP_AUTH_TOKEN", "").strip()
        if token and "Authorization" not in headers:
            headers["Authorization"] = f"Bearer {token}"

        return {
            "gmail": {
                "transport": "sse" if transport == "sse" else "streamable_http",
                "url": url,
                "headers": headers or None,
            }
        }

    if transport == "stdio":
        command = os.environ.get("GMAIL_MCP_COMMAND", "npx")
        raw_args = os.environ.get("GMAIL_MCP_ARGS", "-y mcp-gmail")
        args = shlex.split(raw_args, posix=(os.name != "nt"))
        return {
            "gmail": {
                "transport": "stdio",
                "command": command,
                "args": args,
            }
        }

    raise ValueError(
        "Unsupported GMAIL_MCP_TRANSPORT. Use 'streamable_http', 'sse', or 'stdio'."
    )


AGENT_PROMPT = """You are an execution agent that sends follow-up emails.

Send exactly one email using Gmail tools with these details:
- To: {to}
- Cc: {cc}
- Subject: {subject}
- Body: {body}

Use the available Gmail send-mail tool. Do not ask for confirmation.
Return a clear success message with recipient(s), subject, and message id if available."""


async def gmail_agent_node(state: ConvoOpsState) -> dict:
    email_actions = [
        action for action in state.get("approved_actions", []) if action.get("agent") == "email"
    ]

    if not email_actions:
        return {
            "execution_results": [],
            "audit_trail": [
                {
                    "step": "gmail_agent",
                    "note": "No email actions were approved; skipped.",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            ],
        }

    results: list[dict] = []

    try:
        client = MultiServerMCPClient(_mcp_config())
        tools = await client.get_tools()
        agent = create_react_agent(get_llm(), tools)

        for action in email_actions:
            data = action.get("data", {})
            to = data.get("to", "")
            cc = data.get("cc", "")
            subject = data.get("subject", action.get("title", "Follow-up"))
            body = data.get("body", action.get("description", ""))

            if not to:
                results.append(
                    {
                        "action_id": action["id"],
                        "action_title": action["title"],
                        "agent": "email",
                        "status": "failed",
                        "result": "Missing recipient (to) for email action.",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )
                continue

            prompt = AGENT_PROMPT.format(to=to, cc=cc, subject=subject, body=body)

            try:
                response = await agent.ainvoke({"messages": [HumanMessage(content=prompt)]})
                last_message = response["messages"][-1].content
                status = "sent"
            except Exception as exc:
                last_message = f"Failed to send email: {exc}"
                status = "failed"

            results.append(
                {
                    "action_id": action["id"],
                    "action_title": action["title"],
                    "agent": "email",
                    "status": status,
                    "result": last_message,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )

    except Exception as exc:
        now = datetime.now(timezone.utc).isoformat()
        for action in email_actions:
            results.append(
                {
                    "action_id": action["id"],
                    "action_title": action["title"],
                    "agent": "email",
                    "status": "failed",
                    "result": f"Gmail MCP unavailable: {exc}",
                    "timestamp": now,
                }
            )

    sent_count = sum(1 for result in results if result.get("status") == "sent")
    failed_count = sum(1 for result in results if result.get("status") == "failed")

    return {
        "execution_results": results,
        "audit_trail": [
            {
                "step": "gmail_agent",
                "emails_sent": sent_count,
                "emails_failed": failed_count,
                "action_ids": [action["id"] for action in email_actions],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ],
    }
