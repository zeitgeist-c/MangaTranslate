"""Create the release archive with short retries for transient Windows file locks."""

from __future__ import annotations

import argparse
from pathlib import Path
import time
import zipfile


def create(stage: Path, target: Path) -> None:
    if not stage.is_dir() or target.exists():
        raise ValueError("Stage must exist and the target must not exist")
    try:
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for source in sorted(stage.rglob("*")):
                if not source.is_file():
                    continue
                relative = source.relative_to(stage).as_posix()
                # The helper never makes HTTPS requests. Chromium treats even this
                # public CA bundle as an extension signing-key candidate.
                if relative == "native/_internal/certifi/cacert.pem":
                    continue
                if source.suffix.lower() in {".pem", ".key", ".p12", ".pfx"}:
                    raise ValueError(f"Unexpected key file in release: {relative}")
                for attempt in range(8):
                    try:
                        data = source.read_bytes()
                        break
                    except PermissionError:
                        if attempt == 7:
                            raise
                        time.sleep(.25 * (attempt + 1))
                archive.writestr(relative, data)
    except Exception:
        target.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    create(args.stage, args.target)
