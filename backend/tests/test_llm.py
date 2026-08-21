"""Small contract test for the validated LLM JSON boundary."""

from __future__ import annotations

from types import SimpleNamespace

from pydantic import BaseModel

from app.services import llm


class _Payload(BaseModel):
    value: int


class _Response:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, list[dict[str, str]]]:
        return {"content": [{"type": "text", "text": "```json\n{\"value\": 7}\n```"}]}


def test_request_json_strips_fence_and_validates(monkeypatch) -> None:
    monkeypatch.setattr(
        llm,
        "get_settings",
        lambda: SimpleNamespace(
            anthropic_api_key="test-key",
            anthropic_api_url="https://example.test/messages",
            llm_timeout=1,
        ),
    )
    monkeypatch.setattr(llm.httpx, "post", lambda *args, **kwargs: _Response())

    result = llm.request_json(
        _Payload,
        system="return JSON",
        user="{}",
        model="test-model",
    )

    assert result.value == 7
