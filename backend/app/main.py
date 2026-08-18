"""InterReview FastAPI application entry point.

Skeleton stage: exposes a health check and permissive CORS for the Next.js dev
server. STT, question generation, and LLM evaluation endpoints are added as the
Streamlit logic is ported into ``app/services``.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import evaluate, questions, stt

settings = get_settings()

app = FastAPI(title="InterReview API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(evaluate.router)
app.include_router(questions.router)
app.include_router(stt.router)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe used by the frontend to confirm the API is reachable."""
    return {"status": "ok", "service": "interreview-backend"}
