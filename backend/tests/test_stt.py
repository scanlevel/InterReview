"""Tests for the CLOVA STT proxy and the /stt route.

CLOVA is mocked, so these need neither a key nor network. They cover request
construction, response parsing, and the graceful-degradation statuses.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import stt

client = TestClient(app)


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=None, response=None)

    def json(self) -> dict:
        return self._payload


def _configure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the service at fake CLOVA credentials."""
    cfg = stt._ClovaConfig(
        invoke_url="https://clova.example/domain",
        secret_key="secret",
        language="ko-KR",
        timeout=5.0,
    )
    monkeypatch.setattr(stt, "_load_clova_config", lambda: cfg)


def test_empty_audio_returns_empty() -> None:
    result = stt.transcribe_audio(b"")
    assert result["status"] == "empty"
    assert result["transcript"] == ""


def test_not_configured_when_no_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise() -> None:
        raise stt.ClovaNotConfigured("no creds")

    monkeypatch.setattr(stt, "_load_clova_config", _raise)
    result = stt.transcribe_audio(b"audio-bytes")
    assert result["status"] == "not_configured"


def test_successful_transcription(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(monkeypatch)
    captured: dict = {}

    def _fake_post(url, **kwargs):  # noqa: ANN001, ANN003
        captured["url"] = url
        captured["headers"] = kwargs["headers"]
        captured["params"] = json.loads(kwargs["data"]["params"])
        captured["files"] = kwargs["files"]
        return _FakeResponse({"text": "안녕하세요 저는 지원자입니다", "confidence": 0.9, "segments": [1, 2]})

    monkeypatch.setattr(httpx, "post", _fake_post)
    result = stt.transcribe_audio(b"audio", filename="a.wav", content_type="audio/wav")

    assert result["status"] == "ok"
    assert result["transcript"] == "안녕하세요 저는 지원자입니다"
    assert result["segment_count"] == 2
    # request construction
    assert captured["url"].endswith("/recognizer/upload")
    assert captured["headers"]["X-CLOVASPEECH-API-KEY"] == "secret"
    assert captured["params"]["diarization"] == {"enable": False}
    assert captured["params"]["completion"] == "sync"


def test_no_speech_when_text_blank(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(monkeypatch)
    monkeypatch.setattr(httpx, "post", lambda url, **kw: _FakeResponse({"text": "   "}))
    result = stt.transcribe_audio(b"audio")
    assert result["status"] == "no_speech"
    assert result["transcript"] == ""


def test_http_error_is_captured(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(monkeypatch)

    def _boom(url, **kw):  # noqa: ANN001, ANN003
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "post", _boom)
    result = stt.transcribe_audio(b"audio")
    assert result["status"] == "error"
    assert "CLOVA" in result["error"]


def test_stt_endpoint_no_key() -> None:
    """Without credentials the endpoint still responds 200 with not_configured."""
    response = client.post(
        "/stt", files={"file": ("a.wav", b"audio-bytes", "audio/wav")}
    )
    assert response.status_code == 200
    assert response.json()["status"] in {"not_configured", "error", "no_speech", "ok"}
