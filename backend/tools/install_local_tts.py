"""Download and prepare a pinned Supertonic model for local CPU TTS."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path


MODEL_REPO = "Supertone/supertonic-3"
MODEL_NAME = "supertonic-3"
MODEL_REVISION = "724fb5abbf5502583fb520898d45929e62f02c0b"
SDK_VERSION = "supertonic==1.3.1"
MODEL_DIR = Path(__file__).resolve().parents[1] / "models" / "tts" / "supertonic3"
VOICE_IDS = ("M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5")
GUIDES = {
    "시작하세요.": "start.wav",
    "답변을 마치셨나요?": "confirm.wav",
    "수고하셨습니다.": "finish.wav",
}
EXPECTED_MODEL_SHA256 = {
    "onnx/duration_predictor.onnx": "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
    "onnx/text_encoder.onnx": "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
    "onnx/tts.json": "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09",
    "onnx/unicode_indexer.json": "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f",
    "onnx/vector_estimator.onnx": "883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c",
    "onnx/vocoder.onnx": "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba",
    "voice_styles/F1.json": "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2",
    "voice_styles/F2.json": "7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6",
    "voice_styles/F3.json": "12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab",
    "voice_styles/F4.json": "c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b",
    "voice_styles/F5.json": "45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d",
    "voice_styles/M1.json": "e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b",
    "voice_styles/M2.json": "b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50",
    "voice_styles/M3.json": "ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b",
    "voice_styles/M4.json": "ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303",
    "voice_styles/M5.json": "dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2",
}


def _validate_tree(root: Path) -> None:
    resolved_root = root.resolve()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise RuntimeError("모델 다운로드에 심볼릭 링크가 포함되어 있습니다.")
        if not path.resolve().is_relative_to(resolved_root):
            raise RuntimeError("모델 다운로드 경로가 설치 폴더를 벗어납니다.")


def _validate_model_hashes(root: Path) -> None:
    for relative, expected in EXPECTED_MODEL_SHA256.items():
        path = root / relative
        if not path.is_file():
            raise RuntimeError("고정 모델 파일이 누락되었습니다: " + relative)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected:
            raise RuntimeError("고정 모델 파일 해시가 일치하지 않습니다: " + relative)


def _prepare_guides(model_dir: Path, threads: int) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_root))
    from app.services.tts import _TtsConfig, _synthesize_question

    guides_root = model_dir / "guides"
    guides_root.mkdir(parents=True, exist_ok=False)
    config = _TtsConfig(
        model_dir=model_dir,
        model_name=MODEL_NAME,
        num_threads=threads,
    )
    for voice_id in VOICE_IDS:
        voice_dir = guides_root / voice_id
        voice_dir.mkdir()
        for text, filename in GUIDES.items():
            (voice_dir / filename).write_bytes(
                _synthesize_question(text, config, voice_id)
            )


def _write_manifest(model_dir: Path) -> None:
    files = []
    for path in sorted(model_dir.rglob("*")):
        if not path.is_file() or path.name == "MODEL_MANIFEST.json":
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        files.append(
            {
                "path": path.relative_to(model_dir).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": digest,
            }
        )
    manifest = {
        "model_repo": MODEL_REPO,
        "model_name": MODEL_NAME,
        "model_revision": MODEL_REVISION,
        "sdk": SDK_VERSION,
        "voices": list(VOICE_IDS),
        "files": files,
    }
    (model_dir / "MODEL_MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def install(destination: Path, threads: int) -> None:
    destination = destination.resolve()
    if destination.exists():
        raise RuntimeError("로컬 TTS 설치 폴더가 이미 있습니다. 덮어쓰지 않습니다.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".local-tts-", dir=destination.parent))
    model_dir = staging / "model"
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=MODEL_REPO,
            revision=MODEL_REVISION,
            local_dir=str(model_dir),
        )
        _validate_tree(model_dir)
        _validate_model_hashes(model_dir)
        _prepare_guides(model_dir, threads)
        _write_manifest(model_dir)
        os.replace(model_dir, destination)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=MODEL_DIR)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be at least 1")
    install(args.destination, threads=args.threads)
    print(f"로컬 Supertonic 3 모델과 voice별 안내 WAV를 준비했습니다: {args.destination.resolve()}")


if __name__ == "__main__":
    main()
