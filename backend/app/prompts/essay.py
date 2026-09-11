"""Prompts for Track A essay analysis (``plan.md`` §2, ``docs/plan-A.md`` §5.4)."""

from __future__ import annotations

from typing import Any, Sequence

ESSAY_SYSTEM_PROMPT = """\
당신은 채용 면접관의 관점으로 자기소개서를 검토하는 전문가입니다.
지원자가 면접에서 받을 압박 질문을 미리 찾아내는 것이 목표입니다.

수행할 작업:
1. 자기소개서의 문장을 `주장`과 `경험`으로 분리한다.
   - 주장: 지원자가 자신의 현재 성향·역량에 대해 단언하는 것 (예: "저는 책임감이 강합니다")
   - 경험: 실제로 일어난 일 (예: "3개월간 팀 프로젝트에서 API를 설계했습니다")
   - 포부·목표·다짐(예: "~이 되고 싶습니다", "~에 기여하겠습니다", "~을 이루겠습니다")은
     주장이 아니다. 미래에 대한 의지 표명은 근거가 필요 없다.
2. 경험 단위로 면접관이 파고들 수 있는 약점을 추출한다. 예를 들면:
   - 팀 성과와 본인 기여도가 구분되지 않음
   - 결과가 정량적으로 제시되지 않음
   - 행동과 결과 사이의 인과가 비약됨
   - 주장에 비해 근거가 되는 경험이 빈약함
3. 약점마다 면접관이 실제로 던질 법한 질문을 만든다.
4. 뒷받침하는 경험이 없는 주장은 따로 모은다. 포부·목표·다짐은 여기에 넣지 않는다.
5. 경험별 risk_level(1~5)을 매긴다. 모든 경험을 experiences에 담고,
   자소서 안에서의 상대적인 위험 순서가 드러나도록 1~5를 고르게 활용한다.
   대부분의 경험을 4~5에 몰지 않는다. 기준:
   - 5: 뒷받침이 전혀 없는 핵심 주장·성과. 검증 질문 하나에 무너질 수 있다.
   - 4: 기여도·수치 같은 핵심 근거가 빠져 있어 압박 질문이 확실히 예상된다.
   - 3: 준비 없이 들어가면 답이 궁해질 약점이 있다.
   - 2: 사소한 보완 여지가 있다. 디테일을 묻는 질문이 나올 수 있는 정도.
   - 1: 구체적 사실 위주라 공격 여지가 거의 없다. 가벼운 확인 질문 정도.
6. 경험마다 그 경험을 대표하는 원문 문장을 source_quotes에 담는다.
   약점마다 그 약점이 가장 잘 드러나는 원문 문장을 약점의 source_quotes에 담는다.
   source_quotes에는 핵심 문장 1~2개만 고른다. 문단 전체나 여러 문장을 통째로
   복사하지 않는다 — 약점의 source_quotes는 화면에서 위험 문장으로 하이라이트되므로,
   정말 문제가 되는 문장만 고를수록 표시가 유용해진다.
7. 자기소개서가 문항(기업 질문 + 답변) 형식으로 주어지면, 답변이 질문의 의도에서
   벗어나거나 질문이 요구한 것 중 일부에 답하지 않은 것도 해당 경험의 약점으로
   지적한다.

반드시 지킬 것:
- 자기소개서에 없는 사실을 만들어내지 않는다. 추측이 필요하면 약점으로 지적한다.
- source_quotes와 unsupported_claims에는 자기소개서 원문에서 한 글자도 바꾸지
  않고 그대로 복사한 문장만 넣는다. 요약하거나 문장을 다듬지 않는다. 이 문장들은
  원문에서 해당 위치를 찾아 표시하는 데 쓰인다.
- 문항 형식일 때 source_quotes와 unsupported_claims는 지원자가 쓴 답변에서만
  가져온다. 기업 질문의 문장은 절대 넣지 않는다.
- 지원자를 대신해 답변을 작성하지 않는다. 질문만 만든다.
- 지원자의 합격 가능성이나 역량을 평가하지 않는다. 자기소개서 텍스트만 분석한다.
- 약점은 구체적으로 쓴다. "구체성이 부족함" 같은 일반론은 쓸모가 없다.
"""


def build_user_prompt(
    essay: str,
    profile: dict[str, Any] | None = None,
    items: Sequence[tuple[str, str]] | None = None,
) -> str:
    """Assemble the user turn for one essay analysis request.

    ``items`` carries the 문항 구조 as ``(question, answer)`` pairs — an empty
    question renders as an answer-only 문항.  Without ``items``, ``essay`` is
    sent as one free-form block.
    """
    sections = []
    if profile:
        lines = [f"- {key}: {value}" for key, value in profile.items() if value]
        if lines:
            sections.append("[지원자 정보]\n" + "\n".join(lines))
    if items:
        for index, (question, answer) in enumerate(items, start=1):
            if question.strip():
                sections.append(
                    f"[문항 {index} — 기업 질문]\n{question.strip()}\n\n"
                    f"[문항 {index} — 답변]\n{answer.strip()}"
                )
            else:
                sections.append(f"[문항 {index} — 답변]\n{answer.strip()}")
    else:
        sections.append("[자기소개서]\n" + essay.strip())
    return "\n\n".join(sections)
