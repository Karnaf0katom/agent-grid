#!/usr/bin/env python3
"""Copy only the explicit public file manifest into a new export directory.

No Git history, environment, runtime data, provider files, or workspace-wide copy.
This prepares source files; it does not compile or install anything.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = Path(__file__).resolve().parent.parent / "distribution/export-manifest.json"
SECRETS = re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)")


def collect():
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))
    files = {}
    for entry in entries:
        source = ROOT / entry["source"]
        destination = Path(entry["destination"])
        if source.is_symlink() or destination.is_absolute() or ".." in destination.parts:
            raise ValueError(f"Unsafe manifest entry: {entry['destination']}")
        source.resolve().relative_to(ROOT)
        if not source.is_file():
            if entry.get("optional"):
                continue
            raise ValueError(f"Missing source: {entry['source']}")
        if not entry["source"].startswith(("apps/agent-grid/", "packages/agent-grid/")):
            raise ValueError("A source is outside the requested product.")
        data = source.read_bytes()
        if source.suffix != ".png":
            content = data.decode("utf-8")
            if SECRETS.search(content):
                raise ValueError(f"Secret-like content in {entry['source']}; export refused.")
            if entry.get("root_readme"):
                content = content.replace("(docs/", "(apps/agent-grid/docs/")
                content = content.replace("(../../packages/agent-grid/", "(packages/agent-grid/")
            data = content.encode("utf-8")
        elif not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Preview must be a PNG screenshot.")
        if str(destination) in files:
            raise ValueError(f"Duplicate destination: {destination}")
        files[str(destination)] = data
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    output = args.out.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use a new empty output directory to avoid stale publication files.")
    files = collect()
    for name, data in sorted(files.items()):
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    record = {"files": [{"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items())]}
    (output / "EXPORT.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"directory": str(output), "files": len(files), "bytes": sum(map(len, files.values())), "record": "EXPORT.json"}))


if __name__ == "__main__":
    main()
