"""Tests for the six-file ICT question selector and raw-question contract."""

from __future__ import annotations

import random
from typing import Any

from fastapi.testclient import TestClient

from app.main import app
from app.routers import questions as questions_router
from app.schemas import EssayQAItem, GroundedQuestionSet, Question
from app.services.grounded_questions import GroundedQuestion
from app.services import grounded_questions as grounded_question_service
from app.services.questions import (
    GROUPS,
    _load_group_questions,
    _role_filtered_candidates,
    generated_question_id,
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
        "ignored": "B 단계에서 사용하지 않는 값",
    }
    response = client.post(
        "/questions",
        json={
            "profile": profile,
            "items": [{"question": "회사 질문", "answer": "자기소개서 본문"}],
            "seed": 5,
        },
    )

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


def _stub_bank_questions() -> list[Question]:
    names = dict(GROUPS)
    return [
        Question(
            id=f"q{index}",
            question_id=f"bank-{group_id}",
            category=names[group_id],
            rule_group=group_id,
            subcategory="general::topic",
            text=f"은행 {group_id} 질문?",
            original_text=f"은행 {group_id} 질문?",
        )
        for index, (group_id, _) in enumerate(GROUPS, start=1)
    ]


def test_questions_endpoint_replaces_only_two_domains_with_grounded_questions(
    monkeypatch: Any,
) -> None:
    bank = _stub_bank_questions()
    calls: list[tuple[str, Any]] = []

    def fake_generate_questions(**_kwargs: Any) -> list[Question]:
        assert _kwargs["essay"] == "3년 동안 FastAPI로 주문 API를 개발했습니다."
        assert "FastAPI 경험이 있나요?" not in _kwargs["essay"]
        return bank

    def fake_grounded(
        profile: dict[str, Any], items: list[EssayQAItem], excluded: list[str]
    ) -> dict[str, GroundedQuestion]:
        calls.append(("grounded", excluded))
        assert profile == {"job": "백엔드 개발자"}
        assert items == [
            EssayQAItem(
                question="FastAPI 경험이 있나요?",
                answer="3년 동안 FastAPI로 주문 API를 개발했습니다.",
            )
        ]
        return {
            "resume": GroundedQuestion(
                domain="resume",
                question="주문 API를 개발하며 맡은 역할은 무엇인가요?",
                evidence="주문 API를 개발했습니다",
            ),
            "job_technology": GroundedQuestion(
                domain="job_technology",
                question="FastAPI를 선택한 이유는 무엇인가요?",
                evidence="FastAPI",
            ),
        }

    def fake_personalize(
        _profile: dict[str, Any], _essay: str | None, question: Question
    ) -> str:
        calls.append(("personalize", question.rule_group))
        return question.text

    monkeypatch.setattr(questions_router, "generate_questions", fake_generate_questions)
    monkeypatch.setattr(questions_router, "generate_grounded_questions", fake_grounded)
    monkeypatch.setattr(questions_router, "personalize_question", fake_personalize)

    response = client.post(
        "/questions",
        json={
            "profile": {
                "job": "백엔드 개발자",
                "technologies": "Kubernetes",
                "projects": "회사 질문에서 본 프로젝트",
            },
            "items": [
                {
                    "question": "FastAPI 경험이 있나요?",
                    "answer": "3년 동안 FastAPI로 주문 API를 개발했습니다.",
                }
            ],
        },
    )

    assert response.status_code == 200
    questions = response.json()["questions"]
    assert [item["rule_group"] for item in questions] == [
        group_id for group_id, _ in GROUPS
    ]
    assert questions[0]["text"] == "주문 API를 개발하며 맡은 역할은 무엇인가요?"
    assert questions[2]["text"] == "FastAPI를 선택한 이유는 무엇인가요?"
    assert questions[0]["question_id"].startswith("generated-")
    assert questions[2]["question_id"].startswith("generated-")
    assert all(item["question_id"].startswith("bank-") for item in questions[1:2])
    assert all(item["question_id"].startswith("bank-") for item in questions[3:])
    assert calls[0] == (
        "grounded",
        [f"은행 {group_id} 질문?" for group_id in (
            "motivation_commitment",
            "problem_solving",
            "collaboration_organization",
            "values_personality",
        )],
    )
    assert [event[1] for event in calls[1:]] == [
        "motivation_commitment",
        "problem_solving",
        "collaboration_organization",
        "values_personality",
    ]


def test_invalid_evidence_falls_back_per_domain(monkeypatch: Any) -> None:
    bank = _stub_bank_questions()
    monkeypatch.setattr(
        questions_router, "generate_questions", lambda **_kwargs: bank
    )
    monkeypatch.setattr(
        questions_router,
        "generate_grounded_questions",
        lambda *_args, **_kwargs: {
            "resume": GroundedQuestion(
                domain="resume",
                question="없는 경험을 설명해 주세요?",
                evidence="입력에 없는 경험",
            ),
            "job_technology": GroundedQuestion(
                domain="job_technology",
                question="FastAPI 선택 기준은 무엇인가요?",
                evidence="FastAPI",
            ),
        },
    )
    monkeypatch.setattr(
        questions_router, "personalize_question", lambda _p, _e, question: question.text
    )

    response = client.post(
        "/questions",
        json={
            "items": [
                {
                    "question": "Kubernetes 경험이 있나요?",
                    "answer": "FastAPI를 사용했습니다.",
                }
            ]
        },
    )

    assert response.status_code == 200
    questions = response.json()["questions"]
    assert questions[0]["question_id"] == "bank-resume"
    assert questions[2]["text"] == "FastAPI 선택 기준은 무엇인가요?"
    assert all("evidence" not in item for item in questions)


def test_generated_duplicates_use_bank_first_and_stable_ids(monkeypatch: Any) -> None:
    bank = _stub_bank_questions()
    monkeypatch.setattr(
        questions_router, "generate_questions", lambda **_kwargs: bank
    )
    monkeypatch.setattr(
        questions_router,
        "generate_grounded_questions",
        lambda *_args, **_kwargs: {
            "resume": GroundedQuestion(
                domain="resume",
                question="은행 motivation_commitment 질문?",
                evidence="근거",
            ),
            "job_technology": GroundedQuestion(
                domain="job_technology",
                question="같은 생성 질문?",
                evidence="근거",
            ),
        },
    )
    monkeypatch.setattr(
        questions_router, "personalize_question", lambda _p, _e, question: question.text
    )

    response = client.post(
        "/questions",
        json={"items": [{"question": "회사 질문", "answer": "근거"}]},
    )

    assert response.status_code == 200
    questions = response.json()["questions"]
    assert questions[0]["question_id"] == "bank-resume"
    assert questions[2]["question_id"] == generated_question_id(
        "job_technology", "같은 생성 질문?"
    )
    assert len({item["text"] for item in questions}) == 6
    assert len({item["question_id"] for item in questions}) == 6


def test_personalization_duplicate_reverts_to_original_bank_text(
    monkeypatch: Any,
) -> None:
    bank = _stub_bank_questions()
    monkeypatch.setattr(
        questions_router, "generate_questions", lambda **_kwargs: bank
    )
    monkeypatch.setattr(
        questions_router,
        "personalize_question",
        lambda _p, _e, _question: "같은 개인화 질문?",
    )

    response = client.post(
        "/questions",
        json={"items": [{"question": "회사 질문", "answer": "지원자 경험"}]},
    )

    assert response.status_code == 200
    questions = response.json()["questions"]
    assert questions[0]["text"] == "같은 개인화 질문?"
    assert questions[1]["text"] == "은행 motivation_commitment 질문?"
    assert questions[2]["text"] == "은행 job_technology 질문?"
    assert len({item["text"] for item in questions}) == 6


def test_grounded_question_service_requires_exact_evidence(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {"calls": 0}

    def fake_call_structured(**kwargs: Any) -> GroundedQuestionSet:
        captured["calls"] += 1
        captured["user"] = kwargs["user"]
        return GroundedQuestionSet(
            questions=[
                GroundedQuestion(
                    domain="resume",
                    question="주문 API에서 맡은 역할은 무엇인가요?",
                    evidence="주문 API를 개발했습니다",
                ),
                GroundedQuestion(
                    domain="job_technology",
                    question="Kubernetes를 선택한 이유는 무엇인가요?",
                    evidence="Kubernetes",
                ),
            ]
        )

    monkeypatch.setattr(grounded_question_service.llm, "is_configured", lambda: True)
    monkeypatch.setattr(grounded_question_service.llm, "call_structured", fake_call_structured)

    result = grounded_question_service.generate_grounded_questions(
        {"job": "백엔드 개발자"},
        [
            EssayQAItem(
                question="Kubernetes 경험을 설명해 주세요.",
                answer="주문 API를 개발했습니다.",
            )
        ],
        ["지원동기는 무엇인가요?"],
    )

    assert captured["calls"] == 1
    assert "지원동기는 무엇인가요?" in captured["user"]
    assert "effort" not in captured
    assert result["resume"] is not None
    assert result["job_technology"] is None


def test_questions_request_rejects_oversized_structured_essay() -> None:
    response = client.post(
        "/questions",
        json={"items": [{"question": "질문", "answer": "가" * 10_000}]},
    )
    assert response.status_code == 422


def test_resume_question_rejects_technology_found_only_in_company_question() -> None:
    item = GroundedQuestion(
        domain="resume",
        question="Kubernetes 경험에서 맡은 역할은 무엇인가요?",
        evidence="주문 API를 개발했습니다",
    )
    assert (
        grounded_question_service.is_valid_grounded_question(
            item,
            expected_domain="resume",
            source_text="주문 API를 개발했습니다.",
        )
        is False
    )


def test_personalized_bank_collision_falls_back_to_personalized_bank_question(
    monkeypatch: Any,
) -> None:
    bank = _stub_bank_questions()
    monkeypatch.setattr(
        questions_router, "generate_questions", lambda **_kwargs: bank
    )
    monkeypatch.setattr(
        questions_router,
        "generate_grounded_questions",
        lambda *_args, **_kwargs: {
            "resume": GroundedQuestion(
                domain="resume",
                question="생성 질문?",
                evidence="지원자 경험",
            )
        },
    )

    def fake_personalize(
        _profile: dict[str, Any], _essay: str | None, question: Question
    ) -> str:
        if question.rule_group == "motivation_commitment":
            return "생성 질문?"
        if question.rule_group == "resume":
            return "개인화된 resume 질문?"
        return question.text

    monkeypatch.setattr(questions_router, "personalize_question", fake_personalize)

    response = client.post(
        "/questions",
        json={"items": [{"question": "회사 질문", "answer": "지원자 경험"}]},
    )

    assert response.status_code == 200
    questions = response.json()["questions"]
    assert questions[0]["text"] == "개인화된 resume 질문?"
    assert questions[1]["text"] == "생성 질문?"
    assert len({item["text"] for item in questions}) == 6


def test_grounded_question_service_returns_domain_fallbacks_when_unconfigured(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(grounded_question_service.llm, "is_configured", lambda: False)

    result = grounded_question_service.generate_grounded_questions(
        {"job": "백엔드 개발자"}, [], []
    )

    assert result == {"resume": None, "job_technology": None}


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
        "Docker를 사용했습니다.",
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
        "Docker를 사용했습니다.",
    )

    assert len(filtered) == 2


def test_unmatched_secondary_is_excluded_but_profile_match_is_allowed() -> None:
    candidates = list(_load_group_questions("job_technology"))
    docker = next(row for row in candidates if row["question"].startswith("Docker"))

    without_docker = _role_filtered_candidates(
        "job_technology", candidates, frozenset({"backend"}), random.Random(1), None
    )
    with_docker = _role_filtered_candidates(
        "job_technology",
        candidates,
        frozenset({"backend"}),
        random.Random(1),
        "Docker를 사용했습니다.",
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
        "Docker를 사용했습니다.",
    )

    assert filtered == candidates
