"""Shared provider-neutral client and call helpers for every LLM-backed feature.

This module is the single place that talks to external LLM APIs. Feature
services (:mod:`app.services.essay`, ``personalize``, ``answer_review``) build a
prompt, call one of the helpers here, and translate failures into whatever
fallback their own contract requires.

Which ``plan.md`` §14 principles live here:

* §14-3 — prompt text lives in :mod:`app.prompts`, API calls live here; neither
  is reachable from UI code.
* §14-5 — the key is read from ``.env`` via :func:`app.config.get_settings`.
* §14-6 — JSON is validated by construction: :func:`call_structured` uses
  provider-native schema output where available and Pydantic validation in all
  provider paths.
* §14-7 — every failure surfaces as :class:`LLMError`. Callers decide the
  fallback (see ``docs/plan-A.md`` §4.5); nothing here crashes a session.
* §14-8 — the client is built once per process, not once per question.

Call conventions (``docs/plan-A.md`` §4.4) — violating these returns HTTP 400:

* Never pass ``temperature`` / ``top_p`` / ``top_k``. Non-default values are
  rejected on ``claude-sonnet-5``; steer tone through the prompt instead.
* Gemini/Gemma requests explicitly set ``thinking_level=minimal``. For Gemma 4
  this is the API's off mode; no thinking output is requested.
* Never prefill an assistant turn to force JSON — that is what ``output_format``
  is for.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from functools import lru_cache, wraps
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Any, Callable, Literal, TypeVar

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
_GEMINI_MAX_OUTPUT_TOKENS = 8_192

# The SDK already retries transport failures (429 / 5xx / connection) on its
# own, so this counter only covers the one failure it cannot see: a response
# that came back cleanly but did not satisfy the requested schema.
_SCHEMA_ATTEMPTS = 2
_FAILURE_LOG_PATH = Path(__file__).resolve().parents[3] / "docs" / "log.txt"
_FAILURE_LOG_LOCK = Lock()


def _gemini_config(system: str, max_tokens: int) -> dict[str, Any]:
    """Build the shared no-tools, no-thinking Gemini generation config."""
    return {
        "system_instruction": system,
        # Gemma 4 31B intermittently returns 500 on large output reservations.
        # The largest response used here is essay JSON, which fits comfortably.
        "max_output_tokens": min(max_tokens, _GEMINI_MAX_OUTPUT_TOKENS),
        # Gemma 4 documents MINIMAL as the disabled-thinking setting.
        "thinking_config": {"thinking_level": "minimal"},
    }


class LLMError(RuntimeError):
    """Base class for every failure raised out of this module."""


class LLMNotConfiguredError(LLMError):
    """The selected provider's API key is missing."""


class LLMCallError(LLMError):
    """The call was attempted and did not produce a usable result."""

    def __init__(
        self,
        message: str,
        *,
        prompt: str | None = None,
        answer: str | None = None,
    ) -> None:
        super().__init__(message)
        self.prompt = prompt
        self.answer = answer


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


@lru_cache(maxsize=1)
def get_gemini_client() -> Any:
    """Return the process-wide Gemini client without importing it for Anthropic."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise LLMNotConfiguredError(
            "GEMINI_API_KEY가 설정되지 않았습니다. backend/.env를 확인해 주세요."
        )
    try:
        from google import genai

        return genai.Client(
            api_key=settings.gemini_api_key,
            http_options={
                "timeout": 90_000,
                # Includes the initial request. Gemma 4 31B can return transient
                # 500s for an otherwise valid request, so allow four retries.
                "retry_options": {"attempts": 5},
            },
        )
    except Exception as error:
        raise LLMCallError(f"Gemini client를 초기화하지 못했습니다: {error}") from error


def _provider() -> str:
    """Return the configured provider; old test doubles default to Anthropic."""
    return getattr(get_settings(), "llm_provider", "anthropic")


def _format_prompt(system: str, user: str) -> str:
    return f"[system]\n{system}\n\n[user]\n{user}"


def _append_failure_log(
    *,
    provider: str,
    model: str,
    kind: str,
    input_at: datetime,
    prompt: str,
    wait_ms: float,
    answer: str | None,
    reason: str,
) -> None:
    """Append one complete failed-call record without affecting the request."""
    record = "\n".join(
        (
            "===== LLM CALL FAILURE =====",
            f"input_time: {input_at.isoformat(timespec='milliseconds')}",
            f"provider: {provider}",
            f"model: {model}",
            f"kind: {kind}",
            f"wait_ms: {wait_ms:.0f}",
            "input_prompt:",
            prompt or "(없음)",
            "answer:",
            answer or "(응답 없음)",
            f"failure_reason: {reason}",
            "===== END LLM CALL FAILURE =====",
            "",
        )
    )
    try:
        _FAILURE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        # ponytail: one process-wide lock keeps concurrent personalization records intact;
        # use a dedicated writer only if multiple backend processes write this file.
        with _FAILURE_LOG_LOCK:
            with _FAILURE_LOG_PATH.open(
                "a", encoding="utf-8", newline=""
            ) as log_file:
                log_file.write(record)
    except OSError as error:
        logger.error(
            "LLM failure log write failed path=%s error_type=%s",
            _FAILURE_LOG_PATH,
            type(error).__name__,
        )


def record_failure(
    *,
    model: str,
    kind: str,
    prompt: str,
    answer: str | None,
    reason: str,
    input_at: datetime,
    wait_ms: float,
    provider: str | None = None,
) -> None:
    """Record a downstream validation failure using the shared log format."""
    _append_failure_log(
        provider=provider or _provider(),
        model=model,
        kind=kind,
        input_at=input_at,
        prompt=prompt,
        wait_ms=wait_ms,
        answer=answer,
        reason=reason,
    )


def _log_call_duration(
    *,
    started_at: float,
    provider: str,
    model: str,
    kind: str,
    output: str,
    error: Exception | None = None,
) -> None:
    """Log one logical LLM call without logging prompts or response contents."""
    elapsed_ms = (perf_counter() - started_at) * 1_000
    if error is None:
        logger.info(
            "llm_call completed provider=%s model=%s kind=%s output=%s elapsed_ms=%.0f",
            provider,
            model,
            kind,
            output,
            elapsed_ms,
        )
    else:
        logger.warning(
            "llm_call failed provider=%s model=%s kind=%s output=%s "
            "error_type=%s elapsed_ms=%.0f",
            provider,
            model,
            kind,
            output,
            type(error).__name__,
            elapsed_ms,
        )


def _timed_llm_call(kind: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorate a public helper so its total provider time is logged once."""
    def decorator(function: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(function)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            started_at = perf_counter()
            input_at = datetime.now().astimezone()
            provider = "unknown"
            error: Exception | None = None
            model = str(kwargs.get("model", "unknown"))
            prompt = _format_prompt(
                str(kwargs.get("system", "")), str(kwargs.get("user", ""))
            )
            output = (
                getattr(kwargs.get("output_format"), "__name__", "structured")
                if kind == "structured"
                else "text"
            )
            try:
                provider = _provider()
                return function(*args, **kwargs)
            except Exception as caught:
                error = caught
                raise
            finally:
                _log_call_duration(
                    started_at=started_at,
                    provider=provider,
                    model=model,
                    kind=kind,
                    output=output,
                    error=error,
                )
                if error is not None:
                    _append_failure_log(
                        provider=provider,
                        model=model,
                        kind=kind,
                        input_at=input_at,
                        prompt=str(getattr(error, "prompt", None) or prompt),
                        wait_ms=(perf_counter() - started_at) * 1_000,
                        answer=getattr(error, "answer", None),
                        reason=f"{type(error).__name__}: {error}",
                    )

        return wrapped

    return decorator


def is_configured() -> bool:
    """Return whether an API key is present, without raising.

    Routers use this to answer "LLM 미설정" cleanly instead of surfacing a 500.
    """
    settings = get_settings()
    key = (
        getattr(settings, "gemini_api_key", None)
        if getattr(settings, "llm_provider", "anthropic") == "gemini"
        else getattr(settings, "anthropic_api_key", None)
    )
    return bool(key)


def _output_config(effort: Effort | None) -> dict[str, Any] | None:
    """Build ``output_config`` for the given effort, or ``None`` to omit it."""
    return {"effort": effort} if effort is not None else None


@_timed_llm_call("structured")
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

    Anthropic enforces the schema server-side. Gemini/Gemma receives the schema
    as a JSON instruction and the response is validated locally. Either way,
    callers receive a valid model instance or an :class:`LLMError`.

    Raises:
        LLMNotConfiguredError: if no API key is configured.
        LLMCallError: on API failure, or if the response did not satisfy the
            schema on either attempt.
    """
    if _provider() == "gemini":
        return _call_gemini_structured(
            model=model,
            system=system,
            user=user,
            output_format=output_format,
            max_tokens=max_tokens,
        )

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

    last_answer = ""
    for attempt in range(1, _SCHEMA_ATTEMPTS + 1):
        try:
            response = client.messages.parse(**kwargs)
        except anthropic.BadRequestError as error:
            # A 400 means the request we built is wrong (unsupported parameter,
            # bad schema). Retrying sends the same broken request, so stop.
            raise LLMCallError(
                f"LLM 요청이 거부되었습니다: {error}",
                prompt=_format_prompt(system, user),
            ) from error
        except anthropic.APIError as error:
            raise LLMCallError(
                f"LLM 호출에 실패했습니다: {error}",
                prompt=_format_prompt(system, user),
            ) from error

        last_answer = "".join(
            block.text
            for block in getattr(response, "content", ())
            if getattr(block, "type", None) == "text"
        ).strip()

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
        f"LLM 응답이 {output_format.__name__} 스키마를 만족하지 않았습니다.",
        prompt=_format_prompt(system, user),
        answer=last_answer,
    )


def _parse_gemini_structured_response(
    response: Any, output_format: type[SchemaT]
) -> SchemaT | None:
    """Return a validated model from Gemini's parsed value or JSON text."""
    try:
        parsed = response.parsed
    except Exception:
        parsed = None
    if isinstance(parsed, output_format):
        return parsed
    if parsed is not None:
        try:
            return output_format.model_validate(parsed)
        except Exception:
            pass

    try:
        text = response.text
    except Exception:
        text = None
    if text:
        text = text.strip()
        lines = text.splitlines()
        if (
            len(lines) >= 3
            and lines[0].strip().startswith("```")
            and lines[-1].strip() == "```"
        ):
            text = "\n".join(lines[1:-1]).strip()
        try:
            return output_format.model_validate_json(text)
        except Exception:
            pass
    return None


def _call_gemini_structured(
    *,
    model: str,
    system: str,
    user: str,
    output_format: type[SchemaT],
    max_tokens: int,
) -> SchemaT:
    """Call Gemini with prompted JSON and validate it as the requested model.

    Gemma 4 is supported through the Gemini API, but is not in the API's
    native structured-output model list. Keep the public Pydantic contract by
    asking for JSON in the prompt and validating the returned text locally.
    """
    client = get_gemini_client()
    schema = json.dumps(
        output_format.model_json_schema(), ensure_ascii=False, separators=(",", ":")
    )
    structured_user = (
        f"{user}\n\n"
        "위 요청에 대해 설명이나 마크다운 없이 JSON 객체만 반환하십시오. "
        f"반환 형식은 다음 JSON Schema를 따르십시오:\n{schema}"
    )
    config = _gemini_config(system, max_tokens)
    last_answer = ""
    failure_prompt = _format_prompt(system, structured_user)

    for attempt in range(1, _SCHEMA_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model=model,
                contents=structured_user,
                config=config,
            )
        except Exception as error:
            raise LLMCallError(
                f"Gemini 호출에 실패했습니다: {error}",
                prompt=failure_prompt,
                answer=last_answer,
            ) from error

        try:
            last_answer = response.text or ""
        except Exception:
            last_answer = ""

        parsed = _parse_gemini_structured_response(response, output_format)
        if parsed is not None:
            return parsed

        logger.warning(
            "Gemini structured output did not match %s (attempt %d/%d)",
            output_format.__name__,
            attempt,
            _SCHEMA_ATTEMPTS,
        )

    raise LLMCallError(
        f"LLM 응답이 {output_format.__name__} 스키마를 만족하지 않았습니다.",
        prompt=failure_prompt,
        answer=last_answer,
    )


@_timed_llm_call("text")
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
    if _provider() == "gemini":
        return _call_gemini_text(
            model=model,
            system=system,
            user=user,
            max_tokens=max_tokens,
        )

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
        raise LLMCallError(
            f"LLM 요청이 거부되었습니다: {error}",
            prompt=_format_prompt(system, user),
        ) from error
    except anthropic.APIError as error:
        raise LLMCallError(
            f"LLM 호출에 실패했습니다: {error}",
            prompt=_format_prompt(system, user),
        ) from error

    # content is a list of blocks; only text blocks carry output. Thinking
    # blocks may precede them, so filter rather than indexing [0].
    text = "".join(
        block.text for block in response.content if getattr(block, "type", None) == "text"
    ).strip()
    if not text:
        raise LLMCallError(
            "LLM이 빈 응답을 반환했습니다.",
            prompt=_format_prompt(system, user),
            answer=text,
        )
    return text


def _call_gemini_text(
    *,
    model: str,
    system: str,
    user: str,
    max_tokens: int,
) -> str:
    """Call Gemini and return its stripped text response."""
    client = get_gemini_client()
    try:
        response = client.models.generate_content(
            model=model,
            contents=user,
            config=_gemini_config(system, max_tokens),
        )
    except Exception as error:
        raise LLMCallError(
            f"Gemini 호출에 실패했습니다: {error}",
            prompt=_format_prompt(system, user),
        ) from error

    try:
        text = response.text.strip()
    except Exception as error:
        raise LLMCallError(
            "Gemini가 빈 응답을 반환했습니다.",
            prompt=_format_prompt(system, user),
        ) from error
    if not text:
        raise LLMCallError(
            "Gemini가 빈 응답을 반환했습니다.",
            prompt=_format_prompt(system, user),
            answer=text,
        )
    return text
