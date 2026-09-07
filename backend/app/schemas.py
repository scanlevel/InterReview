"""Pydantic contracts for the Track B interview flow.

Vision and audio fields are measurements, not scores. Answer review is a
short, transcript-grounded coaching response without a numeric evaluation.
"""

from __future__ import annotations

import math
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

SttStatus = Literal[
    "not_attempted", "ok", "no_speech", "empty", "not_configured", "error"
]
SpeechClassificationKind = Literal[
    "transcribed_speech",
    "untranscribed_speech",
    "vad_silence",
    "pending",
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
    classification: list[SpeechClassificationKind] | None = Field(
        default=None, max_length=120
    )

    @model_validator(mode="after")
    def validate_bins(self) -> "AudioTimeline":
        lengths = {len(self.energy), len(self.speech), len(self.long_pause)}
        if len(lengths) != 1:
            raise ValueError("audio timeline arrays must have equal lengths")
        if self.classification is not None and len(self.classification) != len(self.energy):
            raise ValueError("audio timeline classification must match the bin count")
        if any(not math.isfinite(value) or not 0 <= value <= 1 for value in self.energy):
            raise ValueError("audio timeline energy must be finite and between 0 and 1")
        return self


class SpeechClassification(BaseModel):
    """VAD/alignment partition without exposing transcript text."""

    total_analysis_duration_sec: float = Field(default=0, ge=0)
    transcribed_speech_duration_sec: float = Field(default=0, ge=0)
    transcribed_speech_segment_count: int = Field(default=0, ge=0)
    untranscribed_speech_duration_sec: float = Field(default=0, ge=0)
    untranscribed_speech_segment_count: int = Field(default=0, ge=0)
    vad_silence_duration_sec: float = Field(default=0, ge=0)
    vad_silence_segment_count: int = Field(default=0, ge=0)
    pending_duration_sec: float = Field(default=0, ge=0)
    pending_segment_count: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_partition(self) -> "SpeechClassification":
        duration_sum = sum(
            (
                self.transcribed_speech_duration_sec,
                self.untranscribed_speech_duration_sec,
                self.vad_silence_duration_sec,
                self.pending_duration_sec,
            )
        )
        if not math.isclose(self.total_analysis_duration_sec, duration_sum, abs_tol=0.011):
            raise ValueError("speech classification durations must sum to the total")
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
    speech_classification: SpeechClassification | None = None


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


class TtsRequest(BaseModel):
    """Payload for local question or guide synthesis."""

    text: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)
    ]
    voice_id: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8)
    ] | None = None


class GroundedQuestion(BaseModel):
    """Internal A/B contract for one input-grounded interview question."""

    domain: Literal["resume", "job_technology"]
    question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
    ]
    # This is an exact source span, not an LLM-generated summary.
    evidence: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class GroundedQuestionSet(BaseModel):
    """Structured response envelope for the single grounded-question call."""

    questions: list[GroundedQuestion] = Field(default_factory=list)


class MeasurementRequest(BaseModel):
    """Payload for the B-owned measurement report endpoint."""

    answers: list[AnswerItem] = Field(default_factory=list)


class WordTimestamp(BaseModel):
    """Internal CLOVA word alignment data; never rendered as transcript text."""

    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    text: str = Field(min_length=1)


class TranscriptResponse(BaseModel):
    """Result of ``POST /stt`` — transcription of one answer's audio."""

    transcript: str
    status: "SttStatus"
    error: str | None = None
    confidence: float | None = None
    segment_count: int | None = None
    words: list[WordTimestamp] | None = None


class AnswerReview(BaseModel):
    """Transcript-grounded coaching for one interview answer."""

    summary: str = Field(min_length=1, max_length=2_000)
    strengths: list[str] = Field(default_factory=list, max_length=10)
    improvements: list[str] = Field(default_factory=list, max_length=10)


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


class EssayExperience(BaseModel):
    """One experience from the essay, with the claims it is meant to support."""

    experience: str = Field(description="경험 요약")
    claims: list[str] = Field(
        default_factory=list, description="이 경험이 뒷받침한다고 주장하는 것"
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


# --- Track B: 답변 내용 coaching ---------------------------------------------

class AnswerReviewRequest(BaseModel):
    """Payload for ``POST /answers/review``."""

    original_question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1_000)
    ] | None = None
    personalized_question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1_000)
    ] | None = None
    # Request-only compatibility for older clients. It is normalized below and
    # never returned in AnswerReview.
    question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1_000)
    ] | None = None
    transcript: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=10_000)
    ]
    essay: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=10_000)]
        | None
    ) = None
    profile: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def normalize_questions(self) -> "AnswerReviewRequest":
        personalized = (
            self.personalized_question or self.question or self.original_question
        )
        if not personalized:
            raise ValueError(
                "original_question 또는 personalized_question이 필요합니다."
            )
        if self.original_question is None:
            self.original_question = personalized
        if self.personalized_question is None:
            self.personalized_question = personalized
        return self
