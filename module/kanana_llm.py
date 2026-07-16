"""Shared, lazily loaded Kanana LLM service for interview features."""

from __future__ import annotations

import json
import os
import threading
from functools import lru_cache
from typing import Any


DEFAULT_MODEL_ID = "kakaocorp/kanana-nano-2.1b-instruct"


class KananaLLMError(RuntimeError):
    """Raised when the configured Kanana model cannot be loaded or used."""


class KananaLLM:
    """A reusable Kanana inference service shared by personalization and analysis."""

    def __init__(self, tokenizer: Any, model: Any, torch_module: Any, device: str, dtype_name: str) -> None:
        self.tokenizer = tokenizer
        self.model = model
        self.torch = torch_module
        self.device = device
        self.dtype_name = dtype_name
        self._generation_lock = threading.Lock()

    def generate(self, messages: list[dict[str, str]], max_new_tokens: int = 512) -> str:
        """Generate one completion from chat-template messages without sampling."""
        if not messages:
            raise KananaLLMError("Kanana 생성에는 하나 이상의 메시지가 필요합니다.")
        try:
            input_ids = self.tokenizer.apply_chat_template(
                messages,
                tokenize=True,
                add_generation_prompt=True,
                return_tensors="pt",
            ).to(self.device)
            generation_kwargs: dict[str, Any] = {
                "max_new_tokens": max_new_tokens,
                "do_sample": False,
                "repetition_penalty": 1.08,
                "no_repeat_ngram_size": 6,
            }
            if self.tokenizer.eos_token_id is not None:
                generation_kwargs["pad_token_id"] = self.tokenizer.eos_token_id
            with self._generation_lock, self.torch.inference_mode():
                outputs = self.model.generate(input_ids, **generation_kwargs)
            return self.tokenizer.decode(outputs[0][input_ids.shape[-1] :], skip_special_tokens=True).strip()
        except Exception as error:
            raise KananaLLMError("Kanana 생성에 실패했습니다.") from error

    def analyze_context(self, context: dict[str, Any] | list[Any] | str, instruction: str, max_new_tokens: int = 512) -> str:
        """Analyze arbitrary interview context with the already loaded LLM.

        Future modules can use this method for answer feedback, follow-up
        question planning, or interview-summary analysis without loading a
        second model instance.
        """
        rendered_context = context if isinstance(context, str) else json.dumps(context, ensure_ascii=False)
        return self.generate(
            [
                {"role": "system", "content": "You are a careful Korean interview analysis assistant."},
                {"role": "user", "content": f"지시:\n{instruction}\n\n문맥:\n{rendered_context}"},
            ],
            max_new_tokens=max_new_tokens,
        )


def _resolve_device(torch_module: Any) -> str:
    """Resolve the requested inference device, defaulting to available CUDA."""
    requested = os.environ.get("KANANA_DEVICE", "auto").strip().lower()
    if requested == "auto":
        return "cuda" if torch_module.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch_module.cuda.is_available():
        raise KananaLLMError("KANANA_DEVICE=cuda이지만 CUDA를 사용할 수 없습니다.")
    if requested not in {"cpu", "cuda"}:
        raise KananaLLMError("KANANA_DEVICE는 auto, cpu, cuda 중 하나여야 합니다.")
    return requested


def _resolve_dtype(torch_module: Any) -> tuple[Any, str]:
    """Resolve model precision; BF16 is the default half-precision setting."""
    requested = os.environ.get("KANANA_DTYPE", "bfloat16").strip().lower()
    options = {
        "bfloat16": torch_module.bfloat16,
        "float16": torch_module.float16,
        "float32": torch_module.float32,
    }
    if requested not in options:
        raise KananaLLMError("KANANA_DTYPE은 bfloat16, float16, float32 중 하나여야 합니다.")
    return options[requested], requested


@lru_cache(maxsize=1)
def get_kanana_llm() -> KananaLLM:
    """Load and cache one BF16 Kanana model instance for the whole app process.

    By default, the official instruct model is loaded in ``bfloat16``. Set
    ``KANANA_DEVICE=cpu`` for CPU inference or ``KANANA_DTYPE=float32`` only
    when a CPU/runtime cannot execute BF16 operations.
    """
    enabled = os.environ.get("KANANA_ENABLED", "false").strip().lower()
    if enabled not in {"1", "true", "yes", "on"}:
        raise KananaLLMError(
            "Kanana is disabled for this deployment. Set KANANA_ENABLED=true to enable it."
        )

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as error:
        raise KananaLLMError("Kanana 사용에는 torch와 transformers가 필요합니다.") from error

    model_id = os.environ.get("KANANA_MODEL_ID", DEFAULT_MODEL_ID)
    device = _resolve_device(torch)
    dtype, dtype_name = _resolve_dtype(torch)
    try:
        tokenizer = AutoTokenizer.from_pretrained(model_id)
        model = AutoModelForCausalLM.from_pretrained(
            model_id,
            torch_dtype=dtype,
            trust_remote_code=True,
        ).to(device)
        model.eval()
    except Exception as error:
        raise KananaLLMError(f"Kanana 모델을 불러오지 못했습니다: {model_id}") from error
    return KananaLLM(tokenizer, model, torch, device, dtype_name)
