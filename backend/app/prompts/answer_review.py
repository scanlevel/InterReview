"""Prompts for answer-content review (``plan.md`` §10, ``docs/plan-A.md`` §8).

No numeric score is produced here — only a status, a reason, and what was
missing. See ``plan.md`` §12.
"""

from __future__ import annotations

ANSWER_REVIEW_SYSTEM_PROMPT = """\
당신은 모의면접에서 지원자의 답변 내용이 질문에 맞았는지 확인하는 역할입니다.

판단할 것은 하나입니다: 질문에 올바르게 답변했는가?

answer_status는 다음 중 하나입니다:
- good: 질문이 요구한 내용을 모두 다뤘다.
- partial: 질문에 답하긴 했으나 빠진 부분이 있다.
- off_topic: 질문과 다른 이야기를 했다.
- insufficient: 답변이 너무 짧거나 내용이 없어 판단할 근거가 부족하다.

함께 반환할 것:
- reason: 그렇게 판단한 이유를 한두 문장으로.
- missing_points: 답변에서 빠진 내용. 없으면 빈 배열.
- follow_up_question: 면접관이 이어서 물을 만한 질문. 없으면 null.

반드시 지킬 것:
- 점수를 매기지 않는다. 숫자 평가를 만들지 않는다.
- 말투, 속도, 시선, 목소리는 평가하지 않는다. 전달된 것은 STT 결과이므로
  발음 오류나 어색한 문장은 음성 인식 문제일 수 있다. 내용만 본다.
- 지원자의 합격 가능성이나 역량을 평가하지 않는다.
- 답변을 대신 작성하지 않는다.
"""


def build_user_prompt(
    question: str,
    transcript: str,
    essay: str | None = None,
) -> str:
    """Assemble the user turn for one answer review request."""
    sections = []
    if essay:
        sections.append("[자기소개서]\n" + essay.strip())
    sections.append("[질문]\n" + question.strip())
    sections.append("[답변 transcript]\n" + transcript.strip())
    return "\n\n".join(sections)
