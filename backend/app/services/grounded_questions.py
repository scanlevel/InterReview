"""Generate essay/profile-grounded questions for the B question set.

The function is deliberately failure-tolerant: B can always use the question
bank item selected for the same domain when this A-owned call is unavailable.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any, Literal

from app.config import get_settings
from app.prompts.grounded_questions import (
    GROUNDED_QUESTIONS_SYSTEM_PROMPT,
    build_user_prompt,
)
from app.schemas import GroundedQuestion, GroundedQuestionSet
from app.services import llm
from app.services.question_relevance import extract_registered_tokens, normalize_text

logger = logging.getLogger(__name__)

GroundedDomain = Literal["resume", "job_technology"]
_DOMAINS: tuple[GroundedDomain, ...] = ("resume", "job_technology")
_QUESTION_MARKS = ("?", "？")
_MAX_QUESTION_LENGTH = 200


def _field_text(value: Any) -> list[str]:
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, (list, tuple, set, frozenset)):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def grounding_text(
    profile: Mapping[str, Any] | None = None,
    essay: str | None = None,
) -> str:
    """Return only applicant-provided fields allowed as evidence."""
    values: list[str] = []
    if profile:
        for key in ("resume_text", "technologies", "projects"):
            values.extend(_field_text(profile.get(key)))
    values.extend(_field_text(essay))
    return "\n".join(values)


def has_exact_evidence(evidence: str, source_text: str) -> bool:
    """Check evidence by conservative normalized substring membership."""
    normalized_evidence = normalize_text(evidence)
    return bool(normalized_evidence) and normalized_evidence in normalize_text(source_text)


def is_valid_grounded_question(
    item: GroundedQuestion,
    *,
    expected_domain: GroundedDomain | None = None,
    source_text: str = "",
) -> bool:
    """Validate the parts that the model cannot be trusted to enforce."""
    question = " ".join(item.question.split())
    if expected_domain is not None and item.domain != expected_domain:
        return False
    if (
        not question
        or len(question) > _MAX_QUESTION_LENGTH
        or not question.endswith(_QUESTION_MARKS)
        or sum(question.count(mark) for mark in _QUESTION_MARKS) != 1
        or any(mark in item.question for mark in ("\r", "\n"))
    ):
        return False
    if item.domain == "job_technology":
        question_tokens = extract_registered_tokens(question)
        source_tokens = extract_registered_tokens(source_text)
        if not question_tokens <= source_tokens:
            return False
    return has_exact_evidence(item.evidence, source_text)


def generate_grounded_questions(
    profile: Mapping[str, Any] | None = None,
    essay: str | None = None,
    excluded_questions: list[str] | None = None,
) -> dict[str, GroundedQuestion | None]:
    """Generate at most one validated question per requested domain.

    Any failure returns a partial/empty mapping so the caller can fall back per
    domain without interrupting question generation.
    """
    source_text = grounding_text(profile, essay)
    empty_result: dict[str, GroundedQuestion | None] = {
        "resume": None,
        "job_technology": None,
    }
    if not source_text:
        return empty_result

    try:
        if not llm.is_configured():
            logger.warning("자소서 기반 질문 fallback: LLM이 설정되지 않았습니다.")
            return empty_result
        settings = get_settings()
        result = llm.call_structured(
            model=settings.eval_model,
            system=GROUNDED_QUESTIONS_SYSTEM_PROMPT,
            user=build_user_prompt(profile, essay, excluded_questions or []),
            output_format=GroundedQuestionSet,
            max_tokens=1_500,
            effort="low",
        )
    except Exception as error:  # A failure is a domain-level fallback in B.
        logger.warning("자소서 기반 질문 fallback: %s", error)
        return empty_result

    if not isinstance(result, GroundedQuestionSet):
        try:
            result = GroundedQuestionSet.model_validate(result)
        except Exception as error:
            logger.warning("자소서 기반 질문 fallback: 응답 형식 오류: %s", error)
            return empty_result

    questions = dict(empty_result)
    for item in result.questions:
        if item.domain in _DOMAINS and questions[item.domain] is None:
            if is_valid_grounded_question(
                item,
                expected_domain=item.domain,
                source_text=source_text,
            ):
                questions[item.domain] = item.model_copy(
                    update={"question": " ".join(item.question.split())}
                )
    return questions
