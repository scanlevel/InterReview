"""Runtime settings loaded from the environment (and ``.env`` in development).

Ported and generalized from the Streamlit ``module/config.py``: alongside the
CLOVA Speech credentials this now also carries LLM settings and the CORS
allow-list for the Next.js frontend. Secrets are never hard-coded; ``.env`` is
git-ignored and ``.env.example`` documents every key.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration resolved from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Frontend origins allowed to call the API (comma-separated in the env).
    cors_origins: list[str] = Field(
        default=["http://localhost:3000"],
        alias="CORS_ORIGINS",
    )

    # --- CLOVA Speech (STT) — filled in during the STT port ---
    clova_speech_invoke_url: str | None = Field(default=None, alias="CLOVA_SPEECH_INVOKE_URL")
    clova_speech_secret: str | None = Field(default=None, alias="CLOVA_SPEECH_SECRET")
    clova_speech_language: str = Field(default="ko-KR", alias="CLOVA_SPEECH_LANGUAGE")
    clova_speech_timeout: float = Field(default=60.0, alias="CLOVA_SPEECH_TIMEOUT")

    # --- LLM (evaluation / personalization) — filled in during the LLM port ---
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    eval_model: str = Field(default="claude-sonnet-5", alias="EVAL_MODEL")
    personalize_model: str = Field(default="claude-haiku-4-5-20251001", alias="PERSONALIZE_MODEL")


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (read once per process)."""
    return Settings()
