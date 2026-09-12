"""Prompt for expressing a fixed rubric as transcript-grounded coaching."""

from __future__ import annotations

from app.schemas import AnswerRubricEvaluation

ANSWER_REVIEW_SYSTEM_PROMPT = """\
당신은 고정된 내부 루브릭 평가를 사용자가 이해할 수 있는 간결한 모의면접
답변 피드백으로 표현하는 역할입니다.

반드시 JSON 스키마의 세 필드만 채우십시오:
- summary: transcript에 실제로 나타난 답변의 핵심 요약.
- strengths: 루브릭과 transcript에서 확인되는 답변의 강점.
- improvements: 루브릭의 낮은 항목과 reason에 근거한 다음 답변의 보완.

반드시 지킬 것:
- 사용자 메시지에 제공된 루브릭 score와 reason을 변경하거나 재판정하지 않는다.
- question_alignment가 1 이상인 답변만 전달된다. 질문의 요구와 무관한 개선점을 만들지 않는다.
- 낮은 점수 항목을 우선 보완하되, 세 항목이 모두 2점이면 억지로 개선점을 만들지 않는다.
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
    rubric: AnswerRubricEvaluation,
    essay: str | None = None,
    profile: dict[str, object] | None = None,
) -> str:
    """Assemble the constrained feedback input for one answer."""
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
    sections.append(
        "[내부 루브릭 평가 — 변경하거나 재판정하지 않음]\n"
        f"- 질문–요구 부합도: {rubric.question_alignment.score}점\n"
        f"  reason: {rubric.question_alignment.reason}\n"
        f"- 근거의 타당성 및 구체성: {rubric.evidence_specificity.score}점\n"
        f"  reason: {rubric.evidence_specificity.reason}\n"
        f"- 논리적 구성 및 명료성: {rubric.logic_clarity.score}점\n"
        f"  reason: {rubric.logic_clarity.reason}"
    )
    return "\n\n".join(sections)
