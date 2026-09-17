"""Fail closed if any restricted dashboard data is tracked by Git."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Callable


def assert_restricted_data_untracked(
    repository: Path,
    runner: Callable[..., Any] = subprocess.run,
) -> None:
    result = runner(
        ["git", "ls-files", "--", "data/restricted"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    )
    if result.stdout.strip():
        tracked = ", ".join(line for line in result.stdout.splitlines() if line.strip())
        raise AssertionError(f"Files under data/restricted must never be tracked: {tracked}")
