"""Pydantic contracts for the Track B interview flow.

Vision and audio fields are measurements, not scores.  Answer-content review
is supplied by Track A when that contract is connected.
"""

from __future__ import annotations

import math
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

SttStatus = Literal[
    "not_attempted", "ok", "no_speech", "empty", "not_configured", "error"
]


class EyeTrackingSummary(BaseModel):
    """Per-question gaze heatmap produced in the browser."""

    gaze_heatmap: "GazeHeatmap | None" = None


class GazeHeatmap(BaseModel):
    """Compact row-major gaze histogram for rendering without raw video."""

    columns: int = Field(default=12, ge=1, le=64)
    rows: int = Field(default=8, ge=1, le=64)
    counts: list[int] = Field(default_factory=list)
    total: int = Field(default=0, ge=0)


class AudioTimeline(BaseModel):
    """Compact, privacy-safe audio activity bins for one answer."""

    energy: list[float] = Field(default_factory=list, max_length=120)
    speech: list[bool] = Field(default_factory=list, max_length=120)
    long_pause: list[bool] = Field(default_factory=list, max_length=120)

    @model_validator(mode="after")
    def validate_bins(self) -> "AudioTimeline":
        lengths = {len(self.energy), len(self.speech), len(self.long_pause)}
        if len(lengths) != 1:
            raise ValueError("audio timeline arrays must have equal lengths")
        if any(not math.isfinite(value) or not 0 <= value <= 1 for value in self.energy):
            raise ValueError("audio timeline energy must be finite and between 0 and 1")
        return self


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
    audio_timeline: AudioTimeline | None = None


class AnswerItem(BaseModel):
    """One question together with the applicant's captured answer."""

    question_id: str
    question: str
    original_question: str | None = None
    category: str | None = None
    transcript: str = ""
    stt_status: "SttStatus" = "not_attempted"
    stt_error: str | None = None
    eye_tracking: EyeTrackingSummary | None = None
    speech_metrics: SpeechMetrics | None = None


class Question(BaseModel):
    """One generated interview question, tagged with its rule-bank origin."""

    id: str
    # Stable source-derived identifier; id remains for frontend compatibility.
    question_id: str
    category: str  # rule group name, e.g. "자기소개·이력"
    rule_group: str  # rule group id, e.g. "resume"
    subcategory: str  # "<category>::<expression>" from the source domain
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

    questions: list[Question]


class MeasurementRequest(BaseModel):
    """Payload for the B-owned measurement report endpoint."""

    answers: list[AnswerItem] = Field(default_factory=list)


class TranscriptResponse(BaseModel):
    """Result of ``POST /stt`` — transcription of one answer's audio."""

    transcript: str
    status: "SttStatus"
    error: str | None = None
    confidence: float | None = None
    segment_count: int | None = None


AnswerStatus = Literal[
    "good", "partial", "off_topic", "insufficient", "unavailable"
]


class AnswerReview(BaseModel):
    """Content-only review of one interview answer, without a numeric score."""

    answer_status: AnswerStatus
    reason: str
    missing_points: list[str]
    follow_up_question: str | None


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

    stt_status: SttStatus = "not_attempted"
    stt_error: str | None = None
    question_id: str | None
    question: str | None
    category: str | None
    original_question: str | None = None
    transcript: str
    speech_metrics: SpeechMetrics | None = None
    eye_tracking: EyeTrackingSummary | None = None
    content: AnswerReview | None = None


class MeasurementReport(BaseModel):
    """Full question-by-question Track B measurement report."""

    summary_feedback: str
    measurement_summary: MeasurementSummary
    results: list[QuestionResult]


# --- Track A: 자소서 분석 ------------------------------------------------------

class EssayWeakness(BaseModel):
    """One line of attack an interviewer could take on an experience."""

    description: str = Field(description="면접관이 파고들 수 있는 약점")
    expected_questions: list[str] = Field(
        default_factory=list, description="이 약점에서 나올 예상 질문"
    )
    source_quotes: list[str] = Field(
        default_factory=list,
        description=(
            "이 약점이 드러나는 자기소개서 원문 문장. "
            "원문에서 한 글자도 바꾸지 않고 그대로 복사한다."
        ),
    )


class EssayExperience(BaseModel):
    """One experience from the essay, with the claims it is meant to support."""

    experience: str = Field(description="경험 요약")
    claims: list[str] = Field(
        default_factory=list, description="이 경험이 뒷받침한다고 주장하는 것"
    )
    source_quotes: list[str] = Field(
        default_factory=list,
        description=(
            "이 경험의 근거가 된 자기소개서 원문 문장. "
            "원문에서 한 글자도 바꾸지 않고 그대로 복사한다."
        ),
    )
    risk_level: Literal[1, 2, 3, 4, 5] = Field(
        description="면접에서 공격받을 가능성. 5가 가장 위험하다."
    )
    risk_reason: str = Field(description="그 위험도로 판단한 이유")
    weaknesses: list[EssayWeakness] = Field(default_factory=list)


class EssayAnalysis(BaseModel):
    """Result of one essay analysis, experiences sorted most-risky first."""

    experiences: list[EssayExperience] = Field(default_factory=list)
    unsupported_claims: list[str] = Field(
        default_factory=list, description="뒷받침하는 경험이 없는 주장"
    )


class EssayAnalyzeRequest(BaseModel):
    """Payload for ``POST /essay/analyze``."""

    essay: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)
    ]
    profile: dict[str, Any] = Field(default_factory=dict)


# --- Track B 중 A 담당: 답변 내용 판별 ----------------------------------------

class AnswerReviewRequest(BaseModel):
    """Payload for ``POST /answers/review``."""

    question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1_000)
    ]
    transcript: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=10_000)
    ]
    essay: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=10_000)]
        | None
    ) = None
    profile: dict[str, Any] = Field(default_factory=dict)
