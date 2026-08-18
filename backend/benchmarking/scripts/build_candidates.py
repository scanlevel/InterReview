from __future__ import annotations

import argparse
from pathlib import Path

from benchmarking.candidates import build_candidates
from benchmarking.io import write_jsonl
from benchmarking.paths import DEFAULT_CANDIDATES_PATH, ensure_data_dirs


def main() -> None:
    parser = argparse.ArgumentParser(description="Build balanced InterReview benchmark candidates")
    parser.add_argument("--per-group", type=int, default=10, help="candidate count per rules.json group")
    parser.add_argument(
        "--experience",
        choices=["NEW", "EXPERIENCED", "ALL"],
        default="NEW",
        help="question-bank experience scope",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--aihub-root", type=Path, default=None, help="AIHub label-data root used to attach answer.raw.text")
    parser.add_argument("--output", type=Path, default=DEFAULT_CANDIDATES_PATH)
    args = parser.parse_args()

    experiences = ["NEW", "EXPERIENCED"] if args.experience == "ALL" else [args.experience]
    ensure_data_dirs()
    rows = build_candidates(
        per_group=args.per_group,
        experiences=experiences,
        seed=args.seed,
        aihub_root=args.aihub_root,
    )
    write_jsonl(args.output, rows)
    attached = sum(1 for r in rows if r["source"].get("answer_attached"))
    print(f"wrote {len(rows)} candidates -> {args.output}")
    print(f"answers attached: {attached}/{len(rows)}")
    if attached < len(rows):
        print("NOTE: empty answers cannot be annotated meaningfully. Re-run with --aihub-root if needed.")


if __name__ == "__main__":
    main()
