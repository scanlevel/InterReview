"""``/answers/review`` route for B-owned answer coaching."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas import AnswerReview, AnswerReviewRequest
from app.services.answer_review import review_answer

router = APIRouter(tags=["answers"])


@router.post("/answers/review", response_model=AnswerReview)
def review(request: AnswerReviewRequest) -> AnswerReview:
    """Review one answer and keep LLM failures local to that question."""
    return review_answer(
        request.original_question
        or request.personalized_question
        or request.question
        or "",
        request.personalized_question
        or request.original_question
        or request.question
        or "",
        request.transcript,
        request.essay,
        request.profile,
    )
