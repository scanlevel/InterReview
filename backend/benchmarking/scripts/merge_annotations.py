from __future__ import annotations

import argparse
from pathlib import Path

from benchmarking.io import read_jsonl, write_jsonl
from benchmarking.storage import AnnotationStore
from benchmarking.workflow import current_rubric_version


def main() -> None:
    parser = argparse.ArgumentParser(description="Attach current-rubric UUID annotations to target rows")
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows = read_jsonl(args.target)
    target_ids = {str(row["sample_id"]) for row in rows}
    grouped = {sample_id: [] for sample_id in target_ids}
    for annotation in AnnotationStore().load_annotations(rubric_version=current_rubric_version()):
        if annotation.sample_id in grouped:
            grouped[annotation.sample_id].append(annotation.model_dump(mode="json"))
    write_jsonl(args.output, [{**row, "annotations": grouped[str(row["sample_id"])]} for row in rows])
    print(f"merged {len(rows)} target samples -> {args.output}")


if __name__ == "__main__":
    main()
