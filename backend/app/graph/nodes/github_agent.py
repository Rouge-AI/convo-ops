"""Layer 4 — GitHub Agent: creates GitHub issues via the GitHub MCP server."""
from __future__ import annotations

import os
from datetime import datetime, timezone

from langchain_core.messages import HumanMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent

from app.config import get_llm
from app.graph.state import ConvoOpsState

# ── MCP server configuration ───────────────────────────────────────────────────

def _mcp_config() -> dict:
    token = os.environ["GITHUB_TOKEN"]
    # npx-only transport (Docker removed)
    return {
        "github": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": token},
            "transport": "stdio",
        }
    }


# ── Agent prompt ───────────────────────────────────────────────────────────────

AGENT_PROMPT = """You are an execution agent that creates GitHub issues.

Create a GitHub issue with exactly these details:
- Owner:     {owner}
- Repo:      {repo}
- Title:     {title}
- Body:      {body}
- Labels:    {labels}
- Assignees: {assignees}

Use the create_issue tool. Do not ask for confirmation. Return the issue URL once created."""


# ── Node ───────────────────────────────────────────────────────────────────────

async def github_agent_node(state: ConvoOpsState) -> dict:
    github_actions = [
        a for a in state.get("approved_actions", [])
        if a.get("agent") == "github_issue"
    ]

    if not github_actions:
        return {
            "execution_results": [],
            "audit_trail": [
                {
                    "step": "github_agent",
                    "note": "No github_issue actions were approved; skipped.",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            ],
        }

    repo_full = os.environ.get("GITHUB_REPO", "")
    owner, repo = repo_full.split("/", 1) if "/" in repo_full else ("", repo_full)

    results: list[dict] = []

    try:
        client = MultiServerMCPClient(_mcp_config())
        tools = await client.get_tools()
        agent = create_react_agent(get_llm(), tools)

        for action in github_actions:
            data = action.get("data", {})
            prompt = AGENT_PROMPT.format(
                owner=owner,
                repo=repo,
                title=data.get("title", action["title"]),
                body=data.get("body", action.get("description", "")),
                labels=data.get("labels", []),
                assignees=data.get("assignees", []),
            )

            try:
                response = await agent.ainvoke(
                    {"messages": [HumanMessage(content=prompt)]}
                )
                last_message = response["messages"][-1].content
                status = "created"
            except Exception as exc:
                # Do not fail the full run if one issue fails (e.g., invalid assignee).
                last_message = f"Failed to create issue: {exc}"
                status = "failed"

            results.append(
                {
                    "action_id": action["id"],
                    "action_title": action["title"],
                    "agent": "github_issue",
                    "status": status,
                    "result": last_message,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )

    except Exception as exc:
        # MCP startup/transport failures are reported as failed results for all actions.
        now = datetime.now(timezone.utc).isoformat()
        for action in github_actions:
            results.append(
                {
                    "action_id": action["id"],
                    "action_title": action["title"],
                    "agent": "github_issue",
                    "status": "failed",
                    "result": f"GitHub MCP unavailable: {exc}",
                    "timestamp": now,
                }
            )

    created_count = sum(1 for r in results if r.get("status") == "created")
    failed_count = sum(1 for r in results if r.get("status") == "failed")

    return {
        "execution_results": results,
        "audit_trail": [
            {
                "step": "github_agent",
                "issues_created": created_count,
                "issues_failed": failed_count,
                "action_ids": [a["id"] for a in github_actions],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ],
    }
