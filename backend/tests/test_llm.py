"""Tests for the shared LLM layer.

The Anthropic client is faked, so these need neither a key nor network. They
cover the three things the rest of the A-part work depends on:

* configuration errors surface as :class:`LLMNotConfiguredError`, not a 500;
* schema misses are retried exactly once and then fail loudly (§14-6);
* the request we build never contains a parameter that returns HTTP 400
  (``docs/plan-A.md`` §4.4) — this is the guard that keeps the other services
  from silently regressing into a 400 on every call.
"""

from __future__ import annotations

from typing import Any

import anthropic
import httpx2
import pytest
from pydantic import BaseModel

from app.config import get_settings
from app.services import llm


class _Sample(BaseModel):
    value: str


class _FakeParsed:
    """Stands in for ``ParsedMessage``: only ``parsed_output`` is read."""

    def __init__(self, parsed: _Sample | None) -> None:
        self.parsed_output = parsed
        self.stop_reason = "end_turn"


class _FakeBlock:
    def __init__(self, type_: str, text: str = "") -> None:
        self.type = type_
        self.text = text


class _FakeMessage:
    def __init__(self, blocks: list[_FakeBlock]) -> None:
        self.content = blocks


class _FakeMessages:
    """Records every call so tests can assert on attempt counts and kwargs."""

    def __init__(self, results: list[Any]) -> None:
        self._results = list(results)
        self.calls: list[dict[str, Any]] = []

    def _next(self, kwargs: dict[str, Any]) -> Any:
        self.calls.append(kwargs)
        result = self._results.pop(0) if self._results else None
        if isinstance(result, Exception):
            raise result
        return result

    def parse(self, **kwargs: Any) -> Any:
        return self._next(kwargs)

    def create(self, **kwargs: Any) -> Any:
        return self._next(kwargs)


class _FakeClient:
    def __init__(self, results: list[Any]) -> None:
        self.messages = _FakeMessages(results)


def _install(monkeypatch: pytest.MonkeyPatch, *results: Any) -> _FakeClient:
    """Replace the cached client with a fake returning ``results`` in order."""
    client = _FakeClient(list(results))
    monkeypatch.setattr(llm, "get_client", lambda: client)
    return client


def _bad_request() -> anthropic.BadRequestError:
    response = httpx2.Response(400, request=httpx2.Request("POST", "https://api.test/v1"))
    return anthropic.BadRequestError("unsupported parameter", response=response, body=None)


# --- configuration ----------------------------------------------------------


def test_get_client_without_key_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    llm.get_client.cache_clear()
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(
        llm, "get_settings", lambda: type("S", (), {"anthropic_api_key": None})()
    )
    with pytest.raises(llm.LLMNotConfiguredError):
        llm.get_client()


def test_is_configured_reflects_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        llm, "get_settings", lambda: type("S", (), {"anthropic_api_key": "sk-test"})()
    )
    assert llm.is_configured() is True


# --- structured calls -------------------------------------------------------


def test_call_structured_returns_validated_model(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, _FakeParsed(_Sample(value="ok")))
    result = llm.call_structured(
        model="m", system="s", user="u", output_format=_Sample
    )
    assert result.value == "ok"


def test_call_structured_retries_once_on_schema_miss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _install(monkeypatch, _FakeParsed(None), _FakeParsed(_Sample(value="ok")))
    result = llm.call_structured(
        model="m", system="s", user="u", output_format=_Sample
    )
    assert result.value == "ok"
    assert len(client.messages.calls) == 2


def test_call_structured_gives_up_after_one_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _install(monkeypatch, _FakeParsed(None), _FakeParsed(None))
    with pytest.raises(llm.LLMCallError):
        llm.call_structured(model="m", system="s", user="u", output_format=_Sample)
    assert len(client.messages.calls) == 2


def test_call_structured_does_not_retry_bad_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 400 means our request is malformed; retrying it is pure waste."""
    client = _install(monkeypatch, _bad_request(), _FakeParsed(_Sample(value="ok")))
    with pytest.raises(llm.LLMCallError):
        llm.call_structured(model="m", system="s", user="u", output_format=_Sample)
    assert len(client.messages.calls) == 1


def test_call_structured_omits_parameters_that_return_400(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Guard for docs/plan-A.md §4.4.

    ``temperature`` / ``top_p`` / ``top_k`` and the old ``thinking`` form are
    rejected on claude-sonnet-5, and an assistant prefill is rejected outright.
    """
    client = _install(monkeypatch, _FakeParsed(_Sample(value="ok")))
    llm.call_structured(model="m", system="s", user="u", output_format=_Sample)

    sent = client.messages.calls[0]
    for forbidden in ("temperature", "top_p", "top_k", "thinking"):
        assert forbidden not in sent
    assert [m["role"] for m in sent["messages"]] == ["user"]


def test_call_structured_passes_effort_only_when_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _install(monkeypatch, _FakeParsed(_Sample(value="ok")))
    llm.call_structured(model="m", system="s", user="u", output_format=_Sample)
    assert "output_config" not in client.messages.calls[0]

    client = _install(monkeypatch, _FakeParsed(_Sample(value="ok")))
    llm.call_structured(
        model="m", system="s", user="u", output_format=_Sample, effort="low"
    )
    assert client.messages.calls[0]["output_config"] == {"effort": "low"}


# --- text calls -------------------------------------------------------------


def test_call_text_joins_text_blocks_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """Thinking blocks can precede text, so indexing content[0] is unsafe."""
    _install(
        monkeypatch,
        _FakeMessage([_FakeBlock("thinking"), _FakeBlock("text", "  질문입니다?  ")]),
    )
    assert llm.call_text(model="m", system="s", user="u") == "질문입니다?"


def test_call_text_raises_on_empty_response(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, _FakeMessage([_FakeBlock("text", "   ")]))
    with pytest.raises(llm.LLMCallError):
        llm.call_text(model="m", system="s", user="u")


def test_call_text_wraps_api_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, _bad_request())
    with pytest.raises(llm.LLMCallError):
        llm.call_text(model="m", system="s", user="u")
