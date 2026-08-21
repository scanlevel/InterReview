"""Tests for Track A essay analysis and the /essay/analyze route.

The LLM is mocked, so these need neither a key nor network. They cover the
output contract (risk ordering), the request the service builds, and the two
failure statuses the route is responsible for.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas import EssayAnalysis, EssayExperience, EssayWeakness
from app.services import essay as essay_service
from app.services import llm

client = TestClient(app)


def _experience(text: str, risk: int) -> EssayExperience:
    return EssayExperience(
        experience=text,
        claims=["책임감이 강하다"],
        risk_level=risk,  # type: ignore[arg-type]
        risk_reason="정량적 결과가 없다",
        weaknesses=[
            EssayWeakness(
                description="본인 기여도가 드러나지 않음",
                expected_questions=["직접 담당한 부분은 무엇인가요?"],
            )
        ],
    )


def _analysis(*risks: int) -> EssayAnalysis:
    return EssayAnalysis(
        experiences=[_experience(f"경험{r}", r) for r in risks],
        unsupported_claims=["꼼꼼합니다"],
    )


def _stub_llm(monkeypatch: pytest.MonkeyPatch, result: Any) -> dict[str, Any]:
    """Replace call_structured; return a dict that captures its kwargs."""
    captured: dict[str, Any] = {}

    def fake(**kwargs: Any) -> Any:
        captured.update(kwargs)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(essay_service.llm, "call_structured", fake)
    return captured


# --- schema -----------------------------------------------------------------


def test_risk_level_rejects_out_of_range() -> None:
    """risk_level is an enum, so the API enforces it rather than the client."""
    for invalid in (0, 6):
        with pytest.raises(ValidationError):
            _experience("경험", invalid)


# --- service ----------------------------------------------------------------


def test_analysis_is_sorted_by_risk_descending(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, _analysis(2, 5, 1, 4))
    result = essay_service.analyze_essay("자소서 본문")
    assert [item.risk_level for item in result.experiences] == [5, 4, 2, 1]


def test_sort_is_stable_within_a_risk_level(monkeypatch: pytest.MonkeyPatch) -> None:
    """Equal risk keeps the model's ordering instead of shuffling."""
    analysis = EssayAnalysis(
        experiences=[
            _experience("먼저", 3),
            _experience("나중", 3),
            _experience("위험", 5),
        ]
    )
    _stub_llm(monkeypatch, analysis)
    result = essay_service.analyze_essay("자소서 본문")
    assert [item.experience for item in result.experiences] == ["위험", "먼저", "나중"]


def test_service_requests_the_analysis_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _stub_llm(monkeypatch, _analysis(3))
    essay_service.analyze_essay("자소서 본문", {"job": "백엔드"})

    assert captured["output_format"] is EssayAnalysis
    assert "자소서 본문" in captured["user"]
    assert "백엔드" in captured["user"]  # profile is included in the prompt
    assert captured["system"]


def test_service_uses_the_configured_eval_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """The model comes from settings, never a literal in the service."""
    captured = _stub_llm(monkeypatch, _analysis(3))
    essay_service.analyze_essay("자소서 본문")
    assert captured["model"] == essay_service.get_settings().eval_model


# --- route ------------------------------------------------------------------


def test_route_returns_sorted_analysis(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, _analysis(1, 5))
    response = client.post("/essay/analyze", json={"essay": "자소서 본문"})

    assert response.status_code == 200
    body = response.json()
    assert [item["risk_level"] for item in body["experiences"]] == [5, 1]
    assert body["unsupported_claims"] == ["꼼꼼합니다"]
    assert body["experiences"][0]["weaknesses"][0]["expected_questions"]


def test_route_reports_502_when_the_call_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """No degraded output: Track A has nothing to fall back to."""
    _stub_llm(monkeypatch, llm.LLMCallError("boom"))
    response = client.post("/essay/analyze", json={"essay": "자소서 본문"})
    assert response.status_code == 502


def test_route_reports_503_when_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_llm(monkeypatch, llm.LLMNotConfiguredError("no key"))
    response = client.post("/essay/analyze", json={"essay": "자소서 본문"})
    assert response.status_code == 503


# ids are given explicitly: the over-length case would otherwise put 10k
# characters into the test's node id.
@pytest.mark.parametrize(
    "essay",
    ["", "   ", "가" * 10_001],
    ids=["empty", "whitespace_only", "over_length"],
)
def test_route_rejects_unusable_essay(essay: str) -> None:
    response = client.post("/essay/analyze", json={"essay": essay})
    assert response.status_code == 422
