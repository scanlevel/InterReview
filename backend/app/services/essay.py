"""Track A — essay analysis (``plan.md`` §2, ``docs/plan-A.md`` §5).

Finds the claims and experiences in a 자기소개서, the weak points an interviewer
could push on, and the questions those weak points invite.

This is analysis of the *text*, not assessment of the applicant: no score is
produced for the person, and ``risk_level`` ranks how exposed an experience is
in an interview (``plan.md`` §2 asks for exactly this ordering), not how good
the applicant is (``plan.md`` §12 forbids that).
"""

from __future__ import annotations

from typing import Any

from app.config import get_settings
from app.prompts.essay import ESSAY_SYSTEM_PROMPT, build_user_prompt
from app.schemas import EssayAnalysis
from app.services import llm


def _sorted_by_risk(analysis: EssayAnalysis) -> EssayAnalysis:
    """Return the analysis with the riskiest experiences first.

    Ordering is done here rather than asked of the model: sorting is exact in
    code, costs nothing, and stays correct even when the model returns a
    perfectly good analysis in the essay's original order. Python's sort is
    stable, so experiences sharing a risk level keep the model's ordering.
    """
    return analysis.model_copy(
        update={
            "experiences": sorted(
                analysis.experiences, key=lambda item: item.risk_level, reverse=True
            )
        }
    )


def analyze_essay(essay: str, profile: dict[str, Any] | None = None) -> EssayAnalysis:
    """Analyze one 자기소개서 and return its interview weak points.

    Raises:
        LLMNotConfiguredError: if no API key is configured.
        LLMCallError: if the call failed or the response did not validate.
            Track A has no meaningful degraded output — the analysis *is* the
            feature — so the caller surfaces this rather than substituting
            anything (``docs/plan-A.md`` §4.5).
    """
    settings = get_settings()
    analysis = llm.call_structured(
        model=settings.eval_model,
        system=ESSAY_SYSTEM_PROMPT,
        user=build_user_prompt(essay, profile),
        output_format=EssayAnalysis,
    )
    return _sorted_by_risk(analysis)
