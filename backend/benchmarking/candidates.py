from __future__ import annotations

import hashlib
import random
from pathlib import Path
from typing import Iterable

from .io import read_json
from .paths import QUESTION_BANK_DIR
from .rubric import group_metadata

EXPERIENCE_DIRS = {
    "NEW": "new",
    "EXPERIENCED": "experienced",
}


def normalize_question(text: str) -> str:
    return " ".join(text.split()).strip()


def source_id_from_path(source_file: str | None, question: str) -> str:
    if source_file:
        stem = Path(source_file.replace("\\", "/")).stem
        if stem:
            return stem
    return "q_" + hashlib.sha1(normalize_question(question).encode("utf-8")).hexdigest()[:16]


def _load_bank_records(experience: str, category: str, expression: str) -> list[dict]:
    dirname = EXPERIENCE_DIRS[experience]
    path = QUESTION_BANK_DIR / dirname / f"{category}__{expression}.json"
    if not path.exists():
        return []
    data = read_json(path)
    questions = data.get("questions", [])
    if not isinstance(questions, list):
        raise ValueError(f"{path}: questions must be a list")
    out: list[dict] = []
    for q in questions:
        if not isinstance(q, dict) or not isinstance(q.get("question"), str):
            continue
        item = dict(q)
        item["_bank_file"] = str(path.relative_to(QUESTION_BANK_DIR)).replace("\\", "/")
        item["_experience"] = experience
        out.append(item)
    return out


def collect_group_pool(group_id: str, experiences: Iterable[str]) -> list[dict]:
    meta = group_metadata(group_id)
    pool: list[dict] = []
    seen: set[str] = set()
    for experience in experiences:
        for domain in meta["domains"]:
            for row in _load_bank_records(experience, domain["category"], domain["expression"]):
                question = normalize_question(row["question"])
                if not question or question in seen:
                    continue
                seen.add(question)
                pool.append(row)
    return pool


class AIHubAnswerResolver:
    """Resolve bank source_file entries to original AIHub label JSON answers.

    Direct relative path is tried first. If that fails, a basename index of JSON files
    under the supplied root is built lazily. This supports local layouts that add an
    extra enclosing directory while preserving the original filenames.
    """

    def __init__(self, root: Path | None):
        self.root = root.resolve() if root else None
        self._basename_index: dict[str, Path] | None = None

    def _direct_path(self, source_file: str) -> Path | None:
        if self.root is None:
            return None
        rel = Path(source_file.replace("\\", "/"))
        direct = self.root / rel
        return direct if direct.is_file() else None

    def _ensure_index(self) -> None:
        if self.root is None or self._basename_index is not None:
            return
        index: dict[str, Path] = {}
        for p in self.root.rglob("*.json"):
            index.setdefault(p.name, p)
        self._basename_index = index

    def resolve(self, source_file: str | None) -> tuple[str, bool, str | None]:
        if self.root is None or not source_file:
            return "", False, None
        path = self._direct_path(source_file)
        if path is None:
            self._ensure_index()
            assert self._basename_index is not None
            path = self._basename_index.get(Path(source_file.replace("\\", "/")).name)
        if path is None:
            return "", False, None
        try:
            data = read_json(path)
            answer = data["dataSet"]["answer"]["raw"]["text"]
        except (KeyError, TypeError, ValueError):
            return "", False, str(path)
        if not isinstance(answer, str) or not answer.strip():
            return "", False, str(path)
        return answer.strip(), True, str(path)


def build_candidates(
    *,
    per_group: int,
    experiences: list[str],
    seed: int,
    aihub_root: Path | None = None,
) -> list[dict]:
    if per_group <= 0:
        raise ValueError("per_group must be > 0")
    rng = random.Random(seed)
    resolver = AIHubAnswerResolver(aihub_root)

    # Use rules.json order as the canonical group order.
    from .rubric import load_rules

    result: list[dict] = []
    global_seen: set[str] = set()
    for group in load_rules()["groups"]:
        gid = group["id"]
        meta = group_metadata(gid)
        pool = collect_group_pool(gid, experiences)
        rng.shuffle(pool)
        selected: list[dict] = []
        for row in pool:
            qtext = normalize_question(row["question"])
            if qtext in global_seen:
                continue
            global_seen.add(qtext)
            selected.append(row)
            if len(selected) >= per_group:
                break
        if len(selected) < per_group:
            raise ValueError(
                f"group {gid!r} has only {len(selected)} unique usable questions; requested {per_group}"
            )
        for row in selected:
            question = normalize_question(row["question"])
            source_file = row.get("source_file")
            source_id = source_id_from_path(source_file, question)
            answer_text, attached, resolved_source = resolver.resolve(source_file)
            result.append(
                {
                    "benchmark_version": "1.0",
                    "sample_id": "",  # filled after all groups are collected
                    "source": {
                        "dataset": "AIHub_ICT_Interview",
                        "experience": row.get("_experience"),
                        "source_question_id": source_id,
                        "source_answer_id": source_id,
                        "source_file": source_file,
                        "bank_file": row.get("_bank_file"),
                        "occurrence_count": row.get("occurrence_count"),
                        "answer_intent": row.get("answer_intent"),
                        "answer_attached": attached,
                        "resolved_source_file": resolved_source,
                    },
                    "question": {
                        "text": question,
                        "group": gid,
                        "group_name": meta["name"],
                        "specialized_metric": meta["specialized_metric"],
                    },
                    "answer": {"text": answer_text},
                    "annotations": [],
                    "gold": None,
        "benchmark_split": None,
                }
            )
    for idx, row in enumerate(result, start=1):
        row["sample_id"] = f"IRB_{idx:06d}"
    return result
