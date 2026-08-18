from __future__ import annotations

import argparse
import json
from pathlib import Path

from benchmarking.dataset import (
    build_portable_candidates,
    resolve_dataset_root,
    write_candidate_build,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build no-score Q-A candidates from the portable ICT dataset"
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=None,
        help="portable dataset root; otherwise INTERREVIEW_ICT_QA_DATASET_DIR/defaults",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="derived JSONL path; default is <dataset-dir>/benchmark_candidates.jsonl",
    )
    args = parser.parse_args()

    root = resolve_dataset_root(args.dataset_dir)
    build = build_portable_candidates(root)
    output = write_candidate_build(root, build, output_path=args.output)

    print(f"전체 Q-A sample 수: {build.report['total_qa_samples']}")
    print(f"group 연결 성공 수: {build.report['group_mapping_success']}")
    print(f"group 미연결 수: {build.report['group_unmatched']}")
    print(f"복수 group 충돌 수: {build.report['group_ambiguous']}")
    print("6개 group별 Q-A 수:")
    print(json.dumps(build.report["group_counts"], ensure_ascii=False, sort_keys=True))
    print(f"answer WAV 존재 수: {build.report['answer_wav_exists']}")
    print(f"question WAV 존재 수: {build.report['question_wav_exists']}")
    print(f"오디오 누락 sample 수: {build.report['audio_missing_samples']}")
    print(f"derived file: {output}")
    print(f"unmatched report: {root / 'reports' / 'unmatched_questions.jsonl'}")
    print(f"ambiguous report: {root / 'reports' / 'ambiguous_questions.jsonl'}")


if __name__ == "__main__":
    main()
