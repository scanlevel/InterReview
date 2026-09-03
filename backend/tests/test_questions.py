"""Tests for the six-file ICT question selector and raw-question contract."""

from __future__ import annotations

import random
from typing import Any

from fastapi.testclient import TestClient

from app.main import app
from app.routers import questions as questions_router
from app.schemas import Question
from app.services.questions import (
    GROUPS,
    _load_group_questions,
    _role_filtered_candidates,
    generate_questions,
    has_experienced_context,
)

client = TestClient(app)


def test_generates_one_question_per_group() -> None:
    questions = generate_questions(seed=42)
    expected_groups = (
        "resume",
        "motivation_commitment",
        "job_technology",
        "problem_solving",
        "collaboration_organization",
        "values_personality",
    )

    assert len(questions) == len(GROUPS) == 6
    assert tuple(group_id for group_id, _ in GROUPS) == expected_groups
    assert [question.id for question in questions] == [
        f"q{index}" for index in range(1, 7)
    ]
    assert len({question.id for question in questions}) == 6
    assert len({question.question_id for question in questions}) == 6
    assert len({question.text for question in questions}) == 6
    assert [question.rule_group for question in questions] == list(expected_groups)
    assert [question.category for question in questions] == [
        "자기소개·이력",
        "지원동기·직무몰입",
        "직무·기술",
        "문제 해결",
        "협업·조직생활",
        "가치관·성향",
    ]
    assert all(question.original_text == question.text for question in questions)
    assert all(question.source_file is None for question in questions)
    assert all(question.occurrence_count == 1 for question in questions)


def test_seed_is_reproducible() -> None:
    """Same code, input, and seed are deterministic after candidate capping."""
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

    def fake_generate_questions(
        *,
        seed: int | None,
        job_role: Any,
        profile: dict[str, Any] | None = None,
        essay: str | None = None,
    ) -> list[Question]:
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


def _scoped_candidate(
    text: str,
    backend_priority: str,
) -> dict[str, Any]:
    return {
        "question": text,
        "answer_intent": {"category": "technology", "expression": "topic"},
        "role_scopes": ["backend", "devops"],
        "role_priority": {"backend": backend_priority, "devops": "primary"},
    }


def test_role_priority_metadata_is_complete() -> None:
    for group_id in ("job_technology", "problem_solving"):
        for row in _load_group_questions(group_id):
            scopes = row.get("role_scopes") or []
            if len(scopes) > 1:
                priority = row.get("role_priority")
                assert isinstance(priority, dict)
                assert set(priority) == set(scopes)
                assert set(priority.values()) <= {"primary", "secondary"}
                assert "primary" in priority.values()

    database_row = next(
        row
        for row in _load_group_questions("problem_solving")
        if set(row.get("role_scopes") or ()) == {"backend", "database", "data_ai"}
    )
    assert database_row["role_priority"]["backend"] == "primary"
    assert database_row["role_priority"]["database"] == "primary"


def test_matched_secondary_is_capped_by_three_and_primary_count() -> None:
    primary = [
        _scoped_candidate(f"REST API primary {index}?", "primary")
        for index in range(10)
    ]
    secondary = [
        _scoped_candidate(f"Docker secondary {index}?", "secondary")
        for index in range(5)
    ]

    filtered = _role_filtered_candidates(
        "job_technology",
        primary + secondary,
        frozenset({"backend"}),
        random.Random(4),
        {"technologies": "Docker"},
    )

    assert len(filtered) == 13
    assert filtered[:10] == primary
    assert all(item in secondary for item in filtered[10:])


def test_matched_secondary_cap_is_never_larger_than_one_primary() -> None:
    candidates = [
        _scoped_candidate("REST API primary?", "primary"),
        *(_scoped_candidate(f"Docker secondary {index}?", "secondary") for index in range(5)),
    ]

    filtered = _role_filtered_candidates(
        "job_technology",
        candidates,
        frozenset({"backend"}),
        random.Random(5),
        {"technologies": "Docker"},
    )

    assert len(filtered) == 2


def test_unmatched_secondary_is_excluded_but_profile_match_is_allowed() -> None:
    candidates = list(_load_group_questions("job_technology"))
    docker = next(row for row in candidates if row["question"].startswith("Docker"))

    without_docker = _role_filtered_candidates(
        "job_technology", candidates, frozenset({"backend"}), random.Random(1), {}
    )
    with_docker = _role_filtered_candidates(
        "job_technology",
        candidates,
        frozenset({"backend"}),
        random.Random(1),
        {"technologies": "Docker"},
    )

    assert docker not in without_docker
    assert docker in with_docker


def test_devops_treats_docker_as_primary() -> None:
    candidates = list(_load_group_questions("job_technology"))
    docker = next(row for row in candidates if row["question"].startswith("Docker"))

    filtered = _role_filtered_candidates(
        "job_technology", candidates, frozenset({"devops"}), random.Random(1)
    )

    assert docker in filtered


def test_no_primary_uses_related_secondary() -> None:
    candidates = [
        _scoped_candidate("Docker secondary 1?", "secondary"),
        _scoped_candidate("Docker secondary 2?", "secondary"),
    ]

    filtered = _role_filtered_candidates(
        "job_technology",
        candidates,
        frozenset({"backend"}),
        random.Random(1),
        {"technologies": "Docker"},
    )

    assert filtered == candidates
