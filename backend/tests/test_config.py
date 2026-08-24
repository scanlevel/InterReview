"""Tests for settings parsing."""

from __future__ import annotations

import pytest

from app.config import Settings, get_settings


def test_cors_origins_splits_comma_separated_string() -> None:
    settings = Settings(CORS_ORIGINS="http://a.com, http://b.com ,")
    assert settings.cors_origin_list == ["http://a.com", "http://b.com"]


def test_cors_origins_default_is_local_dev() -> None:
    settings = Settings(CORS_ORIGINS="http://localhost:3000")
    assert settings.cors_origin_list == ["http://localhost:3000"]


def test_llm_models_have_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    # _env_file=None only skips .env; real environment variables still apply,
    # so drop them too or this fails in any shell/CI that exports a key.
    for name in ("ANTHROPIC_API_KEY", "EVAL_MODEL", "PERSONALIZE_MODEL"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    assert settings.eval_model == "claude-sonnet-5"
    assert settings.personalize_model == "claude-haiku-4-5-20251001"
    assert settings.anthropic_api_key is None


def test_llm_settings_load_from_env_aliases() -> None:
    settings = Settings(
        _env_file=None,
        ANTHROPIC_API_KEY="k",
        EVAL_MODEL="m1",
        PERSONALIZE_MODEL="m2",
    )
    assert settings.anthropic_api_key == "k"
    assert settings.eval_model == "m1"
    assert settings.personalize_model == "m2"


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
