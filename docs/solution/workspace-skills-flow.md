# 工作空间与 Skills 同步 — 全流程图

## 概述

本文档描述了对话工作空间初始化、文件管理、Agent 执行以及 Skills 自动同步的完整数据流。

---

## 核心流程图

```mermaid
flowchart TD
    A[用户发起对话] --> B[前端生成 conversationId]
    B --> C[WorkspaceContext.setActiveConversation]
    C --> D[FileSidebar 自动切换 sessionId]

    D --> E["GET /api/workspace/files?sessionId={conversationId}"]
    E --> F["getOrCreateWorkspace(conversationId)"]
    F --> G{工作空间是否已存在?}
    G -- 否 --> H["initWorkspace(conversationId)"]
    G -- 是 --> I[返回已有路径]

    H --> H1["创建 files/ 目录"]
    H --> H2["创建 logs/ 目录"]
    H --> H3["创建 skills/ 目录"]
    H --> H4["复制 .claude/ 到工作空间"]
    H --> H5["复制 .mcp.json 到工作空间"]
    H3 --> H6["syncSkillsSymlinks()"]
    H6 --> H7["扫描 skills/ 中的文件"]
    H7 --> H8["为每个 skill 文件创建软链接"]
    H8 --> H9[".claude/skills/{sessionId}--{filename}"]
    H6 --> H10["清理过期软链接"]

    H --> I

    I --> J[FileSidebar 显示文件列表]

    K[用户上传文件] --> L["POST /api/workspace/files"]
    L --> M["写入 {AGENT_CWD}/{conversationId}/files/{filename}"]
    M --> J

    N[用户发送消息] --> O["POST /api/claude-agent"]
    O --> P["getOrCreateWorkspace(conversationId)"]
    P --> Q["agentRunner.runStreaming({ cwd: workspacePath })"]
    Q --> R["Agent 读写 {conversationId}/ 下的文件"]
    R --> S["Agent 可能生成新文件"]
    S --> J

    style H3 fill:#e8f5e9,stroke:#4caf50,stroke-width:2px
    style H6 fill:#e8f5e9,stroke:#4caf50,stroke-width:2px
    style H8 fill:#e8f5e9,stroke:#4caf50,stroke-width:2px
    style H9 fill:#fff3e0,stroke:#ff9800,stroke-width:2px
```

---

## Skills 同步机制详情

```mermaid
flowchart LR
    subgraph 工作空间
        WS["workspace/{sessionId}/skills/"]
        S1["my-skill.md"]
        S2["research.md"]
    end

    subgraph 项目级 Claude Skills
        PS[".claude/skills/"]
        L1["{sessionId}--my-skill.md → symlink"]
        L2["{sessionId}--research.md → symlink"]
    end

    WS --> S1
    WS --> S2
    S1 -.->|symlink| L1
    S2 -.->|symlink| L2

    style L1 fill:#e3f2fd,stroke:#2196f3
    style L2 fill:#e3f2fd,stroke:#2196f3
```

### 为什么用软链接？

Claude Code 官方只认两个固定位置的 skills：
- **项目级**：`{project}/.claude/skills/`
- **用户级**：`~/.claude/skills/`

官方 **没有** 提供修改 skills 根目录的配置开关。因此我们采用软链接策略：

1. 每个对话工作空间自带 `skills/` 目录，用户/Agent 可自由写入
2. `syncSkillsSymlinks()` 自动将这些文件软链接到项目级 `.claude/skills/`
3. 链接命名为 `{sessionId}--{filename}`，避免多对话间冲突
4. 每次同步时清理已失效的过期链接

### 同步触发时机

| 时机 | 触发函数 | 说明 |
|------|----------|------|
| 工作空间初始化 | `initWorkspace()` → `syncSkillsSymlinks()` | 首次创建时自动同步 |
| 手动调用 | `syncSkillsSymlinks(workspacePath)` | 可在文件上传后主动触发 |

---

## 数据通道总览

```mermaid
sequenceDiagram
    participant U as 用户/浏览器
    participant FS as FileSidebar
    participant CTX as WorkspaceContext
    participant API as /api/workspace/files
    participant AGENT as /api/claude-agent
    participant WS as workspace.ts
    participant DISK as 文件系统

    U->>CTX: 选择/创建对话 (conversationId)
    CTX->>FS: 传递 sessionId = conversationId
    FS->>API: GET /files?sessionId={cid}
    API->>WS: getOrCreateWorkspace(cid)
    WS->>DISK: mkdir files/ + logs/ + skills/
    WS->>DISK: cp .claude/ + .mcp.json
    WS->>DISK: syncSkillsSymlinks → symlink to .claude/skills/
    WS-->>API: workspacePath
    API-->>FS: 文件列表

    U->>FS: 上传文件
    FS->>API: POST /files (sessionId=cid)
    API->>DISK: 写入 {cwd}/{cid}/files/{name}
    API-->>FS: 刷新列表

    U->>AGENT: 发送消息 (conversationId=cid)
    AGENT->>WS: getOrCreateWorkspace(cid) → 复用同一目录
    AGENT->>DISK: agentRunner.runStreaming({ cwd })
    Note over AGENT,DISK: Agent 可读写 {cid}/ 下所有文件
    AGENT-->>FS: 流式返回 → FileSidebar 自动刷新
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENT_CWD` | `/tmp/claude-agent-workspaces` | 工作空间根目录；生产环境建议设为持久化路径 |

```
AGENT_CWD=/data/workspaces (生产环境)
  └── {conversationId}/
      ├── .claude/          ← 从项目根复制
      ├── .mcp.json         ← 从项目根复制
      ├── files/            ← 用户上传 + Agent 生成
      ├── logs/             ← Agent 日志
      └── skills/           ← 对话级 skills
            └── *.md        → symlink 到 .claude/skills/{sessionId}--*.md
```
