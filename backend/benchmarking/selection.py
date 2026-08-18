from __future__ import annotations

import hashlib
from collections import Counter
from pathlib import Path
from typing import Literal

from .io import read_json, write_jsonl
from .paths import PACKAGE_DIR, target_path
from .rubric import load_rules

SELECTION_CONFIG_PATH = PACKAGE_DIR / "selection.json"
TargetMode = Literal["pilot", "full"]


def load_selection_config() -> dict:
    return read_json(SELECTION_CONFIG_PATH)


def _rank(sample_id: str, group: str, seed: int) -> str:
    return hashlib.sha256(f"{seed}:{group}:{sample_id}".encode("utf-8")).hexdigest()


def select_target(
    rows: list[dict],
    *,
    mode: TargetMode,
    per_group: int = 10,
    seed: int | None = None,
) -> list[dict]:
    """Select a reproducible pilot or 1,000-row full target from mapped rows."""
    config = load_selection_config()
    effective_seed = int(config["seed"] if seed is None else seed)
    groups = load_rules()["groups"]
    group_ids = [group["id"] for group in groups]
    configured_targets = config["group_targets"]
    if set(configured_targets) != set(group_ids):
        raise ValueError("selection.json group_targets must exactly match rules.json groups")
    if sum(configured_targets.values()) != config["full_target_size"]:
        raise ValueError("selection.json group targets do not sum to full_target_size")
    if mode == "pilot" and per_group <= 0:
        raise ValueError("per_group must be positive")

    pools: dict[str, list[dict]] = {group_id: [] for group_id in group_ids}
    for row in rows:
        group = row.get("question", {}).get("group")
        if group in pools:
            pools[group].append(row)

    selected: list[dict] = []
    for group_id in group_ids:
        pool = sorted(
            pools[group_id],
            key=lambda row: (_rank(str(row["sample_id"]), group_id, effective_seed), str(row["sample_id"])),
        )
        requested = per_group if mode == "pilot" else int(configured_targets[group_id])
        if mode == "full" and len(pool) < requested:
            raise ValueError(
                f"group {group_id!r} has {len(pool)} mapped rows; target requires {requested}"
            )
        for row in pool[: min(requested, len(pool))]:
            copied = dict(row)
            copied["benchmark"] = {
                "version": str(config["benchmark_version"]),
                "target_mode": mode,
                "selection_seed": effective_seed,
            }
            selected.append(copied)
    return selected


def selection_counts(rows: list[dict]) -> dict[str, int]:
    return dict(Counter(row["question"]["group"] for row in rows))


def write_target(
    rows: list[dict],
    *,
    mode: TargetMode,
    data_root: str | Path | None = None,
) -> Path:
    path = target_path(mode, data_root)
    write_jsonl(path, rows)
    return path
