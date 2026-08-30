"""Structural checks for the six-file runtime ICT question bank."""

from __future__ import annotations

from pathlib import Path

from tools.validate_ict_question_bank import validate_question_bank


EXPECTED_COUNTS = {
    "resume": 111,
    "values_personality": 291,
    "job_technology": 224,
    "problem_solving": 65,
    "collaboration_organization": 197,
    "motivation_commitment": 109,
}


def test_ict_question_bank_is_clean_and_all_groups_have_candidates() -> None:
    report = validate_question_bank(
        Path(__file__).resolve().parents[1] / "question_banks" / "ict"
    )

    assert report["errors"] == []
    assert report["total_questions"] == 997
    assert report["exact_unique_questions"] == 997
    assert report["duplicate_questions"] == 0
    assert report["career_context_candidates"] == 0
    assert report["service_group_files"] == 6
    assert report["service_group_candidates"] == EXPECTED_COUNTS
    assert report["service_group_unique_candidates"] == EXPECTED_COUNTS
    assert report["question_bank_files"] == sorted(
        f"{group}.json" for group in EXPECTED_COUNTS
    )
