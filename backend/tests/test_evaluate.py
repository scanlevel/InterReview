"""Tests for the rule-based evaluation engine and the /evaluate route.

None of these need an API key — they exercise the graceful-degradation path.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.schemas import AnswerItem, EvaluateRequest, EyeTrackingSummary
from app.services.evaluate import evaluate_interview

client = TestClient(app)


def _strong_answer() -> AnswerItem:
    return AnswerItem(
        question_id="q1",
        question="협업 중 갈등을 해결한 경험을 말해 주세요.",
        category="personality",
        transcript=(
            "당시 프로젝트에서 일정 문제로 팀원과 갈등이 있었습니다. 그래서 저는 "
            "역할을 다시 나누고 매일 15분 회의를 제안해 진행 상황을 공유했습니다. "
            "그 결과 마감을 3일 단축했고 협업 방식도 개선했습니다."
        ),
        eye_tracking=EyeTrackingSummary(
            front_gaze_ratio=0.82, face_detected_ratio=0.95, std_gaze=0.08
        ),
    )


def test_strong_answer_scores_high() -> None:
    report = evaluate_interview(EvaluateRequest(answers=[_strong_answer()]))
    assert report.engine == "rule_based"
    assert report.total_score is not None and report.total_score >= 60
    result = report.results[0]
    names = {i.name for i in result.evaluation_items}
    assert names == {"질문 적합성", "답변 구체성", "논리 구조", "전달 태도"}
    # Structure hints (상황/그래서/결과) should all be detected.
    structure = next(i for i in result.evaluation_items if i.name == "논리 구조")
    assert structure.score is not None and structure.score >= 80


def test_empty_answer_marks_no_answer() -> None:
    empty = AnswerItem(question_id="q2", question="자기소개를 해주세요.", transcript="")
    report = evaluate_interview(EvaluateRequest(answers=[empty]))
    result = report.results[0]
    text_items = [i for i in result.evaluation_items if i.name != "전달 태도"]
    assert all(i.status == "no_answer" and i.score is None for i in text_items)


def test_all_empty_gives_none_total() -> None:
    report = evaluate_interview(
        EvaluateRequest(answers=[AnswerItem(question_id="q", question="?", transcript="")])
    )
    assert report.total_score is None


def test_delivery_na_without_eye_data() -> None:
    answer = AnswerItem(
        question_id="q3", question="장점은?", transcript="꼼꼼합니다.", eye_tracking=None
    )
    report = evaluate_interview(EvaluateRequest(answers=[answer]))
    delivery = next(
        i for i in report.results[0].evaluation_items if i.name == "전달 태도"
    )
    assert delivery.status == "na" and delivery.score is None


def test_evaluate_endpoint() -> None:
    payload = {
        "profile": {"job": "backend"},
        "answers": [
            {
                "question_id": "q1",
                "question": "갈등 해결 경험은?",
                "category": "personality",
                "transcript": "당시 문제가 있었고 그래서 해결했고 그 결과 개선했습니다.",
                "eye_tracking": {"front_gaze_ratio": 0.7, "face_detected_ratio": 0.9},
            }
        ],
    }
    response = client.post("/evaluate", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["engine"] == "rule_based"
    assert body["status"] == "rule_based"
    assert len(body["results"]) == 1
    assert body["total_score"] is not None
