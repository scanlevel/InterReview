"""``/questions`` route — generate a rule-balanced interview question set."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import GenerateQuestionsRequest, GenerateQuestionsResponse
from app.services.questions import (
    QuestionBankError,
    _experience_from_profile,
    generate_questions,
)

router = APIRouter(tags=["questions"])


@router.post("/questions", response_model=GenerateQuestionsResponse)
def create_questions(request: GenerateQuestionsRequest) -> GenerateQuestionsResponse:
    """Generate interview questions for the given applicant profile."""
    try:
        questions = generate_questions(request.profile, seed=request.seed)
    except QuestionBankError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    return GenerateQuestionsResponse(
        experience=_experience_from_profile(request.profile),
        questions=questions,
    )
