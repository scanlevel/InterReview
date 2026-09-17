"""Tests for the two-stage, transcript-grounded answer feedback flow."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.prompts.answer_review import ANSWER_REVIEW_SYSTEM_PROMPT
from app.prompts.answer_rubric import RUBRIC_EVALUATION_SYSTEM_PROMPT
from app.schemas import AnswerReview, AnswerRubricEvaluation, RubricJudgement
from app.services import answer_review as answer_review_service
from app.services import llm

client = TestClient(app)

QUESTION = "가장 기억에 남는 프로젝트 경험은 무엇인가요?"
PERSONALIZED = "주문 처리 프로젝트에서 맡은 역할은 무엇인가요?"
TRANSCRIPT = "쇼핑몰 백엔드 프로젝트에서 주문 처리 모듈을 담당했습니다."
ESSAY = "자소서 본문"
PROFILE = {"job": "백엔드 개발자"}


def _review(**overrides: Any) -> AnswerReview:
    fields: dict[str, Any] = {
        "summary": "주문 처리 모듈을 담당한 경험을 설명했습니다.",
        "strengths": ["담당한 업무를 구체적으로 언급했습니다."],
        "improvements": ["다음에는 그 결과나 판단 근거도 덧붙여 보세요."],
    }
    fields.update(overrides)
    return AnswerReview(**fields)


def _rubric(**scores: int) -> AnswerRubricEvaluation:
    return AnswerRubricEvaluation(
        question_alignment=RubricJudgement(
            score=scores.get("question_alignment", 2),
            reason="질문 부합도 reason",
        ),
        evidence_specificity=RubricJudgement(
            score=scores.get("evidence_specificity", 1),
            reason="근거 구체성 reason",
        ),
        logic_clarity=RubricJudgement(
            score=scores.get("logic_clarity", 2),
            reason="논리 명료성 reason",
        ),
    )


def _stub_llm(
    monkeypatch: pytest.MonkeyPatch,
    *results: Any,
    configured: bool = True,
) -> dict[str, Any]:
    """Replace structured calls and capture every stage separately."""
    captured: dict[str, Any] = {"calls": []}
    pending = list(results)

    def fake(**kwargs: Any) -> Any:
        captured["calls"].append(kwargs)
        result = pending.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    monkeypatch.setattr(answer_review_service.llm, "is_configured", lambda: configured)
    monkeypatch.setattr(answer_review_service.llm, "call_structured", fake)
    return captured


def test_review_runs_rubric_then_feedback(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _rubric(), _review())

    result = answer_review_service.review_answer(
        QUESTION, PERSONALIZED, TRANSCRIPT, ESSAY, PROFILE
    )

    assert isinstance(result, AnswerReview)
    assert result.summary.startswith("주문 처리")
    assert len(captured["calls"]) == 2

    rubric_call, feedback_call = captured["calls"]
    assert rubric_call["model"] == get_settings().eval_model
    assert rubric_call["system"] == RUBRIC_EVALUATION_SYSTEM_PROMPT
    assert rubric_call["output_format"] is AnswerRubricEvaluation
    assert QUESTION in rubric_call["user"]
    assert PERSONALIZED in rubric_call["user"]
    assert TRANSCRIPT in rubric_call["user"]

    assert feedback_call["system"] == ANSWER_REVIEW_SYSTEM_PROMPT
    assert feedback_call["output_format"] is AnswerReview
    assert ESSAY in feedback_call["user"]
    assert "백엔드 개발자" in feedback_call["user"]
    assert "질문 부합도 reason" in feedback_call["user"]
    assert "근거 구체성 reason" in feedback_call["user"]
    assert "논리 명료성 reason" in feedback_call["user"]
    assert "2점" in feedback_call["user"]


def test_alignment_zero_returns_fixed_fallback_without_feedback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _stub_llm(monkeypatch, _rubric(question_alignment=0))

    result = answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)

    assert result.summary == (
        "질문의 핵심 요구에 답하지 않았습니다. "
        "질문에서 요구하는 내용을 중심으로 다시 답변해 보세요."
    )
    assert result.strengths == []
    assert result.improvements == []
    assert len(captured["calls"]) == 1


def test_alignment_one_still_generates_feedback(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _rubric(question_alignment=1), _review())

    answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)

    assert len(captured["calls"]) == 2
    assert "질문 부합도 reason" in captured["calls"][1]["user"]


@pytest.mark.parametrize(
    ("field", "score", "reason"),
    [
        ("evidence_specificity", 0, "근거 구체성 reason"),
        ("evidence_specificity", 1, "근거 구체성 reason"),
        ("logic_clarity", 0, "논리 명료성 reason"),
        ("logic_clarity", 1, "논리 명료성 reason"),
    ],
)
def test_feedback_prompt_preserves_low_rubric_constraints(
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    score: int,
    reason: str,
) -> None:
    captured = _stub_llm(monkeypatch, _rubric(**{field: score}), _review())

    answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)

    feedback_prompt = captured["calls"][1]["user"]
    assert f"{score}점" in feedback_prompt
    assert reason in feedback_prompt


def test_all_perfect_rubric_does_not_force_improvement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _stub_llm(
        monkeypatch,
        _rubric(question_alignment=2, evidence_specificity=2, logic_clarity=2),
        _review(improvements=[]),
    )

    result = answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)

    assert result.improvements == []
    assert "억지로 개선점을 만들지 않는다" in ANSWER_REVIEW_SYSTEM_PROMPT
    assert captured["calls"][1]["user"].count("2점") == 3


def test_empty_or_short_transcript_skips_rubric(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _rubric(), _review())

    for transcript in ("", "  ", "짧"):
        result = answer_review_service.review_answer(QUESTION, PERSONALIZED, transcript)
        assert result.summary

    assert captured["calls"] == []


def test_rubric_failure_returns_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, llm.LLMCallError("rubric boom"))

    result = answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)

    assert "사용할 수 없습니다" in result.summary
    assert result.strengths == []
    assert result.improvements == []
    assert len(captured["calls"]) == 1


def test_feedback_failure_returns_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _rubric(), llm.LLMCallError("feedback boom"))

    result = answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)

    assert "사용할 수 없습니다" in result.summary
    assert len(captured["calls"]) == 2


def test_unavailable_on_unexpected_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """Even a non-LLMError bug in the call path must not end the session."""
    _stub_llm(monkeypatch, RuntimeError("unexpected"))

    result = answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)

    assert "사용할 수 없습니다" in result.summary


def test_unavailable_when_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without a key the service must not attempt either call."""
    captured = _stub_llm(monkeypatch, _rubric(), _review(), configured=False)

    result = answer_review_service.review_answer(QUESTION, PERSONALIZED, TRANSCRIPT)

    assert "사용할 수 없습니다" in result.summary
    assert captured["calls"] == []


def test_route_422_on_invalid_request(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _rubric(), _review())

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
    assert captured["calls"] == []


def test_route_contract_does_not_expose_rubric(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _rubric(), _review())

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
    assert set(response.json()) == {"summary", "strengths", "improvements"}
    assert len(captured["calls"]) == 2


def test_route_200_even_on_llm_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, llm.LLMCallError("rubric boom"))

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


def test_evaluate_route_removed() -> None:
    """The retired score-based /evaluate endpoint stays unavailable."""
    response = client.post("/evaluate", json={})
    assert response.status_code == 404
