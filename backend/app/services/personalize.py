"""Question personalization service (``plan.md`` §4.2, ``docs/plan-A.md`` §7).

The selected question alone is sent to the LLM.  Every failure falls back to
the original text so personalization can never interrupt an interview session.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings
from app.prompts.personalize import PERSONALIZE_SYSTEM_PROMPT, build_user_prompt
from app.schemas import Question
from app.services import llm

logger = logging.getLogger(__name__)

_MAX_LENGTH = 200
_EDGE_QUOTES = "\"'“”"


def personalize_question(
    profile: dict[str, Any],
    essay: str | None,
    question: Question,
) -> str:
    """Return one personalized question, or the original text on any failure.

    No additional retry loop is needed here: the shared Anthropic client uses
    ``max_retries=2`` for transient transport failures (``plan-A`` §7.3).
    """
    original = question.text

    try:
        if not llm.is_configured():
            logger.warning("질문 개인화 fallback: LLM이 설정되지 않았습니다.")
            return original

        settings = get_settings()
        result = llm.call_text(
            model=settings.personalize_model,
            system=PERSONALIZE_SYSTEM_PROMPT,
            user=build_user_prompt(original, profile, essay),
            effort="low",
        )
        personalized = " ".join(result.strip().split()).strip(_EDGE_QUOTES).strip()

        if (
            not personalized
            or len(personalized) > _MAX_LENGTH
            or not personalized.endswith("?")
        ):
            logger.warning("질문 개인화 fallback: LLM 응답 검증에 실패했습니다.")
            return original

        return personalized
    except llm.LLMError as error:
        logger.warning("질문 개인화 fallback: %s", error)
        return original
    except Exception as error:  # Defensive: personalization must never stop a session.
        logger.warning("질문 개인화 fallback: 예상하지 못한 오류: %s", error)
        return original
