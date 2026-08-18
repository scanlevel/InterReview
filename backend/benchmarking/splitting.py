from __future__ import annotations

import random
from collections import Counter, defaultdict

from .candidates import normalize_question


def _question_key(row: dict) -> str:
    return normalize_question(row["question"]["text"])


def assign_splits(rows: list[dict], *, seed: int = 42, train_ratio: float = 0.8, validation_ratio: float = 0.1, test_ratio: float = 0.1) -> list[dict]:
    """Keep normalized-question clusters together and preserve group ratios approximately."""
    if abs(train_ratio + validation_ratio + test_ratio - 1.0) > 1e-9:
        raise ValueError("split ratios must sum to 1.0")
    key_rows = defaultdict(list)
    key_group: dict[str, str] = {}
    for row in (item for item in rows if item.get("gold") is not None):
        key = _question_key(row)
        if not key:
            raise ValueError(f"sample {row.get('sample_id')} has empty normalized question")
        group = row["question"]["group"]
        if key in key_group and key_group[key] != group:
            raise ValueError(f"same normalized question appears in multiple groups: {key!r}")
        key_rows[key].append(row)
        key_group[key] = group

    by_group = defaultdict(list)
    for key, group in key_group.items():
        by_group[group].append(key)

    assignment: dict[str, str] = {}
    ratios = {"train": train_ratio, "validation": validation_ratio, "test": test_ratio}
    for group, keys in sorted(by_group.items()):
        keys = sorted(keys)
        random.Random(f"{seed}:{group}").shuffle(keys)
        total = sum(len(key_rows[key]) for key in keys)
        targets = {split: total * ratio for split, ratio in ratios.items()}
        assigned = Counter()
        for key in sorted(keys, key=lambda item: -len(key_rows[item])):
            split = min(ratios, key=lambda name: (assigned[name] - targets[name], assigned[name]))
            assignment[key] = split
            assigned[split] += len(key_rows[key])

    output = []
    for row in rows:
        copied = dict(row)
        copied["benchmark_split"] = assignment.get(_question_key(row)) if row.get("gold") is not None else None
        output.append(copied)
    return output
