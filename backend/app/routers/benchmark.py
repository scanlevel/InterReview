"""Portable benchmark inspection and human annotation API."""

from __future__ import annotations

from functools import lru_cache

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.schemas import (
    AnnotatorRegistrationRequest,
    BenchmarkCandidate,
    BenchmarkSamplePage,
    SaveAdjudicationRequest,
    SaveBenchmarkAnnotationRequest,
)
from benchmarking.dataset import DatasetError, PortableDataset, load_dataset
from benchmarking.models import AdjudicationRecord, Annotation, ScoreSet
from benchmarking.reporting import summarize
from benchmarking.rubric import load_rubric
from benchmarking.selection import select_target
from benchmarking.storage import AnnotationStore
from benchmarking.workflow import (
    configured_min_annotations,
    current_rubric_version,
    next_assignment,
    progress,
    unresolved_items,
)

router = APIRouter(prefix="/benchmark", tags=["benchmark"])


@lru_cache(maxsize=1)
def _cached_dataset() -> PortableDataset:
    return load_dataset()


def _dataset() -> PortableDataset:
    try:
        return _cached_dataset()
    except DatasetError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@lru_cache(maxsize=1)
def _store() -> AnnotationStore:
    return AnnotationStore()


def _target(mode: Literal["pilot", "full"], per_group: int = 10) -> list[dict]:
    return select_target(_dataset().samples, mode=mode, per_group=per_group)


def _assert_current_rubric(version: str) -> None:
    if version != current_rubric_version():
        raise HTTPException(status_code=409, detail="rubric_version is stale; reload the rubric")


def _unresolved(mode: Literal["pilot", "full"], per_group: int = 10) -> list[dict]:
    return unresolved_items(
        _target(mode, per_group),
        _store().load_annotations(),
        _store().load_adjudications(),
        rubric_version=current_rubric_version(),
        min_annotations=configured_min_annotations(),
    )


@router.get("/samples", response_model=BenchmarkSamplePage)
def list_samples(
    group: str | None = Query(default=None),
    source_split: str | None = Query(default=None),
    experience: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
) -> BenchmarkSamplePage:
    """List indexed candidates with optional group/split/experience filters."""
    items, total = _dataset().list(
        group=group,
        source_split=source_split,
        experience=experience,
        offset=offset,
        limit=limit,
    )
    return BenchmarkSamplePage(items=items, total=total, offset=offset, limit=limit)


@router.get("/samples/{sample_id}/audio/{side}")
def sample_audio(sample_id: str, side: str) -> FileResponse:
    """Stream one dataset-owned WAV; the client never supplies a filesystem path."""
    dataset = _dataset()
    if dataset.get(sample_id) is None:
        raise HTTPException(status_code=404, detail="unknown sample_id")
    try:
        path = dataset.audio_path(sample_id, side)
    except DatasetError as error:
        raise HTTPException(status_code=404, detail="audio file not found") from error
    if not path.is_file():
        raise HTTPException(status_code=404, detail="audio file not found")
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@router.get("/samples/{sample_id}", response_model=BenchmarkCandidate)
def sample(sample_id: str) -> BenchmarkCandidate:
    """Return one reference transcript and its paired audio paths."""
    row = _dataset().get(sample_id)
    if row is None:
        raise HTTPException(status_code=404, detail="unknown sample_id")
    return BenchmarkCandidate.model_validate(row)


@router.get("/rubric")
def rubric() -> dict:
    return load_rubric()


@router.get("/annotators")
def list_annotators() -> list[dict]:
    """Expose only the identity needed to resume an evaluator session."""
    return [
        {"annotator_id": str(item.annotator_id), "name": item.name, "created_at": item.created_at}
        for item in _store().list_annotators()
    ]


@router.post("/annotators", status_code=201)
def register_annotator(request: AnnotatorRegistrationRequest) -> dict:
    try:
        profile = _store().register_annotator(**request.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return profile.model_dump(mode="json")


@router.get("/annotation/progress")
def annotation_progress(
    annotator_id: str,
    mode: Literal["pilot", "full"] = "full",
    per_group: int = Query(default=10, ge=1, le=100),
) -> dict:
    if _store().get_annotator(annotator_id) is None:
        raise HTTPException(status_code=404, detail="unknown annotator_id")
    return progress(
        _target(mode, per_group),
        _store().load_annotations(),
        annotator_id=annotator_id,
        rubric_version=current_rubric_version(),
        min_annotations=configured_min_annotations(),
    )


@router.get("/assignments/next")
def assignment(
    annotator_id: str,
    mode: Literal["pilot", "full"] = "full",
    per_group: int = Query(default=10, ge=1, le=100),
) -> dict:
    if _store().get_annotator(annotator_id) is None:
        raise HTTPException(status_code=404, detail="unknown annotator_id")
    result = next_assignment(
        _target(mode, per_group),
        _store().load_annotations(),
        _store().load_adjudications(),
        annotator_id=annotator_id,
        rubric_version=current_rubric_version(),
        min_annotations=configured_min_annotations(),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="no sample currently needs this annotator")
    return {**result, "rubric_version": current_rubric_version()}


@router.post("/samples/{sample_id}/annotations")
def save_sample_annotation(sample_id: str, request: SaveBenchmarkAnnotationRequest) -> dict:
    _assert_current_rubric(request.rubric_version)
    target_ids = {str(row["sample_id"]) for row in _target(request.target_mode)}
    if sample_id not in target_ids:
        raise HTTPException(status_code=404, detail="sample is not in the selected target")
    annotation = Annotation(
        annotator_id=request.annotator_id,
        rubric_version=request.rubric_version,
        scores=ScoreSet.model_validate(request.scores.model_dump()),
        confidence=request.confidence,
        note=request.note,
    )
    try:
        saved = _store().save_annotation(
            sample_id=sample_id, annotation=annotation, target_mode=request.target_mode
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return saved.model_dump(mode="json")


@router.get("/admin/stats")
def admin_stats(
    mode: Literal["pilot", "full"] = "full",
    per_group: int = Query(default=10, ge=1, le=100),
) -> dict:
    return summarize(
        _target(mode, per_group),
        _store().load_annotations(),
        _store().list_annotators(),
        _store().load_adjudications(),
        rubric_version=current_rubric_version(),
        min_annotations=configured_min_annotations(),
    )


@router.get("/adjudication/unresolved")
def unresolved(
    mode: Literal["pilot", "full"] = "full",
    per_group: int = Query(default=10, ge=1, le=100),
) -> list[dict]:
    return _unresolved(mode, per_group)


@router.post("/samples/{sample_id}/adjudication")
def save_sample_adjudication(sample_id: str, request: SaveAdjudicationRequest) -> dict:
    _assert_current_rubric(request.rubric_version)
    unresolved_ids = {
        str(item["sample"]["sample_id"])
        for item in _unresolved(request.target_mode)
    }
    if sample_id not in unresolved_ids:
        raise HTTPException(status_code=409, detail="sample is not unresolved")
    record = AdjudicationRecord(
        sample_id=sample_id,
        adjudicator_id=request.adjudicator_id,
        rubric_version=request.rubric_version,
        scores=ScoreSet.model_validate(request.scores.model_dump()),
        note=request.note,
    )
    try:
        saved = _store().save_adjudication(record)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return saved.model_dump(mode="json")
