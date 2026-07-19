"""Tests for rule-based question generation and the /questions route."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services.questions import _load_rules, generate_questions

client = TestClient(app)


def _group_count() -> int:
    return len(_load_rules()["groups"])


def test_generates_one_question_per_group() -> None:
    questions = generate_questions({"experience": "NEW"}, seed=42)
    assert len(questions) == _group_count()
    # ids are sequential q1..qN
    assert [q.id for q in questions] == [f"q{i}" for i in range(1, len(questions) + 1)]
    # every question maps to a distinct rule group
    assert len({q.rule_group for q in questions}) == len(questions)


def test_no_duplicate_question_text() -> None:
    questions = generate_questions({"experience": "NEW"}, seed=7)
    texts = [q.text for q in questions]
    assert len(set(texts)) == len(texts)
    assert all(q.text.strip() for q in questions)


def test_seed_is_reproducible() -> None:
    a = generate_questions({"experience": "NEW"}, seed=123)
    b = generate_questions({"experience": "NEW"}, seed=123)
    assert [q.text for q in a] == [q.text for q in b]


def test_experience_alias_defaults_to_new() -> None:
    assert generate_questions({"experience": "신입"}, seed=1)[0].experience == "NEW"
    assert generate_questions({}, seed=1)[0].experience == "NEW"
    assert generate_questions({"experience": "경력"}, seed=1)[0].experience == "EXPERIENCED"


def test_questions_endpoint() -> None:
    response = client.post("/questions", json={"profile": {"experience": "NEW"}, "seed": 5})
    assert response.status_code == 200
    body = response.json()
    assert body["experience"] == "NEW"
    assert len(body["questions"]) == _group_count()
    first = body["questions"][0]
    assert {"id", "category", "rule_group", "subcategory", "text"} <= first.keys()
