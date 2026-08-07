#!/usr/bin/env python3
"""Read-only Ink-Dream Playwright environment preflight."""

from __future__ import annotations

import argparse
import json
import shutil
import socket
import subprocess
import sys
from pathlib import Path


def default_repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(0.25)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=default_repo_root())
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    root = args.repo_root.expanduser().resolve()
    frontend = root / "frontend"
    backend = root / "backend"
    package_path = frontend / "package.json"
    required = {
        "frontend/package.json": package_path,
        "frontend/vite.config.ts": frontend / "vite.config.ts",
        "backend/server.py": backend / "server.py",
        "backend/.venv/bin/python": backend / ".venv" / "bin" / "python",
        "frontend/node_modules/@playwright/test": frontend / "node_modules" / "@playwright" / "test",
    }
    checks = {label: path.exists() for label, path in required.items()}

    playwright_version = None
    playwright_bin = frontend / "node_modules" / ".bin" / "playwright"
    if playwright_bin.exists():
        result = subprocess.run(
            [str(playwright_bin), "--version"],
            cwd=frontend,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            playwright_version = result.stdout.strip()
        else:
            checks["frontend Playwright executable"] = False
    else:
        checks["frontend Playwright executable"] = False

    declared_version = None
    if package_path.exists():
        package = json.loads(package_path.read_text(encoding="utf-8"))
        declared_version = package.get("devDependencies", {}).get("@playwright/test")

    report = {
        "repo_root": str(root),
        "checks": checks,
        "commands": {
            "node": shutil.which("node"),
            "npm": shutil.which("npm"),
        },
        "playwright": {
            "declared": declared_version,
            "installed": playwright_version,
        },
        "ports": {
            "5173_listening": port_open(5173),
            "8765_listening": port_open(8765),
        },
    }
    ok = all(checks.values()) and all(report["commands"].values()) and bool(playwright_version)

    if args.as_json:
        print(json.dumps({**report, "ok": ok}, ensure_ascii=False, indent=2))
    else:
        print(f"Repository: {root}")
        for label, passed in checks.items():
            print(f"[{'OK' if passed else 'MISSING'}] {label}")
        for command, resolved in report["commands"].items():
            print(f"[{'OK' if resolved else 'MISSING'}] {command}: {resolved or '-'}")
        print(f"Playwright: declared={declared_version or '-'} installed={playwright_version or '-'}")
        for port, listening in report["ports"].items():
            print(f"[{'LISTENING' if listening else 'FREE'}] {port.replace('_listening', '')}")
        print("Preflight passed." if ok else "Preflight failed.")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
