"""Assemble B-owned audio and vision measurements for the result screen."""

from __future__ import annotations

from statistics import fmean

from app.schemas import (
    MeasurementReport,
    MeasurementRequest,
    MeasurementSummary,
    QuestionResult,
)


def _mean(values: list[float]) -> float | None:
    return round(fmean(values), 2) if values else None


def measurement_summary(request: MeasurementRequest) -> MeasurementSummary:
    """Average only measurements that exist; never invent missing values."""
    answers = request.answers
    speech = [answer.speech_metrics for answer in answers if answer.speech_metrics]
    return MeasurementSummary(
        average_answer_length_eojeol=_mean(
            [
                float(len(answer.transcript.strip().split()))
                for answer in answers
                if answer.transcript.strip()
            ]
        ),
        average_total_duration_sec=_mean(
            [item.total_duration_sec for item in speech]
        ),
        average_speech_duration_sec=_mean(
            [item.speech_duration_sec for item in speech]
        ),
        average_silence_duration_sec=_mean(
            [item.silence_duration_sec for item in speech]
        ),
        average_silence_ratio=_mean([item.silence_ratio for item in speech]),
        average_long_pause_count=_mean(
            [float(item.long_pause_count) for item in speech]
        ),
    )


def _display(value: float | None, suffix: str = "") -> str:
    return "—" if value is None else f"{value:.2f}{suffix}"


def _summary_text(summary: MeasurementSummary) -> str:
    """Describe the reference and measured values without ranking the user."""
    return (
        f"{summary.reference_source} 기준 평균 답변시간은 약 "
        f"{summary.reference_average_total_duration_sec:.1f}초입니다. "
        f"이번 세션의 평균 총 답변시간은 "
        f"{_display(summary.average_total_duration_sec, '초')}, "
        f"평균 실제 발화시간은 {_display(summary.average_speech_duration_sec, '초')}, "
        f"평균 무음시간은 {_display(summary.average_silence_duration_sec, '초')}입니다. "
        "시선은 질문별 Heatmap으로 표시합니다."
    )


def build_measurement_report(request: MeasurementRequest) -> MeasurementReport:
    """Return captured answers and raw B measurements for the result screen."""
    summary = measurement_summary(request)
    results = [
        QuestionResult(
            question_id=answer.question_id,
            question=answer.question,
            category=answer.category,
            original_question=answer.original_question,
            transcript=answer.transcript,
            stt_status=answer.stt_status,
            stt_error=answer.stt_error,
            speech_metrics=answer.speech_metrics,
            eye_tracking=answer.eye_tracking,
        )
        for answer in request.answers
    ]
    return MeasurementReport(
        summary_feedback=_summary_text(summary),
        measurement_summary=summary,
        results=results,
    )
