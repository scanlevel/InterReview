"""``/essay/analyze`` route — Track A essay analysis."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import EssayAnalysis, EssayAnalyzeRequest
from app.services.essay import analyze_essay
from app.services.llm import LLMCallError, LLMNotConfiguredError

router = APIRouter(tags=["essay"])


@router.post("/essay/analyze", response_model=EssayAnalysis)
def analyze(request: EssayAnalyzeRequest) -> EssayAnalysis:
    """Analyze one 자기소개서 and return its interview weak points.

    Unlike the interview routes, there is no fallback here: the analysis is the
    entire feature, so a failure is reported rather than papered over.
    """
    try:
        return analyze_essay(request.essay, request.profile)
    except LLMNotConfiguredError as error:
        # Server-side configuration gap, not a bad request.
        raise HTTPException(
            status_code=503,
            detail="자소서 분석 기능이 설정되지 않았습니다. 관리자에게 문의해 주세요.",
        ) from error
    except LLMCallError as error:
        raise HTTPException(
            status_code=502,
            detail="자소서 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        ) from error
