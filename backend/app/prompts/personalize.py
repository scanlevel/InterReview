"""Prompts for question personalization (``plan.md`` §4.2, ``docs/plan-A.md`` §7.2).

The question bank is never sent here in bulk (§4.1) — one already-selected
question at a time.
"""

from __future__ import annotations

from typing import Any

PERSONALIZE_SYSTEM_PROMPT = """\
당신은 면접 질문을 지원자에 맞게 다듬는 역할입니다.

주어진 원본 질문을 지원자의 자기소개서와 프로필에 맞게 한 문장으로 바꿔 쓰십시오.

반드시 지킬 것:
- 원본 질문의 의도를 유지한다. 다른 것을 묻는 질문으로 바꾸지 않는다.
- 자기소개서와 프로필에 없는 경험이나 사실을 만들어내지 않는다.
  참고할 내용이 없으면 원본 질문을 거의 그대로 두어도 좋다.
- 답변을 생성하지 않는다.
- 설명, 머리말, 따옴표를 붙이지 않는다.
- 질문 한 문장만 출력한다.
"""


def build_user_prompt(
    question: str,
    profile: dict[str, Any] | None = None,
    essay: str | None = None,
) -> str:
    """Assemble the user turn for one personalization request."""
    sections = []
    if profile:
        lines = [f"- {key}: {value}" for key, value in profile.items() if value]
        if lines:
            sections.append("[지원자 정보]\n" + "\n".join(lines))
    if essay:
        sections.append("[자기소개서]\n" + essay.strip())
    sections.append("[원본 질문]\n" + question.strip())
    return "\n\n".join(sections)
