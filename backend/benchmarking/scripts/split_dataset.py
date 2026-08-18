from __future__ import annotations

import argparse
from pathlib import Path

from benchmarking.io import read_jsonl, write_jsonl
from benchmarking.paths import DEFAULT_GOLD_PATH, SPLIT_DIR
from benchmarking.splitting import assign_splits


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalized-question-level 80/10/10 benchmark split")
    parser.add_argument("--input", type=Path, default=DEFAULT_GOLD_PATH)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output-all", type=Path, default=SPLIT_DIR / "gold_with_splits.jsonl")
    args = parser.parse_args()

    rows = assign_splits(read_jsonl(args.input), seed=args.seed)
    write_jsonl(args.output_all, rows)
    for split in ("train", "validation", "test"):
        subset = [r for r in rows if r.get("benchmark_split") == split]
        write_jsonl(SPLIT_DIR / f"{split}.jsonl", subset)
        print(f"{split}: {len(subset)}")
    print(f"all: {len(rows)} -> {args.output_all}")


if __name__ == "__main__":
    main()
