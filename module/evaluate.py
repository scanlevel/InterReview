# module/evaluate.py

import time
import random


def evaluate_interview(submitted_data: dict) -> dict:
    """
    제출된 면접 JSON을 평가한다.
    현재는 실제 평가 로직 구현 전이므로 empty/mock 결과를 반환한다.

    나중에 여기서:
    - STT transcript
    - eye tracking feature
    - 질문별 답변
    - rule 기반 점수
    를 계산하면 됨.
    """

    # 실제 분석처럼 보이기 위한 랜덤 지연
    delay_sec = random.uniform(2.0, 4.5)
    time.sleep(delay_sec)

    questions = submitted_data.get("questions", [])

    results = []

    for question in questions:
        results.append(
            {
                "question_id": question.get("id"),
                "question": question.get("text"),
                "category": question.get("category"),
                "evaluation_items": [
                    {
                        "name": "질문 적합성",
                        "score": None,
                        "status": "not_implemented",
                        "comment": "질문 의도와 답변의 관련성을 평가할 예정입니다.",
                    },
                    {
                        "name": "답변 구체성",
                        "score": None,
                        "status": "not_implemented",
                        "comment": "구체적인 경험, 근거, 사례 포함 여부를 평가할 예정입니다.",
                    },
                    {
                        "name": "논리 구조",
                        "score": None,
                        "status": "not_implemented",
                        "comment": "상황, 행동, 결과 구조가 포함되었는지 평가할 예정입니다.",
                    },
                    {
                        "name": "전달 태도",
                        "score": None,
                        "status": "not_implemented",
                        "comment": "시선, 고개 움직임, 발화 상태를 바탕으로 평가할 예정입니다.",
                    },
                ],
                "feedback": "아직 실제 평가 로직은 연결되지 않았습니다. 추후 STT, 시선 분석, 룰 기반 평가 결과를 바탕으로 피드백을 생성합니다.",
            }
        )

    return {
        "total_score": None,
        "status": "mock_result",
        "summary_feedback": "평가 모듈 연결 테스트가 완료되었습니다. 현재는 빈 평가 결과를 반환합니다.",
        "results": results,
    }