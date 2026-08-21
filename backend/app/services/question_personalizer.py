"""Optional LLM personalization for already-selected question-bank items."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from app.config import get_settings
from app.schemas import Question
from app.services.llm import LLMError, request_json


class PersonalizedQuestions(BaseModel):
    questions: list[str] = Field(default_factory=list)


_PROFILE_LABELS = {
    "job": "지원 직무",
    "resume_text": "자기소개·이력",
    "technologies": "기술 스택",
    "projects": "프로젝트 경험",
}


def _profile_context(profile: dict[str, Any]) -> dict[str, str]:
    return {
        label: str(profile[key]).strip()
        for key, label in _PROFILE_LABELS.items()
        if str(profile.get(key) or "").strip()
    }


def personalize_questions(
    questions: list[Question], profile: dict[str, Any]
) -> list[Question]:
    """Personalize selected questions; return originals for every LLM failure."""
    if not questions or not _profile_context(profile):
        return [question.model_copy(update={"original_text": question.text}) for question in questions]

    settings = get_settings()
    if not (settings.anthropic_api_key or "").strip():
        return [question.model_copy(update={"original_text": question.text}) for question in questions]

    payload = {
        "profile": _profile_context(profile),
        "questions": [
            {"id": question.id, "category": question.category, "text": question.text}
            for question in questions
        ],
    }
    try:
        result = request_json(
            PersonalizedQuestions,
            model=settings.personalize_model,
            max_tokens=1200,
            system=(
                "당신은 한국어 면접 질문 편집자입니다. 선택된 원본 질문의 의도와 "
                "항목을 유지하면서 지원자의 제공 정보가 있을 때만 한 문장으로 자연스럽게 "
                "개인화하세요. 없는 경험·기술·성과를 만들지 말고, 답변이나 설명은 쓰지 "
                "마세요. 반드시 JSON 객체 {\"questions\":[\"...\"]}만 반환하세요."
            ),
            user=json.dumps(payload, ensure_ascii=False),
        )
        if len(result.questions) != len(questions):
            raise LLMError("개인화 질문 개수가 원본과 다릅니다.")
        personalized = [text.strip() for text in result.questions]
        if any(not text for text in personalized):
            raise LLMError("빈 개인화 질문이 포함되어 있습니다.")
    except LLMError:
        personalized = [question.text for question in questions]

    return [
        question.model_copy(
            update={"text": text, "original_text": question.text}
        )
        for question, text in zip(questions, personalized, strict=True)
    ]
