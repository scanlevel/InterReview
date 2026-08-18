from __future__ import annotations

import hashlib
import os
from collections import Counter, defaultdict
from typing import Iterable
from uuid import UUID

from .gold import gold_from_annotations
from .models import AdjudicationRecord, Annotation, AnnotationRecord
from .rubric import load_rubric

MIN_ANNOTATIONS_PER_SAMPLE = 3
MIN_ANNOTATIONS_ENV = "INTERREVIEW_MIN_ANNOTATIONS_PER_SAMPLE"
ASSIGNMENT_SEED = 42


def configured_min_annotations() -> int:
    raw = os.environ.get(MIN_ANNOTATIONS_ENV, str(MIN_ANNOTATIONS_PER_SAMPLE))
    value = int(raw)
    if value < 1:
        raise ValueError(f"{MIN_ANNOTATIONS_ENV} must be at least 1")
    return value


def current_rubric_version() -> str:
    return str(load_rubric()["version"])


def _by_sample(
    annotations: Iterable[AnnotationRecord],
    *,
    rubric_version: str,
    target_ids: set[str] | None = None,
) -> dict[str, list[AnnotationRecord]]:
    result: defaultdict[str, list[AnnotationRecord]] = defaultdict(list)
    for annotation in annotations:
        if annotation.rubric_version != rubric_version:
            continue
        if target_ids is not None and annotation.sample_id not in target_ids:
            continue
        result[annotation.sample_id].append(annotation)
    return result


def next_assignment(
    target_rows: list[dict],
    annotations: list[AnnotationRecord],
    adjudications: list[AdjudicationRecord],
    *,
    annotator_id: str | UUID,
    rubric_version: str,
    min_annotations: int,
    seed: int = ASSIGNMENT_SEED,
) -> dict | None:
    normalized_annotator = UUID(str(annotator_id))
    target_ids = {str(row["sample_id"]) for row in target_rows}
    current = _by_sample(
        annotations, rubric_version=rubric_version, target_ids=target_ids
    )
    adjudicated_ids = {
        record.sample_id
        for record in adjudications
        if record.rubric_version == rubric_version
    }
    personal_group_counts: Counter[str] = Counter()
    stale_ids: set[str] = set()
    for annotation in annotations:
        if annotation.annotator_id != normalized_annotator:
            continue
        if annotation.rubric_version != rubric_version:
            stale_ids.add(annotation.sample_id)
        elif annotation.sample_id in target_ids:
            row = next(
                item for item in target_rows if item["sample_id"] == annotation.sample_id
            )
            personal_group_counts[row["question"]["group"]] += 1

    eligible: list[tuple[dict, int]] = []
    for row in target_rows:
        sample_id = str(row["sample_id"])
        sample_annotations = current.get(sample_id, [])
        annotator_ids = {annotation.annotator_id for annotation in sample_annotations}
        if (
            normalized_annotator in annotator_ids
            or sample_id in adjudicated_ids
            or len(annotator_ids) >= min_annotations
        ):
            continue
        eligible.append((row, len(annotator_ids)))
    if not eligible:
        return None

    minimum_count = min(count for _, count in eligible)
    least_annotated = [(row, count) for row, count in eligible if count == minimum_count]
    minimum_personal_group_count = min(
        personal_group_counts[row["question"]["group"]] for row, _ in least_annotated
    )
    balanced = [
        (row, count)
        for row, count in least_annotated
        if personal_group_counts[row["question"]["group"]]
        == minimum_personal_group_count
    ]
    row, count = min(
        balanced,
        key=lambda item: hashlib.sha256(
            f"{seed}:{normalized_annotator}:{item[0]['sample_id']}".encode("utf-8")
        ).hexdigest(),
    )
    return {
        "sample": row,
        "annotation_count": count,
        "needs_reevaluation": str(row["sample_id"]) in stale_ids,
    }


def progress(
    target_rows: list[dict],
    annotations: list[AnnotationRecord],
    *,
    annotator_id: str | UUID,
    rubric_version: str,
    min_annotations: int,
) -> dict:
    normalized = UUID(str(annotator_id))
    target_ids = {str(row["sample_id"]) for row in target_rows}
    current = _by_sample(
        annotations, rubric_version=rubric_version, target_ids=target_ids
    )
    completed_ids = {
        annotation.sample_id
        for annotation in annotations
        if annotation.annotator_id == normalized
        and annotation.rubric_version == rubric_version
        and annotation.sample_id in target_ids
    }
    stale_ids = {
        annotation.sample_id
        for annotation in annotations
        if annotation.annotator_id == normalized
        and annotation.rubric_version != rubric_version
        and annotation.sample_id in target_ids
        and annotation.sample_id not in completed_ids
    }
    completed_slots = sum(
        min(len({item.annotator_id for item in items}), min_annotations)
        for items in current.values()
    )
    required_slots = len(target_rows) * min_annotations
    return {
        "annotator_completed": len(completed_ids),
        "needs_reevaluation": len(stale_ids),
        "target_samples": len(target_rows),
        "global_completed_annotations": completed_slots,
        "global_required_annotations": required_slots,
        "global_progress": completed_slots / required_slots if required_slots else 0.0,
    }


def unresolved_items(
    target_rows: list[dict],
    annotations: list[AnnotationRecord],
    adjudications: list[AdjudicationRecord],
    *,
    rubric_version: str,
    min_annotations: int,
) -> list[dict]:
    target_ids = {str(row["sample_id"]) for row in target_rows}
    current = _by_sample(
        annotations, rubric_version=rubric_version, target_ids=target_ids
    )
    adjudication_map = {
        record.sample_id: record
        for record in adjudications
        if record.rubric_version == rubric_version
    }
    unresolved: list[dict] = []
    for row in target_rows:
        sample_id = str(row["sample_id"])
        sample_annotations = current.get(sample_id, [])
        gold, status = gold_from_annotations(
            [Annotation.model_validate(item.model_dump()) for item in sample_annotations],
            adjudication_map.get(sample_id),
            min_annotations=min_annotations,
        )
        if gold is None and status["status"] == "unresolved":
            unresolved.append(
                {
                    "sample": row,
                    "annotations": [item.model_dump(mode="json") for item in sample_annotations],
                    **status,
                }
            )
    return unresolved


def build_gold_rows(
    target_rows: list[dict],
    annotations: list[AnnotationRecord],
    adjudications: list[AdjudicationRecord],
    *,
    rubric_version: str,
    min_annotations: int,
) -> tuple[list[dict], list[dict]]:
    target_ids = {str(row["sample_id"]) for row in target_rows}
    current = _by_sample(
        annotations, rubric_version=rubric_version, target_ids=target_ids
    )
    adjudication_map = {
        record.sample_id: record
        for record in adjudications
        if record.rubric_version == rubric_version
    }
    gold_rows: list[dict] = []
    pending: list[dict] = []
    for sample in target_rows:
        sample_id = str(sample["sample_id"])
        records = current.get(sample_id, [])
        simple_annotations = [
            Annotation.model_validate(record.model_dump()) for record in records
        ]
        gold, status = gold_from_annotations(
            simple_annotations,
            adjudication_map.get(sample_id),
            min_annotations=min_annotations,
        )
        row = {
            **sample,
            "annotations": [record.model_dump(mode="json") for record in records],
            "gold": gold,
            "benchmark_split": None,
        }
        if gold is None:
            pending.append({**row, **status})
        else:
            gold_rows.append(row)
    return gold_rows, pending
