"""Answer-content review service (``plan.md`` §10, ``docs/plan-A.md`` §8).

Only whether an answer addresses its question is reviewed.  No numeric score
is produced, and every LLM failure degrades to ``unavailable`` so the interview
session can continue.
"""

from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel

from app.config import get_settings
from app.prompts.answer_review import ANSWER_REVIEW_SYSTEM_PROMPT, build_user_prompt
from app.schemas import AnswerReview
from app.services import llm

logger = logging.getLogger(__name__)

_NOT_CONFIGURED_REASON = "답변 판별 기능이 설정되지 않아 이 답변은 판단할 수 없습니다."
_FAILURE_REASON = "답변 판별에 실패해 이 답변은 판단할 수 없습니다."


class _LLMAnswerReview(BaseModel):
    """Validated LLM output excluding the fallback-only ``unavailable`` state."""

    answer_status: Literal["good", "partial", "off_topic", "insufficient"]
    reason: str
    missing_points: list[str]
    follow_up_question: str | None


def _unavailable(reason: str) -> AnswerReview:
    """Build the safe response used when content review is unavailable."""
    return AnswerReview(
        answer_status="unavailable",
        reason=reason,
        missing_points=[],
        follow_up_question=None,
    )


def review_answer(
    question: str,
    transcript: str,
    essay: str | None = None,
) -> AnswerReview:
    """Review one answer's content, returning ``unavailable`` on any failure.

    No retry loop is added here: ``call_structured`` retries schema misses and
    the shared client retries transient transport failures (``plan-A`` §4.5).
    """
    try:
        if not llm.is_configured():
            logger.warning("답변 판별 fallback: LLM이 설정되지 않았습니다.")
            return _unavailable(_NOT_CONFIGURED_REASON)

        settings = get_settings()
        result = llm.call_structured(
            model=settings.eval_model,
            system=ANSWER_REVIEW_SYSTEM_PROMPT,
            user=build_user_prompt(question, transcript, essay),
            output_format=_LLMAnswerReview,
        )
        return AnswerReview(**result.model_dump())
    except llm.LLMError as error:
        logger.warning("답변 판별 fallback: %s", error)
        return _unavailable(_FAILURE_REASON)
    except Exception as error:  # Defensive: review must never stop a session.
        logger.warning("답변 판별 fallback: 예상하지 못한 오류: %s", error)
        return _unavailable(_FAILURE_REASON)
