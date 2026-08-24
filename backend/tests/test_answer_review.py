"""Tests for A-4 answer-content review and the /answers/review route.

The LLM is mocked, so these need neither a key nor network. They cover the
happy path (fields passed through, the request the service builds), every
``unavailable`` fallback path — the contract is that ``review_answer`` never
raises and the route always answers 200 so an interview session cannot be
killed by an LLM failure (plan.md §14-7, ``docs/plan-A.md`` §8.2) — and the
removal of the retired ``/evaluate`` route (C-1 점수 스키마 폐기).
"""

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
from app.services.answer_review import _LLMAnswerReview

client = TestClient(app)

QUESTION = "가장 기억에 남는 프로젝트 경험은 무엇인가요?"
TRANSCRIPT = "쇼핑몰 백엔드 프로젝트에서 주문 처리 모듈을 담당했습니다."
ESSAY = "자소서 본문"


def _review(**overrides: Any) -> _LLMAnswerReview:
    fields: dict[str, Any] = {
        "answer_status": "good",
        "reason": "충분히 답했다",
        "missing_points": [],
        "follow_up_question": None,
    }
    fields.update(overrides)
    return _LLMAnswerReview(**fields)


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


def test_status_values(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _review())

    result = answer_review_service.review_answer(QUESTION, TRANSCRIPT, ESSAY)

    assert isinstance(result, AnswerReview)
    assert result.answer_status == "good"
    assert result.reason == "충분히 답했다"
    assert result.missing_points == []
    assert result.follow_up_question is None

    assert captured["model"] == get_settings().eval_model
    assert captured["output_format"] is _LLMAnswerReview
    assert captured["system"] == ANSWER_REVIEW_SYSTEM_PROMPT
    assert QUESTION in captured["user"]
    assert TRANSCRIPT in captured["user"]
    assert ESSAY in captured["user"]


def test_partial_with_missing_points(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(
        monkeypatch,
        _review(
            answer_status="partial",
            reason="역할 설명이 빠졌다",
            missing_points=["본인이 담당한 역할", "정량적 결과"],
            follow_up_question="그 프로젝트에서 직접 담당한 부분은 무엇인가요?",
        ),
    )

    result = answer_review_service.review_answer(QUESTION, TRANSCRIPT)

    assert result.answer_status == "partial"
    assert result.missing_points == ["본인이 담당한 역할", "정량적 결과"]
    assert result.follow_up_question == "그 프로젝트에서 직접 담당한 부분은 무엇인가요?"


# --- service: unavailable fallbacks (never raise) ---------------------------


def test_unavailable_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, llm.LLMCallError("boom"))
    result = answer_review_service.review_answer(QUESTION, TRANSCRIPT)
    assert result.answer_status == "unavailable"
    assert result.reason


def test_unavailable_on_unexpected_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """Even a non-LLMError bug in the call path must not end the session."""
    _stub_llm(monkeypatch, RuntimeError("unexpected"))
    result = answer_review_service.review_answer(QUESTION, TRANSCRIPT)
    assert result.answer_status == "unavailable"


def test_unavailable_when_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without a key the service must not attempt a call at all."""
    captured = _stub_llm(monkeypatch, _review(), configured=False)
    result = answer_review_service.review_answer(QUESTION, TRANSCRIPT)
    assert result.answer_status == "unavailable"
    assert captured["calls"] == 0


def test_empty_transcript_is_insufficient_without_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No speech is a foregone "insufficient" — never worth an LLM call."""
    captured = _stub_llm(monkeypatch, _review())
    result = answer_review_service.review_answer(QUESTION, "   ")
    assert result.answer_status == "insufficient"
    assert result.reason
    assert captured["calls"] == 0


# --- route ------------------------------------------------------------------


def test_route_422_on_out_of_bounds_input(monkeypatch: pytest.MonkeyPatch) -> None:
    """Input caps mirror the essay route: reject before spending tokens."""
    captured = _stub_llm(monkeypatch, _review())

    too_long = client.post(
        "/answers/review", json={"question": QUESTION, "transcript": "가" * 10_001}
    )
    empty_question = client.post(
        "/answers/review", json={"question": "  ", "transcript": TRANSCRIPT}
    )

    assert too_long.status_code == 422
    assert empty_question.status_code == 422
    assert captured["calls"] == 0


def test_route_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(
        monkeypatch,
        _review(answer_status="off_topic", reason="질문과 다른 경험을 이야기했다"),
    )

    response = client.post(
        "/answers/review",
        json={"question": QUESTION, "transcript": TRANSCRIPT, "essay": ESSAY},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["answer_status"] == "off_topic"
    assert body["reason"] == "질문과 다른 경험을 이야기했다"
    assert body["missing_points"] == []
    assert body["follow_up_question"] is None


def test_route_200_even_on_llm_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unlike /essay/analyze there is no 502 here: the session must go on."""
    _stub_llm(monkeypatch, llm.LLMCallError("boom"))

    response = client.post(
        "/answers/review",
        json={"question": QUESTION, "transcript": TRANSCRIPT},
    )

    assert response.status_code == 200
    assert response.json()["answer_status"] == "unavailable"


# --- retired route ----------------------------------------------------------


def test_evaluate_route_removed() -> None:
    """C-1: the score-based /evaluate endpoint is gone, not just unused."""
    response = client.post("/evaluate", json={})
    assert response.status_code == 404
