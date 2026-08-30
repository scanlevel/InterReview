"""``/questions`` route — generate a rule-balanced question set."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import GenerateQuestionsRequest, GenerateQuestionsResponse
from app.services.questions import QuestionBankError, generate_questions
from app.services.personalize import personalize_question

router = APIRouter(tags=["questions"])


@router.post("/questions", response_model=GenerateQuestionsResponse)
def create_questions(request: GenerateQuestionsRequest) -> GenerateQuestionsResponse:
    """Filter target groups before personalizing the selected questions."""
    profile = dict(request.profile)
    job_role = profile.get("job_role") or profile.get("job")
    resume_text = profile.pop("resume_text", None)
    essay = (
        resume_text.strip()
        if isinstance(resume_text, str) and resume_text.strip()
        else None
    )
    try:
        questions = generate_questions(
            seed=request.seed,
            job_role=job_role,
        )
    except QuestionBankError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    if profile or essay:
        for index, question in enumerate(questions):
            personalized = personalize_question(profile, essay, question)
            if personalized != question.text:
                questions[index] = question.model_copy(
                    update={"text": personalized, "original_text": question.text}
                )
    return GenerateQuestionsResponse(questions=questions)
