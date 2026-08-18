from __future__ import annotations

import argparse
from pathlib import Path

from benchmarking.io import read_jsonl
from benchmarking.paths import DEFAULT_CANDIDATES_PATH
from benchmarking.validation import validate_rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate benchmark JSONL")
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_CANDIDATES_PATH)
    parser.add_argument("--require-answer", action="store_true")
    args = parser.parse_args()

    rows = read_jsonl(args.path)
    errors = validate_rows(rows, require_answer=args.require_answer)
    if errors:
        print(f"FAILED: {len(errors)} error(s)")
        for err in errors:
            print(f"- {err}")
        raise SystemExit(1)
    print(f"OK: {len(rows)} rows validated: {args.path}")


if __name__ == "__main__":
    main()
