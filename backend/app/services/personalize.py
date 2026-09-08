"""B-owned question personalization service using the shared LLM client.

The selected question alone is sent to the LLM.  Every failure falls back to
the original text so personalization can never interrupt an interview session.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from time import perf_counter
from typing import Any

from app.config import get_settings
from app.prompts.personalize import PERSONALIZE_SYSTEM_PROMPT, build_user_prompt
from app.schemas import Question
from app.services import llm
from app.services.question_relevance import (
    evidence_registered_tokens,
    extract_registered_tokens,
    is_evidence_related,
)
from app.services.questions import has_experienced_context

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


def _relevance_text(question: Question, original: str) -> str:
    return " ".join(
        part.strip()
        for part in (original, question.subcategory or "")
        if isinstance(part, str) and part.strip()
    )


def _has_technical_topic(question: Question, original: str) -> bool:
    return bool(extract_registered_tokens(_relevance_text(question, original)))


def _uses_relevance_gate(question: Question, original: str) -> bool:
    if question.rule_group == "job_technology":
        return True
    return question.rule_group == "problem_solving" and _has_technical_topic(
        question, original
    )


def _parse_answer_intent(subcategory: str | None) -> dict[str, str] | None:
    if not isinstance(subcategory, str) or not subcategory.strip():
        return None
    category, separator, expression = subcategory.partition("::")
    if (
        separator
        and subcategory.count("::") == 1
        and category.strip()
        and expression.strip()
    ):
        return {"category": category.strip(), "expression": expression.strip()}
    return None


def _has_new_registered_token(
    original: str,
    personalized: str,
    essay: str | None,
) -> bool:
    allowed = extract_registered_tokens(original) | evidence_registered_tokens(essay)
    return not extract_registered_tokens(personalized) <= allowed


def personalize_question(
    profile: dict[str, Any],
    essay: str | None,
    question: Question,
) -> str:
    """Return one personalized question, or the original text on any failure.

    No additional retry loop is needed here: the shared Anthropic client uses
    ``max_retries=2`` for transient transport failures (``plan-A`` §7.3).
    """
    original = question.original_text or question.text

    try:
        relevance_gate = _uses_relevance_gate(question, original)
        relevance_text = _relevance_text(question, original)
        if relevance_gate and not is_evidence_related(relevance_text, essay):
            return original
        if not llm.is_configured():
            logger.warning("질문 개인화 fallback: LLM이 설정되지 않았습니다.")
            return original

        settings = get_settings()
        subcategory = question.subcategory
        answer_intent = _parse_answer_intent(subcategory)
        target_role = None
        if profile:
            target_role = profile.get("job_role") or profile.get("job")
            if isinstance(target_role, (list, tuple, set, frozenset)):
                target_role = ", ".join(
                    str(value) for value in target_role if str(value).strip()
                )
        user_prompt = build_user_prompt(
            original,
            profile,
            essay,
            target_role=target_role if isinstance(target_role, str) else None,
            subcategory=(
                subcategory.strip()
                if isinstance(subcategory, str) and subcategory.strip()
                else None
            ),
            answer_intent=answer_intent,
        )
        input_at = datetime.now().astimezone()
        started_at = perf_counter()
        result = llm.call_text(
            model=settings.personalize_model,
            system=PERSONALIZE_SYSTEM_PROMPT,
            user=user_prompt,
        )
        personalized = _strip_outer_quotes(" ".join(result.split()))

        validation_reasons: list[str] = []
        if not personalized:
            validation_reasons.append("empty")
        if len(personalized) > _MAX_LENGTH:
            validation_reasons.append("too_long")
        if has_experienced_context(personalized):
            validation_reasons.append("experienced_context")
        question_mark_count = sum(
            personalized.count(mark) for mark in _QUESTION_MARKS
        )
        if not personalized.endswith(_QUESTION_MARKS):
            validation_reasons.append("missing_question_mark")
        if question_mark_count > 1:
            validation_reasons.append("multiple_question_marks")
        if any(mark in personalized[:-1] for mark in ("!", "！", "。")):
            validation_reasons.append("inner_sentence_punctuation")
        if relevance_gate and _has_new_registered_token(original, personalized, essay):
            validation_reasons.append("new_registered_token")

        if validation_reasons:
            llm.record_failure(
                provider=settings.llm_provider,
                model=settings.personalize_model,
                kind="text",
                input_at=input_at,
                prompt=(
                    f"[system]\n{PERSONALIZE_SYSTEM_PROMPT}\n\n"
                    f"[user]\n{user_prompt}"
                ),
                wait_ms=(perf_counter() - started_at) * 1_000,
                answer=result,
                reason="LLM 응답 검증 실패: " + ",".join(validation_reasons),
            )
            logger.warning(
                "질문 개인화 fallback: LLM 응답 검증 실패 reasons=%s",
                ",".join(validation_reasons),
            )
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
