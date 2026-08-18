from __future__ import annotations

from functools import lru_cache

from .io import read_json
from .paths import RUBRIC_PATH, RULES_PATH


@lru_cache(maxsize=1)
def load_rubric() -> dict:
    return read_json(RUBRIC_PATH)


@lru_cache(maxsize=1)
def load_rules() -> dict:
    if not RULES_PATH.exists():
        raise FileNotFoundError(
            f"new_framework rules.json not found: {RULES_PATH}. "
            "Place this patch in the InterReview new_framework repository root."
        )
    return read_json(RULES_PATH)


def rule_groups() -> dict[str, dict]:
    return {g["id"]: g for g in load_rules()["groups"]}


def rubric_groups() -> dict[str, dict]:
    return load_rubric()["specialized"]


def group_metadata(group_id: str) -> dict:
    groups = rule_groups()
    if group_id not in groups:
        raise KeyError(f"unknown rules.json group id: {group_id}")
    specialized = rubric_groups()
    if group_id not in specialized:
        raise KeyError(f"rubric missing specialized definition for: {group_id}")
    return {
        "id": group_id,
        "name": groups[group_id]["name"],
        "specialized_metric": specialized[group_id]["metric"],
        "domains": groups[group_id]["domains"],
    }


def validate_rubric_rule_mapping() -> list[str]:
    errors: list[str] = []
    rules = rule_groups()
    rubric = rubric_groups()
    if set(rules) != set(rubric):
        missing = sorted(set(rules) - set(rubric))
        extra = sorted(set(rubric) - set(rules))
        if missing:
            errors.append(f"rubric missing rules groups: {missing}")
        if extra:
            errors.append(f"rubric has unknown groups: {extra}")
    for gid, rgroup in rules.items():
        if gid in rubric and rubric[gid].get("group_name") != rgroup.get("name"):
            errors.append(
                f"group name mismatch for {gid}: rules={rgroup.get('name')!r}, "
                f"rubric={rubric[gid].get('group_name')!r}"
            )
    return errors
