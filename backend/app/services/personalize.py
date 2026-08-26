"""Question personalization service (``plan.md`` §4.2, ``docs/plan-A.md`` §7).

The selected question alone is sent to the LLM.  Every failure falls back to
the original text so personalization can never interrupt an interview session.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from app.config import get_settings
from app.prompts.personalize import PERSONALIZE_SYSTEM_PROMPT, build_user_prompt
from app.schemas import Question
from app.services import llm

logger = logging.getLogger(__name__)

_MAX_LENGTH = 200
# Opening quote → its closing partner. Only balanced pairs are stripped, so an
# inner quotation ('협업') is never half-eaten by an unpaired outer strip.
_QUOTE_PAIRS = {'"': '"', "'": "'", "“": "”", "‘": "’"}
# Half-width and full-width question marks are both fine sentence endings.
_QUESTION_MARKS = ("?", "？")


def _strip_outer_quotes(text: str) -> str:
    """Remove balanced wrapping quote pairs, one layer at a time."""
    while len(text) >= 2 and _QUOTE_PAIRS.get(text[0]) == text[-1]:
        text = text[1:-1].strip()
    return text


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
        personalized = _strip_outer_quotes(" ".join(result.split()))

        if (
            not personalized
            or len(personalized) > _MAX_LENGTH
            or not personalized.endswith(_QUESTION_MARKS)
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


def personalize_questions(
    profile: dict[str, Any],
    essay: str | None,
    questions: list[Question],
) -> list[Question]:
    """Personalize a question set concurrently while preserving input order."""
    if not questions or not llm.is_configured() or (not essay and not profile):
        return questions

    with ThreadPoolExecutor(max_workers=min(8, len(questions))) as executor:
        personalized_texts = executor.map(
            lambda question: personalize_question(profile, essay, question), questions
        )
        return [
            question.model_copy(
                update={"text": personalized, "original_text": question.text}
            )
            if personalized != question.text
            else question
            for question, personalized in zip(questions, personalized_texts, strict=True)
        ]
