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
    H6 --> H7["扫描 skills/ 中的文件和文件夹"]
    H7 --> H8["为每个条目创建软链接"]
    H8 --> H9["{workspace}/.claude/skills/{name}"]
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
    subgraph "workspace/{sessionId}/"
        WS["skills/"]
        S1["my-skill.md"]
        S2["research-tools/"]
    end

    subgraph "workspace/{sessionId}/.claude/"
        PS["skills/"]
        L1["my-skill.md → symlink"]
        L2["research-tools/ → symlink"]
    end

    WS --> S1
    WS --> S2
    S1 -.->|symlink| L1
    S2 -.->|symlink| L2

    style L1 fill:#e3f2fd,stroke:#2196f3
    style L2 fill:#e3f2fd,stroke:#2196f3
```

### 为什么用软链接？

Claude SDK 被调用时设置 `cwd = workspacePath` 且 `settingSources: ["project"]`，
因此 Claude 从 `{workspacePath}/.claude/skills/` 读取 skills。

我们让用户/Agent 在更直观的 `{workspace}/skills/` 目录操作，然后自动软链接到
`{workspace}/.claude/skills/` 供 Claude 发现。

**关键优势**：
1. 每个对话工作空间完全隔离，无命名冲突
2. 同时支持**文件和文件夹**软链接
3. 无需 sessionId 前缀 — 工作空间本身就是隔离边界
4. 每次同步自动清理失效的链接

### 同步触发时机

| 时机 | 触发函数 | 说明 |
|------|----------|------|
| 工作空间初始化 | `initWorkspace()` → `syncSkillsSymlinks()` | 首次创建时自动同步 |
| 访问已有工作空间 | `getOrCreateWorkspace()` → `syncSkillsSymlinks()` | 每次访问重新同步 |
| 写入 skills/ | `writeWorkspaceFile()` → `syncSkillsSymlinks()` | 上传 skill 文件后自动同步 |
| 删除 skills/ | `deleteWorkspaceFile()` → `syncSkillsSymlinks()` | 删除后清理链接 |
| 移动涉及 skills/ | `moveWorkspaceFile()` → `syncSkillsSymlinks()` | 移动后更新链接 |

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
  └── {conversationId}/            ← Claude SDK cwd
      ├── .claude/                 ← 从项目根复制
      │   └── skills/              ← 软链接目标目录
      │       ├── my-skill.md      → symlink → skills/my-skill.md
      │       └── research-tools/  → symlink → skills/research-tools/
      ├── .mcp.json                ← 从项目根复制
      ├── files/                   ← 用户上传 + Agent 生成
      ├── logs/                    ← Agent 日志
      └── skills/                  ← 对话级 skills（用户操作此目录）
            ├── my-skill.md
            └── research-tools/    ← 支持文件夹
                └── web-search.md
```
