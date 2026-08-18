from __future__ import annotations

import argparse
import json

from benchmarking.io import read_jsonl
from benchmarking.paths import target_path
from benchmarking.reporting import summarize
from benchmarking.storage import AnnotationStore
from benchmarking.workflow import configured_min_annotations, current_rubric_version


def main() -> None:
    parser = argparse.ArgumentParser(description="Print annotation progress and agreement statistics")
    parser.add_argument("--mode", choices=("pilot", "full"), default="full")
    args = parser.parse_args()
    store = AnnotationStore()
    report = summarize(
        read_jsonl(target_path(args.mode)), store.load_annotations(), store.list_annotators(), store.load_adjudications(),
        rubric_version=current_rubric_version(), min_annotations=configured_min_annotations(),
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
