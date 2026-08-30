"""Validate the six-file ICT question bank used at runtime."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CAREER_CONTEXT_MARKERS = (
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

SERVICE_GROUPS = (
    "resume",
    "values_personality",
    "job_technology",
    "problem_solving",
    "collaboration_organization",
    "motivation_commitment",
)
EXPECTED_ITEM_KEYS = {"question", "answer_intent"}
EXPECTED_INTENT_KEYS = {"category", "expression"}
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


@dataclass(frozen=True)
class QuestionEntry:
    file_name: str
    service_group: str
    question: str
    answer_intent: dict[str, Any]
    role_scopes: tuple[str, ...] = ()


def default_bank_root() -> Path:
    return Path(__file__).resolve().parents[1] / "question_banks" / "ict"


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _career_candidate(text: str) -> bool:
    return any(marker in text for marker in CAREER_CONTEXT_MARKERS)


def collect_entries(bank_root: Path) -> tuple[list[QuestionEntry], list[str]]:
    errors: list[str] = []
    new_root = bank_root / "new"
    if not new_root.is_dir():
        return [], [f"질문은행 디렉터리가 없습니다: {new_root}"]

    expected_files = {f"{group}.json" for group in SERVICE_GROUPS}
    actual_files = {path.name for path in new_root.glob("*.json")}
    for file_name in sorted(expected_files - actual_files):
        errors.append(f"서비스 그룹 파일이 없습니다: {new_root / file_name}")
    for file_name in sorted(actual_files - expected_files):
        errors.append(f"허용되지 않은 질문은행 파일: {new_root / file_name}")

    entries: list[QuestionEntry] = []
    for group_id in SERVICE_GROUPS:
        file_name = f"{group_id}.json"
        path = new_root / file_name
        if not path.is_file():
            continue
        try:
            payload = _load_json(path)
        except (OSError, json.JSONDecodeError) as error:
            errors.append(f"질문은행 파일을 읽을 수 없습니다 ({file_name}): {error}")
            continue
        if not isinstance(payload, list) or not payload:
            errors.append(f"질문 배열이 없거나 비어 있습니다: {file_name}")
            continue
        for index, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                errors.append(f"문항이 객체가 아닙니다: {file_name}:{index}")
                continue
            expected_item_keys = (
                EXPECTED_ITEM_KEYS | {"role_scopes"}
                if group_id in ROLE_SCOPED_GROUPS
                else EXPECTED_ITEM_KEYS
            )
            if set(item) not in (EXPECTED_ITEM_KEYS, expected_item_keys):
                errors.append(f"문항 필드가 최소 스키마와 다릅니다: {file_name}:{index}")
            question = item.get("question")
            answer_intent = item.get("answer_intent")
            if not isinstance(question, str) or not question.strip():
                errors.append(f"빈 질문: {file_name}:{index}")
                continue
            if (
                not isinstance(answer_intent, dict)
                or set(answer_intent) != EXPECTED_INTENT_KEYS
                or not all(
                    isinstance(answer_intent.get(key), str)
                    and answer_intent[key].strip()
                    for key in EXPECTED_INTENT_KEYS
                )
            ):
                errors.append(f"answer_intent 형식 오류: {file_name}:{index}")
                continue
            has_role_scopes = "role_scopes" in item
            role_scopes = item.get("role_scopes")
            if has_role_scopes and (
                group_id not in ROLE_SCOPED_GROUPS
                or not isinstance(role_scopes, list)
                or not role_scopes
                or not all(
                    isinstance(scope, str) and scope in ROLE_SCOPES
                    for scope in role_scopes
                )
            ):
                errors.append(f"role_scopes 형식 오류: {file_name}:{index}")
                continue
            entries.append(
                QuestionEntry(
                    file_name=file_name,
                    service_group=group_id,
                    question=question,
                    answer_intent=answer_intent,
                    role_scopes=tuple(role_scopes or ()),
                )
            )
    return entries, errors


def validate_question_bank(bank_root: Path | None = None) -> dict[str, Any]:
    root = bank_root or default_bank_root()
    entries, errors = collect_entries(root)
    by_text: dict[str, list[QuestionEntry]] = defaultdict(list)
    for entry in entries:
        by_text[entry.question].append(entry)
    duplicate_groups = {text: group for text, group in by_text.items() if len(group) > 1}
    service_counts = Counter(entry.service_group for entry in entries)
    service_unique_counts = Counter()
    for text, group in by_text.items():
        service_unique_counts[group[0].service_group] += 1
    role_scope_counts: dict[str, dict[str, int]] = {}
    role_scope_unscoped: dict[str, int] = {}
    for group_id in ROLE_SCOPED_GROUPS:
        group_entries = [entry for entry in entries if entry.service_group == group_id]
        role_scope_counts[group_id] = dict(
            Counter(
                scope
                for entry in group_entries
                for scope in entry.role_scopes
            )
        )
        role_scope_unscoped[group_id] = sum(
            not entry.role_scopes for entry in group_entries
        )
    career_candidates = [entry for entry in entries if _career_candidate(entry.question)]
    expected_files = {f"{group}.json" for group in SERVICE_GROUPS}
    actual_files = {path.name for path in (root / "new").glob("*.json")}
    return {
        "errors": errors,
        "total_questions": len(entries),
        "exact_unique_questions": len(by_text),
        "duplicate_questions": len(entries) - len(by_text),
        "duplicate_groups": len(duplicate_groups),
        "career_context_candidates": len(career_candidates),
        "career_candidates": career_candidates,
        "service_group_candidates": {
            group: service_counts.get(group, 0) for group in SERVICE_GROUPS
        },
        "service_group_unique_candidates": {
            group: service_unique_counts.get(group, 0) for group in SERVICE_GROUPS
        },
        "role_scope_counts": role_scope_counts,
        "role_scope_unscoped": role_scope_unscoped,
        "service_group_files": len(actual_files & expected_files),
        "question_bank_files": sorted(actual_files),
    }


def print_report(report: dict[str, Any]) -> None:
    print(f"서비스 그룹 파일 수: {report['service_group_files']}")
    print(f"전체 질문 수: {report['total_questions']}")
    print(f"exact unique 질문 수: {report['exact_unique_questions']}")
    print(f"duplicate 수: {report['duplicate_questions']} ({report['duplicate_groups']} groups)")
    print(f"경력 전제 후보 수: {report['career_context_candidates']}")
    print("service group별 후보 수:")
    for group_id, count in report["service_group_candidates"].items():
        unique_count = report["service_group_unique_candidates"][group_id]
        print(f"  {group_id}: {count} (unique={unique_count})")
    print("role scope별 후보 수:")
    for group_id in sorted(ROLE_SCOPED_GROUPS):
        print(
            f"  {group_id}: {report['role_scope_counts'][group_id]} "
            f"(unscoped={report['role_scope_unscoped'][group_id]})"
        )
    if report["career_candidates"]:
        print("경력 전제 후보:")
        for entry in report["career_candidates"]:
            print(f"  {entry.file_name} | {entry.question}")
    if report["errors"]:
        print("검증 오류:")
        for error in report["errors"]:
            print(f"  - {error}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=default_bank_root())
    parser.add_argument("--check", action="store_true", help="중복·경력 후보까지 오류로 처리")
    args = parser.parse_args()
    report = validate_question_bank(args.root)
    print_report(report)
    if report["errors"]:
        return 1
    if args.check and (
        report["duplicate_questions"] or report["career_context_candidates"]
    ):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
