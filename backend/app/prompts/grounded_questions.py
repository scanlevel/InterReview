"""Prompt for generating interview questions grounded in applicant input."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


GROUNDED_QUESTIONS_SYSTEM_PROMPT = """\
당신은 지원자의 자기소개서와 프로필에 근거한 면접 질문을 만드는 면접관입니다.

resume와 job_technology 두 도메인에 대해 질문을 하나씩 만드십시오.

반드시 지킬 것:
- 질문의 근거는 자기소개서 또는 프로필에 실제로 적힌 내용이어야 합니다.
- evidence는 입력에서 그대로 복사한 짧은 원문 구절이어야 합니다. 요약하거나
  새로 만들지 마십시오.
- 입력에 없는 기술, 역할, 성과, 경험을 가정하지 마십시오.
- resume는 지원자의 실제 경험·주장을 확인하는 질문으로 만드십시오.
- job_technology는 지원자가 실제로 언급한 기술의 사용·선택·판단을 묻습니다.
- 제외 질문과 의미가 겹치는 질문을 만들지 마십시오.
- resume와 job_technology 질문끼리도 같은 내용을 반복하지 마십시오.
- 각 질문은 한 문장이고 물음표 하나로 끝나야 합니다.
- 설명, 답변, 마크다운은 반환하지 마십시오.
"""


def _format_profile(profile: Mapping[str, Any] | None) -> list[str]:
    if not profile:
        return []
    lines: list[str] = []
    for key in ("resume_text", "technologies", "projects"):
        value = profile.get(key)
        if isinstance(value, str) and value.strip():
            lines.append(f"- {key}: {value.strip()}")
        elif isinstance(value, (list, tuple, set, frozenset)):
            values = [str(item).strip() for item in value if str(item).strip()]
            if values:
                lines.append(f"- {key}: {', '.join(values)}")
    return lines


def build_user_prompt(
    profile: Mapping[str, Any] | None,
    essay: str | None,
    excluded_questions: list[str],
) -> str:
    """Build one structured-generation request without sending the full bank."""
    sections: list[str] = []
    profile_lines = _format_profile(profile)
    if profile_lines:
        sections.append("[지원자 프로필]\n" + "\n".join(profile_lines))
    if essay and essay.strip():
        sections.append("[자기소개서]\n" + essay.strip())
    if excluded_questions:
        sections.append(
            "[이미 선택되어 제외할 질문]\n"
            + "\n".join(f"- {question}" for question in excluded_questions)
        )
    sections.append(
        "[출력 요구]\n"
        'questions 배열에 domain이 "resume"인 질문과 '
        '"job_technology"인 질문을 각각 최대 하나씩 넣으십시오. '
        "각 항목에는 question과 evidence를 함께 넣으십시오."
    )
    return "\n\n".join(sections)
