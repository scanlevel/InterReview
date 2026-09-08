"""``/tts`` route for local CPU speech synthesis."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.schemas import TtsRequest
from app.services.tts import (
    TtsError,
    TtsGuideUnavailable,
    TtsInvalidVoice,
    TtsLoadError,
    TtsNotConfigured,
    TtsSynthesisError,
    synthesize_guide,
)

router = APIRouter(tags=["tts"])
logger = logging.getLogger(__name__)


def _tts_unavailable(code: str, message: str, error: Exception) -> HTTPException:
    logger.error("tts_failure code=%s error_type=%s", code, type(error).__name__)
    return HTTPException(
        status_code=503,
        detail={"code": code, "message": message},
    )


@router.post("/tts", response_class=Response)
def synthesize(request: TtsRequest) -> Response:
    try:
        audio = synthesize_guide(request.text, request.voice_id)
    except TtsInvalidVoice as error:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_voice", "message": "허용되지 않은 로컬 TTS 화자입니다."},
        ) from error
    except TtsGuideUnavailable as error:
        raise _tts_unavailable(
            "guide_missing",
            "고정 안내 음성이 준비되지 않았습니다.",
            error,
        ) from error
    except TtsNotConfigured as error:
        raise _tts_unavailable(
            "model_missing",
            "로컬 TTS 모델이 준비되지 않았습니다.",
            error,
        ) from error
    except TtsLoadError as error:
        raise _tts_unavailable(
            "model_load",
            "로컬 TTS 모델을 불러오지 못했습니다.",
            error,
        ) from error
    except TtsSynthesisError as error:
        raise _tts_unavailable(
            "synthesis",
            "로컬 TTS 합성에 실패했습니다.",
            error,
        ) from error
    except (TtsError, ValueError) as error:
        raise _tts_unavailable(
            "request_failed",
            "로컬 TTS 요청을 처리하지 못했습니다.",
            error,
        ) from error
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )
