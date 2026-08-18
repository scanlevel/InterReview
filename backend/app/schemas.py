"""Pydantic request/response models for the InterReview API.

These mirror the data contract the Streamlit app used (``total_score`` /
``summary_feedback`` / ``results[]`` with per-question ``evaluation_items``) so
the evaluation output stays compatible while the frontend is rebuilt.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class EyeTrackingSummary(BaseModel):
    """Per-question gaze summary produced in the browser (MediaPipe).

    All fields are optional so a question with no camera data still validates.
    """

    front_gaze_ratio: float | None = Field(
        default=None, description="정면 응시 프레임 비율 (0..1)"
    )
    face_detected_ratio: float | None = Field(
        default=None, description="얼굴이 검출된 프레임 비율 (0..1)"
    )
    std_gaze: float | None = Field(
        default=None, description="시선 좌표 표준편차 (흔들림, 클수록 산만)"
    )


class AnswerItem(BaseModel):
    """One question together with the applicant's captured answer."""

    question_id: str
    question: str
    category: str | None = None
    transcript: str = ""
    eye_tracking: EyeTrackingSummary | None = None


class Question(BaseModel):
    """One generated interview question, tagged with its rule-bank origin."""

    id: str
    category: str  # rule group name, e.g. "자기소개·이력"
    rule_group: str  # rule group id, e.g. "resume"
    subcategory: str  # "<category>::<expression>" from the source domain
    experience: str  # NEW | EXPERIENCED
    text: str
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


class EvaluateRequest(BaseModel):
    """Payload for ``POST /evaluate``."""

    # Kept loose on purpose: the rule-based engine barely uses the profile, and
    # the LLM path will accept whatever context the frontend chooses to send.
    profile: dict[str, Any] = Field(default_factory=dict)
    answers: list[AnswerItem] = Field(default_factory=list)


class TranscriptResponse(BaseModel):
    """Result of ``POST /stt`` — transcription of one answer's audio."""

    transcript: str
    # ok | no_speech | empty | not_configured | error
    status: str
    error: str | None = None
    confidence: float | None = None
    segment_count: int | None = None


class BenchmarkSource(BaseModel):
    dataset: str
    source_sample_id: str | None = None
    source_split: str | None = None
    experience: str | None = None


class BenchmarkQuestion(BaseModel):
    text: str
    group: str | None = None
    group_name: str | None = None


class BenchmarkAnswer(BaseModel):
    text: str
    word_count: int = 0


class BenchmarkAudio(BaseModel):
    question_wav: str
    answer_wav: str


class BenchmarkCandidate(BaseModel):
    """Inspectable Q-A/audio pair; scoring fields are intentionally absent."""

    sample_id: str
    source: BenchmarkSource
    question: BenchmarkQuestion
    answer: BenchmarkAnswer
    audio: BenchmarkAudio
    metadata: dict[str, Any] = Field(default_factory=dict)


class BenchmarkSamplePage(BaseModel):
    items: list[BenchmarkCandidate]
    total: int
    offset: int
    limit: int


class AnnotatorRegistrationRequest(BaseModel):
    name: str = Field(min_length=1)
    affiliation_or_major: str | None = None
    interview_experience: str | None = None
    evaluation_experience: str | None = None
    note: str | None = None


class BenchmarkScores(BaseModel):
    relevance: Literal[0, 1, 2]
    specificity: Literal[0, 1, 2]
    coherence: Literal[0, 1, 2]
    specialized: Literal[0, 1, 2]


class SaveBenchmarkAnnotationRequest(BaseModel):
    annotator_id: UUID
    rubric_version: str = Field(min_length=1)
    target_mode: Literal["pilot", "full"] = "full"
    scores: BenchmarkScores
    confidence: Literal[0, 1, 2]
    note: str = ""


class SaveAdjudicationRequest(BaseModel):
    adjudicator_id: UUID
    rubric_version: str = Field(min_length=1)
    target_mode: Literal["pilot", "full"] = "full"
    scores: BenchmarkScores
    note: str = ""


class EvaluationItem(BaseModel):
    """A single scored dimension of one answer."""

    name: str
    score: int | None
    status: str  # rule_based | no_answer | na
    comment: str


class QuestionResult(BaseModel):
    """Evaluation of one question."""

    question_id: str | None
    question: str | None
    category: str | None
    evaluation_items: list[EvaluationItem]
    feedback: str


class EvaluationReport(BaseModel):
    """Full evaluation returned to the frontend."""

    total_score: int | None
    status: str  # rule_based | llm | mock
    engine: str  # "rule_based" | "llm"
    summary_feedback: str
    results: list[QuestionResult]
