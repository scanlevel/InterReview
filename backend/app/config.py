"""Track B runtime settings loaded from the environment and development ``.env``.

Secrets are never hard-coded; ``.env`` is git-ignored and ``.env.example``
documents every supported key.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LLMProvider = Literal["anthropic", "gemini"]

_DEFAULT_ANTHROPIC_EVAL_MODEL = "claude-sonnet-5"
_DEFAULT_ANTHROPIC_PERSONALIZE_MODEL = "claude-haiku-4-5-20251001"
_DEFAULT_GEMINI_EVAL_MODEL = "gemma-4-31b-it"
_DEFAULT_GEMINI_PERSONALIZE_MODEL = "gemma-4-31b-it"


class Settings(BaseSettings):
    """Application configuration resolved from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Frontend origins allowed to call the API, comma-separated. Kept as a str
    # (not list[str]) because pydantic-settings JSON-decodes list-typed env
    # values, which would reject a plain "http://localhost:3000". Split via
    # ``cors_origin_list``.
    cors_origins: str = Field(
        default="http://localhost:3000",
        alias="CORS_ORIGINS",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        """Parse ``cors_origins`` into a clean list of origins."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    # --- CLOVA Speech (STT) — filled in during the STT port ---
    clova_speech_invoke_url: str | None = Field(default=None, alias="CLOVA_SPEECH_INVOKE_URL")
    clova_speech_secret: str | None = Field(default=None, alias="CLOVA_SPEECH_SECRET")
    clova_speech_language: str = Field(default="ko-KR", alias="CLOVA_SPEECH_LANGUAGE")
    # HTTP wait for CLOVA to return the transcript (NOT a limit on answer/audio
    # length). Sync recognition of a long answer can take a while, so keep this
    # generous. Tune via CLOVA_SPEECH_TIMEOUT.
    clova_speech_timeout: float = Field(default=180.0, alias="CLOVA_SPEECH_TIMEOUT")

    # --- Local CPU TTS ---
    local_tts_model: Literal["supertonic-3", "supertonic-2"] = Field(
        default="supertonic-3", alias="LOCAL_TTS_MODEL"
    )
    local_tts_model_dir: str = Field(
        default="models/tts/supertonic3",
        alias="LOCAL_TTS_MODEL_DIR",
    )
    local_tts_num_threads: int = Field(
        default=2, alias="LOCAL_TTS_NUM_THREADS", ge=1, le=16
    )
    local_tts_default_voice: str = Field(default="M1", alias="LOCAL_TTS_DEFAULT_VOICE")
    local_tts_steps: int = Field(default=8, alias="LOCAL_TTS_STEPS", ge=5, le=12)
    local_tts_speed: float = Field(default=1.05, alias="LOCAL_TTS_SPEED", ge=0.7, le=2.0)

    # --- LLM (evaluation / personalization) ---
    llm_provider: LLMProvider = Field(default="anthropic", alias="LLM_PROVIDER")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    anthropic_eval_model: str | None = Field(default=None, alias="ANTHROPIC_EVAL_MODEL")
    anthropic_personalize_model: str | None = Field(
        default=None, alias="ANTHROPIC_PERSONALIZE_MODEL"
    )
    gemini_eval_model: str | None = Field(default=None, alias="GEMINI_EVAL_MODEL")
    gemini_personalize_model: str | None = Field(default=None, alias="GEMINI_PERSONALIZE_MODEL")
    # Legacy overrides remain supported; provider-specific values take priority.
    eval_model: str | None = Field(default=None, alias="EVAL_MODEL")
    personalize_model: str | None = Field(default=None, alias="PERSONALIZE_MODEL")

    @field_validator(
        "eval_model", "personalize_model",
        "anthropic_eval_model", "anthropic_personalize_model",
        "gemini_eval_model", "gemini_personalize_model", mode="before",
    )
    @classmethod
    def _empty_model_is_unset(cls, value: object) -> object:
        """Treat an empty .env model value as the provider default."""
        if value is None or not str(value).strip():
            return None
        return str(value).strip()

    @model_validator(mode="after")
    def _apply_provider_model_defaults(self) -> "Settings":
        if self.llm_provider == "gemini":
            self.eval_model = (
                self.gemini_eval_model or self.eval_model or _DEFAULT_GEMINI_EVAL_MODEL
            )
            self.personalize_model = (
                self.gemini_personalize_model
                or self.personalize_model
                or _DEFAULT_GEMINI_PERSONALIZE_MODEL
            )
        else:
            self.eval_model = (
                self.anthropic_eval_model or self.eval_model or _DEFAULT_ANTHROPIC_EVAL_MODEL
            )
            self.personalize_model = (
                self.anthropic_personalize_model
                or self.personalize_model
                or _DEFAULT_ANTHROPIC_PERSONALIZE_MODEL
            )
        wrong_prefixes = ("claude-",) if self.llm_provider == "gemini" else ("gemini-", "gemma-")
        for field in ("eval_model", "personalize_model"):
            model = getattr(self, field)
            if model.lower().removeprefix("models/").startswith(wrong_prefixes):
                raise ValueError(
                    f"{self.llm_provider}: {field.upper()} 모델 공급자가 일치하지 않습니다. "
                    f"{self.llm_provider.upper()}_{field.upper()}을 설정하거나 "
                    f"기존 {field.upper()}을 비워 주세요."
                )
        return self


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (read once per process)."""
    return Settings()
