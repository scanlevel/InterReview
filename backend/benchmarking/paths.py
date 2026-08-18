from __future__ import annotations

import os
from pathlib import Path
from uuid import UUID

PACKAGE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = PACKAGE_DIR.parent
REPO_DIR = BACKEND_DIR.parent
QUESTION_BANK_DIR = BACKEND_DIR / "question_banks" / "ict"
RULES_PATH = QUESTION_BANK_DIR / "rules.json"
RUBRIC_PATH = PACKAGE_DIR / "rubric.json"
SCHEMA_PATH = PACKAGE_DIR / "schemas" / "benchmark_sample.schema.json"
DATA_DIR = PACKAGE_DIR / "data"
DATA_DIR_ENV = "INTERREVIEW_BENCHMARK_DATA_DIR"
CANDIDATE_DIR = DATA_DIR / "candidates"
ANNOTATION_DIR = DATA_DIR / "annotations"
TARGET_DIR = DATA_DIR / "targets"
ADJUDICATION_DIR = DATA_DIR / "adjudication"
GOLD_DIR = DATA_DIR / "gold"
SPLIT_DIR = DATA_DIR / "splits"
EXPORT_DIR = DATA_DIR / "exports"
DEFAULT_CANDIDATES_PATH = CANDIDATE_DIR / "candidates.jsonl"
DEFAULT_MERGED_PATH = GOLD_DIR / "merged_annotations.jsonl"
DEFAULT_GOLD_PATH = GOLD_DIR / "gold.jsonl"
DEFAULT_UNRESOLVED_PATH = ADJUDICATION_DIR / "unresolved.jsonl"
DEFAULT_ADJUDICATION_PATH = ADJUDICATION_DIR / "adjudicated.jsonl"
DEFAULT_REGISTRY_PATH = DATA_DIR / "annotators.jsonl"


def benchmark_data_dir(explicit: str | Path | None = None) -> Path:
    if explicit is not None:
        return Path(explicit).expanduser().resolve()
    configured = os.environ.get(DATA_DIR_ENV, "").strip()
    return Path(configured).expanduser().resolve() if configured else DATA_DIR.resolve()


def ensure_data_dirs(root: str | Path | None = None) -> None:
    base = benchmark_data_dir(root)
    for path in ("candidates", "annotations", "targets", "adjudication", "gold", "splits", "exports"):
        path = base / path
        path.mkdir(parents=True, exist_ok=True)


def annotation_path(annotator_id: str | UUID, root: str | Path | None = None) -> Path:
    normalized = str(UUID(str(annotator_id)))
    return benchmark_data_dir(root) / "annotations" / f"{normalized}.jsonl"


def registry_path(root: str | Path | None = None) -> Path:
    return benchmark_data_dir(root) / "annotators.jsonl"


def target_path(mode: str, root: str | Path | None = None) -> Path:
    if mode not in {"pilot", "full"}:
        raise ValueError("mode must be pilot or full")
    return benchmark_data_dir(root) / "targets" / f"{mode}.jsonl"


def adjudication_path(root: str | Path | None = None) -> Path:
    return benchmark_data_dir(root) / "adjudication" / "adjudicated.jsonl"
