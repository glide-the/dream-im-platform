

## Optimized Prompt

> **Role:** You are a senior Python engineer conducting a code architecture review.
>
> **Task:** Produce a structured, step-by-step breakdown of the workspace initialization flow in the `_run_research` method of research_agent_processor.py from the `agent-sandbox` project. Cover every phase from directory creation to SDK client readiness.
>
> **Output Requirements — use the following sections:**
>
> 1. **Entry Point & Data Model** — Describe `ResearchAgentSandboxProcessorData` fields (`workspace`, `userId`, `userFilesDir`, `userLogsDir`, `logDetailPath`, `logSummaryPath`, `logRunPath`) and how the processor is routed via `match()` + registry.
>
> 2. **`_init_workspace` — Directory Scaffolding** — Trace the workspace path resolution logic (absolute vs. relative vs. empty), which directories are `mkdir`'d, how relative log paths are converted to absolute, and which config files (.claude, .mcp.json) are copied from the project root.
>
> 3. **CWD Switch & Logging Infrastructure** — Explain the `os.chdir(workspace)` pattern, the `SandboxTranscriptWriter` (dual-write to disk + in-memory buffer), `SubagentTracker` initialization, and the `session_dir` setup.
>
> 4. **Prompt Resolution** — Document `_resolve_prompt` flow (YAML override → file read → `load_prompt` fallback from `prompts/` package directory). List all four prompts loaded and which one is actually used as `system_prompt`.
>
> 5. **SDK Client Configuration** — Detail the `ClaudeAgentOptions` fields: `permission_mode`, `cwd`, `setting_sources`, `system_prompt`, `allowed_tools`, `tools`, `hooks`, `model`. Explain why no `agents` dict is used (single-agent architecture).
>
> 6. **Message Loop & Incremental Persistence** — Describe the `receive_response()` async iteration: token accumulation from `ResultMessage`, transcript writing from `AssistantMessage`, and the periodic (every 10 messages) intermediate summary dump.
>
> 7. **Post-Processing & Final Outputs** — Cover Repomix research-notes aggregation, transcript/tracker closure, tool log renaming, `log_summary.json` and `result.json` generation (including `token_usage`), and the `finally` block (CWD restore + client cleanup).
>
> 8. **Directory & File Map** — Provide a tree diagram showing every file/directory created or written during a single `_run_research` invocation.
>
> **Constraints:** Reference actual line numbers and method names. Use Chinese comments where they exist in the source. Note the difference from `_run_research_bak` (multi-agent → single-agent simplification).

---

## Analysis Result — `_run_research` workspace initialization flow

### 1. Entry Point & Data Model

`ResearchAgentSandboxProcessorData` carries these fields:

| Field | Default | Purpose |
|---|---|---|
| `workspace` | `""` | Optional workspace base path |
| `userId` | *(required)* | User identifier |
| `userFilesDir` | `"files"` | Research output subdirectory |
| `userLogsDir` | `"logs"` | Log subdirectory |
| `logDetailPath` | `"logs/log_detail.jsonl"` | Tool call detail log (relative) |
| `logSummaryPath` | `"logs/log_summary.json"` | Summary JSON (relative) |
| `logRunPath` | `"logs/log_run.log"` | Transcript log (relative) |

The processor is registered as `"research_agent_processor"` via `@registry.register_processor` and routed when `data.type == "ResearchAgentSandbox"`.

### 2. `_init_workspace` — Directory Scaffolding

Called at research_agent_processor.py:

```
workspace = self._init_workspace(code_input, task_id)
```

Path resolution logic:

| Condition | Result |
|---|---|
| `code_input.workspace` is set & absolute | Use as-is |
| `code_input.workspace` is set & relative | `{self.cwd}/{workspace}/{task_id}` |
| `code_input.workspace` is empty | `{self.cwd}/workspace/{task_id}` |

Then:
1. `workspace/` — `mkdir(parents=True)`
2. `workspace/files/` — `mkdir(parents=True)`
3. `workspace/logs/` — `mkdir(parents=True)`
4. Convert relative log paths → absolute: e.g. `logs/log_run.log` → `{workspace}/logs/log_run.log`
5. Copy **.claude** directory (contains `AGENT.md`, `PROMPT.md`) via `shutil.copytree` — only if source exists and destination doesn't
6. Copy **.mcp.json** (MCP server config for `data-analyst-mcp` + `exa-search-mcp`) via `shutil.copy` — same guard

### 3. CWD Switch & Logging Infrastructure

```python
os.chdir(workspace)          # line 638, restored in finally block
```

- **`SandboxTranscriptWriter`** — extends `TranscriptWriter` with an in-memory `_buffer`, so the full transcript can later be embedded in `log_summary.json` as `assistant_summary`.
- **`SubagentTracker`** — opens `{session_dir}/tool_calls.jsonl`, logs every tool invocation via `PreToolUse`/`PostToolUse` hooks.
- `session_dir` = `log_detail_file.parent` (typically `{workspace}/logs/`).

### 4. Prompt Resolution

`_resolve_prompt(default_filename, override_key)`:
1. Check `self.prompt_overrides[override_key]` → read that file
2. Fallback → `load_prompt(default_filename)` → reads from `sandbox/common/research_agent/prompts/{filename}`

Four prompts loaded, **only one used**:

| Override Key | Default File | Actually Used? |
|---|---|---|
| `lead_agent` | `lead_agent_qa.txt` | Loaded but **unused** |
| `researcher` | `researcher_SAAD-SOP-V2.txt` | **Yes — `system_prompt`** |
| `data_analyst` | `data_analyst.txt` | Loaded but **unused** |
| `report_writer` | `report_writer.txt` | Loaded but **unused** |

### 5. SDK Client Configuration

```python
ClaudeAgentOptions(
    permission_mode="bypassPermissions",
    cwd=workspace.as_posix(),
    setting_sources=["project"],          # loads .claude/ project config
    system_prompt=researcher_prompt,      # researcher_SAAD-SOP-V2.txt
    allowed_tools=["Task", "mcp__data-analyst-mcp__vanna_chat_once",
                   "mcp__exa-search-mcp__*"],
    tools=["Write", "mcp__data-analyst-mcp__vanna_chat_once",
           "mcp__exa-search-mcp__*"],
    hooks={PreToolUse: [...], PostToolUse: [...]},
    model="sonnet",
)
```

**No `agents` dict** — this is a **single flat agent** (the researcher itself), unlike `_run_research_bak` which used a multi-agent lead→subagent hierarchy.

### 6. Message Loop & Incremental Persistence

```
await client.query(prompt=topic)
async for msg in client.receive_response():
```

- **`ResultMessage`** → accumulate `input_tokens` / `output_tokens`
- **`AssistantMessage`** → `process_assistant_message()` writes text blocks to transcript, tracks `Task` tool spawns
- Every **10** `AssistantMessage`s → dump intermediate `log_summary.json` with current directory tree

### 7. Post-Processing & Final Outputs

1. **Repomix** — runs `npx repomix@latest` on `files/research_notes/` to aggregate all notes into transcript
2. Write token usage line to transcript
3. Close transcript writer + tracker
4. Rename `tool_calls.jsonl` → `log_detail.jsonl`
5. Write **`log_summary.json`** — full summary with `assistant_summary` (transcript buffer)
6. Write **`result.json`** — same structure minus `assistant_summary`, plus `token_usage: { steps, input_tokens, output_tokens, total_tokens }`
7. **`finally`** — `os.chdir(original_cwd)` + `client.__aexit__()`

### 8. Directory & File Map

```
{workspace}/
├── .claude/                    ← copied from project root
│   ├── AGENT.md
│   └── PROMPT.md
├── .mcp.json                   ← copied from project root
├── files/                      ← userFilesDir
│   ├── research_notes/         ← agent writes here at runtime
│   ├── charts/                 ← agent writes here at runtime
│   ├── data/                   ← agent writes here at runtime
│   ├── assets/                 ← agent writes here at runtime
│   └── reports/                ← agent writes here at runtime
└── logs/                       ← userLogsDir
    ├── log_run.log             ← transcript (SandboxTranscriptWriter)
    ├── log_detail.jsonl        ← tool call records (SubagentTracker)
    ├── log_summary.json        ← summary JSON (topic + tree + env + transcript)
    └── result.json             ← final result (summary - transcript + token_usage)
```

### Key Difference from `_run_research_bak`

| Aspect | `_run_research_bak` | `_run_research` |
|---|---|---|
| Architecture | Multi-agent (lead + 3 subagents) | Single flat agent |
| System prompt | `lead_agent_qa.txt` | `researcher_SAAD-SOP-V2.txt` |
| Researcher prompt version | V1 (`SAAD-SOP.txt`) | V2 (`SAAD-SOP-V2.txt`) |
| Top-level tools | Only `Task` + vanna | `Task` + vanna + exa search + Write |
| `agents` dict | 3 `AgentDefinition`s | None |

---

## Optional Enhancers

- **Add a sequence diagram** — use Mermaid to visualize the async flow from `__call__` → `_run_research` → `_init_workspace` → SDK → message loop → cleanup.
- **Add error handling analysis** — document what happens on SDK connection failure, Repomix timeout, or file permission errors.
- **Add configuration example** — show a sample sandbox.yaml snippet that drives the `from_config` class method with `cwd` and `prompts` overrides.