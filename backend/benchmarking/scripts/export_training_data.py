from __future__ import annotations

import argparse
from pathlib import Path

from benchmarking.io import read_jsonl, write_jsonl
from benchmarking.paths import EXPORT_DIR, SPLIT_DIR
from benchmarking.rubric import group_metadata


def _export_row(row: dict) -> dict:
    gold = row["gold"]["scores"]
    return {
        "sample_id": row["sample_id"],
        "input": {
            "question_group": row["question"]["group"],
            "specialized_metric": row["question"].get("specialized_metric")
            or group_metadata(row["question"]["group"])["specialized_metric"],
            "question": row["question"]["text"],
            "answer": row["answer"]["text"],
        },
        "output": {
            "relevance": gold["relevance"],
            "specificity": gold["specificity"],
            "coherence": gold["coherence"],
            "specialized": gold["specialized"],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export derived model-training/evaluation JSONL")
    parser.add_argument("--split-dir", type=Path, default=SPLIT_DIR)
    parser.add_argument("--output-dir", type=Path, default=EXPORT_DIR)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for split in ("train", "validation", "test"):
        source = args.split_dir / f"{split}.jsonl"
        rows = [_export_row(r) for r in read_jsonl(source)]
        target = args.output_dir / f"{split}_model.jsonl"
        write_jsonl(target, rows)
        print(f"{split}: {len(rows)} -> {target}")


if __name__ == "__main__":
    main()
