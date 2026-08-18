from __future__ import annotations

from collections import Counter, defaultdict

from .gold import SCORE_FIELDS, gold_from_annotations
from .models import AdjudicationRecord, Annotation, AnnotationRecord, AnnotatorProfile


def summarize(target_rows: list[dict], annotations: list[AnnotationRecord], annotators: list[AnnotatorProfile], adjudications: list[AdjudicationRecord], *, rubric_version: str, min_annotations: int) -> dict:
    target_by_id = {str(row["sample_id"]): row for row in target_rows}
    current = [a for a in annotations if a.rubric_version == rubric_version and a.sample_id in target_by_id]
    by_sample = defaultdict(list)
    by_annotator = Counter()
    score_dist = {field: Counter() for field in SCORE_FIELDS}
    confidence = []
    for item in current:
        by_sample[item.sample_id].append(item)
        by_annotator[item.annotator_id] += 1
        confidence.append(item.confidence)
        for field in SCORE_FIELDS:
            score_dist[field][getattr(item.scores, field)] += 1

    coverage = Counter()
    group_slots = defaultdict(lambda: {"completed": 0, "required": 0})
    agreement_hits, agreement_totals = Counter(), Counter()
    adjudication_map = {a.sample_id: a for a in adjudications if a.rubric_version == rubric_version}
    unresolved = 0
    for sample_id, row in target_by_id.items():
        distinct = {a.annotator_id: a for a in by_sample.get(sample_id, [])}
        count = len(distinct)
        coverage["3+" if count >= 3 else str(count)] += 1
        slots = group_slots[row["question"]["group"]]
        slots["completed"] += min(count, min_annotations)
        slots["required"] += min_annotations
        if count < min_annotations:
            continue
        simple = [Annotation.model_validate(a.model_dump()) for a in distinct.values()]
        gold, status = gold_from_annotations(simple, adjudication_map.get(sample_id), min_annotations=min_annotations)
        unresolved += int(gold is None and status["status"] == "unresolved")
        for field in SCORE_FIELDS:
            agreement_totals[field] += 1
            agreement_hits[field] += int(len({getattr(a.scores, field) for a in distinct.values()}) == 1)

    completed_slots = sum(min(len({a.annotator_id for a in items}), min_annotations) for items in by_sample.values())
    required_slots = len(target_rows) * min_annotations
    return {
        "registered_annotators": len(annotators),
        "annotator_completed": {str(p.annotator_id): {"name": p.name, "count": by_annotator[p.annotator_id]} for p in annotators},
        "samples": len(target_rows),
        "annotation_coverage": {key: coverage[key] for key in ("0", "1", "2", "3+")},
        "completed_annotation_slots": completed_slots,
        "required_annotation_slots": required_slots,
        "overall_progress": completed_slots / required_slots if required_slots else 0.0,
        "group_progress": {group: {**slots, "progress": slots["completed"] / slots["required"] if slots["required"] else 0.0} for group, slots in sorted(group_slots.items())},
        "score_distribution": {field: {str(score): score_dist[field][score] for score in (0, 1, 2)} for field in SCORE_FIELDS},
        "exact_agreement_rate": {field: agreement_hits[field] / agreement_totals[field] if agreement_totals[field] else None for field in SCORE_FIELDS},
        "unresolved_samples": unresolved,
        "average_confidence": sum(confidence) / len(confidence) if confidence else None,
        "rubric_version": rubric_version,
        "min_annotations_per_sample": min_annotations,
    }
