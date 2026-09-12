"""B-owned transcript-grounded answer coaching service."""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings
from app.prompts.answer_review import ANSWER_REVIEW_SYSTEM_PROMPT, build_user_prompt
from app.prompts.answer_rubric import (
    RUBRIC_EVALUATION_SYSTEM_PROMPT,
    build_user_prompt as build_rubric_user_prompt,
)
from app.schemas import AnswerReview, AnswerRubricEvaluation
from app.services import llm

logger = logging.getLogger(__name__)


_NOT_CONFIGURED_SUMMARY = "답변 피드백을 사용할 수 없습니다. LLM이 설정되지 않았습니다."
_FAILURE_SUMMARY = "답변 피드백을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
_EMPTY_SUMMARY = "답변이 비어 있거나 너무 짧아 분석할 근거가 없습니다."
_ALIGNMENT_FALLBACK = (
    "질문의 핵심 요구에 답하지 않았습니다. "
    "질문에서 요구하는 내용을 중심으로 다시 답변해 보세요."
)


def _unavailable(reason: str) -> AnswerReview:
    """Build a safe per-question response when review is unavailable."""
    return AnswerReview(
        summary=reason,
        strengths=[],
        improvements=[],
    )


def _evaluate_rubric(
    *,
    model: str,
    original_question: str,
    personalized_question: str,
    transcript: str,
) -> AnswerRubricEvaluation:
    result = llm.call_structured(
        model=model,
        system=RUBRIC_EVALUATION_SYSTEM_PROMPT,
        user=build_rubric_user_prompt(
            original_question,
            personalized_question,
            transcript,
        ),
        output_format=AnswerRubricEvaluation,
    )
    return (
        result
        if isinstance(result, AnswerRubricEvaluation)
        else AnswerRubricEvaluation.model_validate(result)
    )


def _generate_feedback(
    *,
    model: str,
    original_question: str,
    personalized_question: str,
    transcript: str,
    essay: str | None,
    profile: dict[str, Any] | None,
    rubric: AnswerRubricEvaluation,
) -> AnswerReview:
    result = llm.call_structured(
        model=model,
        system=ANSWER_REVIEW_SYSTEM_PROMPT,
        user=build_user_prompt(
            original_question,
            personalized_question,
            transcript,
            rubric,
            essay=essay,
            profile=profile,
        ),
        output_format=AnswerReview,
    )
    return result if isinstance(result, AnswerReview) else AnswerReview.model_validate(result)


def review_answer(
    original_question: str,
    personalized_question: str,
    transcript: str,
    essay: str | None = None,
    profile: dict[str, Any] | None = None,
) -> AnswerReview:
    """Return coaching, or a safe per-question fallback on any failure."""

    cleaned_transcript = transcript.strip()
    if len(cleaned_transcript) < 4:
        return AnswerReview(summary=_EMPTY_SUMMARY, strengths=[], improvements=[])
    try:
        if not llm.is_configured():
            logger.warning("답변 coaching fallback: LLM이 설정되지 않았습니다.")
            return _unavailable(_NOT_CONFIGURED_SUMMARY)

        settings = get_settings()
        rubric = _evaluate_rubric(
            model=settings.eval_model,
            original_question=original_question,
            personalized_question=personalized_question,
            transcript=cleaned_transcript,
        )
        if rubric.question_alignment.score == 0:
            return AnswerReview(summary=_ALIGNMENT_FALLBACK, strengths=[], improvements=[])
        return _generate_feedback(
            model=settings.eval_model,
            original_question=original_question,
            personalized_question=personalized_question,
            transcript=cleaned_transcript,
            essay=essay,
            profile=profile,
            rubric=rubric,
        )
    except llm.LLMError as error:
        logger.warning("답변 coaching fallback: %s", error)
        return _unavailable(_FAILURE_SUMMARY)
    except Exception as error:  # Defensive: review must never stop a session.
        logger.warning("답변 coaching fallback: 예상하지 못한 오류: %s", error)
        return _unavailable(_FAILURE_SUMMARY)
