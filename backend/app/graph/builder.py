"""Assembles the ConvoOps LangGraph graph."""
from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.classifier import classifier_node
from app.graph.nodes.extractor import extractor_node
from app.graph.nodes.github_agent import github_agent_node
from app.graph.nodes.ingestion import ingest_node
from app.graph.nodes.planner import planner_node
from app.graph.nodes.supervisor import supervisor_node
from app.graph.state import ConvoOpsState

_graph = None


def build_graph():
    builder = StateGraph(ConvoOpsState)

    # ── Nodes ──────────────────────────────────────────────────────────────────
    builder.add_node("ingest", ingest_node)

    # Parallel intelligence layer
    builder.add_node("classifier", classifier_node)
    builder.add_node("extractor", extractor_node)
    builder.add_node("planner", planner_node)

    builder.add_node("supervisor", supervisor_node)
    builder.add_node("github_agent", github_agent_node)

    # ── Edges ──────────────────────────────────────────────────────────────────
    builder.add_edge(START, "ingest")

    # Fan-out: ingest → three parallel intelligence nodes
    builder.add_edge("ingest", "classifier")
    builder.add_edge("ingest", "extractor")
    builder.add_edge("ingest", "planner")

    # Fan-in: all three converge at supervisor (LangGraph waits for all three)
    builder.add_edge("classifier", "supervisor")
    builder.add_edge("extractor", "supervisor")
    builder.add_edge("planner", "supervisor")

    # HITL → execution → done
    builder.add_edge("supervisor", "github_agent")
    builder.add_edge("github_agent", END)

    # ── Compile with in-memory checkpointer (enables HITL interrupt/resume) ───
    checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)


def get_graph():
    """Returns a singleton graph instance (lazy-initialised)."""
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
