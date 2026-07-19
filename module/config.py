"""Runtime configuration loaders for external services (STT, etc.).

Secrets are read from environment variables first, then from Streamlit's
``.streamlit/secrets.toml``. Never hard-code keys here; ``secrets.toml`` is
git-ignored and a ``secrets.toml.example`` template documents the keys.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


class ClovaConfigError(RuntimeError):
    """Raised when CLOVA Speech credentials are missing or malformed."""


@dataclass(frozen=True)
class ClovaConfig:
    """Connection settings for the CLOVA Speech long-sentence API."""

    invoke_url: str
    secret_key: str
    language: str = "ko-KR"
    timeout: float = 60.0


def _get_secret(name: str) -> str | None:
    """Return a secret from the environment, then Streamlit secrets, else None."""
    value = os.environ.get(name)
    if value:
        return value.strip()

    # ``st.secrets`` raises if no secrets file exists, so guard broadly.
    try:
        import streamlit as st

        if name in st.secrets:
            secret = str(st.secrets[name]).strip()
            return secret or None
    except Exception:
        return None
    return None


def get_clova_config() -> ClovaConfig:
    """Load CLOVA Speech settings, raising ClovaConfigError when incomplete.

    Required keys: ``CLOVA_SPEECH_INVOKE_URL`` (the domain's Invoke URL copied
    verbatim from the NCP console) and ``CLOVA_SPEECH_SECRET`` (the domain's
    ``X-CLOVASPEECH-API-KEY``). ``CLOVA_SPEECH_LANGUAGE`` and
    ``CLOVA_SPEECH_TIMEOUT`` are optional.
    """
    invoke_url = _get_secret("CLOVA_SPEECH_INVOKE_URL")
    secret_key = _get_secret("CLOVA_SPEECH_SECRET")
    if not invoke_url or not secret_key:
        raise ClovaConfigError(
            "CLOVA Speech 설정이 없습니다. CLOVA_SPEECH_INVOKE_URL과 "
            "CLOVA_SPEECH_SECRET를 환경변수 또는 .streamlit/secrets.toml에 "
            "설정해 주세요."
        )

    language = _get_secret("CLOVA_SPEECH_LANGUAGE") or "ko-KR"
    raw_timeout = _get_secret("CLOVA_SPEECH_TIMEOUT")
    try:
        timeout = float(raw_timeout) if raw_timeout else 60.0
    except ValueError as error:
        raise ClovaConfigError("CLOVA_SPEECH_TIMEOUT은 숫자여야 합니다.") from error

    return ClovaConfig(
        invoke_url=invoke_url.rstrip("/"),
        secret_key=secret_key,
        language=language,
        timeout=timeout,
    )
