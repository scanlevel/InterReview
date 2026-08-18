"""Speech-to-text via Naver CLOVA Speech.

Ported from the Streamlit ``module/stt.py``, but only the network half: the
browser now captures and encodes the audio (``MediaRecorder``), so the server no
longer needs the thread-safe ``AudioBuffer``/resampler. This module just proxies
one uploaded audio blob to CLOVA's long-sentence ``/recognizer/upload`` endpoint.

``transcribe_audio`` never raises for expected conditions — it always returns a
result dict whose ``status`` is one of ``ok``/``no_speech``/``empty``/
``not_configured``/``error`` so the route and downstream evaluation can branch
without exception handling.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings


class ClovaNotConfigured(RuntimeError):
    """CLOVA Speech credentials are missing."""


@dataclass(frozen=True)
class _ClovaConfig:
    invoke_url: str
    secret_key: str
    language: str
    timeout: float


def _load_clova_config() -> _ClovaConfig:
    """Build a CLOVA config from settings, raising if credentials are missing."""
    settings = get_settings()
    invoke_url = (settings.clova_speech_invoke_url or "").strip()
    secret_key = (settings.clova_speech_secret or "").strip()
    if not invoke_url or not secret_key:
        raise ClovaNotConfigured(
            "CLOVA Speech 설정이 없습니다. CLOVA_SPEECH_INVOKE_URL과 "
            "CLOVA_SPEECH_SECRET를 환경변수 또는 backend/.env에 설정해 주세요."
        )
    return _ClovaConfig(
        invoke_url=invoke_url.rstrip("/"),
        secret_key=secret_key,
        language=settings.clova_speech_language,
        timeout=settings.clova_speech_timeout,
    )


def transcribe_audio(
    content: bytes,
    *,
    filename: str = "answer",
    content_type: str = "application/octet-stream",
    language: str | None = None,
) -> dict[str, Any]:
    """Transcribe one audio blob with CLOVA Speech.

    ``content`` is the raw bytes of a browser-recorded audio file. CLOVA infers
    the container from the payload, so the caller only needs to forward it.
    """
    if not content:
        return {"transcript": "", "status": "empty", "error": None}

    try:
        config = _load_clova_config()
    except ClovaNotConfigured as error:
        return {"transcript": "", "status": "not_configured", "error": str(error)}

    params = {
        "language": language or config.language,
        "completion": "sync",
        "wordAlignment": False,
        "fullText": True,
        # Speaker recognition must be explicitly disabled or CLOVA rejects the
        # request with 400 "speaker detect is off".
        "diarization": {"enable": False},
    }

    try:
        response = httpx.post(
            f"{config.invoke_url}/recognizer/upload",
            headers={"X-CLOVASPEECH-API-KEY": config.secret_key},
            files={"media": (filename, content, content_type)},
            data={"params": json.dumps(params)},
            timeout=config.timeout,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as error:
        return {"transcript": "", "status": "error", "error": f"CLOVA 요청 실패: {error}"}
    except ValueError:
        return {
            "transcript": "",
            "status": "error",
            "error": "CLOVA 응답을 해석할 수 없습니다.",
        }

    transcript = str(payload.get("text") or "").strip()
    return {
        "transcript": transcript,
        "status": "ok" if transcript else "no_speech",
        "error": None,
        "confidence": payload.get("confidence"),
        "segment_count": len(payload.get("segments") or []),
    }
