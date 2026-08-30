"""Validate and report the runtime ICT new-applicant question bank.

This is an offline data check.  It intentionally does not import the runtime
question selector or any LLM code, so the report describes the JSON source
that Track B hands to the selector.
"""

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

ROLE_SCOPES = {
    "common", "frontend", "backend", "data_ai", "database",
    "security", "infra_cloud", "devops", "mobile",
}


@dataclass(frozen=True)
class QuestionEntry:
    file_name: str
    category: str
    expression: str
    rule_group: str
    question: str
    source_file: str | None
    answer_intent: dict[str, Any] | None
    occurrence_count: Any
    review_index: int
    review_decision: str


def default_bank_root() -> Path:
    return Path(__file__).resolve().parents[1] / "question_banks" / "ict"


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _career_candidate(text: str) -> bool:
    return any(marker in text for marker in CAREER_CONTEXT_MARKERS)


def collect_entries(bank_root: Path) -> tuple[dict[str, Any], list[QuestionEntry], list[str]]:
    errors: list[str] = []
    rules_path = bank_root / "rules.json"
    try:
        rules = _load_json(rules_path)
    except (OSError, json.JSONDecodeError) as error:
        return {}, [], [f"rules.json을 읽을 수 없습니다: {error}"]

    groups = rules.get("groups") if isinstance(rules, dict) else None
    selection = rules.get("selection") if isinstance(rules, dict) else None
    expected_count = selection.get("questions_per_interview") if isinstance(selection, dict) else None
    if not isinstance(groups, list) or expected_count != len(groups):
        errors.append("rules.json의 groups와 questions_per_interview가 일치하지 않습니다.")
    group_ids = (
        {group.get("id") for group in groups if isinstance(group, dict)}
        if isinstance(groups, list)
        else set()
    )

    entries: list[QuestionEntry] = []
    referenced_files: set[str] = set()
    for group in groups if isinstance(groups, list) else []:
        if not isinstance(group, dict):
            errors.append("rules.json group이 객체가 아닙니다.")
            continue
        rule_group = group.get("id")
        domains = group.get("domains")
        if not isinstance(rule_group, str) or not isinstance(domains, list) or not domains:
            errors.append(f"잘못된 rules.json group: {group!r}")
            continue
        for domain in domains:
            if not isinstance(domain, dict):
                errors.append(f"잘못된 domain 참조: {domain!r}")
                continue
            category = domain.get("category")
            expression = domain.get("expression")
            if not isinstance(category, str) or not isinstance(expression, str):
                errors.append(f"category/expression이 없는 domain 참조: {domain!r}")
                continue

            file_name = f"{category}__{expression}.json"
            referenced_files.add(file_name)
            path = bank_root / "new" / file_name
            if not path.is_file():
                errors.append(f"rules.json이 참조한 domain 파일이 없습니다: {path}")
                continue
            try:
                payload = _load_json(path)
            except (OSError, json.JSONDecodeError) as error:
                errors.append(f"domain 파일을 읽을 수 없습니다 ({file_name}): {error}")
                continue

            payload_domain = payload.get("domain") if isinstance(payload, dict) else None
            if not isinstance(payload_domain, dict) or (
                payload_domain.get("category") != category
                or payload_domain.get("expression") != expression
            ):
                errors.append(f"파일 domain 불일치: {file_name}")
            questions = payload.get("questions") if isinstance(payload, dict) else None
            if not isinstance(questions, list):
                errors.append(f"questions 배열이 없습니다: {file_name}")
                continue
            for index, item in enumerate(questions, start=1):
                if not isinstance(item, dict):
                    errors.append(f"문항이 객체가 아닙니다: {file_name}:{index}")
                    continue
                question = item.get("question")
                answer_intent = item.get("answer_intent")
                source_file = item.get("source_file")
                occurrence_count = item.get("occurrence_count")
                service_group = item.get("service_group")
                role_scopes = item.get("role_scopes")
                review_index = item.get("review_index")
                review_decision = item.get("review_decision")
                original_question = item.get("original_question")
                if not isinstance(question, str) or not question.strip():
                    errors.append(f"빈 질문: {file_name}:{index}")
                    continue
                if not isinstance(source_file, str) or not source_file.strip():
                    errors.append(f"source_file 누락: {file_name}:{index}")
                if not isinstance(answer_intent, dict) or (
                    answer_intent.get("category") != category
                    or answer_intent.get("expression") != expression
                ):
                    errors.append(f"answer_intent 불일치: {file_name}:{index}")
                if not isinstance(occurrence_count, int) or occurrence_count < 1:
                    errors.append(f"occurrence_count 오류: {file_name}:{index}")
                if service_group not in group_ids:
                    errors.append(f"service_group 오류: {file_name}:{index}")
                if (
                    not isinstance(role_scopes, list)
                    or not role_scopes
                    or any(scope not in ROLE_SCOPES for scope in role_scopes)
                ):
                    errors.append(f"role_scopes 오류: {file_name}:{index}")
                if not isinstance(review_index, int) or review_index < 1:
                    errors.append(f"review_index 오류: {file_name}:{index}")
                if review_decision not in {"keep", "comment"}:
                    errors.append(f"review_decision 오류: {file_name}:{index}")
                if review_decision == "comment" and (
                    not isinstance(original_question, str)
                    or not original_question.strip()
                    or original_question == question
                ):
                    errors.append(f"comment 미정제: {file_name}:{index}")
                entries.append(
                    QuestionEntry(
                        file_name=file_name,
                        category=category,
                        expression=expression,
                        rule_group=service_group,
                        question=question,
                        source_file=source_file,
                        answer_intent=answer_intent,
                        occurrence_count=occurrence_count,
                        review_index=review_index,
                        review_decision=review_decision,
                    )
                )

    actual_files = {path.name for path in (bank_root / "new").glob("*.json")}
    for file_name in sorted(actual_files - referenced_files):
        errors.append(f"rules.json에서 참조하지 않는 domain 파일: {file_name}")
    return rules if isinstance(rules, dict) else {}, entries, errors


def validate_question_bank(bank_root: Path | None = None) -> dict[str, Any]:
    root = bank_root or default_bank_root()
    rules, entries, errors = collect_entries(root)
    by_text: dict[str, list[QuestionEntry]] = defaultdict(list)
    for entry in entries:
        by_text[entry.question].append(entry)
    duplicate_groups = {text: group for text, group in by_text.items() if len(group) > 1}
    review_indices = Counter(entry.review_index for entry in entries)
    duplicate_review_indices = [key for key, count in review_indices.items() if count > 1]
    if duplicate_review_indices:
        errors.append(f"중복 review_index: {sorted(duplicate_review_indices)}")
    service_counts = Counter(entry.rule_group for entry in entries)
    service_unique_counts = Counter()
    for text, group in by_text.items():
        service_unique_counts[group[0].rule_group] += 1
    career_candidates = [entry for entry in entries if _career_candidate(entry.question)]
    group_ids = [group.get("id") for group in rules.get("groups", []) if isinstance(group, dict)]
    return {
        "errors": errors,
        "total_questions": len(entries),
        "exact_unique_questions": len(by_text),
        "duplicate_questions": len(entries) - len(by_text),
        "duplicate_groups": len(duplicate_groups),
        "review_index_count": len(review_indices),
        "review_decision_counts": dict(Counter(entry.review_decision for entry in entries)),
        "career_context_candidates": len(career_candidates),
        "career_candidates": career_candidates,
        "service_group_candidates": {group_id: service_counts.get(group_id, 0) for group_id in group_ids},
        "service_group_unique_candidates": {
            group_id: service_unique_counts.get(group_id, 0) for group_id in group_ids
        },
        "referenced_domain_files": len(
            {entry.file_name for entry in entries}
        ),
    }


def print_report(report: dict[str, Any]) -> None:
    print(f"rules 참조 domain 파일 수: {report['referenced_domain_files']}")
    print(f"전체 질문 수: {report['total_questions']}")
    print(f"exact unique 질문 수: {report['exact_unique_questions']}")
    print(f"duplicate 수: {report['duplicate_questions']} ({report['duplicate_groups']} groups)")
    print(f"review_index 수: {report['review_index_count']}")
    print(f"review decision: {report['review_decision_counts']}")
    print(f"경력 전제 후보 수: {report['career_context_candidates']}")
    print("service group별 후보 수:")
    for group_id, count in report["service_group_candidates"].items():
        unique_count = report["service_group_unique_candidates"][group_id]
        print(f"  {group_id}: {count} (unique={unique_count})")
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
