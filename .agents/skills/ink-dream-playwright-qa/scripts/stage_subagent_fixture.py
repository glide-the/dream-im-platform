#!/usr/bin/env python3
"""Stage deterministic SubAgent meta/JSONL records under an isolated AGENT_CWD."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def record(timestamp: str, role: str, content: list[dict[str, Any]]) -> dict[str, Any]:
    return {"timestamp": timestamp, "message": {"role": role, "content": content}}


def safe_segment(value: str, label: str) -> str:
    candidate = value.strip()
    if not candidate or candidate in {".", ".."} or Path(candidate).name != candidate or "\\" in candidate:
        raise ValueError(f"{label} must be one path segment")
    return candidate


def write_agent(
    directory: Path,
    agent_id: str,
    agent_type: str,
    description: str,
    prompt: str,
    records: list[dict[str, Any]],
) -> None:
    stem = f"agent-{agent_id}"
    meta_path = directory / f"{stem}.meta.json"
    transcript_path = directory / f"{stem}.jsonl"
    collisions = [path for path in (meta_path, transcript_path) if path.exists()]
    if collisions:
        raise FileExistsError(f"refusing to overwrite: {', '.join(str(path) for path in collisions)}")
    meta = {
        "agentType": agent_type,
        "description": description,
        "toolUseId": f"tool-parent-{agent_id}",
        "spawnDepth": 1,
        "prompt": prompt,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    transcript_path.write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in records) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-root", type=Path, required=True)
    parser.add_argument("--thread-id", required=True)
    parser.add_argument("--project-key", default="playwright-qa")
    args = parser.parse_args()

    root = args.workspace_root.expanduser().resolve()
    try:
        thread_id = safe_segment(args.thread_id, "thread id")
        project_key = safe_segment(args.project_key, "project key")
    except ValueError as error:
        parser.error(str(error))
    directory = (root / thread_id / ".claude-home" / "projects" / project_key / "subagents").resolve()
    directory.relative_to(root)
    directory.mkdir(parents=True, exist_ok=True)

    write_agent(
        directory,
        "completed",
        "U5 integration e2e",
        "验证 SubAgent 对话详情的长消息与 Markdown",
        "检查深浅主题、中英文、窄宽侧栏、Markdown、工具记录与最终回复。",
        [
            record("2026-08-05T08:00:00Z", "user", [{"type": "text", "text": "开始浏览器验收"}]),
            record("2026-08-05T08:00:02Z", "assistant", [
                {"type": "text", "text": "我会先检查布局，再运行相关测试。\n\n- 检查列表密度\n- 检查消息顺序"},
                {"type": "tool_use", "id": "tool-read", "name": "Read", "input": {
                    "file_path": "frontend/src/components/chat/SubagentPanel.tsx",
                    "api_key": "qa-secret-must-not-render",
                }},
            ]),
            record("2026-08-05T08:00:05Z", "user", [{
                "type": "tool_result", "tool_use_id": "tool-read", "content": "Read completed.",
            }]),
            record("2026-08-05T08:01:30Z", "assistant", [{
                "type": "text",
                "text": "## U5 已完成\n\n1. **任务列表**保持紧凑。\n2. Markdown 与代码块正常。\n\n```ts\nconst passed = true;\n```",
            }]),
        ],
    )
    write_agent(
        directory,
        "running",
        "Explorer",
        "扫描聊天组件并生成执行摘要",
        "扫描消息渲染共享边界。",
        [
            record("2026-08-05T09:00:00Z", "user", [{"type": "text", "text": "开始扫描"}]),
            record("2026-08-05T09:00:03Z", "assistant", [{
                "type": "tool_use", "id": "tool-grep", "name": "Grep", "input": {"pattern": "ChatMarkdown"},
            }]),
        ],
    )
    write_agent(
        directory,
        "failed",
        "Reviewer",
        "检查失败状态与错误降级",
        "验证工具失败后的错误展示。",
        [
            record("2026-08-05T07:00:00Z", "user", [{"type": "text", "text": "执行失败场景"}]),
            record("2026-08-05T07:00:04Z", "user", [{
                "type": "tool_result", "tool_use_id": "tool-missing", "is_error": True, "content": "permission denied",
            }]),
        ],
    )
    write_agent(
        directory,
        "cancelled",
        "Planner",
        "验证中断任务保留已有消息",
        "生成计划后等待用户中断。",
        [
            record("2026-08-05T06:00:00Z", "assistant", [{"type": "text", "text": "已完成第一阶段计划。"}]),
            record("2026-08-05T06:00:06Z", "user", [{"type": "text", "text": "[Request interrupted by user]"}]),
        ],
    )

    print(json.dumps({
        "workspace_root": str(root),
        "thread_id": thread_id,
        "subagents_dir": str(directory),
        "tasks": ["completed", "running", "failed", "cancelled"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except FileExistsError as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
