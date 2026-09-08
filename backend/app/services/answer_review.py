"""B-owned transcript-grounded answer coaching service."""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings
from app.prompts.answer_review import ANSWER_REVIEW_SYSTEM_PROMPT, build_user_prompt
from app.schemas import AnswerReview
from app.services import llm

logger = logging.getLogger(__name__)


_NOT_CONFIGURED_SUMMARY = "답변 피드백을 사용할 수 없습니다. LLM이 설정되지 않았습니다."
_FAILURE_SUMMARY = "답변 피드백을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
_EMPTY_SUMMARY = "답변이 비어 있거나 너무 짧아 분석할 근거가 없습니다."


def _unavailable(reason: str) -> AnswerReview:
    """Build a safe per-question response when review is unavailable."""
    return AnswerReview(
        summary=reason,
        strengths=[],
        improvements=[],
    )


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
        result = llm.call_structured(
            model=settings.eval_model,
            system=ANSWER_REVIEW_SYSTEM_PROMPT,
            user=build_user_prompt(
                original_question,
                personalized_question,
                cleaned_transcript,
                essay=essay,
                profile=profile,
            ),
            output_format=AnswerReview,
        )
        return (
            result
            if isinstance(result, AnswerReview)
            else AnswerReview.model_validate(result)
        )
    except llm.LLMError as error:
        logger.warning("답변 coaching fallback: %s", error)
        return _unavailable(_FAILURE_SUMMARY)
    except Exception as error:  # Defensive: review must never stop a session.
        logger.warning("답변 coaching fallback: 예상하지 못한 오류: %s", error)
        return _unavailable(_FAILURE_SUMMARY)
