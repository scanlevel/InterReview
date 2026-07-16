"""Question-by-question personalization built on the shared Kanana LLM."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from typing import Any

from module.kanana_llm import KananaLLM, KananaLLMError


LOGGER = logging.getLogger(__name__)
ProgressCallback = Callable[[str, float], None]


class KananaPersonalizationError(RuntimeError):
    """Raised when one Kanana response cannot be converted to a question."""


def _clean_question_text(value: str) -> str:
    """Normalize a model reply while keeping only one usable question sentence."""
    text = value.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"^(?:질문|면접 질문)\s*[:：]\s*", "", text).strip()
    if text.startswith(("저는 ", "제가 ", "우선 ", "당사는 ", "저희는 ")):
        raise KananaPersonalizationError("Kanana가 질문 대신 답변 문장을 생성했습니다.")
    if 5 <= len(text) <= 500:
        return text
    raise KananaPersonalizationError("Kanana 응답에서 사용할 질문 문장을 찾지 못했습니다.")


def _extract_personalized_text(response: str) -> str:
    """Accept a JSON object when possible, with a safe plain-text fallback.

    The prompt requests ``{"text": "..."}``, but generation models may add a
    code fence or return the question as plain text.  A valid question sentence
    is sufficient for this one-question request; JSON formatting is not a
    reason to discard all six personalizations.
    """
    cleaned = response.strip()
    if not cleaned:
        raise KananaPersonalizationError("Kanana 응답이 비어 있습니다.")

    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        cleaned = fenced.group(1).strip()

    decoder = json.JSONDecoder()
    payload: Any | None = None
    for start in (match.start() for match in re.finditer(r"[\[{]", cleaned)):
        try:
            candidate, _ = decoder.raw_decode(cleaned[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(candidate, (dict, list)):
            payload = candidate
            break

    if isinstance(payload, dict):
        for key in ("text", "question", "질문"):
            value = payload.get(key)
            if isinstance(value, str):
                return _clean_question_text(value)
    if isinstance(payload, list) and len(payload) == 1 and isinstance(payload[0], dict):
        for key in ("text", "question", "질문"):
            value = payload[0].get(key)
            if isinstance(value, str):
                return _clean_question_text(value)
    if payload is not None:
        raise KananaPersonalizationError("Kanana JSON 응답에 질문 텍스트가 없습니다.")

    # Plain-text replies are allowed, but only their first complete question is
    # used. This prevents a model that keeps generating from becoming one long
    # repeated interview question.
    first_question = re.search(r"(.{5,500}?\?)", cleaned, flags=re.DOTALL)
    if first_question:
        return _clean_question_text(first_question.group(1))
    return _clean_question_text(cleaned)


def _render_profile(profile: dict[str, Any]) -> str:
    """Render the known applicant fields in a stable, human-readable prompt form."""
    field_names = {
        "interview_topic": "면접 주제",
        "job_role": "지원 직무",
        "tech_stack": "기술 스택",
        "project_experience": "프로젝트 경험",
        "collaboration_experience": "협업 경험",
        "self_intro": "자기소개",
    }
    lines: list[str] = []
    for key, label in field_names.items():
        value = profile.get(key)
        rendered_value = value.strip() if isinstance(value, str) else ""
        lines.append(f"- {label}: {rendered_value or '미입력'}")
    return "\n".join(lines)


def _fallback_question(question: dict[str, Any], reason: str) -> dict[str, Any]:
    return {**question, "base_text": question["text"], "personalization": "fallback", "fallback_reason": reason}


def personalize_questions(
    profile: dict[str, Any],
    questions: list[dict[str, Any]],
    llm: KananaLLM | None = None,
    progress_callback: ProgressCallback | None = None,
) -> list[dict[str, Any]]:
    """Personalize each selected question in six independent Kanana calls.

    Every call receives the complete interview-information JSON and exactly one
    question-bank question.  A malformed response affects only that question;
    the remaining calls continue and retain their individual results.
    """
    if not questions:
        return questions
    if llm is None:
        if progress_callback is not None:
            progress_callback("LLM fallback으로 질문은행 원문을 사용합니다.", 0.95)
        return [_fallback_question(question, "Kanana 모델을 사용할 수 없습니다.") for question in questions]

    results: list[dict[str, Any]] = []
    for index, question in enumerate(questions, start=1):
        if progress_callback is not None:
            progress_callback(
                f"LLM이 {index}/{len(questions)}번 질문을 개인화하는 중입니다.",
                0.25 + (0.75 * index / len(questions)),
            )

        prompt = (
            "아래 지원자 정보와 원본 질문을 바탕으로 개인화된 면접 질문을 만드세요.\n\n"
            f"지원자 정보:\n{_render_profile(profile)}\n\n"
            f"원본 질문:\n{question['text']}\n\n"
            "개인화된 질문: "
        )
        try:
            response = llm.generate(
                [
                    {
                        "role": "system",
                        "content": (
                            "당신은 한국어 모의면접 질문 편집기입니다.\n"
                            "다음 규칙을 반드시 지키세요.\n"
                            "1. 출력은 한국어 면접 질문 한 문장만 작성합니다.\n"
                            "2. 질문은 반드시 물음표(?)로 끝냅니다.\n"
                            "3. 설명, 답변, JSON, 인사말, Markdown을 출력하지 않습니다.\n"
                            "4. 원본 질문의 의도에서 벗어나지 않습니다.\n"
                            "5. 지원자 정보에 실제로 있는 내용만 반영합니다.\n"
                            "6. 입력값이 '없음'이면 해당 경험이나 기술이 없다는 뜻으로 해석하고, 이를 보유했다고 추측하지 않습니다.\n"
                            "7. 경험이 없는 경우에는 필요에 따라 미래 계획형 또는 가상 상황형 질문으로 바꿀 수 있습니다.\n"
                            "8. 답변 문장을 작성하지 않습니다. "
                            "9. '저는', '제가', '우선'으로 시작하는 문장은 금지합니다."
                        ),
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    },
                ],
                max_new_tokens=96,
            )
            personalized_text = _extract_personalized_text(response)
        except (KananaLLMError, KananaPersonalizationError) as error:
            LOGGER.warning("Kanana personalization fallback for %s: %s", question["id"], error)
            results.append(_fallback_question(question, str(error)))
            continue
        except Exception as error:  # Defensive boundary around third-party model execution.
            LOGGER.warning("Unexpected Kanana personalization fallback for %s: %s", question["id"], error)
            results.append(_fallback_question(question, "Kanana 생성 중 예기치 못한 오류가 발생했습니다."))
            continue

        results.append(
            {
                **question,
                "base_text": question["text"],
                "text": personalized_text,
                "personalization": "kanana",
            }
        )
    return results
