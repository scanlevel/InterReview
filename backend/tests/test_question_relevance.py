"""Tests for the shared question-selection and personalization relevance helper."""

from app.services.question_relevance import (
    extract_registered_tokens,
    is_profile_related,
    normalize_text,
)


def test_normalization_and_registered_aliases() -> None:
    assert normalize_text("  REST/API\u3000도커 ") == "rest api 도커"
    assert extract_registered_tokens("Docker, 도커, K8S, 쿠버네티스") == {
        "docker",
        "kubernetes",
    }
    assert extract_registered_tokens(
        "REST API, DB 데이터베이스, 배포 네트워크 보안 transaction 트랜잭션"
    ) == {
        "rest",
        "api",
        "database",
        "deployment",
        "network",
        "security",
        "transaction",
    }


def test_generic_words_are_not_relevance_topics() -> None:
    assert extract_registered_tokens(
        "프로젝트에서 경험한 문제를 설명하고 사용한 내용을 공유해 주세요."
    ) == set()


def test_profile_relevance_uses_only_profile_context_fields() -> None:
    question = "Docker 배포 경험을 설명해 주세요?"

    assert is_profile_related(question, {"job": "Docker"}) is False
    assert is_profile_related(question, {"technologies": "Docker"}) is True
    assert is_profile_related(question, {"projects": ["Docker 기반 서비스"]}) is True
    assert is_profile_related(question, {"resume_text": "Docker 운영 경험"}) is True
