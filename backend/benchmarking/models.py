from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

Score = Literal[0, 1, 2]
AnnotatorId = UUID


class SourceInfo(BaseModel):
    dataset: str = "AIHub_ICT_Interview"
    experience: Literal["NEW", "EXPERIENCED"] | None = None
    source_question_id: str | None = None
    source_answer_id: str | None = None
    source_file: str | None = None
    resolved_source_file: str | None = None
    bank_file: str | None = None
    occurrence_count: int | None = None
    answer_intent: dict[str, str] | None = None
    answer_attached: bool = False


class QuestionInfo(BaseModel):
    text: str = Field(min_length=1)
    group: str = Field(min_length=1)
    group_name: str = Field(min_length=1)
    specialized_metric: str = Field(min_length=1)


class AnswerInfo(BaseModel):
    text: str = ""


class ScoreSet(BaseModel):
    relevance: Score
    specificity: Score
    coherence: Score
    specialized: Score


class Annotation(BaseModel):
    annotator_id: AnnotatorId
    rubric_version: str = Field(min_length=1)
    scores: ScoreSet
    confidence: Score
    note: str = ""


class AnnotationRecord(Annotation):
    sample_id: str = Field(min_length=1)
    target_mode: Literal["pilot", "full"]
    created_at: datetime
    updated_at: datetime


class AnnotatorProfile(BaseModel):
    annotator_id: AnnotatorId
    name: str = Field(min_length=1)
    affiliation_or_major: str | None = None
    interview_experience: str | None = None
    evaluation_experience: str | None = None
    note: str | None = None
    created_at: datetime


class Agreement(BaseModel):
    relevance: bool
    specificity: bool
    coherence: bool
    specialized: bool


class GoldResult(BaseModel):
    scores: ScoreSet
    total_score: int = Field(ge=0, le=8)
    agreement: Agreement
    adjudicated: bool = False
    rubric_version: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_total(self) -> "GoldResult":
        expected = sum(self.scores.model_dump().values())
        if self.total_score != expected:
            raise ValueError(f"total_score must equal sum(scores)={expected}")
        return self


class BenchmarkSample(BaseModel):
    benchmark_version: str = "1.0"
    sample_id: str = Field(min_length=1)
    source: SourceInfo
    question: QuestionInfo
    answer: AnswerInfo
    annotations: list[Annotation] = Field(default_factory=list)
    gold: GoldResult | None = None
    benchmark_split: Literal["train", "validation", "test"] | None = None

    @model_validator(mode="after")
    def validate_annotations(self) -> "BenchmarkSample":
        ids = [a.annotator_id for a in self.annotations]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate annotator_id in annotations")
        return self


class AdjudicationRecord(BaseModel):
    sample_id: str
    adjudicator_id: AnnotatorId | None = None
    rubric_version: str = Field(min_length=1)
    scores: ScoreSet
    note: str = ""
    created_at: datetime | None = None
