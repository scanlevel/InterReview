"""Generate interview questions from the ICT question-bank rules.

Ported from the Streamlit ``module/question_generator.py`` with the Kanana
local-model dependency and the Streamlit progress callback removed. Question
personalization (previously Kanana) will be reintroduced later as an optional
LLM step; for now the rule-bank text is returned verbatim.

``rules.json`` is the single source of truth: it defines the service-facing
groups and, per group, the source domains to draw one question from.
"""

from __future__ import annotations

import json
import os
import random
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.schemas import Question

# backend/app/services/questions.py -> parents[2] == backend/
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
QUESTION_BANK_ROOT = Path(
    os.environ.get("QUESTION_BANK_ROOT", _BACKEND_ROOT / "question_banks" / "ict")
).expanduser()
RULES_PATH = QUESTION_BANK_ROOT / "rules.json"

EXPERIENCE_ALIASES = {
    "NEW": "NEW",
    "신입": "NEW",
    "EXPERIENCED": "EXPERIENCED",
    "경력": "EXPERIENCED",
}


class QuestionBankError(RuntimeError):
    """Raised when the configured question bank or its rules are unusable."""


def _experience_from_profile(profile: dict[str, Any]) -> str:
    """Normalize a profile experience value, defaulting to the new bank."""
    value = str(profile.get("experience", "NEW")).strip().upper()
    return EXPERIENCE_ALIASES.get(value, "NEW")


@lru_cache(maxsize=1)
def _load_rules() -> dict[str, Any]:
    """Load and validate the question-grouping rules."""
    try:
        with RULES_PATH.open("r", encoding="utf-8") as handle:
            rules = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise QuestionBankError(f"질문 생성 규칙을 읽을 수 없습니다: {RULES_PATH}") from error

    groups = rules.get("groups") if isinstance(rules, dict) else None
    selection = rules.get("selection") if isinstance(rules, dict) else None
    expected_count = (
        selection.get("questions_per_interview") if isinstance(selection, dict) else None
    )
    if not isinstance(groups, list) or not groups or expected_count != len(groups):
        raise QuestionBankError(
            "rules.json의 groups와 questions_per_interview 설정이 올바르지 않습니다."
        )
    for group in groups:
        domains = group.get("domains") if isinstance(group, dict) else None
        if (
            not isinstance(group, dict)
            or not group.get("id")
            or not group.get("name")
            or not isinstance(domains, list)
            or not domains
        ):
            raise QuestionBankError(
                "rules.json의 각 질문 그룹에는 id, name, domains가 필요합니다."
            )
        if any(
            not isinstance(domain, dict)
            or not domain.get("category")
            or not domain.get("expression")
            for domain in domains
        ):
            raise QuestionBankError("rules.json의 domains에는 category와 expression이 필요합니다.")
    return rules


@lru_cache(maxsize=64)
def _load_domain_questions(
    experience: str, category: str, expression: str
) -> tuple[dict[str, Any], ...]:
    """Load and cache one experience/domain question-bank JSON file."""
    path = QUESTION_BANK_ROOT / experience.lower() / f"{category}__{expression}.json"
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise QuestionBankError(f"질문은행을 읽을 수 없습니다: {path}") from error

    questions = payload.get("questions") if isinstance(payload, dict) else None
    if not isinstance(questions, list):
        raise QuestionBankError(f"질문은행 형식이 올바르지 않습니다: {path}")
    return tuple(
        q for q in questions if isinstance(q, dict) and q.get("question")
    )


def _pick_group_question(
    experience: str,
    domains: list[dict[str, str]],
    used_texts: set[str],
    rng: random.Random,
) -> tuple[dict[str, str], dict[str, Any]]:
    """Select one non-duplicate question from a rule group's source domains."""
    candidates = list(domains)
    rng.shuffle(candidates)
    for domain in candidates:
        category, expression = domain["category"], domain["expression"]
        questions = [
            item
            for item in _load_domain_questions(experience, category, expression)
            if item["question"] not in used_texts
        ]
        if questions:
            return domain, rng.choice(questions)
    raise QuestionBankError(
        f"{experience} 질문은행에서 규칙 그룹에 맞는 질문을 찾지 못했습니다."
    )


def generate_questions(profile: dict[str, Any], seed: int | None = None) -> list[Question]:
    """Generate the rule-balanced set of interview questions (one per group).

    Set ``profile['experience']`` to ``NEW``/``신입`` or ``EXPERIENCED``/``경력``
    to choose a bank. Pass ``seed`` for reproducible selection.
    """
    rules = _load_rules()
    experience = _experience_from_profile(profile)
    # ``profile['question_seed']`` kept for backward compatibility with callers.
    effective_seed = seed if seed is not None else profile.get("question_seed")
    rng = random.Random(effective_seed) if effective_seed is not None else random.SystemRandom()

    used_texts: set[str] = set()
    selected: list[Question] = []
    for index, group in enumerate(rules["groups"], start=1):
        domain, source = _pick_group_question(
            experience, group["domains"], used_texts, rng
        )
        text = source["question"]
        used_texts.add(text)
        selected.append(
            Question(
                id=f"q{index}",
                category=group["name"],
                rule_group=group["id"],
                subcategory=f"{domain['category']}::{domain['expression']}",
                experience=experience,
                text=text,
                source_file=source.get("source_file"),
                occurrence_count=source.get("occurrence_count", 1),
            )
        )
    return selected
