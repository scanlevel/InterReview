from __future__ import annotations

import argparse
import json

from benchmarking.dataset import load_dataset
from benchmarking.selection import select_target, selection_counts, write_target


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a deterministic pilot or full annotation target")
    parser.add_argument("--mode", choices=("pilot", "full"), required=True)
    parser.add_argument("--per-group", type=int, default=10)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()
    rows = select_target(load_dataset().samples, mode=args.mode, per_group=args.per_group, seed=args.seed)
    path = write_target(rows, mode=args.mode)
    print(json.dumps({"mode": args.mode, "samples": len(rows), "groups": selection_counts(rows), "path": str(path)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
