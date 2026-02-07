# 工作空间文件系统 — 业务说明文档

## 1. 概述

每一次 AI 对话（conversation）都拥有独立的工作空间目录，实现用户文件上传、Agent 文件读写、Skills 管理的完全隔离。工作空间由 `app/lib/workspace.ts` 统一管理。

---

## 2. 目录结构

```
{AGENT_CWD}/
  └── {conversationId}/              ← 每个对话的隔离工作空间
      ├── .claude/                   ← 从项目根 .claude/ 复制（包含 settings、commands）
      │   └── skills/                ← 项目级 skills（不直接写入，通过软链接间接更新）
      ├── .mcp.json                  ← MCP 服务器配置（从项目根复制）
      ├── files/                     ← 用户文件区
      │   ├── report.pdf             ← 用户上传的文件
      │   └── analysis.xlsx          ← Agent 生成的文件
      ├── logs/                      ← 执行日志区
      │   └── agent-run-2026-02-07.log
      └── skills/                    ← 对话级 Skills 区
          ├── custom-research.md     ← 用户/Agent 创建的 skill
          └── sales-analysis.md      ← 对话专属 skill
```

---

## 3. 各目录职责

### 3.1 `files/` — 用户文件区

| 属性 | 说明 |
|------|------|
| **用途** | 存放用户上传的文件和 Agent 生成的产出物 |
| **写入者** | 用户（通过 FileSidebar 上传）、Agent（在执行过程中生成） |
| **读取者** | Agent（作为上下文输入）、用户（通过 FileSidebar 下载/预览） |
| **API** | `GET/POST/DELETE/PATCH /api/workspace/files` |
| **生命周期** | 随对话存在；对话删除时可选清理 |

### 3.2 `logs/` — 日志区

| 属性 | 说明 |
|------|------|
| **用途** | 存放 Agent 执行日志、调试信息 |
| **写入者** | Agent runner（streaming 输出日志） |
| **读取者** | 开发者调试、运维排查 |
| **生命周期** | 随对话存在 |

### 3.3 `skills/` — 对话级 Skills 区 (**新增**)

| 属性 | 说明 |
|------|------|
| **用途** | 存放对话专属的 Claude Code skills 文件 |
| **写入者** | 用户手动放置、Agent 在对话中动态生成 |
| **读取者** | Claude SDK（通过 `{workspace}/.claude/skills/` 软链接间接读取） |
| **同步机制** | `syncSkillsSymlinks()` 自动创建软链接到工作空间 `.claude/skills/` |
| **命名约定** | 软链接名称与源文件/文件夹同名（工作空间隔离，无需前缀） |
| **支持类型** | 文件和文件夹均可软链接 |
| **生命周期** | 随对话存在；过期链接自动清理 |

### 3.4 `.claude/` — Claude 配置区

从项目根目录的 `.claude/` 复制，包含 `settings.json`、`index.json`、`commands/` 等。
此目录在工作空间创建时一次性复制，后续不再自动同步。

### 3.5 `.mcp.json` — MCP 配置

从项目根目录复制的 MCP 服务器配置文件，供 Agent 在工作空间中使用。

---

## 4. Skills 软链接机制

### 4.1 背景

Claude SDK 被调用时设置 `cwd = workspacePath` 且 `settingSources: ["project"]`，
因此它从 `{workspacePath}/.claude/skills/` 读取 skills。

每个对话工作空间在初始化时已将项目根的 `.claude/` 复制到 `{workspace}/.claude/`，
所以我们只需将 skills 链接到 **工作空间内部** 的 `.claude/skills/` 即可。

### 4.2 方案

在每个工作空间创建 `skills/` 目录（用户友好的顶层位置），然后通过 `syncSkillsSymlinks()`
将其中的**文件和文件夹**软链接到同一工作空间的 `.claude/skills/`。

```
工作空间:   {workspace}/skills/research.md
                          ↓ symlink
Claude读取:  {workspace}/.claude/skills/research.md

工作空间:   {workspace}/skills/analysis-tools/
                          ↓ symlink
Claude读取:  {workspace}/.claude/skills/analysis-tools/
```

### 4.3 隔离机制

每个对话工作空间是完全独立的目录，无需 sessionId 前缀区分：

```
会话 A:  chat_abc123/skills/analysis.md  → chat_abc123/.claude/skills/analysis.md
会话 B:  chat_def456/skills/analysis.md  → chat_def456/.claude/skills/analysis.md
```

两者互不影响。

### 4.4 生命周期管理

| 事件 | 行为 |
|------|------|
| 工作空间初始化 | 扫描 `skills/` 并创建软链接 |
| Skill 文件新增 | 下次 `syncSkillsSymlinks()` 调用时自动链接（写入 skills/ 自动触发） |
| Skill 文件删除 | `cleanStaleSkillSymlinks()` 自动清理失效链接（删除 skills/ 自动触发） |
| 对话删除 | 工作空间目录被删除后，源文件消失，下次同步时清理链接 |

### 4.5 API 导出

```typescript
// 主要 API（workspace.ts 导出）
initWorkspace(sessionId?)        // 创建工作空间（自动调用 syncSkillsSymlinks）
getOrCreateWorkspace(sessionId)  // 获取或创建工作空间
syncSkillsSymlinks(workspacePath) // 手动触发 skills 同步

// 常量
WORKSPACE_DIRS.FILES  = "files"
WORKSPACE_DIRS.LOGS   = "logs"
WORKSPACE_DIRS.SKILLS = "skills"
```

---

## 5. 安全保障

### 路径遍历防护

所有文件操作函数均包含路径安全校验：

```typescript
const resolvedPath = resolve(fullPath);
const resolvedWorkspace = resolve(workspacePath);
if (!resolvedPath.startsWith(resolvedWorkspace)) {
  throw new Error("Path traversal not allowed");
}
```

### 软链接安全

- 软链接只指向同一工作空间 `skills/` 目录内的文件和文件夹
- 链接目标始终在工作空间 `.claude/skills/` 内，不触碰项目根或用户级 `~/.claude/`
- 跳过 dotfiles/dotfolders（`.` 开头的条目）
- 支持文件和文件夹两种类型的软链接

---

## 6. 环境配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `AGENT_CWD` | `os.tmpdir()/claude-agent-workspaces` | 工作空间根目录 |

**生产环境建议**：设为持久化磁盘路径（如 `/data/workspaces`），避免 tmpdir 被系统清理。

**Docker 环境**：在 `docker/.env.example` 中已配置为 `./agent-workspaces`。

---

## 7. 改动影响范围

| 文件 | 改动说明 |
|------|----------|
| `app/lib/workspace.ts` | 增加 `SKILLS` 常量、`skills/` 目录创建、`syncSkillsSymlinks()` 和 `cleanStaleSkillSymlinks()` 函数 |
| `app/lib/workspace.test.ts` | 新增 `skills/` 断言、`syncSkillsSymlinks` 测试组（3 个用例） |
| `docs/workspace-skills-flow.md` | 全流程图文档（本次新增） |
| `docs/workspace-filesystem.md` | 文件系统业务说明文档（本文档） |

**未改动的模块**：
- `app/lib/db/schema.ts` — 无 DB schema 变更
- `app/lib/chat-schema.ts` — 无协议变更  
- `app/lib/types.ts` — 无类型变更
- 所有 API 路由 — 无接口变更
