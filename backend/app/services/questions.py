"""Generate one random interview question per service group."""

from __future__ import annotations

import hashlib
import json
import os
import random
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.schemas import Question
from app.services.question_relevance import is_profile_related

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
ROLE_SCOPED_GROUPS = frozenset({"job_technology", "problem_solving"})
ROLE_SCOPES = frozenset(
    {
        "common",
        "frontend",
        "backend",
        "data_ai",
        "database",
        "security",
        "infra_cloud",
        "devops",
        "mobile",
    }
)
ROLE_PRIORITY_VALUES = frozenset({"primary", "secondary"})
# ponytail: conservative free-text mapping; use explicit canonical scopes if coverage grows.
_ROLE_SCOPE_ALIASES = {
    "common": ("common", "공통", "일반"),
    "frontend": ("frontend", "front end", "front-end", "프론트"),
    "backend": ("backend", "back end", "back-end", "백엔드", "서버"),
    "data_ai": (
        "data_ai",
        "data ai",
        "data scientist",
        "data analyst",
        "data engineer",
        "machine learning",
        "deep learning",
        "인공지능",
        "머신러닝",
        "딥러닝",
        "데이터 사이언스",
        "데이터 분석",
        "데이터 엔지니어",
    ),
    "database": ("database", "data base", "db", "dba", "sql", "데이터베이스"),
    "security": ("security", "cyber", "보안", "정보보안", "정보 보호"),
    "infra_cloud": (
        "infra_cloud",
        "infra cloud",
        "infrastructure",
        "infra",
        "cloud",
        "aws",
        "azure",
        "gcp",
        "클라우드",
        "인프라",
    ),
    "devops": (
        "devops",
        "dev ops",
        "sre",
        "platform",
        "플랫폼",
        "배포",
        "운영",
    ),
    "mobile": (
        "mobile",
        "android",
        "ios",
        "모바일",
        "안드로이드",
        "아이폰",
    ),
}

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


def resolve_role_scopes(job_role: Any) -> frozenset[str]:
    """Resolve canonical role scopes from a profile job label."""
    if isinstance(job_role, str):
        values = (job_role,)
    elif isinstance(job_role, (list, tuple, set, frozenset)):
        values = tuple(value for value in job_role if isinstance(value, str))
    else:
        values = ()

    scopes: set[str] = set()
    for value in values:
        normalized = " ".join(
            value.casefold().replace("_", " ").replace("-", " ").split()
        )
        for scope, aliases in _ROLE_SCOPE_ALIASES.items():
            if any(alias in normalized for alias in aliases):
                scopes.add(scope)
    return frozenset(scopes)


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
        role_scopes = item.get("role_scopes") if isinstance(item, dict) else None
        role_priority = item.get("role_priority") if isinstance(item, dict) else None
        role_scopes_valid = role_scopes is None or (
            group_id in ROLE_SCOPED_GROUPS
            and isinstance(role_scopes, list)
            and bool(role_scopes)
            and all(
                isinstance(scope, str) and scope in ROLE_SCOPES
                for scope in role_scopes
            )
        )
        role_priority_valid = role_priority is None
        if role_scopes_valid and isinstance(role_scopes, list) and len(role_scopes) > 1:
            role_priority_valid = (
                isinstance(role_priority, dict)
                and set(role_priority) == set(role_scopes)
                and all(
                    isinstance(value, str) and value in ROLE_PRIORITY_VALUES
                    for value in role_priority.values()
                )
                and "primary" in role_priority.values()
            )
        elif role_priority is not None:
            role_priority_valid = False
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("question"), str)
            or not item["question"].strip()
            or not isinstance(intent, dict)
            or not isinstance(intent.get("category"), str)
            or not isinstance(intent.get("expression"), str)
            or not role_scopes_valid
            or not role_priority_valid
        ):
            raise QuestionBankError(f"질문은행 문항 형식이 올바르지 않습니다: {path}:{index}")
    return tuple(payload)


def _role_filtered_candidates(
    group_id: str,
    candidates: list[dict[str, Any]],
    requested_scopes: frozenset[str],
    rng: random.Random | None = None,
    profile: Mapping[str, Any] | None = None,
    essay: str | None = None,
) -> list[dict[str, Any]]:
    if group_id not in ROLE_SCOPED_GROUPS:
        return candidates

    if requested_scopes:
        matching = [
            item
            for item in candidates
            if set(item.get("role_scopes") or ()) & requested_scopes
        ]
        if matching:
            primary: list[dict[str, Any]] = []
            secondary: list[dict[str, Any]] = []
            for item in matching:
                scopes = set(item.get("role_scopes") or ())
                if len(scopes) <= 1:
                    primary.append(item)
                    continue
                priorities = item.get("role_priority") or {}
                # Runtime loading rejects malformed metadata; keep direct helper
                # callers compatible with pre-priority candidate dictionaries.
                if not priorities:
                    primary.append(item)
                    continue
                matched_priorities = [
                    priorities.get(scope)
                    for scope in requested_scopes
                    if scope in scopes
                ]
                if "primary" in matched_priorities:
                    primary.append(item)
                elif "secondary" in matched_priorities and is_profile_related(
                    _candidate_relevance_text(item), profile, essay
                ):
                    secondary.append(item)

            if primary:
                secondary_limit = min(3, len(primary))
                if len(secondary) > secondary_limit:
                    secondary = (rng or random.Random()).sample(
                        secondary, secondary_limit
                    )
                return primary + secondary
            if secondary:
                return secondary

    common = [
        item for item in candidates if "common" in (item.get("role_scopes") or ())
    ]
    if common:
        return common

    if requested_scopes:
        return []

    multi_scope = [
        item
        for item in candidates
        if len(item.get("role_scopes") or ()) > 1
    ]
    if multi_scope:
        return multi_scope
    return candidates


def _candidate_relevance_text(item: dict[str, Any]) -> str:
    intent = item.get("answer_intent") or {}
    return " ".join(
        str(value)
        for value in (
            item.get("question", ""),
            intent.get("category", ""),
            intent.get("expression", ""),
        )
        if value
    )


def _pick_group_question(
    group_id: str,
    used_ids: set[str],
    used_texts: set[str],
    rng: random.Random,
    requested_scopes: frozenset[str] = frozenset(),
    profile: Mapping[str, Any] | None = None,
    essay: str | None = None,
) -> dict[str, Any]:
    candidates = [
        item
        for item in _load_group_questions(group_id)
        if item["question"] not in used_texts
        and _question_id(group_id, item) not in used_ids
    ]
    candidates = _role_filtered_candidates(
        group_id,
        candidates,
        requested_scopes,
        rng,
        profile,
        essay,
    )
    if not candidates:
        raise QuestionBankError(f"질문 그룹에 사용 가능한 문항이 없습니다: {group_id}")
    return rng.choice(candidates)


def generate_questions(
    seed: int | None = None,
    job_role: Any = None,
    profile: Mapping[str, Any] | None = None,
    essay: str | None = None,
) -> list[Question]:
    """Generate one random new-applicant question from each service group."""
    rng = random.Random(seed) if seed is not None else random.SystemRandom()
    used_ids: set[str] = set()
    requested_scopes = resolve_role_scopes(job_role)
    used_texts: set[str] = set()
    selected: list[Question] = []
    for index, (group_id, group_name) in enumerate(GROUPS, start=1):
        source = _pick_group_question(
            group_id,
            used_ids,
            used_texts,
            rng,
            requested_scopes,
            profile,
            essay,
        )
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
