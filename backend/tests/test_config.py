"""Tests for settings parsing."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from app.config import Settings, get_settings


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    for field in Settings.model_fields.values():
        if field.alias:
            monkeypatch.delenv(field.alias, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_cors_origins_splits_comma_separated_string() -> None:
    settings = Settings(CORS_ORIGINS="http://a.com, http://b.com ,")
    assert settings.cors_origin_list == ["http://a.com", "http://b.com"]


def test_cors_origins_default_is_local_dev() -> None:
    settings = Settings(CORS_ORIGINS="http://localhost:3000")
    assert settings.cors_origin_list == ["http://localhost:3000"]


def test_llm_models_have_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    # _env_file=None only skips .env; real environment variables still apply,
    # so drop them too or this fails in any shell/CI that exports a key.
    for name in (
        "LLM_PROVIDER",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "EVAL_MODEL",
        "PERSONALIZE_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    assert settings.llm_provider == "anthropic"
    assert settings.eval_model == "claude-sonnet-5"
    assert settings.personalize_model == "claude-haiku-4-5-20251001"
    assert settings.anthropic_api_key is None
    assert settings.gemini_api_key is None


def test_llm_settings_load_from_env_aliases() -> None:
    settings = Settings(
        _env_file=None,
        LLM_PROVIDER="gemini",
        ANTHROPIC_API_KEY="k",
        GEMINI_API_KEY="g",
        EVAL_MODEL="m1",
        PERSONALIZE_MODEL="m2",
    )
    assert settings.llm_provider == "gemini"
    assert settings.anthropic_api_key == "k"
    assert settings.gemini_api_key == "g"
    assert settings.eval_model == "m1"
    assert settings.personalize_model == "m2"


def test_gemini_provider_uses_gemini_model_defaults() -> None:
    settings = Settings(_env_file=None, LLM_PROVIDER="gemini")
    assert settings.eval_model == "gemma-4-31b-it"
    assert settings.personalize_model == "gemma-4-31b-it"


def test_unknown_llm_provider_is_rejected() -> None:
    with pytest.raises(ValueError):
        Settings(_env_file=None, LLM_PROVIDER="unknown")


@pytest.mark.parametrize("provider", ["anthropic", "gemini"])
def test_switch_provider_uses_only_its_models(provider: str) -> None:
    settings = Settings(
        _env_file=None, LLM_PROVIDER=provider,
        ANTHROPIC_EVAL_MODEL="claude-eval",
        ANTHROPIC_PERSONALIZE_MODEL="claude-personalize",
        GEMINI_EVAL_MODEL="gemma-eval",
        GEMINI_PERSONALIZE_MODEL="gemma-personalize",
        EVAL_MODEL="old-model", PERSONALIZE_MODEL="old-model",
    )
    prefix = "claude" if provider == "anthropic" else "gemma"
    assert settings.eval_model == f"{prefix}-eval"
    assert settings.personalize_model == f"{prefix}-personalize"


@pytest.mark.parametrize("provider,model", [
    ("gemini", "claude-sonnet-5"),
    ("anthropic", "gemini-test"),
    ("anthropic", "models/gemma-4-31b-it"),
])
@pytest.mark.parametrize("field", ["EVAL_MODEL", "PERSONALIZE_MODEL"])
@pytest.mark.parametrize("scoped", [False, True])
def test_mismatched_model_is_rejected(
    provider: str, model: str, field: str, scoped: bool,
) -> None:
    name = f"{provider.upper()}_{field}" if scoped else field
    with pytest.raises(ValueError, match="모델 공급자가 일치하지 않습니다"):
        Settings(_env_file=None, LLM_PROVIDER=provider, **{name: model})


def test_blank_scoped_models_use_defaults() -> None:
    settings = Settings(
        _env_file=None, LLM_PROVIDER="gemini",
        GEMINI_EVAL_MODEL="  ", GEMINI_PERSONALIZE_MODEL="",
        EVAL_MODEL="", PERSONALIZE_MODEL=" ",
    )
    assert settings.eval_model == "gemma-4-31b-it"
    assert settings.personalize_model == "gemma-4-31b-it"


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
