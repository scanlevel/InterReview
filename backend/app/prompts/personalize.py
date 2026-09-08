"""Prompt for B-owned question personalization.

The question bank is never sent here in bulk — one already-selected question at a time.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

PERSONALIZE_SYSTEM_PROMPT = """\
당신은 면접 질문을 지원자에 맞게 다듬는 역할입니다.

주어진 원본 질문을 지원자의 자기소개서와 프로필에 맞게 한 문장으로 바꿔 쓰십시오.

반드시 지킬 것:
- 원본 질문의 의도를 유지한다. 다른 것을 묻는 질문으로 바꾸지 않는다.
- 자기소개서와 프로필에 없는 경험이나 사실을 만들어내지 않는다.
- 관련 정보가 없으면 원본 질문을 그대로 반환한다.
- 제공된 target role, subcategory, answer intent는 원본 질문의 평가 의도를
  이해하기 위한 참고 정보로만 사용한다.
- 프로필에 실제로 존재하는 정보만 활용한다.
- 새로운 기술·경험을 가정하지 않는다.
- 다른 기술 영역으로 확장하지 않는다.
- 답변을 생성하지 않는다.
- 설명, 머리말, 따옴표를 붙이지 않는다.
- 질문 한 문장만 출력한다.
- 문장 끝에 물음표 하나만 둔다.
"""


def build_user_prompt(
    question: str,
    profile: dict[str, Any] | None = None,
    essay: str | None = None,
    *,
    target_role: str | None = None,
    subcategory: str | None = None,
    answer_intent: Mapping[str, str] | None = None,
) -> str:
    """Assemble the user turn for one personalization request."""
    sections = []
    metadata = []
    if target_role:
        metadata.append(f"- target role: {target_role}")
    if subcategory:
        metadata.append(f"- subcategory: {subcategory}")
    if answer_intent:
        category = answer_intent.get("category")
        expression = answer_intent.get("expression")
        if category:
            metadata.append(f"- answer_intent.category: {category}")
        if expression:
            metadata.append(f"- answer_intent.expression: {expression}")
    if metadata:
        sections.append("[질문 메타데이터]\n" + "\n".join(metadata))
    if profile:
        lines = [
            f"- {key}: {profile[key]}"
            for key in ("name", "job", "job_role")
            if profile.get(key)
        ]
        if lines:
            sections.append("[지원자 정보]\n" + "\n".join(lines))
    if essay:
        sections.append("[자기소개서]\n" + essay.strip())
    sections.append("[원본 질문]\n" + question.strip())
    return "\n\n".join(sections)
