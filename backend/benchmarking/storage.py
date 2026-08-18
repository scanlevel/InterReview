from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from uuid import UUID, uuid4

from .io import read_jsonl, write_jsonl
from .models import (
    AdjudicationRecord,
    Annotation,
    AnnotationRecord,
    AnnotatorProfile,
    BenchmarkSample,
)
from .paths import (
    adjudication_path,
    annotation_path,
    benchmark_data_dir,
    ensure_data_dirs,
    registry_path,
)

# ponytail: This lock is process-local; move to a transactional DB before running multiple API workers.
_WRITE_LOCK = RLock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def load_candidates(path: Path) -> list[BenchmarkSample]:
    return [BenchmarkSample.model_validate(row) for row in read_jsonl(path)]


class AnnotationStore:
    """Small file-backed registry with one annotation file per UUID evaluator."""

    def __init__(self, root: str | Path | None = None):
        self.root = benchmark_data_dir(root)
        ensure_data_dirs(self.root)

    def list_annotators(self) -> list[AnnotatorProfile]:
        return [AnnotatorProfile.model_validate(row) for row in read_jsonl(registry_path(self.root))]

    def get_annotator(self, annotator_id: str | UUID) -> AnnotatorProfile | None:
        normalized = UUID(str(annotator_id))
        return next(
            (profile for profile in self.list_annotators() if profile.annotator_id == normalized),
            None,
        )

    def register_annotator(
        self,
        *,
        name: str,
        affiliation_or_major: str | None = None,
        interview_experience: str | None = None,
        evaluation_experience: str | None = None,
        note: str | None = None,
    ) -> AnnotatorProfile:
        profile = AnnotatorProfile(
            annotator_id=uuid4(),
            name=name.strip(),
            affiliation_or_major=affiliation_or_major,
            interview_experience=interview_experience,
            evaluation_experience=evaluation_experience,
            note=note,
            created_at=_now(),
        )
        with _WRITE_LOCK:
            rows = [item.model_dump(mode="json") for item in self.list_annotators()]
            rows.append(profile.model_dump(mode="json"))
            write_jsonl(registry_path(self.root), rows)
        return profile

    def load_annotations(
        self,
        annotator_id: str | UUID | None = None,
        *,
        rubric_version: str | None = None,
    ) -> list[AnnotationRecord]:
        if annotator_id is not None:
            paths = [annotation_path(annotator_id, self.root)]
        else:
            paths = sorted((self.root / "annotations").glob("*.jsonl"))
        records: list[AnnotationRecord] = []
        for path in paths:
            records.extend(AnnotationRecord.model_validate(row) for row in read_jsonl(path))
        if rubric_version is not None:
            records = [record for record in records if record.rubric_version == rubric_version]
        return records

    def save_annotation(
        self,
        *,
        sample_id: str,
        annotation: Annotation,
        target_mode: str,
    ) -> AnnotationRecord:
        if self.get_annotator(annotation.annotator_id) is None:
            raise ValueError("unknown annotator_id")
        path = annotation_path(annotation.annotator_id, self.root)
        now = _now()
        with _WRITE_LOCK:
            existing = [AnnotationRecord.model_validate(row) for row in read_jsonl(path)]
            key = (sample_id, annotation.rubric_version)
            previous = next(
                (
                    record
                    for record in existing
                    if (record.sample_id, record.rubric_version) == key
                ),
                None,
            )
            record = AnnotationRecord(
                sample_id=sample_id,
                target_mode=target_mode,
                created_at=previous.created_at if previous else now,
                updated_at=now,
                **annotation.model_dump(),
            )
            by_key = {(item.sample_id, item.rubric_version): item for item in existing}
            by_key[key] = record
            write_jsonl(
                path,
                [by_key[item].model_dump(mode="json") for item in sorted(by_key)],
            )
        return record

    def load_adjudications(self, *, rubric_version: str | None = None) -> list[AdjudicationRecord]:
        records = [
            AdjudicationRecord.model_validate(row)
            for row in read_jsonl(adjudication_path(self.root))
        ]
        if rubric_version is not None:
            records = [record for record in records if record.rubric_version == rubric_version]
        return records

    def save_adjudication(self, record: AdjudicationRecord) -> AdjudicationRecord:
        if record.adjudicator_id and self.get_annotator(record.adjudicator_id) is None:
            raise ValueError("unknown adjudicator_id")
        if record.created_at is None:
            record = record.model_copy(update={"created_at": _now()})
        path = adjudication_path(self.root)
        with _WRITE_LOCK:
            existing = [AdjudicationRecord.model_validate(row) for row in read_jsonl(path)]
            by_key = {(item.sample_id, item.rubric_version): item for item in existing}
            by_key[(record.sample_id, record.rubric_version)] = record
            write_jsonl(
                path,
                [by_key[item].model_dump(mode="json") for item in sorted(by_key)],
            )
        return record


def load_annotation_map(
    annotator_id: str | UUID,
    *,
    rubric_version: str | None = None,
    root: str | Path | None = None,
) -> dict[str, AnnotationRecord]:
    records = AnnotationStore(root).load_annotations(
        annotator_id, rubric_version=rubric_version
    )
    return {record.sample_id: record for record in records}


def save_annotation(
    sample_id: str,
    annotation: Annotation,
    *,
    target_mode: str = "full",
    root: str | Path | None = None,
) -> AnnotationRecord:
    return AnnotationStore(root).save_annotation(
        sample_id=sample_id,
        annotation=annotation,
        target_mode=target_mode,
    )
