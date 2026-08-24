"""``/answers/review`` route for content-only answer review."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas import AnswerReview, AnswerReviewRequest
from app.services.answer_review import review_answer

router = APIRouter(tags=["answers"])


@router.post("/answers/review", response_model=AnswerReview)
def review(request: AnswerReviewRequest) -> AnswerReview:
    """Review one answer and always return HTTP 200.

    The service converts every failure into ``unavailable``, so this route does
    not need exception translation.  ``profile`` remains in the API contract
    but is not passed because the current review prompt does not use it.
    """
    return review_answer(request.question, request.transcript, request.essay)
