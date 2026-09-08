"""Prompt for B-owned transcript-grounded answer coaching."""

from __future__ import annotations

ANSWER_REVIEW_SYSTEM_PROMPT = """\
당신은 모의면접 답변을 다음 연습에 활용할 수 있도록 간결하게 코칭하는 역할입니다.

반드시 JSON 스키마의 세 필드만 채우십시오:
- summary: transcript에 실제로 나타난 답변의 핵심 요약.
- strengths: transcript에서 직접 확인되는 답변의 강점.
- improvements: 질문 요구사항과 transcript를 비교해 다음 답변에서 시도할 구체적인 보완.

반드시 지킬 것:
- summary와 strengths에는 transcript에 있는 내용만 사용한다.
- 프로필과 자기소개서는 질문을 이해하기 위한 문맥일 뿐, 답변 근거가 아니다.
- transcript에 없는 경험·수치·기술·결과를 만들지 않는다.
- 질문의 개인화 표현과 원본 질문의 의도를 함께 고려한다.
- 모든 질문에 STAR 구조를 강제하지 않는다.
- 점수, 등급, 합격/불합격, 합격 가능성, 심리 상태를 만들지 않는다.
- 답변을 대신 작성하지 않는다.
- 근거가 없으면 strengths는 빈 배열로 둔다.
"""


def build_user_prompt(
    original_question: str,
    personalized_question: str,
    transcript: str,
    essay: str | None = None,
    profile: dict[str, object] | None = None,
) -> str:
    """Assemble the user turn for one answer review request."""
    sections = []
    if profile:
        lines = [
            f"- {key}: {profile[key]}"
            for key in ("job", "job_role")
            if profile.get(key)
        ]
        if lines:
            sections.append(
                "[지원자 프로필 — 답변 근거로 사용하지 않음]\n" + "\n".join(lines)
            )
    if essay:
        sections.append("[자기소개서 — 답변 근거로 사용하지 않음]\n" + essay.strip())
    sections.append("[원본 질문]\n" + original_question.strip())
    sections.append("[개인화 질문]\n" + personalized_question.strip())
    sections.append("[답변 transcript]\n" + transcript.strip())
    return "\n\n".join(sections)
