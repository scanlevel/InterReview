"""Structural and provenance checks for the runtime ICT question bank."""

from __future__ import annotations

from pathlib import Path

from tools.validate_ict_question_bank import validate_question_bank


def test_ict_question_bank_is_clean_and_all_groups_have_candidates() -> None:
    report = validate_question_bank(
        Path(__file__).resolve().parents[1] / "question_banks" / "ict"
    )

    assert report["errors"] == []
    assert report["duplicate_questions"] == 0
    assert report["career_context_candidates"] == 0
    assert len(report["service_group_candidates"]) == 6
    assert all(report["service_group_candidates"].values())
