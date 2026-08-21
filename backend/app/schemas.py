"""Pydantic contracts for the Track B interview flow.

Vision and audio fields are measurements, not scores.  Answer-content review
is supplied by Track A when that contract is connected.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class EyeTrackingSummary(BaseModel):
    """Per-question gaze heatmap produced in the browser."""

    gaze_heatmap: "GazeHeatmap | None" = None


class GazeHeatmap(BaseModel):
    """Compact row-major gaze histogram for rendering without raw video."""

    columns: int = Field(default=12, ge=1, le=64)
    rows: int = Field(default=8, ge=1, le=64)
    counts: list[int] = Field(default_factory=list)
    total: int = Field(default=0, ge=0)


class SpeechMetrics(BaseModel):
    """VAD-derived timing values for one answer."""

    total_duration_sec: float = Field(default=0, ge=0)
    speech_duration_sec: float = Field(default=0, ge=0)
    speech_rate_eojeol_per_min: float | None = Field(default=None, ge=0)
    silence_duration_sec: float = Field(default=0, ge=0)
    silence_ratio: float = Field(default=0, ge=0, le=1)
    long_pause_count: int = Field(default=0, ge=0)
    max_pause_sec: float = Field(default=0, ge=0)
    long_pause_threshold_sec: float = Field(default=2.0, gt=0)


class AnswerItem(BaseModel):
    """One question together with the applicant's captured answer."""

    question_id: str
    question: str
    original_question: str | None = None
    category: str | None = None
    transcript: str = ""
    eye_tracking: EyeTrackingSummary | None = None
    speech_metrics: SpeechMetrics | None = None


class Question(BaseModel):
    """One generated interview question, tagged with its rule-bank origin."""

    id: str
    category: str  # rule group name, e.g. "자기소개·이력"
    rule_group: str  # rule group id, e.g. "resume"
    subcategory: str  # "<category>::<expression>" from the source domain
    experience: str  # NEW | EXPERIENCED
    text: str
    original_text: str | None = None
    source_file: str | None = None
    occurrence_count: int = 1


class GenerateQuestionsRequest(BaseModel):
    """Payload for ``POST /questions``."""

    profile: dict[str, Any] = Field(default_factory=dict)
    # Optional fixed seed for reproducible selection (mainly for tests).
    seed: int | None = None


class GenerateQuestionsResponse(BaseModel):
    """Response of ``POST /questions``."""

    experience: str
    questions: list[Question]


class MeasurementRequest(BaseModel):
    """Payload for the B-owned measurement report endpoint."""

    answers: list[AnswerItem] = Field(default_factory=list)


class TranscriptResponse(BaseModel):
    """Result of ``POST /stt`` — transcription of one answer's audio."""

    transcript: str
    # ok | no_speech | empty | not_configured | error
    status: str
    error: str | None = None
    confidence: float | None = None
    segment_count: int | None = None


class ContentFeedback(BaseModel):
    """Track A answer-content result, without a numeric score."""

    answer_status: Literal[
        "good", "partial", "off_topic", "insufficient", "unavailable"
    ]
    reason: str
    missing_points: list[str] = Field(default_factory=list)


class MeasurementSummary(BaseModel):
    """Descriptive session averages; these are never converted to scores."""

    reference_source: str = "ICT 데이터 분석 참고값"
    reference_average_total_duration_sec: float = 90.0
    reference_average_answer_length_eojeol: int = 131
    average_answer_length_eojeol: float | None = None
    average_total_duration_sec: float | None = None
    average_speech_duration_sec: float | None = None
    average_silence_duration_sec: float | None = None
    average_silence_ratio: float | None = None
    average_long_pause_count: float | None = None


class QuestionResult(BaseModel):
    """All user-visible measurements and optional Track A feedback."""

    question_id: str | None
    question: str | None
    category: str | None
    original_question: str | None = None
    transcript: str
    speech_metrics: SpeechMetrics | None = None
    eye_tracking: EyeTrackingSummary | None = None
    content: ContentFeedback | None = None


class MeasurementReport(BaseModel):
    """Full question-by-question Track B measurement report."""

    summary_feedback: str
    measurement_summary: MeasurementSummary
    results: list[QuestionResult]
