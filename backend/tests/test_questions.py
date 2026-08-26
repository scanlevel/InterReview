"""Tests for rule-based question generation and the /questions route."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import questions as questions_router
from app.services.questions import _load_rules, generate_questions

client = TestClient(app)


def _group_count() -> int:
    return len(_load_rules()["groups"])


def test_generates_one_question_per_group() -> None:
    questions = generate_questions(seed=42)
    assert len(questions) == _group_count()
    assert [q.id for q in questions] == [f"q{i}" for i in range(1, len(questions) + 1)]
    assert len({q.id for q in questions}) == len(questions)
    assert all(len(q.question_id) == 16 for q in questions)
    assert len({q.question_id for q in questions}) == len(questions)
    # every question maps to a distinct rule group
    assert len({q.rule_group for q in questions}) == len(questions)


def test_no_duplicate_question_text() -> None:
    questions = generate_questions(seed=7)
    texts = [q.text for q in questions]
    assert len(set(texts)) == len(texts)
    assert all(q.text.strip() for q in questions)


def test_seed_is_reproducible() -> None:
    a = generate_questions(seed=123)
    b = generate_questions(seed=123)
    assert [q.text for q in a] == [q.text for q in b]
    assert [q.question_id for q in a] == [q.question_id for q in b]


def test_questions_endpoint() -> None:
    response = client.post("/questions", json={"profile": {}, "seed": 5})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"questions"}
    assert len(body["questions"]) == _group_count()
    first = body["questions"][0]
    assert {"id", "question_id", "category", "rule_group", "subcategory", "text"} <= first.keys()
    assert "experience" not in first
    assert first["original_text"] is None


def test_questions_endpoint_passes_resume_to_personalization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def fake_personalize(
        profile: dict[str, Any], essay: str | None, questions: list[Any]
    ) -> list[Any]:
        captured.update(profile=profile, essay=essay, questions=questions)
        return questions

    monkeypatch.setattr(questions_router, "personalize_questions", fake_personalize)
    profile = {"job": "백엔드 개발자", "resume_text": "자기소개서 본문"}
    response = client.post("/questions", json={"profile": profile, "seed": 5})

    assert response.status_code == 200
    assert captured["profile"] == profile
    assert captured["essay"] == "자기소개서 본문"
    assert len(captured["questions"]) == _group_count()
