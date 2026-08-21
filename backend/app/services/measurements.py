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
    gaze = [answer.eye_tracking for answer in answers if answer.eye_tracking]
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
    """Describe the reference and measured values without ranking the user."""
    face_detected = (
        summary.average_face_detected_ratio * 100
        if summary.average_face_detected_ratio is not None
        else None
    )
    valid_gaze = (
        summary.average_valid_gaze_ratio * 100
        if summary.average_valid_gaze_ratio is not None
        else None
    )
    return (
        f"{summary.reference_source} 기준 평균 답변시간은 약 "
        f"{summary.reference_average_total_duration_sec:.1f}초입니다. "
        f"이번 세션의 평균 총 답변시간은 "
        f"{_display(summary.average_total_duration_sec, '초')}, "
        f"평균 실제 발화시간은 {_display(summary.average_speech_duration_sec, '초')}, "
        f"평균 무음시간은 {_display(summary.average_silence_duration_sec, '초')}입니다. "
        f"평균 시선 측정값은 얼굴 검출 {_display(face_detected, '%')}, "
        f"유효 시선 {_display(valid_gaze, '%')}, "
        f"평균 위치 ({_display(summary.average_mean_gaze_x)}, "
        f"{_display(summary.average_mean_gaze_y)}), "
        f"표준편차 ({_display(summary.average_gaze_std_x)}, "
        f"{_display(summary.average_gaze_std_y)})입니다."
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
