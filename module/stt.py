# module/stt.py
"""Speech-to-text for interview answers.

Two pieces:
- ``AudioBuffer`` accumulates microphone frames coming from streamlit-webrtc's
  worker thread and exports them as a 16 kHz mono WAV.
- ``transcribe_wav`` sends that WAV to the Naver CLOVA Speech long-sentence
  ``/recognizer/upload`` endpoint and returns the transcript.

The WebRTC frame callback runs in a separate thread where ``st.session_state``
is unavailable, so the buffer is a plain object guarded by its own lock. Create
one buffer per Streamlit session (see ``get_audio_buffer``) and hold a reference
to it inside the callback closure rather than reaching into session state.
"""

from __future__ import annotations

import io
import json
import threading
import wave
from typing import Any

import av
import numpy as np
import requests

from module.config import ClovaConfigError, get_clova_config

TARGET_SAMPLE_RATE = 16000
TARGET_SAMPLE_WIDTH = 2  # bytes per sample for signed 16-bit PCM


def _format_duration(duration_sec: float) -> str:
    total = int(duration_sec)
    return f"{total // 60:02d}:{total % 60:02d}"


class AudioBuffer:
    """Thread-safe accumulator for WebRTC mic audio, per Streamlit session.

    Incoming frames are resampled to 16 kHz mono signed-16-bit PCM so any
    browser/OS sample rate (WebRTC mic is usually 48 kHz stereo) exports to a
    consistent WAV that CLOVA Speech accepts.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frames: list[np.ndarray] = []
        self._recording = False
        # Reused across frames; the resampler keeps internal buffer state.
        self._resampler = av.AudioResampler(
            format="s16",
            layout="mono",
            rate=TARGET_SAMPLE_RATE,
        )

    def start(self) -> None:
        """Clear any previous audio and begin capturing frames."""
        with self._lock:
            self._frames = []
            self._recording = True

    def stop(self) -> None:
        """Stop capturing without discarding what has been buffered."""
        with self._lock:
            self._recording = False

    def reset(self) -> None:
        """Discard buffered audio and stop capturing."""
        with self._lock:
            self._frames = []
            self._recording = False

    @property
    def recording(self) -> bool:
        with self._lock:
            return self._recording

    def add_frame(self, frame: av.AudioFrame) -> None:
        """Resample and append one WebRTC audio frame. Safe to call from the
        webrtc worker thread; a no-op while not recording."""
        with self._lock:
            if not self._recording:
                return
            try:
                resampled = self._resampler.resample(frame)
            except Exception:
                # A malformed frame should never break the capture stream.
                return
            # PyAV >= 10 returns a list of frames; older returns one frame.
            if not isinstance(resampled, list):
                resampled = [resampled]
            for out_frame in resampled:
                array = out_frame.to_ndarray()
                if array.size:
                    self._frames.append(array.copy())

    def sample_count(self) -> int:
        with self._lock:
            return sum(int(array.shape[-1]) for array in self._frames)

    def duration_sec(self) -> float:
        return self.sample_count() / TARGET_SAMPLE_RATE

    def to_wav_bytes(self) -> bytes:
        """Return buffered audio as an in-memory 16 kHz mono WAV (empty if none)."""
        with self._lock:
            frames = list(self._frames)
        if not frames:
            return b""

        pcm = np.concatenate(frames, axis=1).astype(np.int16)
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(TARGET_SAMPLE_WIDTH)
            wav_file.setframerate(TARGET_SAMPLE_RATE)
            wav_file.writeframes(pcm.tobytes())
        return buffer.getvalue()


def get_audio_buffer() -> AudioBuffer:
    """Return this Streamlit session's AudioBuffer, creating it on first use."""
    import streamlit as st

    if st.session_state.get("audio_buffer") is None:
        st.session_state["audio_buffer"] = AudioBuffer()
    return st.session_state["audio_buffer"]


def get_stt_status(audio_buffer: AudioBuffer | None) -> dict[str, Any]:
    """Summarize live capture state for the interview UI panel."""
    if audio_buffer is None:
        return {
            "recording": False,
            "duration_sec": 0.0,
            "duration_text": "00:00",
            "buffered_samples": 0,
            "status": "unavailable",
        }

    duration = audio_buffer.duration_sec()
    recording = audio_buffer.recording
    return {
        "recording": recording,
        "duration_sec": round(duration, 1),
        "duration_text": _format_duration(duration),
        "buffered_samples": audio_buffer.sample_count(),
        "status": "recording" if recording else ("buffered" if duration > 0 else "idle"),
    }


def transcribe_wav(wav_bytes: bytes, *, language: str | None = None) -> dict[str, Any]:
    """Transcribe WAV audio with CLOVA Speech, returning a result dict.

    The result always includes ``transcript`` (possibly empty) and ``status``
    (one of ``ok``/``no_speech``/``empty``/``not_configured``/``error``) so the
    caller and downstream evaluation can handle every case without exceptions.
    """
    if not wav_bytes:
        return {"transcript": "", "status": "empty", "error": None}

    try:
        config = get_clova_config()
    except ClovaConfigError as error:
        return {"transcript": "", "status": "not_configured", "error": str(error)}

    params = {
        "language": language or config.language,
        "completion": "sync",
        "wordAlignment": False,
        "fullText": True,
    }

    try:
        response = requests.post(
            f"{config.invoke_url}/recognizer/upload",
            headers={"X-CLOVASPEECH-API-KEY": config.secret_key},
            files=[("media", ("answer.wav", wav_bytes, "audio/wav"))],
            data={"params": json.dumps(params)},
            timeout=config.timeout,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as error:
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
