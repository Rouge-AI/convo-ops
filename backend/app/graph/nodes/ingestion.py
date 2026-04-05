"""Layer 1 — Ingestion node: reads a PDF transcript and extracts plain text."""
from __future__ import annotations

import pdfplumber

from app.graph.state import ConvoOpsState


def ingest_node(state: ConvoOpsState) -> dict:
    text_parts: list[str] = []
    with pdfplumber.open(state["pdf_path"]) as pdf:
        for page in pdf.pages:
            extracted = page.extract_text()
            if extracted:
                text_parts.append(extracted)

    transcript_text = "\n".join(text_parts).strip()
    if not transcript_text:
        raise ValueError("Could not extract any text from the PDF. Ensure it is a text-based PDF, not a scanned image.")

    return {
        "transcript_text": transcript_text,
        "execution_results": [],
        "audit_trail": [],
    }
