from __future__ import annotations

import argparse

from benchmarking.io import read_jsonl, write_jsonl
from benchmarking.paths import DEFAULT_GOLD_PATH, DEFAULT_UNRESOLVED_PATH, target_path
from benchmarking.storage import AnnotationStore
from benchmarking.workflow import build_gold_rows, configured_min_annotations, current_rubric_version


def main() -> None:
    parser = argparse.ArgumentParser(description="Build unique-mode/adjudicated gold labels")
    parser.add_argument("--mode", choices=("pilot", "full"), default="full")
    parser.add_argument("--output", default=DEFAULT_GOLD_PATH)
    parser.add_argument("--unresolved", default=DEFAULT_UNRESOLVED_PATH)
    args = parser.parse_args()
    store = AnnotationStore()
    gold, pending = build_gold_rows(
        read_jsonl(target_path(args.mode)), store.load_annotations(), store.load_adjudications(),
        rubric_version=current_rubric_version(), min_annotations=configured_min_annotations(),
    )
    write_jsonl(args.output, gold)
    write_jsonl(args.unresolved, pending)
    print(f"gold: {len(gold)} -> {args.output}")
    print(f"pending/unresolved: {len(pending)} -> {args.unresolved}")


if __name__ == "__main__":
    main()
