from __future__ import annotations

from collections import Counter

from pydantic import ValidationError

from .models import BenchmarkSample
from .rubric import group_metadata, validate_rubric_rule_mapping


def validate_rows(rows: list[dict], *, require_answer: bool = False) -> list[str]:
    errors: list[str] = []
    errors.extend(validate_rubric_rule_mapping())
    sample_ids = [str(r.get("sample_id", "")) for r in rows]
    for sid, count in Counter(sample_ids).items():
        if sid and count > 1:
            errors.append(f"duplicate sample_id: {sid} ({count} rows)")

    for idx, row in enumerate(rows, start=1):
        sid = row.get("sample_id") or f"row#{idx}"
        try:
            sample = BenchmarkSample.model_validate(row)
        except ValidationError as exc:
            errors.append(f"{sid}: schema validation failed: {exc}")
            continue
        try:
            meta = group_metadata(sample.question.group)
        except (KeyError, FileNotFoundError) as exc:
            errors.append(f"{sid}: {exc}")
            continue
        if sample.question.group_name != meta["name"]:
            errors.append(
                f"{sid}: group_name mismatch: {sample.question.group_name!r} != {meta['name']!r}"
            )
        if sample.question.specialized_metric != meta["specialized_metric"]:
            errors.append(
                f"{sid}: specialized_metric mismatch: {sample.question.specialized_metric!r} "
                f"!= {meta['specialized_metric']!r}"
            )
        if require_answer and not sample.answer.text.strip():
            errors.append(f"{sid}: answer.text is empty")
    return errors
