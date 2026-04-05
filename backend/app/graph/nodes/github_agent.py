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
    transport = os.environ.get("GITHUB_MCP_TRANSPORT", "docker").lower()

    if transport == "npx":
        # Alternative: community server via npx (no Docker required)
        return {
            "github": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": token},
                "transport": "stdio",
            }
        }

    # Default: official GitHub MCP server via Docker
    return {
        "github": {
            "command": "docker",
            "args": [
                "run", "-i", "--rm",
                "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
                "ghcr.io/github/github-mcp-server",
            ],
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

    async with MultiServerMCPClient(_mcp_config()) as client:
        tools = client.get_tools()
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

            response = await agent.ainvoke(
                {"messages": [HumanMessage(content=prompt)]}
            )
            last_message = response["messages"][-1].content

            results.append(
                {
                    "action_id": action["id"],
                    "action_title": action["title"],
                    "agent": "github_issue",
                    "result": last_message,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )

    return {
        "execution_results": results,
        "audit_trail": [
            {
                "step": "github_agent",
                "issues_created": len(results),
                "action_ids": [a["id"] for a in github_actions],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ],
    }
