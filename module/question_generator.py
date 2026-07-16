"""Generate interview questions by applying the ICT question-bank rules."""

from __future__ import annotations

import json
import os
import random
from functools import lru_cache
from pathlib import Path
from collections.abc import Callable
from typing import Any

from module.kanana_llm import KananaLLMError, get_kanana_llm
from module.kanana_personalizer import personalize_questions

APP_ROOT = Path(__file__).resolve().parents[1]
# Keep the question bank inside the deployable application.  An environment
# variable is useful when a larger bank is mounted as a volume in production.
QUESTION_BANK_ROOT = Path(
    os.environ.get("QUESTION_BANK_ROOT", APP_ROOT / "question_banks" / "ict")
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


ProgressCallback = Callable[[str, float], None]


def _notify(progress_callback: ProgressCallback | None, message: str, progress: float) -> None:
    """Send optional, bounded generation progress to a UI caller."""
    if progress_callback is not None:
        progress_callback(message, max(0.0, min(1.0, progress)))


def _experience_from_profile(profile: dict[str, Any]) -> str:
    """Normalize a profile experience value, defaulting to the new bank."""
    value = str(profile.get("experience", "NEW")).strip().upper()
    return EXPERIENCE_ALIASES.get(value, "NEW")


@lru_cache(maxsize=1)
def _load_rules() -> dict[str, Any]:
    """Load and validate the editable service-question grouping rules."""
    try:
        with RULES_PATH.open("r", encoding="utf-8") as handle:
            rules = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise QuestionBankError(f"질문 생성 규칙을 읽을 수 없습니다: {RULES_PATH}") from error

    groups = rules.get("groups") if isinstance(rules, dict) else None
    selection = rules.get("selection") if isinstance(rules, dict) else None
    expected_count = selection.get("questions_per_interview") if isinstance(selection, dict) else None
    if not isinstance(groups, list) or not groups or expected_count != len(groups):
        raise QuestionBankError("rules.json의 groups와 questions_per_interview 설정이 올바르지 않습니다.")
    for group in groups:
        domains = group.get("domains") if isinstance(group, dict) else None
        if not isinstance(group, dict) or not group.get("id") or not group.get("name") or not isinstance(domains, list) or not domains:
            raise QuestionBankError("rules.json의 각 질문 그룹에는 id, name, domains가 필요합니다.")
        if any(not isinstance(domain, dict) or not domain.get("category") or not domain.get("expression") for domain in domains):
            raise QuestionBankError("rules.json의 domains에는 category와 expression이 필요합니다.")
    return rules


@lru_cache(maxsize=64)
def _load_domain_questions(experience: str, category: str, expression: str) -> tuple[dict[str, Any], ...]:
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
    return tuple(question for question in questions if isinstance(question, dict) and question.get("question"))


def _pick_group_question(
    experience: str,
    domains: list[dict[str, str]],
    used_texts: set[str],
    rng: random.Random | random.SystemRandom,
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
    raise QuestionBankError(f"{experience} 질문은행에서 규칙 그룹에 맞는 질문을 찾지 못했습니다.")


def generate_questions(
    profile: dict[str, Any],
    progress_callback: ProgressCallback | None = None,
) -> list[dict[str, Any]]:
    """Generate six rule-balanced questions and personalize them with Kanana.

    ``question_banks/ict/rules.json`` is the single source of truth for the
    service-facing groups and source intent tags. Set ``profile['experience']``
    to ``NEW``/``신입`` or ``EXPERIENCED``/``경력`` to choose a bank.
    """
    _notify(progress_callback, "Kanana 모델을 다운로드하거나 로딩하는 중입니다.", 0.0)
    try:
        llm = get_kanana_llm()
        _notify(progress_callback, "Kanana 모델 로딩이 완료되었습니다.", 0.15)
    except KananaLLMError:
        llm = None
        _notify(progress_callback, "Kanana를 사용할 수 없어 질문은행 원문으로 생성합니다.", 0.15)

    _notify(progress_callback, "질문 생성 규칙을 불러오는 중입니다.", 0.18)
    rules = _load_rules()
    experience = _experience_from_profile(profile)
    seed = profile.get("question_seed")
    rng = random.Random(seed) if seed is not None else random.SystemRandom()
    used_texts: set[str] = set()
    selected: list[dict[str, Any]] = []

    for index, group in enumerate(rules["groups"], start=1):
        _notify(
            progress_callback,
            f"{index}/{len(rules['groups'])}번 질문을 생성하는 중입니다.",
            0.20 + (0.30 * index / len(rules["groups"])),
        )
        domain, source = _pick_group_question(experience, group["domains"], used_texts, rng)
        text = source["question"]
        used_texts.add(text)
        selected.append(
            {
                "id": f"q{index}",
                "category": group["name"],
                "rule_group": group["id"],
                "subcategory": f"{domain['category']}::{domain['expression']}",
                "experience": experience,
                "text": text,
                "source_file": source.get("source_file"),
                "occurrence_count": source.get("occurrence_count", 1),
            }
        )
    _notify(progress_callback, "질문은행 선택을 완료했습니다.", 0.52)
    return personalize_questions(profile, selected, llm=llm, progress_callback=progress_callback)
