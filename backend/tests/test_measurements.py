"""Tests for B-owned measurement preservation and session averages."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.schemas import (
    AnswerItem,
    EyeTrackingSummary,
    GazeHeatmap,
    MeasurementRequest,
    SpeechMetrics,
)
from app.services.measurements import build_measurement_report

client = TestClient(app)


def _answer() -> AnswerItem:
    return AnswerItem(
        question_id="q1",
        question="협업 중 갈등을 해결한 경험을 말해 주세요.",
        original_question="갈등을 해결한 경험이 있나요",
        category="협업·조직생활",
        transcript="당시 프로젝트에서 역할을 다시 나누고 결과를 확인했습니다.",
        eye_tracking=EyeTrackingSummary(
            front_gaze_ratio=0.82,
            face_detected_ratio=0.95,
            valid_gaze_ratio=0.9,
            mean_gaze_x=0.03,
            mean_gaze_y=-0.02,
            gaze_std_x=0.11,
            gaze_std_y=0.09,
            std_gaze=0.142,
            gaze_heatmap=GazeHeatmap(columns=2, rows=1, counts=[3, 1], total=4),
        ),
        speech_metrics=SpeechMetrics(
            total_duration_sec=87.4,
            speech_duration_sec=71.2,
            speech_rate_eojeol_per_min=126,
            silence_duration_sec=16.2,
            silence_ratio=0.185,
            long_pause_count=3,
            max_pause_sec=3.1,
        ),
    )


def test_report_keeps_measurements_and_session_averages() -> None:
    report = build_measurement_report(MeasurementRequest(answers=[_answer()]))

    result = report.results[0]
    assert result.transcript.startswith("당시 프로젝트")
    assert result.original_question == "갈등을 해결한 경험이 있나요"
    assert result.content is None
    assert result.speech_metrics is not None
    assert result.speech_metrics.long_pause_count == 3
    assert result.eye_tracking is not None
    assert result.eye_tracking.gaze_heatmap is not None
    assert report.measurement_summary.average_total_duration_sec == 87.4
    assert report.measurement_summary.average_speech_duration_sec == 71.2
    assert report.measurement_summary.average_silence_duration_sec == 16.2
    assert report.measurement_summary.average_valid_gaze_ratio == 0.9


def test_empty_answer_has_no_measurement_values() -> None:
    report = build_measurement_report(
        MeasurementRequest(
            answers=[AnswerItem(question_id="q2", question="자기소개를 해주세요.")]
        )
    )
    assert report.results[0].content is None
    assert report.measurement_summary.average_total_duration_sec is None
    assert report.measurement_summary.average_answer_length_eojeol is None


def test_measurements_endpoint() -> None:
    response = client.post(
        "/measurements",
        json={
            "answers": [
                {
                    "question_id": "q1",
                    "question": "갈등 해결 경험은?",
                    "transcript": "당시 문제가 있었습니다.",
                    "speech_metrics": {
                        "total_duration_sec": 4,
                        "speech_duration_sec": 3,
                        "speech_rate_eojeol_per_min": 80,
                        "silence_duration_sec": 1,
                        "silence_ratio": 0.25,
                        "long_pause_count": 0,
                        "max_pause_sec": 1,
                        "long_pause_threshold_sec": 2,
                    },
                }
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["content"] is None
    assert body["results"][0]["speech_metrics"]["total_duration_sec"] == 4
    assert body["measurement_summary"]["average_speech_duration_sec"] == 3
