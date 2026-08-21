"""Pydantic request/response models for the InterReview API.

These mirror the data contract the Streamlit app used (``total_score`` /
``summary_feedback`` / ``results[]`` with per-question ``evaluation_items``) so
the evaluation output stays compatible while the frontend is rebuilt.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints


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


# --- Track A: 자소서 분석 ------------------------------------------------------
# These are the output schema for `POST /essay/analyze`. Because the analysis
# model is handed to the API as a structured-output format, only JSON Schema
# features the API supports may appear here — notably `Literal` (rendered as
# `enum`, enforced server-side) rather than numeric range constraints, which
# the SDK strips from the schema and can only check after the fact.


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

    # Bounded because this is a user-input boundary: the text is billed as
    # input tokens, and a 자기소개서 is a few thousand characters at most.
    essay: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)
    ]
    profile: dict[str, Any] = Field(default_factory=dict)
