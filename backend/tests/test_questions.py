"""Tests for the six-file ICT question selector and raw-question contract."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from app.main import app
from app.routers import questions as questions_router
from app.schemas import Question
from app.services.questions import (
    GROUPS,
    _load_group_questions,
    generate_questions,
    has_experienced_context,
)

client = TestClient(app)


def test_generates_one_question_per_group() -> None:
    questions = generate_questions(seed=42)

    assert len(questions) == len(GROUPS) == 6
    assert [question.id for question in questions] == [
        f"q{index}" for index in range(1, 7)
    ]
    assert len({question.id for question in questions}) == 6
    assert len({question.question_id for question in questions}) == 6
    assert len({question.text for question in questions}) == 6
    assert [question.rule_group for question in questions] == [
        group_id for group_id, _ in GROUPS
    ]
    assert [question.category for question in questions] == [
        group_name for _, group_name in GROUPS
    ]
    assert all(question.original_text == question.text for question in questions)
    assert all(question.source_file is None for question in questions)
    assert all(question.occurrence_count == 1 for question in questions)


def test_seed_is_reproducible() -> None:
    first = generate_questions(seed=123)
    second = generate_questions(seed=123)

    assert [
        (question.question_id, question.text, question.original_text)
        for question in first
    ] == [
        (question.question_id, question.text, question.original_text)
        for question in second
    ]


def test_excludes_experienced_questions_from_new_applicant_pool() -> None:
    for group_id, _ in GROUPS:
        questions = _load_group_questions(group_id)
        assert questions
        assert all(
            not has_experienced_context(question["question"])
            for question in questions
        )


def test_questions_endpoint_returns_raw_questions_and_metadata(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(
        questions_router,
        "personalize_question",
        lambda _profile, _essay, question: question.text,
    )
    profile: dict[str, Any] = {
        "name": "홍길동",
        "job": "백엔드 개발자",
        "resume_text": "자기소개서 본문",
        "ignored": "B 단계에서 사용하지 않는 값",
    }
    response = client.post("/questions", json={"profile": profile, "seed": 5})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"questions"}
    assert len(body["questions"]) == 6

    required = {
        "id",
        "question_id",
        "category",
        "rule_group",
        "subcategory",
        "text",
        "original_text",
        "source_file",
        "occurrence_count",
    }
    for question in body["questions"]:
        assert required <= question.keys()
        assert question["text"] == question["original_text"]
        assert question["source_file"] is None
        assert question["occurrence_count"] == 1
        assert "experience" not in question


def test_target_groups_filter_by_role_scope() -> None:
    bank = {
        group_id: {
            row["question"]: row
            for row in _load_group_questions(group_id)
        }
        for group_id in ("job_technology", "problem_solving")
    }
    selected = {
        question.rule_group: question
        for question in generate_questions(seed=42, job_role="mobile")
    }

    for group_id in ("job_technology", "problem_solving"):
        row = bank[group_id][selected[group_id].text]
        assert "mobile" in row["role_scopes"]


def test_unknown_role_prefers_common_target_questions() -> None:
    bank = {
        group_id: {
            row["question"]: row
            for row in _load_group_questions(group_id)
        }
        for group_id in ("job_technology", "problem_solving")
    }
    selected = {
        question.rule_group: question
        for question in generate_questions(seed=42, job_role="unclassified role")
    }

    for group_id in ("job_technology", "problem_solving"):
        row = bank[group_id][selected[group_id].text]
        assert "common" in row["role_scopes"]


def test_role_filter_runs_before_personalization(
    monkeypatch: Any,
) -> None:
    events: list[tuple[str, Any]] = []
    source_question = Question(
        id="q1",
        question_id="question-id",
        category="직무·기술",
        rule_group="job_technology",
        subcategory="technology::i_prg",
        text="원문 질문?",
        original_text="원문 질문?",
    )

    def fake_generate_questions(*, seed: int | None, job_role: Any) -> list[Question]:
        events.append(("select", job_role))
        return [source_question]

    def fake_personalize(profile: dict[str, Any], essay: str | None, question: Question) -> str:
        events.append(("personalize", question.rule_group))
        return question.text

    monkeypatch.setattr(questions_router, "generate_questions", fake_generate_questions)
    monkeypatch.setattr(questions_router, "personalize_question", fake_personalize)

    response = client.post(
        "/questions",
        json={"profile": {"job": "프론트엔드 개발자"}, "seed": 7},
    )

    assert response.status_code == 200
    assert events == [
        ("select", "프론트엔드 개발자"),
        ("personalize", "job_technology"),
    ]
