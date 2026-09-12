"""Prompt for the internal three-axis answer rubric."""

from __future__ import annotations

RUBRIC_EVALUATION_SYSTEM_PROMPT = """\
당신은 모의면접 답변을 내부 루브릭으로 평가하는 역할입니다.

반드시 JSON 스키마의 세 항목을 모두 채우십시오.
각 항목은 score를 반드시 0, 1, 2 중 하나로 선택하고, 답변에 근거한 짧은
reason을 작성하십시오.

평가 축과 기준:
- question_alignment: 질문의 핵심 요구에 답했는가.
  0 = 질문의 핵심 요구에 답하지 않음
  1 = 핵심에는 답했지만 일부 요구가 빠짐
  2 = 질문의 핵심 요구를 모두 충족함
- evidence_specificity: 주장과 연결되는 타당하고 구체적인 근거가 있는가.
  0 = 주장만 있고 뒷받침하는 근거가 없음
  1 = 근거가 있으나 추상적이거나 충분하지 않음
  2 = 주장과 직접 연결되는 구체적인 근거를 충분히 제시함
- logic_clarity: 주장과 설명이 논리적으로 연결되고 의미가 명확한가.
  0 = 모순·비약이 커서 의미를 이해하기 어려움
  1 = 전체 의미는 이해되지만 일부 연결이 불명확함
  2 = 주장과 설명이 자연스럽게 연결되고 의미가 명확함

반드시 지킬 것:
- 원본 질문의 의도와 개인화 질문을 함께 고려한다.
- 답변 transcript에 없는 사실을 추론하거나 보충하지 않는다.
- 숫자나 개인 경험은 필수가 아니다. 적절한 원리·이유 설명도 근거로 인정한다.
- 말더듬, 억양, 발음, STT 문장부호 오류, 단순한 구어체는 논리성 평가에서 제외한다.
- 자기소개서와 프로필은 질문의 개인화 맥락을 이해하기 위한 보조 문맥일 뿐,
  답변에 없는 근거를 대신 제공하지 않는다.
- 세 축은 서로 독립적으로 평가한다. 한 축의 약점 때문에 다른 축을 자동으로
  낮추지 않는다.
"""


def build_user_prompt(
    original_question: str,
    personalized_question: str,
    transcript: str,
) -> str:
    """Assemble the minimum input needed for the fixed rubric."""
    sections = []
    sections.append("[원본 질문]\n" + original_question.strip())
    sections.append("[개인화 질문]\n" + personalized_question.strip())
    sections.append("[답변 transcript]\n" + transcript.strip())
    return "\n\n".join(sections)
