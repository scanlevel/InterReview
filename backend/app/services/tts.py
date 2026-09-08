"""Local CPU Supertonic TTS service for questions and fixed guides."""

from __future__ import annotations

import io
import sys
import threading
import wave
from array import array
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import get_settings


VOICE_IDS = ("M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5")
DEFAULT_VOICE_ID = "M1"
FIXED_GUIDE_TEXTS = frozenset(
    {"시작하세요.", "답변을 마치셨나요?", "수고하셨습니다."}
)
_GUIDE_FILES = {
    "시작하세요.": "start.wav",
    "답변을 마치셨나요?": "confirm.wav",
    "수고하셨습니다.": "finish.wav",
}
_MODEL_FILES = (
    Path("onnx") / "tts.json",
    Path("onnx") / "duration_predictor.onnx",
    Path("onnx") / "text_encoder.onnx",
    Path("onnx") / "vector_estimator.onnx",
    Path("onnx") / "vocoder.onnx",
    Path("onnx") / "unicode_indexer.json",
)


class TtsError(RuntimeError):
    """Base error for local TTS failures."""


class TtsNotConfigured(TtsError):
    """The local model or voice style is missing."""


class TtsGuideUnavailable(TtsNotConfigured):
    """A prepared fixed guide is missing or invalid."""


class TtsInvalidVoice(TtsError):
    """The request selected a voice outside the allow-list."""


class TtsLoadError(TtsError):
    """The local engine could not load the configured model."""


class TtsSynthesisError(TtsError):
    """The local engine could not synthesize usable audio."""


@dataclass(frozen=True)
class _TtsConfig:
    model_dir: Path
    model_name: str = "supertonic-3"
    num_threads: int = 2
    default_voice_id: str = DEFAULT_VOICE_ID
    steps: int = 8
    speed: float = 1.05


_ENGINE_LOCK = threading.Lock()
_ENGINE: Any | None = None
_ENGINE_KEY: tuple[Path, str, int] | None = None
_VOICE_STYLES: dict[tuple[Path, str, int, str], Any] = {}


def _load_config() -> _TtsConfig:
    settings = get_settings()
    model_dir = Path(settings.local_tts_model_dir)
    if not model_dir.is_absolute():
        model_dir = Path(__file__).resolve().parents[2] / model_dir
    return _TtsConfig(
        model_dir=model_dir.resolve(),
        model_name=settings.local_tts_model,
        num_threads=settings.local_tts_num_threads,
        default_voice_id=settings.local_tts_default_voice,
        steps=settings.local_tts_steps,
        speed=settings.local_tts_speed,
    )


def _validate_voice(voice_id: str) -> str:
    if voice_id not in VOICE_IDS:
        raise TtsInvalidVoice("허용되지 않은 로컬 TTS 화자입니다.")
    return voice_id


def _ensure_model_files(config: _TtsConfig, voice_id: str) -> None:
    required = [config.model_dir / path for path in _MODEL_FILES]
    required.append(config.model_dir / "voice_styles" / f"{voice_id}.json")
    if not all(path.is_file() for path in required):
        raise TtsNotConfigured("로컬 Supertonic 모델 또는 화자 파일이 준비되지 않았습니다.")


def _load_engine(config: _TtsConfig) -> Any:
    _validate_voice(config.default_voice_id)
    _ensure_model_files(config, config.default_voice_id)
    try:
        from supertonic import TTS

        return TTS(
            model=config.model_name,
            model_dir=config.model_dir,
            auto_download=False,
            intra_op_num_threads=config.num_threads,
            inter_op_num_threads=1,
        )
    except TtsError:
        raise
    except Exception as error:
        raise TtsLoadError("로컬 Supertonic 모델을 불러오지 못했습니다.") from error


def _get_engine_locked(config: _TtsConfig) -> Any:
    global _ENGINE, _ENGINE_KEY
    key = (config.model_dir, config.model_name, config.num_threads)
    if _ENGINE_KEY != key:
        _ENGINE = _load_engine(config)
        _ENGINE_KEY = key
        _VOICE_STYLES.clear()
    return _ENGINE


def _get_voice_style_locked(config: _TtsConfig, engine: Any, voice_id: str) -> Any:
    key = (config.model_dir, config.model_name, config.num_threads, voice_id)
    style = _VOICE_STYLES.get(key)
    if style is None:
        try:
            style = engine.get_voice_style(voice_id)
        except Exception as error:
            raise TtsLoadError("로컬 TTS 화자 스타일을 불러오지 못했습니다.") from error
        _VOICE_STYLES[key] = style
    return style


def _audio_to_wav(audio: Any, sample_rate: int) -> bytes:
    try:
        values = audio.reshape(-1)
    except AttributeError:
        values = audio[0] if audio and isinstance(audio[0], (list, tuple)) else audio
    samples = [max(-1.0, min(1.0, float(value))) for value in values]
    if not samples or sample_rate <= 0:
        raise TtsSynthesisError("로컬 TTS가 빈 음성을 반환했습니다.")

    pcm = array("h", (int(value * 32767) for value in samples))
    if sys.byteorder != "little":
        pcm.byteswap()
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()


@lru_cache(maxsize=20)
def _read_fixed_guide(path: str) -> bytes:
    try:
        audio = Path(path).read_bytes()
    except OSError as error:
        raise TtsGuideUnavailable("준비된 로컬 TTS 안내 음성이 없습니다.") from error
    if not audio:
        raise TtsGuideUnavailable("준비된 로컬 TTS 안내 음성이 비어 있습니다.")
    return audio


def _synthesize_question(text: str, config: _TtsConfig, voice_id: str) -> bytes:
    _validate_voice(voice_id)
    _ensure_model_files(config, voice_id)
    try:
        with _ENGINE_LOCK:
            engine = _get_engine_locked(config)
            style = _get_voice_style_locked(config, engine, voice_id)
            audio, _ = engine.synthesize(
                text,
                voice_style=style,
                total_steps=config.steps,
                speed=config.speed,
                max_chunk_length=120,
                lang="ko",
                verbose=False,
            )
            return _audio_to_wav(audio, int(engine.sample_rate))
    except (TtsNotConfigured, TtsInvalidVoice, TtsLoadError, TtsSynthesisError):
        raise
    except Exception as error:
        raise TtsSynthesisError("로컬 TTS 합성에 실패했습니다.") from error


def synthesize_guide(text: str, voice_id: str | None = None) -> bytes:
    """Return a WAV without storing applicant-derived question audio."""
    cleaned = " ".join(text.split())
    if not cleaned:
        raise ValueError("TTS 텍스트가 비어 있습니다.")

    config = _load_config()
    selected_voice = _validate_voice(voice_id or config.default_voice_id)
    if cleaned in FIXED_GUIDE_TEXTS:
        guide_path = config.model_dir / "guides" / selected_voice / _GUIDE_FILES[cleaned]
        return _read_fixed_guide(str(guide_path))
    return _synthesize_question(cleaned, config, selected_voice)
