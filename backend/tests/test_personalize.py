"""Tests for Track B question personalization (``docs/plan-A.md`` §7, §10).

The LLM is mocked, so these need neither a key nor network. They cover the
happy path (the personalized sentence and the request the service builds),
post-processing (whitespace collapse, quote stripping), and every fallback
path — the contract is that ``personalize_question`` never raises and any
failure returns ``question.text`` unchanged (plan.md §14-7).
"""

from __future__ import annotations

from typing import Any

import pytest

from app.config import get_settings
from app.prompts.personalize import PERSONALIZE_SYSTEM_PROMPT
from app.schemas import Question
from app.services import llm
from app.services import personalize as personalize_service

ORIGINAL_TEXT = "가장 기억에 남는 프로젝트 경험은 무엇인가요?"


def _question(text: str = ORIGINAL_TEXT) -> Question:
    return Question(
        id="q-1",
        category="자기소개·이력",
        rule_group="resume",
        subcategory="자기소개·이력::프로젝트",
        experience="NEW",
        text=text,
    )


def _stub_llm(
    monkeypatch: pytest.MonkeyPatch,
    result: Any,
    *,
    configured: bool = True,
) -> dict[str, Any]:
    """Replace call_text; return a dict that captures its kwargs and call count."""
    captured: dict[str, Any] = {"calls": 0}

    def fake(**kwargs: Any) -> Any:
        captured["calls"] += 1
        captured.update(kwargs)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(personalize_service.llm, "is_configured", lambda: configured)
    monkeypatch.setattr(personalize_service.llm, "call_text", fake)
    return captured


# --- happy path -------------------------------------------------------------


def test_returns_personalized_text(monkeypatch: pytest.MonkeyPatch) -> None:
    personalized = "쇼핑몰 백엔드 프로젝트에서 가장 기억에 남는 경험은 무엇인가요?"
    captured = _stub_llm(monkeypatch, personalized)

    result = personalize_service.personalize_question(
        {"job": "백엔드"}, "자소서 본문", _question()
    )

    assert result == personalized
    assert captured["model"] == get_settings().personalize_model
    assert captured["effort"] == "low"
    assert captured["system"] == PERSONALIZE_SYSTEM_PROMPT
    assert ORIGINAL_TEXT in captured["user"]


# --- failure fallbacks (never raise, return the original text) --------------


def test_fallback_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, llm.LLMCallError("boom"))
    result = personalize_service.personalize_question({}, None, _question())
    assert result == ORIGINAL_TEXT


def test_fallback_on_unexpected_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """Even a non-LLMError bug in the call path must not end the session."""
    _stub_llm(monkeypatch, RuntimeError("unexpected"))
    result = personalize_service.personalize_question({}, None, _question())
    assert result == ORIGINAL_TEXT


# --- post-processing --------------------------------------------------------


def test_single_sentence(monkeypatch: pytest.MonkeyPatch) -> None:
    """Newlines collapse to single spaces: the UI shows one line."""
    _stub_llm(monkeypatch, "질문 첫 줄\n둘째 줄?")
    result = personalize_service.personalize_question({}, None, _question())
    assert "\n" not in result
    assert result == "질문 첫 줄 둘째 줄?"


def test_strips_quotes(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, '"개인화된 질문?"')
    result = personalize_service.personalize_question({}, None, _question())
    assert result == "개인화된 질문?"


# --- output validation fallbacks --------------------------------------------


def test_fallback_on_missing_question_mark(monkeypatch: pytest.MonkeyPatch) -> None:
    """A statement is not a question; keep the original instead."""
    _stub_llm(monkeypatch, "물음표 없이 끝나는 문장입니다.")
    result = personalize_service.personalize_question({}, None, _question())
    assert result == ORIGINAL_TEXT


def test_fallback_on_too_long(monkeypatch: pytest.MonkeyPatch) -> None:
    """201 characters (question mark included) exceeds the 200-char cap."""
    _stub_llm(monkeypatch, "가" * 200 + "?")
    result = personalize_service.personalize_question({}, None, _question())
    assert result == ORIGINAL_TEXT


# --- not configured ---------------------------------------------------------


def test_not_configured_skips_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without a key the service must not attempt a call at all."""
    captured = _stub_llm(monkeypatch, "호출되면 안 되는 결과?", configured=False)
    result = personalize_service.personalize_question({}, None, _question())
    assert result == ORIGINAL_TEXT
    assert captured["calls"] == 0
