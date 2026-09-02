"""Tests for B-owned question personalization."""

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
        question_id="background__c_person::0",
        category="자기소개·이력",
        rule_group="resume",
        subcategory="자기소개·이력::프로젝트",
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
        {
            "job": "백엔드",
            "technologies": "FastAPI",
            "projects": "주문 처리 프로젝트",
        },
        "자소서 본문",
        _question(),
    )

    assert result == personalized
    assert captured["model"] == get_settings().personalize_model
    assert captured["effort"] == "low"
    assert captured["system"] == PERSONALIZE_SYSTEM_PROMPT
    assert ORIGINAL_TEXT in captured["user"]
    assert "FastAPI" in captured["user"]
    assert "주문 처리 프로젝트" in captured["user"]
    assert "target role: 백엔드" in captured["user"]
    assert "subcategory: 자기소개·이력::프로젝트" in captured["user"]
    assert "answer_intent.category: 자기소개·이력" in captured["user"]
    assert "answer_intent.expression: 프로젝트" in captured["user"]


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


def test_strips_nested_balanced_quotes(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, "\"'개인화된 질문?'\"")
    result = personalize_service.personalize_question({}, None, _question())
    assert result == "개인화된 질문?"


def test_keeps_unbalanced_inner_quotes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Only balanced wrapping pairs come off — inner quoting stays intact."""
    _stub_llm(monkeypatch, "\"'협업'이란 무엇인가요?\"")
    result = personalize_service.personalize_question({}, None, _question())
    assert result == "'협업'이란 무엇인가요?"


def test_accepts_fullwidth_question_mark(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, "쇼핑몰 프로젝트에서 맡은 역할은 무엇이었나요？")
    result = personalize_service.personalize_question({}, None, _question())
    assert result == "쇼핑몰 프로젝트에서 맡은 역할은 무엇이었나요？"


# --- output validation fallbacks --------------------------------------------


def test_fallback_on_experienced_context(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, "이전 직장에서 맡았던 역할은 무엇인가요?")
    result = personalize_service.personalize_question({}, None, _question())
    assert result == ORIGINAL_TEXT


def test_fallback_on_missing_question_mark(monkeypatch: pytest.MonkeyPatch) -> None:
    """A statement is not a question; keep the original instead."""
    _stub_llm(monkeypatch, "물음표 없이 끝나는 문장입니다.")
    result = personalize_service.personalize_question({}, None, _question())
    assert result == ORIGINAL_TEXT


def test_fallback_on_multiple_sentences(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, "첫 질문인가요? 두 번째 질문인가요?")
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


def test_personalize_questions_preserves_order_and_tracks_original(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    questions = [_question("첫 질문?"), _question("둘째 질문?"), _question("셋째 질문?")]
    results = {
        "첫 질문?": "개인화 첫 질문?",
        "둘째 질문?": "둘째 질문?",
        "셋째 질문?": "개인화 셋째 질문?",
    }
    monkeypatch.setattr(personalize_service.llm, "is_configured", lambda: True)
    monkeypatch.setattr(
        personalize_service,
        "personalize_question",
        lambda _profile, _essay, question: results[question.text],
    )

    personalized = personalize_service.personalize_questions(
        {"job": "백엔드 개발자"}, None, questions
    )

    assert [question.text for question in personalized] == [
        "개인화 첫 질문?",
        "둘째 질문?",
        "개인화 셋째 질문?",
    ]
    assert personalized[0].original_text == "첫 질문?"
    assert personalized[1] is questions[1]
    assert personalized[1].original_text is None
    assert personalized[2].original_text == "셋째 질문?"


def test_personalize_questions_skips_without_profile_or_essay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No personal context means nothing to personalize with — zero calls."""
    questions = [_question()]
    monkeypatch.setattr(personalize_service.llm, "is_configured", lambda: True)

    def unexpected_call(*_args: Any) -> str:
        raise AssertionError("personalize_question must not be called")

    monkeypatch.setattr(personalize_service, "personalize_question", unexpected_call)
    assert personalize_service.personalize_questions({}, None, questions) is questions


def test_personalize_questions_not_configured_returns_input_without_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    questions = [_question()]
    monkeypatch.setattr(personalize_service.llm, "is_configured", lambda: False)

    def unexpected_call(*_args: Any) -> str:
        raise AssertionError("personalize_question must not be called")

    monkeypatch.setattr(personalize_service, "personalize_question", unexpected_call)
    assert personalize_service.personalize_questions({}, None, questions) is questions


def _technical_question(
    rule_group: str = "job_technology",
    text: str = "Docker를 사용해 본 경험이 있다면 어떤 점을 고려했나요?",
    subcategory: str = "technology::i_hwsw_prfi",
) -> Question:
    return Question(
        id="q-tech",
        question_id="technical-question",
        category="직무·기술" if rule_group == "job_technology" else "문제 해결",
        rule_group=rule_group,
        subcategory=subcategory,
        text=text,
    )


def test_job_technology_without_profile_topic_skips_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _stub_llm(monkeypatch, "개인화되면 안 되는 질문?")

    result = personalize_service.personalize_question(
        {"technologies": "Docker"}, None, _technical_question(
            text="팀에서 기술을 선택한 기준은 무엇인가요?",
            subcategory="attitude::general",
        )
    )

    assert result == "팀에서 기술을 선택한 기준은 무엇인가요?"
    assert captured["calls"] == 0


def test_job_technology_with_profile_topic_calls_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _stub_llm(monkeypatch, "Docker 활용 경험은 무엇인가요?")

    result = personalize_service.personalize_question(
        {"technologies": "Docker"}, None, _technical_question()
    )

    assert result == "Docker 활용 경험은 무엇인가요?"
    assert captured["calls"] == 1


def test_technical_problem_solving_without_profile_match_keeps_original(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _stub_llm(monkeypatch, "개인화되면 안 되는 질문?")
    question = _technical_question(
        "problem_solving",
        "Docker 배포 중 장애를 어떻게 분석했나요?",
        "technology::docker",
    )

    result = personalize_service.personalize_question(
        {"technologies": "database"}, None, question
    )

    assert result == question.text
    assert captured["calls"] == 0


def test_generic_problem_solving_keeps_existing_personalization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _stub_llm(monkeypatch, "어떤 문제를 해결했는지 설명해 주세요?")
    question = _technical_question(
        "problem_solving",
        "프로젝트에서 발생한 문제를 해결한 경험을 설명해 주세요?",
        "problem_solving::general",
    )

    result = personalize_service.personalize_question(
        {"technologies": "Docker"}, None, question
    )

    assert result == "어떤 문제를 해결했는지 설명해 주세요?"
    assert captured["calls"] == 1


def test_new_registered_profile_token_falls_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _stub_llm(
        monkeypatch, "Docker와 Kubernetes를 사용한 경험은 무엇인가요?"
    )
    question = _technical_question()

    result = personalize_service.personalize_question(
        {"technologies": "Docker"}, None, question
    )

    assert result == question.text
    assert captured["calls"] == 1


def test_malformed_and_missing_subcategory_do_not_break_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    malformed = _question().model_copy(update={"subcategory": "malformed"})
    captured = _stub_llm(monkeypatch, "개인화된 질문?")
    assert personalize_service.personalize_question({}, None, malformed) == "개인화된 질문?"
    assert "- subcategory: malformed" in captured["user"]
    assert "answer_intent.category:" not in captured["user"]

    missing = _question().model_copy(update={"subcategory": ""})
    captured = _stub_llm(monkeypatch, "다시 개인화된 질문?")
    assert personalize_service.personalize_question({}, None, missing) == "다시 개인화된 질문?"
    assert "- subcategory:" not in captured["user"]
    assert "answer_intent.category:" not in captured["user"]
