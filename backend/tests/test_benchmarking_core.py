from __future__ import annotations

from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from benchmarking.gold import gold_from_annotations, majority
from benchmarking.models import AdjudicationRecord, Annotation
from benchmarking.paths import RULES_PATH
from benchmarking.rubric import load_rubric, load_rules, validate_rubric_rule_mapping
from benchmarking.selection import select_target
from benchmarking.splitting import assign_splits
from benchmarking.storage import AnnotationStore


def ann(score: int, *, annotator_id: UUID | None = None, relevance: int | None = None, version: str = "1.0") -> Annotation:
    return Annotation.model_validate({"annotator_id": annotator_id or uuid4(), "rubric_version": version, "scores": {"relevance": score if relevance is None else relevance, "specificity": score, "coherence": score, "specialized": score}, "confidence": 2, "note": ""})


def sample(sample_id: str, question: str, group: str = "problem_solving", *, gold: bool = True) -> dict:
    return {"sample_id": sample_id, "source": {"dataset": "test", "source_split": "train"}, "question": {"text": question, "group": group, "group_name": group}, "answer": {"text": "answer", "word_count": 1}, "audio": {"question_wav": "q.wav", "answer_wav": "a.wav"}, "metadata": {}, "gold": {"scores": {"relevance": 2, "specificity": 2, "coherence": 2, "specialized": 2}} if gold else None, "benchmark_split": None}


def test_rubric_has_three_common_and_rules_groups():
    rubric = load_rubric()
    assert set(rubric["common"]) == {"relevance", "specificity", "coherence"}
    assert set(rubric["specialized"]) == {group["id"] for group in load_rules()["groups"]}
    if RULES_PATH.exists():
        assert validate_rubric_rule_mapping() == []


def test_uuid_and_score_validation():
    with pytest.raises(ValidationError):
        Annotation.model_validate({"annotator_id": "A", "rubric_version": "1.0", "scores": {"relevance": 3, "specificity": 1, "coherence": 1, "specialized": 1}, "confidence": 1})


def test_unique_mode_rules_for_three_and_four_annotators():
    assert majority([2, 2, 1]) == 2
    assert majority([0, 1, 2]) is None
    assert majority([2, 2, 2, 1]) == 2
    assert majority([0, 0, 1, 1]) is None
    annotations = [ann(2, relevance=value) for value in (0, 1, 2)]
    gold, status = gold_from_annotations(annotations)
    assert gold is None and status["status"] == "unresolved"


def test_adjudication_overrides_unresolved():
    annotations = [ann(2, relevance=value) for value in (0, 1, 2)]
    record = AdjudicationRecord(sample_id="1", rubric_version="1.0", scores={"relevance": 1, "specificity": 2, "coherence": 2, "specialized": 2})
    gold, status = gold_from_annotations(annotations, record)
    assert status["status"] == "adjudicated" and gold["scores"]["relevance"] == 1


def test_registry_issues_uuid_and_keeps_profile_separate(tmp_path):
    store = AnnotationStore(tmp_path)
    profile = store.register_annotator(name="Kim", affiliation_or_major="ICT")
    assert isinstance(profile.annotator_id, UUID)
    record = store.save_annotation(sample_id="1", annotation=ann(2, annotator_id=profile.annotator_id), target_mode="pilot")
    raw = record.model_dump(mode="json")
    assert "name" not in raw and raw["annotator_id"] == str(profile.annotator_id)


def test_pilot_is_reproducible_subset_of_full():
    groups = [group["id"] for group in load_rules()["groups"]]
    rows = [sample(f"{group}-{index}", f"question {group} {index}", group, gold=False) for group in groups for index in range(500)]
    full = select_target(rows, mode="full", seed=42)
    pilot = select_target(rows, mode="pilot", per_group=10, seed=42)
    assert len(full) == 1000 and len(pilot) == 60
    assert {row["sample_id"] for row in pilot} <= {row["sample_id"] for row in full}
    assert [row["sample_id"] for row in full] == [row["sample_id"] for row in select_target(rows, mode="full", seed=42)]


def test_normalized_question_cluster_never_crosses_splits():
    rows = [sample("1", "같은   질문"), sample("2", "같은 질문"), sample("3", "다른 질문")]
    output = assign_splits(rows, seed=7)
    assert len({row["benchmark_split"] for row in output[:2]}) == 1


def test_split_is_reproducible_and_export_has_no_annotator_data():
    rows = [sample(str(index), f"question {index}") for index in range(30)]
    first, second = assign_splits(deepcopy(rows)), assign_splits(deepcopy(rows))
    assert [row["benchmark_split"] for row in first] == [row["benchmark_split"] for row in second]
    from benchmarking.scripts.export_training_data import _export_row
    row = first[0]
    row["question"]["specialized_metric"] = "problem_solving_process"
    row["annotations"] = [ann(2).model_dump(mode="json")]
    exported = _export_row(row)
    assert "annotations" not in exported and "annotator_id" not in str(exported)
