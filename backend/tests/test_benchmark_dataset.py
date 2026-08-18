from __future__ import annotations

import json

import pytest

from app.main import app
from app.routers.benchmark import _cached_dataset, _store
from benchmarking import dataset
from benchmarking.dataset import DatasetError, PortableDataset, resolve_audio_path, resolve_dataset_root
from benchmarking.paths import DATA_DIR_ENV


def _candidate(sample_id: str, *, group: str | None = "resume") -> dict:
    return {
        "sample_id": sample_id,
        "source": {
            "dataset": "AIHub_ICT_Interview",
            "source_sample_id": sample_id,
            "source_split": "train",
            "experience": "NEW",
        },
        "question": {
            "text": f"질문 {sample_id}",
            "group": group,
            "group_name": "자기소개·이력" if group else None,
        },
        "answer": {"text": f"답변 {sample_id}", "word_count": 1},
        "audio": {
            "question_wav": f"audio/train/question/{sample_id}.wav",
            "answer_wav": f"audio/train/answer/{sample_id}.wav",
        },
        "metadata": {"experience": "NEW"},
    }


def _write_dataset(root, rows: list[dict], candidates: list[dict] | None = None) -> None:
    (root / "qa_pairs.jsonl").write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )
    if candidates is not None:
        (root / "benchmark_candidates.jsonl").write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in candidates) + "\n",
            encoding="utf-8",
        )


def test_dataset_root_env_has_priority(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv(dataset.DATASET_ENV, str(tmp_path))
    assert resolve_dataset_root() == tmp_path.resolve()


def test_qa_pair_and_candidate_index_lookup(tmp_path) -> None:
    _write_dataset(tmp_path, [{"question": {"text": "원문"}}], [_candidate("42")])
    loaded = PortableDataset(tmp_path)
    assert len(loaded.qa_pairs) == 1
    assert loaded.get("42")["answer"]["text"] == "답변 42"
    items, total = loaded.list(group="resume", source_split="train", experience="new")
    assert total == 1
    assert items[0]["sample_id"] == "42"


def test_group_mapping_reports_unmatched_and_ambiguous(tmp_path, monkeypatch) -> None:
    rows = [
        {
            "source": {"source_split": "train"},
            "metadata": {"experience": "NEW"},
            "question": {"text": "mapped"},
            "answer": {"text": "answer", "word_count": 1},
            "audio": {"question_wav": "audio/train/question/1.wav", "answer_wav": "audio/train/answer/1.wav"},
        },
        {
            "source": {"source_split": "train"},
            "metadata": {"experience": "NEW"},
            "question": {"text": "unmatched"},
            "answer": {"text": "answer", "word_count": 1},
            "audio": {"question_wav": "audio/train/question/2.wav", "answer_wav": "audio/train/answer/2.wav"},
        },
        {
            "source": {"source_split": "train"},
            "metadata": {"experience": "NEW"},
            "question": {"text": "ambiguous"},
            "answer": {"text": "answer", "word_count": 1},
            "audio": {"question_wav": "audio/train/question/3.wav", "answer_wav": "audio/train/answer/3.wav"},
        },
    ]
    _write_dataset(tmp_path, rows)
    one = dataset._BankMatch("resume", "자기소개·이력", "NEW", "background", "c_person", "mapped", "1.json")
    a = dataset._BankMatch("resume", "자기소개·이력", "NEW", "background", "c_person", "ambiguous", "3.json")
    b = dataset._BankMatch("values_personality", "가치관·성향", "NEW", "background", "c_value", "ambiguous", "3.json")
    monkeypatch.setattr(
        dataset,
        "_build_bank_indexes",
        lambda: ({"1": [one], "3": [a, b]}, {"mapped": [one], "ambiguous": [a, b]}),
    )

    build = dataset.build_portable_candidates(tmp_path)
    assert build.report["total_qa_samples"] == 3
    assert build.report["group_mapping_success"] == 1
    assert len(build.unmatched) == 1
    assert len(build.ambiguous) == 1
    assert build.rows[0]["question"]["group"] == "resume"
    assert build.rows[1]["question"]["group"] is None
    assert build.rows[2]["question"]["group"] is None


def test_audio_relative_path_resolution_rejects_escape(tmp_path) -> None:
    audio = tmp_path / "audio" / "train" / "question" / "1.wav"
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b"RIFF")
    assert resolve_audio_path(tmp_path, "audio/train/question/1.wav") == audio.resolve()
    with pytest.raises(DatasetError):
        resolve_audio_path(tmp_path, "../outside.wav")


def test_benchmark_list_detail_audio_and_path_traversal(tmp_path, monkeypatch) -> None:
    sample = _candidate("safe")
    _write_dataset(tmp_path, [{"sample_id": "safe"}], [sample])
    for relative in (sample["audio"]["question_wav"], sample["audio"]["answer_wav"]):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"RIFF\x00\x00\x00\x00WAVE")

    monkeypatch.setenv(dataset.DATASET_ENV, str(tmp_path))
    _cached_dataset.cache_clear()
    try:
        from fastapi.testclient import TestClient

        client = TestClient(app)
        page = client.get("/benchmark/samples?group=resume&limit=1")
        assert page.status_code == 200
        assert page.json()["items"][0]["sample_id"] == "safe"
        detail = client.get("/benchmark/samples/safe")
        assert detail.status_code == 200
        audio = client.get("/benchmark/samples/safe/audio/question")
        assert audio.status_code == 200
        assert audio.headers["content-type"].startswith("audio/wav")
        assert client.get("/benchmark/samples/%2E%2E%2Foutside").status_code == 404
    finally:
        _cached_dataset.cache_clear()


def test_uuid_registry_assignment_and_private_annotation_api(tmp_path, monkeypatch) -> None:
    dataset_root = tmp_path / "dataset"
    data_root = tmp_path / "annotation-data"
    dataset_root.mkdir()
    _write_dataset(dataset_root, [{"sample_id": "safe"}], [_candidate("safe")])
    monkeypatch.setenv(dataset.DATASET_ENV, str(dataset_root))
    monkeypatch.setenv(DATA_DIR_ENV, str(data_root))
    _cached_dataset.cache_clear()
    _store.cache_clear()
    try:
        from fastapi.testclient import TestClient

        client = TestClient(app)
        registered = client.post("/benchmark/annotators", json={"name": "Evaluator", "affiliation_or_major": "ICT"})
        assert registered.status_code == 201
        annotator_id = registered.json()["annotator_id"]
        assigned = client.get(f"/benchmark/assignments/next?annotator_id={annotator_id}&mode=pilot")
        assert assigned.status_code == 200
        payload = assigned.json()
        assert payload["sample"]["sample_id"] == "safe"
        assert "annotations" not in payload["sample"]
        saved = client.post(
            "/benchmark/samples/safe/annotations",
            json={"annotator_id": annotator_id, "rubric_version": payload["rubric_version"], "target_mode": "pilot", "scores": {"relevance": 2, "specificity": 1, "coherence": 2, "specialized": 1}, "confidence": 2, "note": "private"},
        )
        assert saved.status_code == 200
        assert "name" not in saved.json()
        assert client.get(f"/benchmark/assignments/next?annotator_id={annotator_id}&mode=pilot").status_code == 404
    finally:
        _cached_dataset.cache_clear()
        _store.cache_clear()
