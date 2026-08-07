#!/usr/bin/env python3
"""Read-only ink-admin-memory Playwright environment preflight."""

from __future__ import annotations

import argparse
import json
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any


def default_repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(0.25)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def load_package(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=default_repo_root())
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    root = args.repo_root.expanduser().resolve()
    package_path = root / "package.json"
    package = load_package(package_path)
    dependencies = {
        **package.get("dependencies", {}),
        **package.get("devDependencies", {}),
    }

    required = {
        "package.json": package_path,
        "playwright.config.ts": root / "playwright.config.ts",
        "app/layout.tsx": root / "app" / "layout.tsx",
        "app/globals.css": root / "app" / "globals.css",
        "tests/e2e": root / "tests" / "e2e",
        "admin layout": root / "app" / "(admin)" / "admin" / "layout.tsx",
        "AdminProviders": root / "app" / "components" / "admin" / "AdminProviders.tsx",
        "Playwright executable": root / "node_modules" / ".bin" / "playwright",
    }
    checks = {label: path.exists() for label, path in required.items()}

    playwright_version = None
    playwright_bin = required["Playwright executable"]
    if playwright_bin.exists():
        result = subprocess.run(
            [str(playwright_bin), "--version"],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            playwright_version = result.stdout.strip()
        else:
            checks["Playwright executable"] = False

    commands = {
        "node": shutil.which("node"),
        "pnpm": shutil.which("pnpm"),
    }
    framework = {
        "next": dependencies.get("next"),
        "react": dependencies.get("react"),
        "playwright": dependencies.get("@playwright/test"),
        "refine_core": dependencies.get("@refinedev/core"),
        "refine_router": dependencies.get("@refinedev/nextjs-router"),
    }
    framework_ok = all(framework.values())
    report = {
        "repo_root": str(root),
        "checks": checks,
        "commands": commands,
        "framework": framework,
        "playwright_installed": playwright_version,
        "ports": {
            "3000_listening": port_open(3000),
            "5433_listening": port_open(5433),
        },
    }
    ok = (
        all(checks.values())
        and all(commands.values())
        and framework_ok
        and bool(playwright_version)
    )

    if args.as_json:
        print(json.dumps({**report, "ok": ok}, ensure_ascii=False, indent=2))
    else:
        print(f"Repository: {root}")
        for label, passed in checks.items():
            print(f"[{'OK' if passed else 'MISSING'}] {label}")
        for command, resolved in commands.items():
            print(f"[{'OK' if resolved else 'MISSING'}] {command}: {resolved or '-'}")
        for name, version in framework.items():
            print(f"[{'OK' if version else 'MISSING'}] {name}: {version or '-'}")
        print(f"Playwright installed: {playwright_version or '-'}")
        for port, listening in report["ports"].items():
            label = port.replace("_listening", "")
            print(f"[{'LISTENING' if listening else 'FREE'}] {label}")
        print("Preflight passed." if ok else "Preflight failed.")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
