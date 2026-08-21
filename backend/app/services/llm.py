"""Shared Anthropic client and call helpers for every LLM-backed feature.

This module is the single place that talks to the Anthropic API. Feature
services (:mod:`app.services.essay`, ``personalize``, ``answer_review``) build a
prompt, call one of the helpers here, and translate failures into whatever
fallback their own contract requires.

Which ``plan.md`` §14 principles live here:

* §14-3 — prompt text lives in :mod:`app.prompts`, API calls live here; neither
  is reachable from UI code.
* §14-5 — the key is read from ``.env`` via :func:`app.config.get_settings`.
* §14-6 — JSON is validated by construction: :func:`call_structured` uses the
  SDK's structured-output support, so a malformed payload can never reach a
  caller as a dict.
* §14-7 — every failure surfaces as :class:`LLMError`. Callers decide the
  fallback (see ``docs/plan-A.md`` §4.5); nothing here crashes a session.
* §14-8 — the client is built once per process, not once per question.

Call conventions (``docs/plan-A.md`` §4.4) — violating these returns HTTP 400:

* Never pass ``temperature`` / ``top_p`` / ``top_k``. Non-default values are
  rejected on ``claude-sonnet-5``; steer tone through the prompt instead.
* Never pass ``thinking``. Omitting it runs adaptive thinking, which is what we
  want; the old ``budget_tokens`` form no longer exists.
* Never prefill an assistant turn to force JSON — that is what ``output_format``
  is for.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, Literal, TypeVar

import anthropic
from pydantic import BaseModel

from app.config import get_settings

logger = logging.getLogger(__name__)

SchemaT = TypeVar("SchemaT", bound=BaseModel)

Effort = Literal["low", "medium", "high"]

# Generous by default: a truncated response is worse than a slightly costlier
# one, and analysis outputs (experiences x weaknesses x questions) get long.
DEFAULT_MAX_TOKENS = 16_000
# Single-sentence outputs (question personalization) need almost nothing.
DEFAULT_TEXT_MAX_TOKENS = 512

# The SDK already retries transport failures (429 / 5xx / connection) on its
# own, so this counter only covers the one failure it cannot see: a response
# that came back cleanly but did not satisfy the requested schema.
_SCHEMA_ATTEMPTS = 2


class LLMError(RuntimeError):
    """Base class for every failure raised out of this module."""


class LLMNotConfiguredError(LLMError):
    """``ANTHROPIC_API_KEY`` is missing, so no call can be attempted."""


class LLMCallError(LLMError):
    """The call was attempted and did not produce a usable result."""


@lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    """Return the process-wide Anthropic client (§14-8).

    Raises:
        LLMNotConfiguredError: if no API key is configured.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise LLMNotConfiguredError(
            "ANTHROPIC_API_KEY가 설정되지 않았습니다. backend/.env를 확인해 주세요."
        )
    # max_retries covers transient transport failures; schema misses are
    # retried separately in call_structured.
    return anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=2)


def is_configured() -> bool:
    """Return whether an API key is present, without raising.

    Routers use this to answer "LLM 미설정" cleanly instead of surfacing a 500.
    """
    return bool(get_settings().anthropic_api_key)


def _output_config(effort: Effort | None) -> dict[str, Any] | None:
    """Build ``output_config`` for the given effort, or ``None`` to omit it."""
    return {"effort": effort} if effort is not None else None


def call_structured(
    *,
    model: str,
    system: str,
    user: str,
    output_format: type[SchemaT],
    max_tokens: int = DEFAULT_MAX_TOKENS,
    effort: Effort | None = None,
) -> SchemaT:
    """Call the model and return a validated ``output_format`` instance.

    The schema is enforced server-side, so there is no ``json.loads`` to fail
    and no partial dict to defend against — the caller either gets a valid
    model instance or an :class:`LLMError`.

    Raises:
        LLMNotConfiguredError: if no API key is configured.
        LLMCallError: on API failure, or if the response did not satisfy the
            schema on either attempt.
    """
    client = get_client()
    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "output_format": output_format,
    }
    config = _output_config(effort)
    if config is not None:
        kwargs["output_config"] = config

    for attempt in range(1, _SCHEMA_ATTEMPTS + 1):
        try:
            response = client.messages.parse(**kwargs)
        except anthropic.BadRequestError as error:
            # A 400 means the request we built is wrong (unsupported parameter,
            # bad schema). Retrying sends the same broken request, so stop.
            raise LLMCallError(f"LLM 요청이 거부되었습니다: {error}") from error
        except anthropic.APIError as error:
            raise LLMCallError(f"LLM 호출에 실패했습니다: {error}") from error

        parsed = response.parsed_output
        if parsed is not None:
            return parsed

        logger.warning(
            "LLM structured output did not match %s (attempt %d/%d, stop_reason=%s)",
            output_format.__name__,
            attempt,
            _SCHEMA_ATTEMPTS,
            response.stop_reason,
        )

    raise LLMCallError(
        f"LLM 응답이 {output_format.__name__} 스키마를 만족하지 않았습니다."
    )


def call_text(
    *,
    model: str,
    system: str,
    user: str,
    max_tokens: int = DEFAULT_TEXT_MAX_TOKENS,
    effort: Effort | None = None,
) -> str:
    """Call the model and return its text output, stripped.

    Used where the expected output is a single short string (question
    personalization) and a JSON envelope would only add cost. Callers are
    responsible for validating the shape of that string.

    Raises:
        LLMNotConfiguredError: if no API key is configured.
        LLMCallError: on API failure, or if the response contained no text.
    """
    client = get_client()
    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    config = _output_config(effort)
    if config is not None:
        kwargs["output_config"] = config

    try:
        response = client.messages.create(**kwargs)
    except anthropic.BadRequestError as error:
        raise LLMCallError(f"LLM 요청이 거부되었습니다: {error}") from error
    except anthropic.APIError as error:
        raise LLMCallError(f"LLM 호출에 실패했습니다: {error}") from error

    # content is a list of blocks; only text blocks carry output. Thinking
    # blocks may precede them, so filter rather than indexing [0].
    text = "".join(
        block.text for block in response.content if getattr(block, "type", None) == "text"
    ).strip()
    if not text:
        raise LLMCallError("LLM이 빈 응답을 반환했습니다.")
    return text
