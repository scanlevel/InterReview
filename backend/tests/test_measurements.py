"""Tests for B-owned measurement preservation and session averages."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.schemas import (
    AnswerItem,
    EyeTrackingSummary,
    GazeHeatmap,
    MeasurementRequest,
    AudioTimeline,
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
        stt_status="ok",
        stt_error=None,
        eye_tracking=EyeTrackingSummary(
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
            audio_timeline=AudioTimeline(
                energy=[0.1, 0.8], speech=[False, True], long_pause=[True, False]
            ),
        ),
    )


def test_report_keeps_measurements_and_session_averages() -> None:
    report = build_measurement_report(MeasurementRequest(answers=[_answer()]))

    result = report.results[0]
    assert result.stt_status == "ok"
    assert result.transcript.startswith("당시 프로젝트")
    assert result.original_question == "갈등을 해결한 경험이 있나요"
    assert result.content is None
    assert result.speech_metrics is not None
    assert result.speech_metrics.long_pause_count == 3
    assert result.speech_metrics.audio_timeline is not None
    assert result.speech_metrics.audio_timeline.long_pause == [True, False]
    assert result.eye_tracking is not None
    assert result.eye_tracking.gaze_heatmap is not None
    assert report.measurement_summary.average_total_duration_sec == 87.4
    assert report.measurement_summary.average_speech_duration_sec == 71.2
    assert report.measurement_summary.average_silence_duration_sec == 16.2
    assert report.summary_feedback.endswith("시선은 질문별 Heatmap으로 표시합니다.")
    assert "답변시간" not in report.summary_feedback
    assert "발화시간" not in report.summary_feedback
    assert "무음시간" not in report.summary_feedback


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
                    "stt_status": "not_configured",
                    "stt_error": "missing",
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
                        "audio_timeline": {
                            "energy": [0.2, 0.9],
                            "speech": [False, True],
                            "long_pause": [True, False],
                        },
                    },
                }
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["stt_status"] == "not_configured"
    assert body["results"][0]["content"] is None
    assert body["results"][0]["speech_metrics"]["total_duration_sec"] == 4
    assert body["results"][0]["speech_metrics"]["audio_timeline"]["long_pause"] == [True, False]
    assert body["measurement_summary"]["average_speech_duration_sec"] == 3
