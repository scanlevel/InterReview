"""Tests for local CPU TTS and its fixed guide cache."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import tts as tts_router
from app.services import tts


client = TestClient(app)


def _config(model_dir: Path) -> tts._TtsConfig:
    return tts._TtsConfig(model_dir=model_dir, num_threads=2)


def _prepare_model_files(model_dir: Path, voice_id: str = "M1") -> None:
    for relative in tts._MODEL_FILES:
        path = model_dir / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"model")
    voice = model_dir / "voice_styles" / (voice_id + ".json")
    voice.parent.mkdir(parents=True, exist_ok=True)
    voice.write_bytes(b"voice")


def test_questions_use_one_lazy_engine_and_return_wav(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config = _config(tmp_path)
    _prepare_model_files(tmp_path)
    load_calls = 0
    style_calls: list[str] = []
    synthesis_calls = 0

    class FakeEngine:
        sample_rate = 22_050

        def get_voice_style(self, voice_id: str) -> object:
            style_calls.append(voice_id)
            return {"voice": voice_id}

        def synthesize(
            self,
            text: str,
            *,
            voice_style: object,
            total_steps: int,
            speed: float,
            max_chunk_length: int,
            lang: str,
            verbose: bool,
        ) -> tuple[list[float], None]:
            nonlocal synthesis_calls
            synthesis_calls += 1
            assert text == "질문을 읽어 주세요."
            assert voice_style == {"voice": "M1"}
            assert total_steps == 8
            assert speed == 1.05
            assert max_chunk_length == 120
            assert lang == "ko"
            assert verbose is False
            return [0.0, 0.5, -0.5, 0.0], None

    def load_engine(_: tts._TtsConfig) -> FakeEngine:
        nonlocal load_calls
        load_calls += 1
        return FakeEngine()

    monkeypatch.setattr(tts, "_load_config", lambda: config)
    monkeypatch.setattr(tts, "_load_engine", load_engine)
    monkeypatch.setattr(tts, "_ENGINE", None)
    monkeypatch.setattr(tts, "_ENGINE_KEY", None)
    tts._VOICE_STYLES.clear()

    first = tts.synthesize_guide("질문을 읽어 주세요.", "M1")
    second = tts.synthesize_guide("질문을 읽어 주세요.", "M1")

    assert first.startswith(b"RIFF")
    assert b"WAVE" in first[:16]
    assert second == first
    assert load_calls == 1
    assert synthesis_calls == 2
    assert style_calls == ["M1"]


def test_prepared_guides_are_reused_per_voice_without_model_inference(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    guide = tmp_path / "guides" / "F2" / "start.wav"
    guide.parent.mkdir(parents=True)
    guide.write_bytes(b"RIFF-prepared-wav")
    monkeypatch.setattr(tts, "_load_config", lambda: _config(tmp_path))
    monkeypatch.setattr(
        tts, "_load_engine", lambda _: pytest.fail("fixed guide must not infer")
    )
    tts._read_fixed_guide.cache_clear()

    assert tts.synthesize_guide("시작하세요.", "F2") == b"RIFF-prepared-wav"
    assert tts.synthesize_guide("시작하세요.", "F2") == b"RIFF-prepared-wav"


def test_tts_endpoint_returns_wav_and_no_store_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        tts_router,
        "synthesize_guide",
        lambda text, voice_id=None: b"RIFF-wav",
    )

    response = client.post("/tts", json={"text": "질문을 읽어 주세요.", "voice_id": "F3"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b"RIFF-wav"


def test_tts_rejects_unknown_voice() -> None:
    response = client.post("/tts", json={"text": "질문", "voice_id": "unknown"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_voice"


@pytest.mark.parametrize("text", ["", "x" * 2_001])
def test_tts_rejects_empty_or_oversized_text(text: str) -> None:
    response = client.post("/tts", json={"text": text})
    assert response.status_code == 422


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (tts.TtsNotConfigured("missing"), "model_missing"),
        (tts.TtsGuideUnavailable("guide"), "guide_missing"),
        (tts.TtsLoadError("load"), "model_load"),
        (tts.TtsSynthesisError("synthesis"), "synthesis"),
    ],
)
def test_tts_errors_return_diagnostic_codes(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    error: Exception,
    code: str,
) -> None:
    def raise_missing(_: str, _voice_id: str | None = None) -> bytes:
        raise error

    monkeypatch.setattr(tts_router, "synthesize_guide", raise_missing)

    caplog.set_level("ERROR")
    response = client.post("/tts", json={"text": "비밀 질문 원문"})

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == code
    assert "비밀 질문 원문" not in caplog.text
    assert f"code={code}" in caplog.text
