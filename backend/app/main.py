"""ConvoOps — FastAPI entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv()  # load .env before anything else imports os.environ

from app.api.routes import router  # noqa: E402 (must be after load_dotenv)
from app.graph.builder import build_graph  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-initialise the graph singleton at startup
    build_graph()
    yield


app = FastAPI(
    title="ConvoOps",
    description=(
        "API-first multi-agent platform that ingests meeting transcripts (PDF), "
        "extracts structured intelligence, and dispatches supervised agents to execute "
        "downstream tasks — starting with GitHub Issues."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(router, prefix="/api/v1")
