"""Small Anthropic JSON client shared by Track B services."""

from __future__ import annotations

import json
import re
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings

ModelT = TypeVar("ModelT", bound=BaseModel)


class LLMError(RuntimeError):
    """Raised when the provider response cannot be used."""


def _json_text(text: str) -> str:
    """Strip common markdown wrapping while keeping the payload strict."""
    cleaned = text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1).strip()
    return cleaned


def request_json(
    response_model: type[ModelT],
    *,
    system: str,
    user: str,
    model: str,
    max_tokens: int = 2048,
    attempts: int = 2,
) -> ModelT:
    """Ask Anthropic for JSON and validate it, retrying one malformed response."""
    settings = get_settings()
    api_key = (settings.anthropic_api_key or "").strip()
    if not api_key:
        raise LLMError("ANTHROPIC_API_KEY가 설정되지 않았습니다.")

    body: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    last_error: Exception | None = None

    for _ in range(max(1, attempts)):
        try:
            response = httpx.post(
                settings.anthropic_api_url,
                headers=headers,
                json=body,
                timeout=settings.llm_timeout,
            )
            response.raise_for_status()
            payload = response.json()
            content = payload.get("content") if isinstance(payload, dict) else None
            text = "".join(
                item.get("text", "")
                for item in content or []
                if isinstance(item, dict) and item.get("type") == "text"
            )
            if not text.strip():
                raise LLMError("LLM 응답에 JSON 텍스트가 없습니다.")
            decoded = json.loads(_json_text(text))
            return response_model.model_validate(decoded)
        except (httpx.HTTPError, ValueError, ValidationError, LLMError) as error:
            last_error = error

    raise LLMError(f"LLM JSON 응답을 사용할 수 없습니다: {last_error}") from last_error
