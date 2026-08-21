"""Track B answer-content feedback and measurement report assembly."""

from __future__ import annotations

import json
from statistics import fmean
from typing import Literal

from pydantic import BaseModel, Field

from app.config import get_settings
from app.schemas import (
    AnswerItem,
    ContentFeedback,
    EvaluateRequest,
    EvaluationReport,
    MeasurementSummary,
    QuestionResult,
)
from app.services.llm import LLMError, request_json


class ContentFeedbackItem(BaseModel):
    question_id: str
    answer_status: Literal["good", "partial", "off_topic", "insufficient"]
    reason: str
    missing_points: list[str] = Field(default_factory=list)


class _ContentFeedbackBatch(BaseModel):
    results: list[ContentFeedbackItem] = Field(default_factory=list)


def _fallback_feedback(answer: AnswerItem) -> ContentFeedback:
    if not answer.transcript.strip():
        return ContentFeedback(
            answer_status="insufficient",
            reason="전사된 답변이 없어 내용 확인을 할 수 없습니다.",
        )
    return ContentFeedback(
        answer_status="partial",
        reason="LLM 내용 확인을 사용할 수 없어 답변 원문과 측정값만 표시합니다.",
    )


def _llm_feedback(
    answers: list[AnswerItem], profile: dict[str, object]
) -> tuple[list[ContentFeedback], bool]:
    """Evaluate answer content in one request; any failure degrades safely."""
    if not answers:
        return [], False
    settings = get_settings()
    if not (settings.anthropic_api_key or "").strip():
        return [_fallback_feedback(answer) for answer in answers], False

    payload = {
        "profile": profile,
        "answers": [
            {
                "question_id": answer.question_id,
                "question": answer.question,
                "transcript": answer.transcript,
            }
            for answer in answers
        ],
    }
    try:
        result = request_json(
            _ContentFeedbackBatch,
            model=settings.eval_model,
            max_tokens=2400,
            system=(
                "당신은 면접 답변 내용만 확인하는 검토자입니다. 시선·음성 수치나 "
                "지원자의 감정, 성격, 합격 가능성은 판단하지 마세요. 질문과 transcript를 "
                "근거로 answer_status를 good, partial, off_topic, insufficient 중 하나로 "
                "고르고 짧은 reason과 실제로 빠진 내용의 missing_points를 작성하세요. "
                "transcript에 없는 사실을 만들지 마세요. "
                "반드시 {\"results\":[...]} JSON만 반환하세요."
            ),
            user=json.dumps(payload, ensure_ascii=False),
        )
        by_id = {item.question_id: item for item in result.results}
        if any(answer.question_id not in by_id for answer in answers):
            raise LLMError("일부 질문의 내용 피드백이 누락되었습니다.")
        return [
            ContentFeedback(
                answer_status=by_id[answer.question_id].answer_status,
                reason=by_id[answer.question_id].reason.strip(),
                missing_points=[
                    point.strip()
                    for point in by_id[answer.question_id].missing_points
                    if point.strip()
                ],
            )
            for answer in answers
        ], True
    except LLMError:
        return [_fallback_feedback(answer) for answer in answers], False


def _mean(values: list[float]) -> float | None:
    return round(fmean(values), 2) if values else None


def _measurement_summary(answers: list[AnswerItem]) -> MeasurementSummary:
    speech = [answer.speech_metrics for answer in answers if answer.speech_metrics]
    gaze = [answer.eye_tracking for answer in answers if answer.eye_tracking]
    return MeasurementSummary(
        average_answer_length_eojeol=_mean(
            [float(len(answer.transcript.strip().split())) for answer in answers if answer.transcript.strip()]
        ),
        average_total_duration_sec=_mean([item.total_duration_sec for item in speech]),
        average_speech_duration_sec=_mean([item.speech_duration_sec for item in speech]),
        average_silence_duration_sec=_mean([item.silence_duration_sec for item in speech]),
        average_silence_ratio=_mean([item.silence_ratio for item in speech]),
        average_long_pause_count=_mean([float(item.long_pause_count) for item in speech]),
        average_face_detected_ratio=_mean(
            [item.face_detected_ratio for item in gaze if item.face_detected_ratio is not None]
        ),
        average_valid_gaze_ratio=_mean(
            [item.valid_gaze_ratio for item in gaze if item.valid_gaze_ratio is not None]
        ),
        average_front_gaze_ratio=_mean(
            [item.front_gaze_ratio for item in gaze if item.front_gaze_ratio is not None]
        ),
        average_mean_gaze_x=_mean(
            [item.mean_gaze_x for item in gaze if item.mean_gaze_x is not None]
        ),
        average_mean_gaze_y=_mean(
            [item.mean_gaze_y for item in gaze if item.mean_gaze_y is not None]
        ),
        average_gaze_std_x=_mean(
            [item.gaze_std_x for item in gaze if item.gaze_std_x is not None]
        ),
        average_gaze_std_y=_mean(
            [item.gaze_std_y for item in gaze if item.gaze_std_y is not None]
        ),
    )


def _display(value: float | None, suffix: str = "") -> str:
    return "—" if value is None else f"{value:.2f}{suffix}"


def _summary_text(summary: MeasurementSummary) -> str:
    return (
        f"{summary.reference_source} 기준 평균 답변시간은 약 "
        f"{summary.reference_average_total_duration_sec:.1f}초입니다. "
        f"이번 세션의 평균 총 답변시간은 {_display(summary.average_total_duration_sec, '초')}, "
        f"평균 실제 발화시간은 {_display(summary.average_speech_duration_sec, '초')}, "
        f"평균 무음시간은 {_display(summary.average_silence_duration_sec, '초')}입니다. "
        f"평균 시선 측정값은 얼굴 검출 {_display(summary.average_face_detected_ratio * 100 if summary.average_face_detected_ratio is not None else None, '%')}, "
        f"유효 시선 {_display(summary.average_valid_gaze_ratio * 100 if summary.average_valid_gaze_ratio is not None else None, '%')}, "
        f"평균 위치 ({_display(summary.average_mean_gaze_x)}, {_display(summary.average_mean_gaze_y)}), "
        f"표준편차 ({_display(summary.average_gaze_std_x)}, {_display(summary.average_gaze_std_y)})입니다."
    )


def evaluate_interview(request: EvaluateRequest) -> EvaluationReport:
    """Return content feedback plus the unmodified audio/vision measurements."""
    feedback, used_llm = _llm_feedback(request.answers, request.profile)
    measurement_summary = _measurement_summary(request.answers)
    results = [
        QuestionResult(
            question_id=answer.question_id,
            question=answer.question,
            category=answer.category,
            original_question=answer.original_question,
            transcript=answer.transcript,
            speech_metrics=answer.speech_metrics,
            eye_tracking=answer.eye_tracking,
            content=content,
        )
        for answer, content in zip(request.answers, feedback, strict=True)
    ]

    return EvaluationReport(
        status="ok" if used_llm else "fallback",
        engine="llm" if used_llm else "fallback",
        summary_feedback=_summary_text(measurement_summary),
        measurement_summary=measurement_summary,
        results=results,
    )
