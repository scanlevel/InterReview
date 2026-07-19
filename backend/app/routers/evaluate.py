"""``/evaluate`` route — turns a completed interview into a scored report."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas import EvaluateRequest, EvaluationReport
from app.services.evaluate import evaluate_interview

router = APIRouter(tags=["evaluate"])


@router.post("/evaluate", response_model=EvaluationReport)
def evaluate(request: EvaluateRequest) -> EvaluationReport:
    """Evaluate the submitted answers and return a structured report."""
    return evaluate_interview(request)
