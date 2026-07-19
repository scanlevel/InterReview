"""Tests for settings parsing."""

from __future__ import annotations

from app.config import Settings


def test_cors_origins_splits_comma_separated_string() -> None:
    settings = Settings(CORS_ORIGINS="http://a.com, http://b.com ,")
    assert settings.cors_origin_list == ["http://a.com", "http://b.com"]


def test_cors_origins_default_is_local_dev() -> None:
    settings = Settings(CORS_ORIGINS="http://localhost:3000")
    assert settings.cors_origin_list == ["http://localhost:3000"]
