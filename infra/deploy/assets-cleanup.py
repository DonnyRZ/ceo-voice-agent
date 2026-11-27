"""Retain only assets belonging to the active and rollback commits."""
import pathlib
import re
import sys

site = pathlib.Path(sys.argv[1])
commits = set()
for name in ("active-commit", "rollback-commit"):
    marker = site / name
    if marker.is_file():
        value = marker.read_text().strip()
        if not re.fullmatch(r"[a-f0-9]{40}", value):
            raise SystemExit("Invalid asset retention marker")
        commits.add(value)
root = site / "gateway" / "static" / "assets"
manifests = site / "gateway" / "manifests"
if not commits or not root.is_dir() or not manifests.is_dir():
    raise SystemExit(0)
keep = set()
for commit in commits:
    manifest = manifests / commit
    # Do not delete anything if a protected manifest is missing.
    if not manifest.is_file():
        raise SystemExit(0)
    for item in manifest.read_text().splitlines():
        part = pathlib.PurePosixPath(item)
        if part.is_absolute() or ".." in part.parts:
            raise SystemExit("Invalid asset path")
        keep.add(item)
for path in root.rglob("*"):
    if path.is_file() and not path.is_symlink() and path.relative_to(root).as_posix() not in keep:
        path.unlink()
for path in manifests.iterdir():
    if re.fullmatch(r"[a-f0-9]{40}", path.name) and path.name not in commits:
        path.unlink()
