"""Generate interview questions from the ICT question-bank rules.

``rules.json`` defines the service-facing groups and the source domains from
which one question is randomly selected per group.
"""

from __future__ import annotations

import hashlib
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
NEW_QUESTION_BANK_ROOT = QUESTION_BANK_ROOT / "new"


class QuestionBankError(RuntimeError):
    """Raised when the configured question bank or its rules are unusable."""


def _question_id(
    category: str, expression: str, source: dict[str, Any]
) -> str:
    identity = "\x1f".join(
        [
            "NEW",
            category,
            expression,
            str(source.get("source_file") or ""),
            str(source["question"]),
        ]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


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
    category: str, expression: str
) -> tuple[dict[str, Any], ...]:
    """Load and cache one domain from the new-applicant question bank."""
    path = NEW_QUESTION_BANK_ROOT / f"{category}__{expression}.json"
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
    domains: list[dict[str, str]],
    used_ids: set[str],
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
            for item in _load_domain_questions(category, expression)
            if item["question"] not in used_texts
            and _question_id(category, expression, item) not in used_ids
        ]
        if questions:
            return domain, rng.choice(questions)
    raise QuestionBankError(
        "신입 질문은행에서 규칙 그룹에 맞는 질문을 찾지 못했습니다."
    )


def generate_questions(seed: int | None = None) -> list[Question]:
    """Generate a rule-balanced new-applicant question set."""
    rules = _load_rules()
    rng = random.Random(seed) if seed is not None else random.SystemRandom()

    used_ids: set[str] = set()
    used_texts: set[str] = set()
    selected: list[Question] = []
    for index, group in enumerate(rules["groups"], start=1):
        domain, source = _pick_group_question(group["domains"], used_ids, used_texts, rng)
        text = source["question"]
        question_id = _question_id(domain["category"], domain["expression"], source)
        used_ids.add(question_id)
        used_texts.add(text)
        selected.append(
            Question(
                id=f"q{index}",
                question_id=question_id,
                category=group["name"],
                rule_group=group["id"],
                subcategory=f"{domain['category']}::{domain['expression']}",
                text=text,
                original_text=text,
                source_file=source.get("source_file"),
                occurrence_count=source.get("occurrence_count", 1),
            )
        )
    return selected
