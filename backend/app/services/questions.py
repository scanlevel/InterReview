"""Generate one random interview question per service group."""

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
NEW_QUESTION_BANK_ROOT = QUESTION_BANK_ROOT / "new"

GROUPS = (
    ("resume", "자기소개·이력"),
    ("values_personality", "가치관·성향"),
    ("job_technology", "직무·기술"),
    ("problem_solving", "문제 해결"),
    ("collaboration_organization", "협업·조직생활"),
    ("motivation_commitment", "지원동기·직무몰입"),
)
_GROUP_IDS = {group_id for group_id, _ in GROUPS}

_EXPERIENCED_QUESTION_MARKERS = (
    "경력",
    "이전 직장",
    "이전 회사",
    "전 직장",
    "전 회사",
    "전에 회사",
    "현 직장",
    "퇴사",
    "재직",
    "다니던 직장",
    "다니던 회사",
    "직장 생활을 할 때",
    "직장생활을 할 때",
)


def has_experienced_context(text: str) -> bool:
    return any(marker in text for marker in _EXPERIENCED_QUESTION_MARKERS)


class QuestionBankError(RuntimeError):
    """Raised when a six-file question bank is unusable."""


def _question_id(group_id: str, source: dict[str, Any]) -> str:
    answer_intent = source["answer_intent"]
    identity = "\x1f".join(
        [
            "NEW",
            group_id,
            answer_intent["category"],
            answer_intent["expression"],
            source["question"],
        ]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


@lru_cache(maxsize=len(GROUPS))
def _load_group_questions(group_id: str) -> tuple[dict[str, Any], ...]:
    """Load and validate one hard-coded service-group file."""
    if group_id not in _GROUP_IDS:
        raise QuestionBankError(f"알 수 없는 질문 그룹입니다: {group_id}")
    path = NEW_QUESTION_BANK_ROOT / f"{group_id}.json"
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise QuestionBankError(f"질문은행을 읽을 수 없습니다: {path}") from error
    if not isinstance(payload, list) or not payload:
        raise QuestionBankError(f"질문은행 형식이 올바르지 않거나 비어 있습니다: {path}")
    for index, item in enumerate(payload, start=1):
        intent = item.get("answer_intent") if isinstance(item, dict) else None
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("question"), str)
            or not item["question"].strip()
            or not isinstance(intent, dict)
            or not isinstance(intent.get("category"), str)
            or not isinstance(intent.get("expression"), str)
        ):
            raise QuestionBankError(f"질문은행 문항 형식이 올바르지 않습니다: {path}:{index}")
    return tuple(payload)


def _pick_group_question(
    group_id: str,
    used_ids: set[str],
    used_texts: set[str],
    rng: random.Random,
) -> dict[str, Any]:
    candidates = [
        item
        for item in _load_group_questions(group_id)
        if item["question"] not in used_texts
        and _question_id(group_id, item) not in used_ids
    ]
    if not candidates:
        raise QuestionBankError(f"질문 그룹에 사용 가능한 문항이 없습니다: {group_id}")
    return rng.choice(candidates)


def generate_questions(seed: int | None = None) -> list[Question]:
    """Generate one random new-applicant question from each service group."""
    rng = random.Random(seed) if seed is not None else random.SystemRandom()
    used_ids: set[str] = set()
    used_texts: set[str] = set()
    selected: list[Question] = []
    for index, (group_id, group_name) in enumerate(GROUPS, start=1):
        source = _pick_group_question(group_id, used_ids, used_texts, rng)
        answer_intent = source["answer_intent"]
        text = source["question"]
        question_id = _question_id(group_id, source)
        used_ids.add(question_id)
        used_texts.add(text)
        selected.append(
            Question(
                id=f"q{index}",
                question_id=question_id,
                category=group_name,
                rule_group=group_id,
                subcategory=(
                    f"{answer_intent['category']}::{answer_intent['expression']}"
                ),
                text=text,
                original_text=text,
                source_file=None,
                occurrence_count=1,
            )
        )
    return selected
