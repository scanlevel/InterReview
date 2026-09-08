"""Tests for B-owned transcript coaching and its safe fallbacks."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.prompts.answer_review import ANSWER_REVIEW_SYSTEM_PROMPT
from app.schemas import AnswerReview
from app.services import answer_review as answer_review_service
from app.services import llm

client = TestClient(app)

QUESTION = "가장 기억에 남는 프로젝트 경험은 무엇인가요?"
PERSONALIZED = "주문 처리 프로젝트에서 맡은 역할은 무엇인가요?"
TRANSCRIPT = "쇼핑몰 백엔드 프로젝트에서 주문 처리 모듈을 담당했습니다."
ESSAY = "자소서 본문"
PROFILE = {
    "job": "백엔드 개발자",
}


def _review(**overrides: Any) -> AnswerReview:
    fields: dict[str, Any] = {
        "summary": "주문 처리 모듈을 담당한 경험을 설명했습니다.",
        "strengths": ["담당한 업무를 구체적으로 언급했습니다."],
        "improvements": ["다음에는 그 결과나 판단 근거도 덧붙여 보세요."],
    }
    fields.update(overrides)
    return AnswerReview(**fields)


def _stub_llm(
    monkeypatch: pytest.MonkeyPatch,
    result: Any,
    *,
    configured: bool = True,
) -> dict[str, Any]:
    """Replace call_structured; return a dict that captures its kwargs and call count."""
    captured: dict[str, Any] = {"calls": 0}

    def fake(**kwargs: Any) -> Any:
        captured["calls"] += 1
        captured.update(kwargs)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(answer_review_service.llm, "is_configured", lambda: configured)
    monkeypatch.setattr(answer_review_service.llm, "call_structured", fake)
    return captured


# --- service: happy path ----------------------------------------------------


def test_review_returns_three_coaching_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _review())

    result = answer_review_service.review_answer(
        QUESTION, PERSONALIZED, TRANSCRIPT, ESSAY, PROFILE
    )

    assert isinstance(result, AnswerReview)
    assert result.summary.startswith("주문 처리")
    assert result.strengths
    assert result.improvements

    assert captured["model"] == get_settings().eval_model
    assert captured["output_format"] is AnswerReview
    assert captured["system"] == ANSWER_REVIEW_SYSTEM_PROMPT
    assert QUESTION in captured["user"]
    assert PERSONALIZED in captured["user"]
    assert TRANSCRIPT in captured["user"]
    assert ESSAY in captured["user"]
    assert "백엔드 개발자" in captured["user"]


def test_empty_or_short_transcript_skips_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _review())
    for transcript in ("", "  ", "짧"):
        result = answer_review_service.review_answer(QUESTION, PERSONALIZED, transcript)
        assert result.summary
    assert captured["calls"] == 0


# --- service: unavailable fallbacks (never raise) ---------------------------


def test_unavailable_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, llm.LLMCallError("boom"))
    result = answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)
    assert "사용할 수 없습니다" in result.summary
    assert result.strengths == []
    assert result.improvements == []


def test_unavailable_on_unexpected_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """Even a non-LLMError bug in the call path must not end the session."""
    _stub_llm(monkeypatch, RuntimeError("unexpected"))
    result = answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)
    assert "사용할 수 없습니다" in result.summary


def test_unavailable_when_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without a key the service must not attempt a call at all."""
    captured = _stub_llm(monkeypatch, _review(), configured=False)
    result = answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)
    assert "사용할 수 없습니다" in result.summary
    assert captured["calls"] == 0


# --- route ------------------------------------------------------------------


def test_route_422_on_invalid_request(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _review())

    too_long = client.post(
        "/answers/review",
        json={
            "original_question": QUESTION,
            "personalized_question": PERSONALIZED,
            "transcript": "가" * 10_001,
        },
    )
    no_question = client.post(
        "/answers/review",
        json={"transcript": TRANSCRIPT},
    )

    assert too_long.status_code == 422
    assert no_question.status_code == 422
    assert captured["calls"] == 0


def test_route_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _review())

    response = client.post(
        "/answers/review",
        json={
            "original_question": QUESTION,
            "personalized_question": PERSONALIZED,
            "transcript": TRANSCRIPT,
            "essay": ESSAY,
            "profile": PROFILE,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"summary", "strengths", "improvements"}
    assert body["strengths"]
    assert ESSAY in captured["user"]
    assert "백엔드 개발자" in captured["user"]


def test_route_200_even_on_llm_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, llm.LLMCallError("boom"))

    response = client.post(
        "/answers/review",
        json={
            "original_question": QUESTION,
            "personalized_question": PERSONALIZED,
            "transcript": TRANSCRIPT,
        },
    )

    assert response.status_code == 200
    assert "사용할 수 없습니다" in response.json()["summary"]


# --- retired route ----------------------------------------------------------


def test_evaluate_route_removed() -> None:
    """C-1: the score-based /evaluate endpoint is gone, not just unused."""
    response = client.post("/evaluate", json={})
    assert response.status_code == 404
