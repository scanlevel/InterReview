from __future__ import annotations

from collections import Counter

from .models import AdjudicationRecord, Annotation, ScoreSet

SCORE_FIELDS = ("relevance", "specificity", "coherence", "specialized")


def majority(values: list[int]) -> int | None:
    """Return the unique mode; ties are unresolved for any annotator count."""
    if not values:
        return None
    counts = Counter(values)
    top_count = max(counts.values())
    modes = [value for value, count in counts.items() if count == top_count]
    return int(modes[0]) if len(modes) == 1 else None


def gold_from_annotations(
    annotations: list[Annotation],
    adjudication: AdjudicationRecord | None = None,
    *,
    min_annotations: int = 3,
) -> tuple[dict | None, dict]:
    if adjudication is not None:
        scores = adjudication.scores.model_dump()
        return (
            {
                "scores": scores,
                "total_score": sum(scores.values()),
                "agreement": {field: _unanimous(annotations, field) for field in SCORE_FIELDS},
                "adjudicated": True,
                "rubric_version": adjudication.rubric_version,
            },
            {"status": "adjudicated", "unresolved_fields": []},
        )

    by_id = {a.annotator_id: a for a in annotations}
    if len(by_id) < min_annotations:
        return None, {
            "status": "missing_annotations",
            "annotation_count": len(by_id),
            "unresolved_fields": list(SCORE_FIELDS),
        }

    versions = {annotation.rubric_version for annotation in by_id.values()}
    if len(versions) != 1:
        return None, {
            "status": "rubric_version_mismatch",
            "annotation_count": len(by_id),
            "unresolved_fields": list(SCORE_FIELDS),
        }

    resolved: dict[str, int] = {}
    unresolved: list[str] = []
    agreement: dict[str, bool] = {}
    for field in SCORE_FIELDS:
        vals = [getattr(annotation.scores, field) for annotation in by_id.values()]
        m = majority(vals)
        agreement[field] = len(set(vals)) == 1
        if m is None:
            unresolved.append(field)
        else:
            resolved[field] = m
    if unresolved:
        return None, {"status": "unresolved", "unresolved_fields": unresolved}
    score_set = ScoreSet.model_validate(resolved)
    scores = score_set.model_dump()
    return (
        {
            "scores": scores,
            "total_score": sum(scores.values()),
            "agreement": agreement,
            "adjudicated": False,
            "rubric_version": versions.pop(),
        },
        {"status": "majority", "annotation_count": len(by_id), "unresolved_fields": []},
    )


def _unanimous(annotations: list[Annotation], field: str) -> bool:
    if not annotations:
        return False
    vals = [getattr(a.scores, field) for a in annotations]
    return len(set(vals)) == 1
