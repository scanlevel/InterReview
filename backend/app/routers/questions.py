"""``/questions`` route — generate a rule-balanced question set."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter, HTTPException

from app.schemas import GenerateQuestionsRequest, GenerateQuestionsResponse
from app.services.grounded_questions import (
    GroundedQuestion,
    generate_grounded_questions,
    grounding_text,
    is_valid_grounded_question,
)
from app.services.questions import (
    GENERATED_GROUPS,
    QuestionBankError,
    build_generated_question,
    generate_questions,
    resolve_question_duplicates,
)
from app.services.personalize import personalize_question

router = APIRouter(tags=["questions"])


@router.post("/questions", response_model=GenerateQuestionsResponse)
def create_questions(request: GenerateQuestionsRequest) -> GenerateQuestionsResponse:
    """Select six questions, replace two with grounded questions, then personalize bank items."""
    raw_profile = dict(request.profile)
    job_role = raw_profile.get("job_role") or raw_profile.get("job")
    resume_text = raw_profile.pop("resume_text", None)
    essay = (
        resume_text.strip()
        if isinstance(resume_text, str) and resume_text.strip()
        else None
    )
    try:
        questions = generate_questions(
            seed=request.seed,
            job_role=job_role,
            profile=raw_profile,
            essay=essay,
        )
    except QuestionBankError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    bank_fallbacks = {
        question.rule_group: question
        for question in questions
        if question.rule_group in GENERATED_GROUPS
    }
    grounding_profile = dict(raw_profile)
    grounded_source = grounding_text(grounding_profile, essay)
    grounded: Mapping[str, Any] = {}
    if grounded_source:
        try:
            result = generate_grounded_questions(
                grounding_profile,
                essay,
                [
                    question.text
                    for question in questions
                    if question.rule_group not in GENERATED_GROUPS
                ],
            )
            if isinstance(result, Mapping):
                grounded = result
        except Exception:
            # A contract failure is still a per-domain bank fallback.
            grounded = {}
    generated_domains: set[str] = set()
    for index, question in enumerate(questions):
        domain = question.rule_group
        if domain not in GENERATED_GROUPS:
            continue
        candidate = _validated_grounded_question(
            grounded.get(domain), domain, grounded_source
        )
        if candidate is None:
            continue
        questions[index] = build_generated_question(
            index=index + 1,
            group_id=domain,
            group_name=question.category,
            question=candidate.question,
        )
        generated_domains.add(domain)

    # Resolve generated-vs-bank/generated-vs-generated collisions before bank
    # personalization so a generated fallback receives the normal treatment.
    questions, active_generated = resolve_question_duplicates(
        questions,
        bank_fallbacks=bank_fallbacks,
        generated_domains=generated_domains,
    )
    generated_domains = set(active_generated)

    if raw_profile or essay:
        for index, question in enumerate(questions):
            if question.rule_group in generated_domains:
                continue
            personalized = personalize_question(raw_profile, essay, question)
            if personalized != question.text:
                questions[index] = question.model_copy(
                    update={
                        "text": personalized,
                        "original_text": question.original_text or question.text,
                    }
                )

    # A final personalization can create a collision with a generated item.
    # If that item falls back here, personalize the newly restored bank item
    # and run the deterministic check again.
    while True:
        previous_generated = set(generated_domains)
        questions, active_generated = resolve_question_duplicates(
            questions,
            bank_fallbacks=bank_fallbacks,
            generated_domains=generated_domains,
        )
        generated_domains = set(active_generated)
        newly_fallback = previous_generated - generated_domains
        if not newly_fallback:
            break
        for index, question in enumerate(questions):
            if question.rule_group not in newly_fallback:
                continue
            personalized = personalize_question(raw_profile, essay, question)
            if personalized != question.text:
                questions[index] = question.model_copy(
                    update={
                        "text": personalized,
                        "original_text": question.original_text or question.text,
                    }
                )
    return GenerateQuestionsResponse(questions=questions)


def _validated_grounded_question(
    value: Any,
    domain: str,
    source_text: str,
) -> GroundedQuestion | None:
    """Revalidate the A result at the B assembly boundary."""
    try:
        candidate = (
            value
            if isinstance(value, GroundedQuestion)
            else GroundedQuestion.model_validate(value)
        )
    except Exception:
        return None
    if candidate.domain != domain:
        return None
    return (
        candidate.model_copy(update={"question": " ".join(candidate.question.split())})
        if is_valid_grounded_question(
            candidate,
            expected_domain=candidate.domain,
            source_text=source_text,
        )
        else None
    )
