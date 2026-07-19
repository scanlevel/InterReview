"""``/stt`` route — transcribe one uploaded answer audio blob via CLOVA."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile

from app.schemas import TranscriptResponse
from app.services.stt import transcribe_audio

router = APIRouter(tags=["stt"])


@router.post("/stt", response_model=TranscriptResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
) -> TranscriptResponse:
    """Accept a browser-recorded audio file and return its transcript."""
    content = await file.read()
    result = transcribe_audio(
        content,
        filename=file.filename or "answer",
        content_type=file.content_type or "application/octet-stream",
        language=language,
    )
    return TranscriptResponse(**result)
