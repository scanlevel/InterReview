"""Prompt text for every LLM-backed feature, kept out of service and UI code.

``plan.md`` §14-3 requires prompts to be separable from the code that calls the
API. Each module here exposes a ``*_SYSTEM_PROMPT`` constant plus a
``build_user_prompt`` function that takes plain values — no Pydantic models, no
FastAPI types — so prompts stay editable without touching the request path.
"""
