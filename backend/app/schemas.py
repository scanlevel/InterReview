"""Pydantic request/response models for the InterReview API.

These mirror the data contract the Streamlit app used (``total_score`` /
``summary_feedback`` / ``results[]`` with per-question ``evaluation_items``) so
the evaluation output stays compatible while the frontend is rebuilt.
"""

from __future__ import annotations

from typing import Any

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


class EvaluateRequest(BaseModel):
    """Payload for ``POST /evaluate``."""

    # Kept loose on purpose: the rule-based engine barely uses the profile, and
    # the LLM path will accept whatever context the frontend chooses to send.
    profile: dict[str, Any] = Field(default_factory=dict)
    answers: list[AnswerItem] = Field(default_factory=list)


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
