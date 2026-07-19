"""Interview evaluation.

Two engines share one output shape (:class:`EvaluationReport`):

* ``rule_based`` — no API key required. Heuristic scoring from transcript
  length/structure and gaze summary. Deliberately conservative and clearly
  labelled so nobody mistakes it for a real assessment.
* ``llm`` — filled in once ``ANTHROPIC_API_KEY`` is configured; it will reuse
  these schemas and fall back to the rule-based engine on any failure.

The public entry point is :func:`evaluate_interview`, which selects the engine.
"""

from __future__ import annotations

import re

from app.config import get_settings
from app.schemas import (
    AnswerItem,
    EvaluateRequest,
    EvaluationItem,
    EvaluationReport,
    EyeTrackingSummary,
    QuestionResult,
)

# --- Korean keyword buckets for a crude STAR-structure heuristic -------------
# Presence of words from each bucket hints the answer touched Situation,
# Action, and Result. This is a proxy, not comprehension.
_SITUATION_HINTS = (
    "상황", "당시", "프로젝트", "과제", "문제", "이슈", "배경", "환경", "목표",
)
_ACTION_HINTS = (
    "그래서", "위해", "위하여", "방법", "시도", "진행", "구현", "분석", "설계",
    "해결", "협업", "제안", "개발", "적용", "노력",
)
_RESULT_HINTS = (
    "결과", "결국", "덕분", "개선", "달성", "성과", "배웠", "느꼈", "성공",
    "완료", "향상", "단축", "증가", "감소",
)

_KOREAN_STOPWORDS = frozenset(
    {
        "그리고", "하지만", "그러나", "저는", "제가", "그것", "이것", "합니다",
        "했습니다", "그", "저", "때문에", "위해", "대해", "대한", "있습니다",
    }
)


def _clamp_score(value: float) -> int:
    """Clamp to the 0..100 integer range."""
    return int(max(0.0, min(100.0, round(value))))


def _content_tokens(text: str) -> set[str]:
    """Return meaningful tokens (len >= 2, not stopwords) for overlap checks."""
    tokens = re.findall(r"[0-9A-Za-z가-힣]+", text)
    return {t for t in tokens if len(t) >= 2 and t not in _KOREAN_STOPWORDS}


def _score_specificity(transcript: str) -> EvaluationItem:
    """Longer answers with concrete tokens (numbers) score higher."""
    stripped = transcript.strip()
    if not stripped:
        return EvaluationItem(
            name="답변 구체성",
            score=None,
            status="no_answer",
            comment="음성이 인식되지 않아 구체성을 평가할 수 없습니다.",
        )

    char_count = len(stripped.replace(" ", ""))
    digit_count = len(re.findall(r"\d", stripped))

    # ~120 chars of speech maps toward a full length score; digits add a bonus
    # for concrete detail (수치·기간·규모 등).
    length_score = min(80.0, char_count / 120.0 * 80.0)
    digit_bonus = min(20.0, digit_count * 5.0)
    score = _clamp_score(length_score + digit_bonus)

    if score >= 70:
        comment = "충분한 분량과 구체적 표현이 포함되어 있습니다."
    elif score >= 40:
        comment = "답변은 있으나 사례·수치 등 구체적 근거를 더 넣으면 좋습니다."
    else:
        comment = "답변이 짧습니다. 경험과 근거를 구체적으로 풀어 설명해 보세요."
    return EvaluationItem(
        name="답변 구체성", score=score, status="rule_based", comment=comment
    )


def _score_structure(transcript: str) -> EvaluationItem:
    """Reward coverage of Situation / Action / Result cues (STAR proxy)."""
    stripped = transcript.strip()
    if not stripped:
        return EvaluationItem(
            name="논리 구조",
            score=None,
            status="no_answer",
            comment="음성이 인식되지 않아 논리 구조를 평가할 수 없습니다.",
        )

    covered = 0
    for bucket in (_SITUATION_HINTS, _ACTION_HINTS, _RESULT_HINTS):
        if any(word in stripped for word in bucket):
            covered += 1

    # 0/3 -> 30, 3/3 -> 90
    score = _clamp_score(30 + covered * 20)
    labels = ["상황", "행동", "결과"]
    if covered == 3:
        comment = "상황·행동·결과 흐름이 고르게 드러납니다."
    else:
        comment = (
            f"{covered}/3 요소가 감지되었습니다. "
            f"{'·'.join(labels)} 순서로 답하면 전달력이 올라갑니다."
        )
    return EvaluationItem(
        name="논리 구조", score=score, status="rule_based", comment=comment
    )


def _score_relevance(question: str, transcript: str) -> EvaluationItem:
    """Keyword overlap between question and answer as a weak relevance proxy."""
    stripped = transcript.strip()
    if not stripped:
        return EvaluationItem(
            name="질문 적합성",
            score=None,
            status="no_answer",
            comment="음성이 인식되지 않아 질문 적합성을 평가할 수 없습니다.",
        )

    q_tokens = _content_tokens(question)
    a_tokens = _content_tokens(stripped)
    if not q_tokens:
        # Can't measure overlap; give benefit of the doubt for a real answer.
        score = 60
        comment = "질문 키워드를 추출하지 못해 답변 여부만으로 판단했습니다."
    else:
        overlap = len(q_tokens & a_tokens) / len(q_tokens)
        # Map 0..1 overlap onto 45..90 so an on-topic answer isn't over-penalized
        # by the crude tokenizer.
        score = _clamp_score(45 + overlap * 45)
        if overlap >= 0.3:
            comment = "질문의 핵심어를 답변에서 다루고 있습니다."
        else:
            comment = "질문 의도와 직접 연결되는 표현이 적습니다. 질문 키워드를 짚어 답해 보세요."
    return EvaluationItem(
        name="질문 적합성", score=score, status="rule_based", comment=comment
    )


def _score_delivery(eye: EyeTrackingSummary | None) -> EvaluationItem:
    """Score delivery/attitude from the gaze summary only.

    This is the one dimension where a rule-based number is genuinely grounded,
    but gaze is still a noisy proxy — the comment says so.
    """
    if eye is None or (eye.front_gaze_ratio is None and eye.face_detected_ratio is None):
        return EvaluationItem(
            name="전달 태도",
            score=None,
            status="na",
            comment="시선 데이터가 없어 전달 태도를 평가할 수 없습니다.",
        )

    front = eye.front_gaze_ratio if eye.front_gaze_ratio is not None else 0.5
    base = front * 100.0

    # Penalize low face-detection (looking away / off-frame) and jittery gaze.
    if eye.face_detected_ratio is not None:
        base *= 0.5 + 0.5 * max(0.0, min(1.0, eye.face_detected_ratio))
    if eye.std_gaze is not None and eye.std_gaze > 0.15:
        base -= min(20.0, (eye.std_gaze - 0.15) * 100.0)

    score = _clamp_score(base)
    if score >= 70:
        comment = "정면 응시 비율이 높아 안정적인 인상을 줍니다. (시선 기반 참고 지표)"
    elif score >= 45:
        comment = "시선이 다소 분산됩니다. 카메라를 응시하는 시간을 늘려 보세요. (참고 지표)"
    else:
        comment = "정면 응시가 부족합니다. 화면보다 카메라를 보며 답하는 연습을 권합니다. (참고 지표)"
    return EvaluationItem(
        name="전달 태도", score=score, status="rule_based", comment=comment
    )


def _evaluate_answer(answer: AnswerItem) -> QuestionResult:
    items = [
        _score_relevance(answer.question, answer.transcript),
        _score_specificity(answer.transcript),
        _score_structure(answer.transcript),
        _score_delivery(answer.eye_tracking),
    ]

    scored = [i.score for i in items if i.score is not None]
    if not answer.transcript.strip():
        feedback = "이 질문에서는 음성 답변이 인식되지 않았습니다. 마이크 상태를 확인하고 다시 답변해 보세요."
    elif scored:
        avg = sum(scored) / len(scored)
        if avg >= 70:
            feedback = "핵심을 잘 짚어 답했습니다. 수치·사례를 조금 더 더하면 완성도가 높아집니다."
        elif avg >= 45:
            feedback = "무난한 답변입니다. 구조(상황·행동·결과)와 구체적 근거를 보강해 보세요."
        else:
            feedback = "답변을 더 구체적이고 구조적으로 확장할 여지가 큽니다."
    else:
        feedback = "평가할 수 있는 신호가 부족합니다."

    return QuestionResult(
        question_id=answer.question_id,
        question=answer.question,
        category=answer.category,
        evaluation_items=items,
        feedback=feedback,
    )


def _rule_based_evaluate(request: EvaluateRequest) -> EvaluationReport:
    results = [_evaluate_answer(answer) for answer in request.answers]

    all_scores = [
        item.score
        for result in results
        for item in result.evaluation_items
        if item.score is not None
    ]
    total_score = _clamp_score(sum(all_scores) / len(all_scores)) if all_scores else None

    if total_score is None:
        summary = "인식된 답변이 없어 점수를 산출하지 못했습니다. 마이크·카메라 상태를 확인해 주세요."
    else:
        summary = (
            f"규칙 기반 예비 평가 결과 총점은 {total_score}점입니다. "
            "이 점수는 답변 길이·구조·시선 신호에 근거한 참고용이며, "
            "정밀 평가는 LLM 연동 후 제공됩니다."
        )

    return EvaluationReport(
        total_score=total_score,
        status="rule_based",
        engine="rule_based",
        summary_feedback=summary,
        results=results,
    )


def evaluate_interview(request: EvaluateRequest) -> EvaluationReport:
    """Evaluate an interview, choosing the best available engine.

    Until the LLM path is implemented we always run the rule-based engine. Once
    ``ANTHROPIC_API_KEY`` is set the LLM engine will be tried first with this as
    the fallback.
    """
    settings = get_settings()
    if settings.anthropic_api_key:
        # LLM engine not implemented yet; fall through to rule-based. When added,
        # this becomes: try LLM, except -> _rule_based_evaluate(request).
        pass
    return _rule_based_evaluate(request)
