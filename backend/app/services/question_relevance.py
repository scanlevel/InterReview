"""Shared vocabulary-based relevance checks for question selection and personalization."""

from __future__ import annotations

import re
import unicodedata

# Keep this vocabulary intentionally small and explicit. It covers the
# technical/domain terms currently used by the question bank and common aliases.
# ponytail: 등록 vocabulary 기반 lexical match만 사용하며, 미등록 기술·의미적
# 유사성은 실제 누락 사례가 생길 때만 alias를 추가한다.
TECH_DOMAIN_VOCABULARY: dict[str, tuple[str, ...]] = {
    "docker": ("docker", "도커"),
    "kubernetes": ("kubernetes", "k8s", "쿠버네티스"),
    "api": ("api", "에이피아이", "fastapi", "flask"),
    "rest": ("rest", "restful"),
    "database": (
        "database",
        "data base",
        "db",
        "데이터베이스",
        "디비",
        "mysql",
        "postgresql",
        "postgres",
        "mongodb",
        "mariadb",
    ),
    "query": ("query", "쿼리"),
    "sql": ("sql", "에스큐엘"),
    "transaction": ("transaction", "트랜잭션"),
    "cache": ("cache", "캐시"),
    "deployment": ("deployment", "deploy", "배포"),
    "network": ("network", "네트워크"),
    "security": ("security", "보안", "정보보안"),
    "http": ("http", "에이치티티피"),
    "https": ("https", "에이치티티피에스"),
    "vpn": ("vpn", "브이피엔"),
    "aws": ("aws", "아마존 웹 서비스"),
    "cloud": ("cloud", "클라우드"),
    "server": ("server", "서버"),
    "process": ("process", "프로세스"),
    "thread": ("thread", "스레드"),
    "kernel": ("kernel", "커널"),
    "proxy": ("proxy", "프록시"),
    "dns": ("dns", "디엔에스"),
    "tcp": ("tcp", "티씨피"),
    "udp": ("udp", "유디피"),
    "memory": ("memory", "메모리"),
    "algorithm": ("algorithm", "알고리즘"),
    "frontend": ("frontend", "front end", "프론트엔드"),
    "backend": ("backend", "back end", "백엔드"),
    "ci_cd": ("ci cd", "cicd", "continuous integration", "continuous delivery"),
    "redis": ("redis", "레디스"),
}

_NORMALIZE_RE = re.compile(r"[^0-9a-z가-힣]+")
_LATIN_HANGUL_BOUNDARY_RE = re.compile(r"(?<=[0-9a-z])(?=[가-힣])|(?<=[가-힣])(?=[0-9a-z])")


def normalize_text(text: str) -> str:
    """Normalize text for conservative token matching."""
    normalized = unicodedata.normalize("NFKC", text).casefold()
    normalized = _LATIN_HANGUL_BOUNDARY_RE.sub(" ", normalized)
    return " ".join(_NORMALIZE_RE.sub(" ", normalized).split())


def _normalized_vocabulary() -> tuple[tuple[str, str], ...]:
    return tuple(
        (canonical, normalize_text(alias))
        for canonical, aliases in TECH_DOMAIN_VOCABULARY.items()
        for alias in aliases
    )


def _contains_alias(tokens: set[str], normalized_text: str, alias: str) -> bool:
    alias_tokens = alias.split()
    if len(alias_tokens) == 1:
        if alias_tokens[0] in tokens:
            return True
        # Korean particles attach directly to the topic (e.g. "배포를").
        if any("가" <= character <= "힣" for character in alias_tokens[0]):
            return alias_tokens[0] in normalized_text
        return False
    return alias in normalized_text


def extract_registered_tokens(text: str) -> set[str]:
    """Return canonical vocabulary tokens explicitly present in ``text``."""
    normalized = normalize_text(text)
    tokens = set(normalized.split())
    return {
        canonical
        for canonical, alias in _normalized_vocabulary()
        if _contains_alias(tokens, normalized, alias)
    }


def evidence_registered_tokens(evidence_text: str | None = None) -> set[str]:
    """Return registered tokens explicitly written in applicant answers."""
    return extract_registered_tokens(evidence_text or "")


def is_evidence_related(
    question_text: str,
    evidence_text: str | None = None,
) -> bool:
    """Whether a question shares a registered token with applicant answers."""
    return bool(
        extract_registered_tokens(question_text)
        & evidence_registered_tokens(evidence_text)
    )
