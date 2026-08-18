"""Portable ICT Q-A dataset loading, group mapping, and indexing.

This module intentionally has no rubric, score, annotation, or gold-data
concepts.  It only turns the portable ``qa_pairs.jsonl`` records into the
derived records needed to inspect question/answer/audio pairs in the app.
"""

from __future__ import annotations

import hashlib
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from app.services.questions import _load_domain_questions, _load_rules

from .candidates import normalize_question
from .io import read_json, read_jsonl, write_json, write_jsonl

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATASET_DIR = BACKEND_DIR / "data" / "ict_qa_dataset"
DATASET_ENV = "INTERREVIEW_ICT_QA_DATASET_DIR"


class DatasetError(RuntimeError):
    """Raised when the configured portable dataset cannot be used."""


def resolve_dataset_root(explicit: str | Path | None = None) -> Path:
    """Resolve the dataset root: explicit path, env var, then local defaults."""
    if explicit is not None:
        return Path(explicit).expanduser().resolve()

    configured = os.environ.get(DATASET_ENV, "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return DEFAULT_DATASET_DIR.resolve()


def _section(row: dict[str, Any], name: str) -> dict[str, Any]:
    value = row.get(name)
    return value if isinstance(value, dict) else {}


def _text(row: dict[str, Any], name: str) -> str:
    value = _section(row, name).get("text")
    if isinstance(value, str):
        return value
    value = row.get(f"{name}_text")
    return value if isinstance(value, str) else ""


def _audio_path(row: dict[str, Any], side: str) -> str:
    section = _section(row, side)
    value = section.get("audio_path")
    if not isinstance(value, str):
        audio = row.get("audio")
        if isinstance(audio, dict):
            value = audio.get(f"{side}_wav")
    if not isinstance(value, str):
        value = row.get(f"{side}_wav")
    if not isinstance(value, str):
        return ""
    return value.replace("\\", "/").strip()


def _source(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("source")
    return value if isinstance(value, dict) else {}


def _source_split(row: dict[str, Any]) -> str | None:
    source = _source(row)
    value = source.get("source_split") or source.get("split") or row.get("source_split")
    return str(value).strip() if value is not None and str(value).strip() else None


def _experience(row: dict[str, Any]) -> str | None:
    metadata = row.get("metadata")
    source = _source(row)
    value = metadata.get("experience") if isinstance(metadata, dict) else None
    value = value or source.get("experience") or row.get("experience")
    if value is None or not str(value).strip():
        return None
    normalized = str(value).strip().upper()
    return normalized if normalized in {"NEW", "EXPERIENCED"} else normalized


def _word_count(row: dict[str, Any], text: str) -> int:
    value = _section(row, "answer").get("word_count")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return len(text.split())


def _numeric_suffix(path: str) -> str | None:
    stem = PurePosixPath(path).stem
    match = re.search(r"(\d+)$", stem)
    return match.group(1) if match else None


def _source_sample_id(row: dict[str, Any], question_audio: str) -> str | None:
    source = _source(row)
    for value in (
        row.get("source_sample_id"),
        source.get("source_sample_id"),
        row.get("sample_id"),
        source.get("sample_id"),
    ):
        if value is not None and str(value).strip():
            return str(value).strip()
    return _numeric_suffix(question_audio)


def _identity_for_hash(row: dict[str, Any], index: int, question_audio: str, answer_audio: str) -> str:
    source = _source(row)
    for key in ("json_path", "source_json_path", "source_file", "path"):
        value = row.get(key) or source.get(key)
        if isinstance(value, str) and value.strip():
            return value.replace("\\", "/").strip()
    # Updated JSONL does not retain the source JSON path.  The paired audio
    # paths are stable enough for its fallback identity; index disambiguates a
    # malformed duplicate record.
    return f"{question_audio}|{answer_audio}|row:{index}"


def _safe_audio_path(dataset_root: Path, relative_path: str) -> Path:
    """Resolve a dataset-owned relative audio path and reject escapes."""
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise DatasetError("audio path is empty")
    root = dataset_root.resolve()
    candidate = (root / Path(relative_path.replace("\\", "/"))).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise DatasetError("audio path escapes the dataset root") from error
    return candidate


def resolve_audio_path(dataset_root: str | Path, relative_path: str) -> Path:
    """Public safe resolver used by the API and tests."""
    return _safe_audio_path(Path(dataset_root), relative_path)


@dataclass(frozen=True)
class _BankMatch:
    group_id: str
    group_name: str
    experience: str
    category: str
    expression: str
    question: str
    source_file: str | None


@dataclass(frozen=True)
class _PreparedRow:
    index: int
    sample_id: str
    source_sample_id: str | None
    question_text: str
    answer_text: str
    question_audio: str
    answer_audio: str
    source_split: str | None
    experience: str | None
    metadata: dict[str, Any]
    raw: dict[str, Any]


@dataclass
class CandidateBuild:
    rows: list[dict[str, Any]]
    unmatched: list[dict[str, Any]]
    ambiguous: list[dict[str, Any]]
    report: dict[str, Any]


def _prepare_rows(rows: list[dict[str, Any]]) -> list[_PreparedRow]:
    token_rows: defaultdict[str, list[int]] = defaultdict(list)
    prepared: list[_PreparedRow] = []
    for index, raw in enumerate(rows):
        question_text = _text(raw, "question")
        answer_text = _text(raw, "answer")
        question_audio = _audio_path(raw, "question")
        answer_audio = _audio_path(raw, "answer")
        source_sample_id = _source_sample_id(raw, question_audio)
        if source_sample_id and source_sample_id == _numeric_suffix(answer_audio):
            token_rows[source_sample_id].append(index)
        metadata = raw.get("metadata")
        prepared.append(
            _PreparedRow(
                index=index,
                sample_id="",
                source_sample_id=source_sample_id,
                question_text=question_text,
                answer_text=answer_text,
                question_audio=question_audio,
                answer_audio=answer_audio,
                source_split=_source_split(raw),
                experience=_experience(raw),
                metadata=dict(metadata) if isinstance(metadata, dict) else {},
                raw=raw,
            )
        )

    used_ids: set[str] = set()
    result: list[_PreparedRow] = []
    for row in prepared:
        token = row.source_sample_id
        has_unique_pair = bool(token and len(token_rows[token]) == 1)
        identity = _identity_for_hash(row.raw, row.index, row.question_audio, row.answer_audio)
        sample_id = token if has_unique_pair else f"sample_{hashlib.sha256(identity.encode('utf-8')).hexdigest()}"
        if sample_id in used_ids:
            sample_id = f"sample_{hashlib.sha256(f'{identity}|duplicate:{row.index}'.encode('utf-8')).hexdigest()}"
        used_ids.add(sample_id)
        result.append(
            _PreparedRow(
                index=row.index,
                sample_id=sample_id,
                source_sample_id=token,
                question_text=row.question_text,
                answer_text=row.answer_text,
                question_audio=row.question_audio,
                answer_audio=row.answer_audio,
                source_split=row.source_split,
                experience=row.experience,
                metadata=row.metadata,
                raw=row.raw,
            )
        )
    return result


def _add_match(
    index: dict[str, list[_BankMatch]], key: str, match: _BankMatch
) -> None:
    if not key:
        return
    bucket = index.setdefault(key, [])
    identity = (match.group_id, match.experience, match.category, match.expression, match.source_file)
    if not any(
        (item.group_id, item.experience, item.category, item.expression, item.source_file) == identity
        for item in bucket
    ):
        bucket.append(match)


def _bank_source_ids(record: dict[str, Any]) -> set[str]:
    values: set[str] = set()
    for key in ("source_sample_id", "sample_id"):
        value = record.get(key)
        if value is not None and str(value).strip():
            values.add(str(value).strip())
    source_file = record.get("source_file")
    if isinstance(source_file, str) and source_file.strip():
        stem = PurePosixPath(source_file.replace("\\", "/")).stem
        values.add(stem)
        numeric = _numeric_suffix(source_file)
        if numeric:
            values.add(numeric)
    return values


def _build_bank_indexes() -> tuple[dict[str, list[_BankMatch]], dict[str, list[_BankMatch]]]:
    """Build source-id and exact-question indexes from the existing bank."""
    rules = _load_rules()
    by_source_id: dict[str, list[_BankMatch]] = {}
    by_text: dict[str, list[_BankMatch]] = {}
    for experience in ("NEW", "EXPERIENCED"):
        for group in rules["groups"]:
            for domain in group["domains"]:
                records = _load_domain_questions(
                    experience, domain["category"], domain["expression"]
                )
                for record in records:
                    question = record.get("question")
                    if not isinstance(question, str) or not question.strip():
                        continue
                    match = _BankMatch(
                        group_id=group["id"],
                        group_name=group["name"],
                        experience=experience,
                        category=domain["category"],
                        expression=domain["expression"],
                        question=question,
                        source_file=record.get("source_file"),
                    )
                    for source_id in _bank_source_ids(record):
                        _add_match(by_source_id, source_id, match)
                    _add_match(by_text, normalize_question(question), match)
    return by_source_id, by_text


def _group_options(matches: Iterable[_BankMatch]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for match in matches:
        unique.setdefault(
            match.group_id,
            {
                "group": match.group_id,
                "group_name": match.group_name,
                "experience": match.experience,
                "category": match.category,
                "expression": match.expression,
                "source_file": match.source_file,
            },
        )
    return list(unique.values())


def _match_group(
    row: _PreparedRow,
    by_source_id: dict[str, list[_BankMatch]],
    by_text: dict[str, list[_BankMatch]],
) -> tuple[dict[str, Any] | None, str, list[dict[str, Any]]]:
    source_matches = by_source_id.get(row.source_sample_id or "", [])
    if source_matches:
        options = _group_options(source_matches)
        if len(options) == 1:
            return options[0], "source_sample_id", options
        return None, "source_sample_id", options

    text_matches = by_text.get(normalize_question(row.question_text), [])
    options = _group_options(text_matches)
    if len(options) == 1:
        return options[0], "question_exact", options
    return None, "question_exact", options


def _candidate_row(
    row: _PreparedRow,
    group: dict[str, Any] | None,
    dataset_name: str,
) -> dict[str, Any]:
    return {
        "sample_id": row.sample_id,
        "source": {
            "dataset": dataset_name,
            "source_sample_id": row.source_sample_id or row.sample_id,
            "source_split": row.source_split,
            "experience": row.experience,
        },
        "question": {
            "text": row.question_text,
            "group": group["group"] if group else None,
            "group_name": group["group_name"] if group else None,
        },
        "answer": {
            "text": row.answer_text,
            "word_count": _word_count(row.raw, row.answer_text),
        },
        "audio": {
            "question_wav": row.question_audio,
            "answer_wav": row.answer_audio,
        },
        "metadata": row.metadata,
    }


def _report_audio_exists(root: Path, relative_path: str) -> bool:
    try:
        return resolve_audio_path(root, relative_path).is_file()
    except DatasetError:
        return False


def build_portable_candidates(
    dataset_root: str | Path,
    *,
    dataset_name: str = "AIHub_ICT_Interview",
) -> CandidateBuild:
    """Build derived candidates and mapping reports without changing qa_pairs."""
    root = Path(dataset_root).expanduser().resolve()
    qa_path = root / "qa_pairs.jsonl"
    if not qa_path.is_file():
        raise DatasetError(f"qa_pairs.jsonl not found: {qa_path}")

    raw_rows = read_jsonl(qa_path)
    prepared = _prepare_rows(raw_rows)
    by_source_id, by_text = _build_bank_indexes()

    candidates: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    group_counts: Counter[str] = Counter()
    method_counts: Counter[str] = Counter()
    for row in prepared:
        group, method, options = _match_group(row, by_source_id, by_text)
        candidate = _candidate_row(row, group, dataset_name)
        candidates.append(candidate)
        if group:
            group_counts[group["group"]] += 1
            method_counts[method] += 1
        elif options:
            ambiguous.append(
                {
                    "sample_id": row.sample_id,
                    "source_sample_id": row.source_sample_id,
                    "question": row.question_text,
                    "match_method": method,
                    "candidate_groups": options,
                }
            )
        else:
            unmatched.append(
                {
                    "sample_id": row.sample_id,
                    "source_sample_id": row.source_sample_id,
                    "question": row.question_text,
                    "normalized_question": normalize_question(row.question_text),
                    "match_method": method,
                }
            )

    question_audio_exists = sum(
        1 for row in candidates if _report_audio_exists(root, row["audio"]["question_wav"])
    )
    answer_audio_exists = sum(
        1 for row in candidates if _report_audio_exists(root, row["audio"]["answer_wav"])
    )
    audio_missing = sum(
        1
        for row in candidates
        if not (
            _report_audio_exists(root, row["audio"]["question_wav"])
            and _report_audio_exists(root, row["audio"]["answer_wav"])
        )
    )
    manifest_path = root / "manifest.json"
    manifest = read_json(manifest_path) if manifest_path.is_file() else {}
    report = {
        "dataset_root": str(root),
        "manifest_sample_count": manifest.get("sample_count"),
        "total_qa_samples": len(candidates),
        "group_mapping_success": len(candidates) - len(unmatched) - len(ambiguous),
        "group_unmatched": len(unmatched),
        "group_ambiguous": len(ambiguous),
        "group_counts": dict(group_counts),
        "match_methods": dict(method_counts),
        "question_wav_exists": question_audio_exists,
        "answer_wav_exists": answer_audio_exists,
        "audio_missing_samples": audio_missing,
    }
    return CandidateBuild(candidates, unmatched, ambiguous, report)


def write_candidate_build(
    dataset_root: str | Path,
    build: CandidateBuild,
    *,
    output_path: str | Path | None = None,
) -> Path:
    """Write the derived JSONL and separate mapping/report files."""
    root = Path(dataset_root).expanduser().resolve()
    candidate_path = Path(output_path).expanduser().resolve() if output_path else root / "benchmark_candidates.jsonl"
    reports_dir = root / "reports"
    write_jsonl(candidate_path, build.rows)
    write_jsonl(reports_dir / "unmatched_questions.jsonl", build.unmatched)
    write_jsonl(reports_dir / "ambiguous_questions.jsonl", build.ambiguous)
    write_json(reports_dir / "benchmark_mapping_report.json", build.report)
    return candidate_path


def _public_candidate(row: dict[str, Any]) -> dict[str, Any]:
    """Keep API data limited to the no-score candidate contract."""
    source = row.get("source") if isinstance(row.get("source"), dict) else {}
    question = row.get("question") if isinstance(row.get("question"), dict) else {}
    answer = row.get("answer") if isinstance(row.get("answer"), dict) else {}
    audio = row.get("audio") if isinstance(row.get("audio"), dict) else {}
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return {
        "sample_id": str(row.get("sample_id", "")),
        "source": {
            "dataset": str(source.get("dataset") or "AIHub_ICT_Interview"),
            "source_sample_id": str(source["source_sample_id"]) if source.get("source_sample_id") is not None else None,
            "source_split": str(source["source_split"]) if source.get("source_split") is not None else None,
            "experience": str(source["experience"]).upper() if source.get("experience") is not None else None,
        },
        "question": {
            "text": str(question.get("text") or ""),
            "group": str(question["group"]) if question.get("group") is not None else None,
            "group_name": str(question["group_name"]) if question.get("group_name") is not None else None,
        },
        "answer": {
            "text": str(answer.get("text") or ""),
            "word_count": int(answer.get("word_count") or 0),
        },
        "audio": {
            "question_wav": str(audio.get("question_wav") or ""),
            "answer_wav": str(audio.get("answer_wav") or ""),
        },
        "metadata": metadata,
    }


class PortableDataset:
    """One-process in-memory index of the portable dataset."""

    def __init__(self, root: str | Path, candidates_path: str | Path | None = None):
        self.root = Path(root).expanduser().resolve()
        qa_path = self.root / "qa_pairs.jsonl"
        if not qa_path.is_file():
            raise DatasetError(f"qa_pairs.jsonl not found: {qa_path}")
        # Read the source once to validate availability and to support the
        # no-derived-file fallback; never rewrite this file.
        self.qa_pairs = read_jsonl(qa_path)
        self.candidates_path = (
            Path(candidates_path).expanduser().resolve()
            if candidates_path is not None
            else self.root / "benchmark_candidates.jsonl"
        )
        if self.candidates_path.is_file():
            rows = read_jsonl(self.candidates_path)
        else:
            rows = build_portable_candidates(self.root).rows
        self.samples = [_public_candidate(row) for row in rows]
        self.by_id: dict[str, dict[str, Any]] = {}
        self.ids_by_group: defaultdict[str, list[str]] = defaultdict(list)
        self.ids_by_source_split: defaultdict[str, list[str]] = defaultdict(list)
        self.ids_by_experience: defaultdict[str, list[str]] = defaultdict(list)
        for sample in self.samples:
            sample_id = sample["sample_id"]
            if not sample_id:
                raise DatasetError("benchmark candidate has an empty sample_id")
            if sample_id in self.by_id:
                raise DatasetError(f"duplicate sample_id: {sample_id}")
            self.by_id[sample_id] = sample
            group = sample["question"]["group"]
            if group:
                self.ids_by_group[group].append(sample_id)
            source_split = sample["source"]["source_split"]
            if source_split:
                self.ids_by_source_split[source_split].append(sample_id)
            experience = sample["source"]["experience"]
            if experience:
                self.ids_by_experience[experience].append(sample_id)

    def get(self, sample_id: str) -> dict[str, Any] | None:
        return self.by_id.get(sample_id)

    def list(
        self,
        *,
        group: str | None = None,
        source_split: str | None = None,
        experience: str | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[list[dict[str, Any]], int]:
        ids: Iterable[str] = [sample["sample_id"] for sample in self.samples]
        for index in (
            self.ids_by_group.get(group, []) if group else None,
            self.ids_by_source_split.get(source_split, []) if source_split else None,
            self.ids_by_experience.get(experience.upper(), []) if experience else None,
        ):
            if index is not None:
                allowed = set(index)
                ids = [sample_id for sample_id in ids if sample_id in allowed]
        selected = list(ids)
        return [self.by_id[sample_id] for sample_id in selected[offset : offset + limit]], len(selected)

    def audio_path(self, sample_id: str, side: str) -> Path:
        sample = self.by_id.get(sample_id)
        if sample is None:
            raise DatasetError("unknown sample_id")
        if side not in {"question", "answer"}:
            raise DatasetError("unknown audio side")
        relative_path = sample["audio"][f"{side}_wav"]
        return resolve_audio_path(self.root, relative_path)

    def stats(self) -> dict[str, Any]:
        return {
            "total_qa_samples": len(self.qa_pairs),
            "indexed_samples": len(self.samples),
            "groups": {key: len(value) for key, value in sorted(self.ids_by_group.items())},
            "source_splits": {key: len(value) for key, value in sorted(self.ids_by_source_split.items())},
            "experiences": {key: len(value) for key, value in sorted(self.ids_by_experience.items())},
        }


def load_dataset(root: str | Path | None = None) -> PortableDataset:
    """Load one dataset; callers should cache this per process."""
    return PortableDataset(resolve_dataset_root(root))
