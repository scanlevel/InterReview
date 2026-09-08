"""Keep unit tests independent of developer secrets and local model settings."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from app.config import Settings, get_settings


def pytest_configure(config: pytest.Config) -> None:
    # Apply before collection: importing app.main constructs Settings immediately.
    patch = pytest.MonkeyPatch()
    config.add_cleanup(patch.undo)
    patch.setitem(Settings.model_config, "env_file", None)
    for field in Settings.model_fields.values():
        if field.alias:
            patch.delenv(field.alias, raising=False)
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def isolated_settings_and_logs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> Iterator[None]:
    from app.services import llm

    monkeypatch.setattr(llm, "_FAILURE_LOG_PATH", tmp_path / "llm-failures.log")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
