import os
from functools import lru_cache

from langchain_openai import ChatOpenAI


@lru_cache(maxsize=1)
def get_llm() -> ChatOpenAI:
    """Full model — used for nuanced extraction and tool-calling agents."""
    return ChatOpenAI(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o"),
        temperature=0,
    )


@lru_cache(maxsize=1)
def get_fast_llm() -> ChatOpenAI:
    """Fast-path model for simple nodes; defaults to gpt-4o for demo reliability."""
    return ChatOpenAI(
        model=os.environ.get("OPENAI_FAST_MODEL", "gpt-4o-mini"),
        temperature=0,
    )
