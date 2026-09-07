from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools import install_local_tts


def test_existing_installation_is_never_overwritten(tmp_path: Path) -> None:
    destination = tmp_path / "tts"
    destination.mkdir()
    marker = destination / "marker"
    marker.write_text("keep", encoding="utf-8")

    with pytest.raises(RuntimeError, match="이미 있습니다"):
        install_local_tts.install(destination, threads=2)

    assert marker.read_text(encoding="utf-8") == "keep"


def test_download_failure_removes_staging_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def interrupted_download(*_: object, **kwargs: object) -> None:
        model_dir = Path(str(kwargs["local_dir"]))
        model_dir.mkdir(parents=True)
        (model_dir / "partial.onnx").write_bytes(b"partial")
        raise RuntimeError("download interrupted")

    monkeypatch.setitem(
        sys.modules,
        "huggingface_hub",
        SimpleNamespace(snapshot_download=interrupted_download),
    )
    destination = tmp_path / "tts"

    with pytest.raises(RuntimeError, match="interrupted"):
        install_local_tts.install(destination, threads=2)

    assert not destination.exists()
    assert list(tmp_path.glob(".local-tts-*")) == []


def test_symlinked_model_tree_is_rejected(tmp_path: Path) -> None:
    root = tmp_path / "model"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.write_bytes(b"outside")
    link = root / "escape"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("symlink creation is unavailable in this Windows environment")

    with pytest.raises(RuntimeError, match="심볼릭"):
        install_local_tts._validate_tree(root)


def test_model_hash_mismatch_is_rejected(tmp_path: Path) -> None:
    root = tmp_path / "model"
    path = root / "onnx" / "duration_predictor.onnx"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"tampered")

    with pytest.raises(RuntimeError, match="해시"):
        install_local_tts._validate_model_hashes(root)
