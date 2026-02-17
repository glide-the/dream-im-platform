# 对话事件渲染修复方案

> **背景**：`processMessage`（agent-runner.ts）将 Claude SDK 的所有事件类型转化为 `AgentStreamingCallbacks` 事件输出，但 `route.ts` 的 `onToolEvent` 仅处理了其中一个子集，大量有价值的事件被静默丢弃；另外 Chat History PRD（Chat His.md）的消息类型定义与实际前端组件渲染逻辑存在错位。本文档给出完整的事件映射审计、问题清单以及分层修复方案。

---

## 一、事件流全链路审计

### 1.1 三层流转架构

```
Claude SDK Messages (SDKMessage)
        │
        ▼
agent-runner.ts  processMessage()    → AgentStreamingCallbacks 事件 (ToolEventPayload)
        │
        ▼
route.ts         onToolEvent()       → AI SDK Stream Chunks (写入 SSE)
        │
        ▼
ChatMessageList  / ToolMessagePart   → 前端渲染 (UIMessage.parts)
```

### 1.2 processMessage 输出的全部事件类型

| # | `ToolEventPayload.type` | SDK 来源 | 说明 |
|---|---|---|---|
| 1 | `thinking` | `assistant` → content `type: "thinking"` | 完整思考块 |
| 2 | `thinking_delta` | `stream_event` → `content_block_delta` (`thinking_delta`) | 思考增量文本 |
| 3 | `tool_use` | `assistant` → content `type: "tool_use"` | 完整工具调用（快照） |
| 4 | `tool_use_start` | `stream_event` → `content_block_start` (`tool_use`) | 工具调用流开始 |
| 5 | `tool_input_delta` | `stream_event` → `content_block_delta` (`input_json_delta`) | 工具参数 JSON 增量 |
| 6 | `content_block_stop` | `stream_event` → `content_block_stop` | 内容块结束标记 |
| 7 | `text_block_start` | `stream_event` → `content_block_start` (`text`) | 文本块开始 |
| 8 | `message_start` | `stream_event` → `message_start` | 消息开始 (model / usage) |
| 9 | `message_delta` | `stream_event` → `message_delta` | 消息级更新 (stop_reason / output_tokens) |
| 10 | `message_stop` | `stream_event` → `message_stop` | 消息结束标记 |
| 11 | `tool_result` | `user` → content `type: "tool_result"` | 工具执行结果 |
| 12 | `tool_progress` | `tool_progress` 顶层消息 | 工具执行进度 (elapsed_time_seconds) |
| 13 | `tool_use_summary` | `tool_use_summary` 顶层消息 | 多工具调用人可读摘要 |
| 14 | `result` | `result` 顶层消息 | 会话结束汇总 (cost / duration / turns / usage) |

### 1.3 当前 route.ts `onToolEvent` 处理情况

| 事件类型 | 是否处理 | 发送的 Stream Chunks | 备注 |
|---|---|---|---|
| `thinking` | ✅ 已处理 | `reasoning-start` → `reasoning-delta` → `reasoning-end` | 正常 |
| `thinking_delta` | ❌ **丢弃** | — | 增量思考文本被忽略 |
| `tool_use` | ✅ 已处理 | `tool-input-start` → `tool-input-available` | 正常（auto 模式） |
| `tool_use_start` | ✅ 已处理 | `tool-input-start` → `tool-input-available` | 正常（auto 模式），与 `tool_use` 去重 |
| `tool_input_delta` | ❌ **丢弃** | — | 工具参数增量流被忽略 |
| `content_block_stop` | ❌ **丢弃** | — | 块结束标记被忽略 |
| `text_block_start` | ❌ **丢弃** | — | 文本块开始被忽略（文本走 onTextDelta，不影响） |
| `message_start` | ❌ **丢弃** | — | model 信息、input_tokens 被忽略 |
| `message_delta` | ❌ **丢弃** | — | stop_reason、output_tokens 被忽略 |
| `message_stop` | ❌ **丢弃** | — | 消息结束标记被忽略 |
| `tool_result` | ✅ 已处理 | `tool-output-available`（含防御性 auto-register） | 正常 |
| `tool_progress` | ❌ **丢弃** | — | 长耗时工具的执行进度被忽略 |
| `tool_use_summary` | ❌ **丢弃** | — | 工具执行摘要被忽略 |
| `result` | ❌ **丢弃** | — | 会话级汇总被忽略 |

### 1.4 前端渲染层当前支持的 Part 类型

`ChatMessageList.tsx` 遍历 `UIMessage.parts` 渲染：

| `part.type` | 渲染组件 | 样式 |
|---|---|---|
| `reasoning` | 🧠 思考气泡（左对齐，可展开） | ✅ 正常 |
| `step-start` | 📌 步骤推进气泡（左对齐） | ⚠️ 无实际内容来源（见问题 P3） |
| `text` | 💬 文本气泡（用户右对齐 / AI 左对齐 + Markdown） | ✅ 正常 |
| `isToolUIPart()` | ▶️/💻 工具气泡（执行中左对齐 / 完成右对齐） | ⚠️ 部分问题（见问题 P2/P4） |
| `file` | 📎 文件气泡 | ✅ 正常 |

---

## 二、问题清单

### P1：有价值的事件被静默丢弃

**严重程度**：中

| 丢弃事件 | 影响 | 优先级 |
|---|---|---|
| `tool_progress` | 用户看不到长耗时工具（如 Bash、WebFetch）的执行进度时间 | **高** |
| `tool_use_summary` | 多工具链的人可读执行摘要不可见 | **高** |
| `result` | 会话结束后看不到 token 消耗、耗时、费用 | **高** |
| `message_start` | model 名称不可见（用于多模型切换场景） | 中 |
| `message_delta` | stop_reason 不可见（区分 end_turn vs tool_use 暂停） | 低 |
| `thinking_delta` | 增量思考无法实时显示（当前只能等完整 thinking 块到达后一次性渲染） | 中 |
| `tool_input_delta` | 工具参数无法流式显示 | 低 |

### P2：工具气泡的"执行中/完成"状态判断不准确

**严重程度**：中

- `ChatMessageList` 的 `getToolStatus()` 仅依赖 `part.state` 和 `isLast && isLoading`：
  - 当工具正在执行但不是 last message 时，状态可能错误地显示为"已完成"
  - 没有利用 `tool_progress` 事件的 elapsed_time 信息

### P3：`step-start` 类型缺乏内容来源

**严重程度**：低

- `ChatMessageList` 渲染 `step-start` 为「接下来要做：步骤推进【N/M】」，但实际上 `step-start` 只是 AI SDK 的分轮标记（`{type: "step-start"}`），没有携带具体任务描述。
- PRD 中描述的"📌 任务消息"（`前缀 "接下来要做："+ 任务描述`）在当前实现中没有实质内容。

### P4：PRD 设计与实际渲染错位

**严重程度**：高

PRD（Chat His.md）定义了4种消息类型：

| PRD 定义 | 实际实现 | 问题 |
|---|---|---|
| 🧠 思考消息 `"我在想：" + 思考内容` | `reasoning` part → 渲染 ✅ | 内容一次性出现而非流式（`thinking_delta` 被丢弃） |
| 📌 任务消息 `"接下来要做："` | `step-start` part → 渲染 | 无实际任务描述内容 |
| ▶️ 执行消息 `"正在执行："` | `isToolUIPart` → 工具气泡 | 缺少进度信息（`tool_progress` 被丢弃） |
| 💻 终端结果（代码块） | `isToolUIPart` 完成态 → `<pre>` 输出 | 缺少工具执行摘要（`tool_use_summary` 被丢弃） |

**新增缺失的消息类型（PRD 未定义但有价值）：**

| 缺失的 UI 元素 | 事件来源 | 建议 |
|---|---|---|
| 📊 会话统计 | `result` 事件 | 数据写入 metadata.unstable_data，通过 AssistMessagePart MetadataTooltip 按需展示 |
| ⏱️ 工具执行进度 | `tool_progress` 事件 | 在执行中气泡显示已耗时 |
| 📋 工具执行摘要 | `tool_use_summary` 事件 | 多工具链完成后显示汇总 |

---

## 三、修复方案

### 第一期：补齐丢弃事件的转发（后端 route.ts 修改）

**涉及文件**：`app/api/claude-agent/route.ts`

在 `onToolEvent` handler 中增加以下事件的转发逻辑：

#### 3.1 转发 `tool_progress`

```typescript
// 在 onToolEvent 中，tool_result 处理之后添加：
if (event.type === "tool_progress" && event.toolCallId) {
  // 使用 message-metadata 或自定义 SSE 类型传递进度信息
  safeWriteSSE({
    type: "message-metadata",
    messageMetadata: {
      unstable_data: {
        type: "tool_progress",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        elapsedTimeSeconds: (event.output as { elapsedTimeSeconds?: number })?.elapsedTimeSeconds,
      },
    },
  });
}
```

#### 3.2 转发 `tool_use_summary`

```typescript
if (event.type === "tool_use_summary" && event.output) {
  const summaryOutput = event.output as { summary: string; precedingToolUseIds: string[] };
  // 将摘要作为文本块写入流
  const summaryId = createId("summary");
  writeAndTrack({
    type: "text-start",
    id: summaryId,
  });
  writeAndTrack({
    type: "text-delta",
    id: summaryId,
    delta: summaryOutput.summary,
  });
  writeAndTrack({
    type: "text-end",
    id: summaryId,
  });
}
```

#### 3.3 转发 `result`（会话汇总）

```typescript
if (event.type === "result" && event.output) {
  const resultData = event.output as {
    subtype?: string;
    result?: string;
    isError?: boolean;
    durationMs?: number;
    numTurns?: number;
    totalCostUsd?: number;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  safeWriteSSE({
    type: "message-metadata",
    messageMetadata: {
      unstable_data: {
        type: "session_result",
        ...resultData,
      },
    },
  });
}
```

#### 3.4 转发 `thinking_delta`（流式思考）

```typescript
// 思考增量事件 → 追加到当前 reasoning 流
if (event.type === "thinking_delta" && event.output) {
  if (!currentReasoningId) {
    currentReasoningId = createId("reasoning");
    writeAndTrack({ type: "reasoning-start", id: currentReasoningId });
  }
  writeAndTrack({
    type: "reasoning-delta",
    id: currentReasoningId,
    delta: String(event.output),
  });
}
```

> **注意**：需要同时修改 `thinking`（完整块）的处理逻辑，当已有 thinking_delta 流在进行时跳过重复输出。添加一个 `currentReasoningId` 状态变量来协调 thinking / thinking_delta 的去重。

---

### 第二期：前端渲染优化（ChatMessageList + 新组件）

**涉及文件**：
- `app/components/chat/ChatMessageList.tsx`
- `app/components/chat/AssistMessagePart.tsx`
- `app/components/ToolMessagePart.tsx`（微调）

#### 3.5 AssistMessagePart MetadataTooltip

助手消息的操作栏（hover `···`）已集成 Model 信息与 Token Usage 统计。`result` 事件数据通过 `message-metadata` 传递至 `metadata.unstable_data`（`type: "session_result"`），可按需在 MetadataTooltip 中扩展显示会话级统计（耗时/轮次/费用）。

#### 3.6 工具气泡增加进度信息

在 `ToolMessagePart` 执行中状态下，显示来自 `tool_progress` 的耗时信息：

```
┌──────────────────────────────────┐
│ ▶️ 正在执行：Bash               │
│ ⏱️ 已执行 12.3 秒               │
│ [●○○○○ 加载动画]                 │
└──────────────────────────────────┘
```

#### 3.7 修正 step-start 渲染

将 `step-start` 类型渲染为轻量分隔线而非内容气泡，因为它实际只是 AI SDK 的多轮分隔标记：

```
── 第 2 轮 ──────────────────────────
```

#### 3.8 修正工具气泡状态逻辑

`ChatMessageList.getToolStatus()` 改为：

```typescript
function getToolStatus(part, isLoading, isLast): ToolStatus {
  if (part.state === "output-error") return "error";
  if (TOOL_COMPLETED_STATES.has(part.state ?? "")) return "completed";
  // 没有明确的完成状态、且仍在 loading → executing
  if (isLoading) return "executing";
  // 既没有完成也没有在 loading → 认为已完成（历史消息）
  return "completed";
}
```

去掉对 `isLast` 的依赖，避免非最后一条消息中的工具被错误标记。

---

### 第三期：PRD 文档更新

更新 `docs/prd/Chat His.md` 使其与实际实现对齐：

#### 3.9 修订消息类型表

| 消息类型 | 对齐 | 内容规则 | 数据来源 |
|---|---|---|---|
| 🧠 思考消息 | 左 | 流式渲染思考过程 | `thinking_delta` / `thinking` 事件 → `reasoning` part |
| 💬 AI 回复 | 左 | Markdown 渲染，长文本可折叠 | `text_delta` → `text` part |
| 👤 用户消息 | 右 | 纯文本 + 附件 | 用户输入 → `text` / `file` part |
| ▶️ 工具执行 | 左 | 显示工具名 + 参数 + 进度时间 | `tool_use_start` → `isToolUIPart` |
| 💻 工具结果 | 右 | 代码块输出，成功绿/失败红 | `tool_result` → `isToolUIPart` (completed) |
| 📋 执行摘要 | 左 | 多工具链人可读汇总 | `tool_use_summary` → `text` part |
| 📊 会话统计 | — | Token/耗时/费用/轮次（数据存于 metadata.unstable_data） | `result` → `message-metadata` |
| ── 分隔线 ── | 居中 | 多轮分隔 | `step-start` part |

#### 3.10 修订布局结构

```
ChatPanel (flex flex-col min-h-0)
├── ChatMessageList (flex-1 overflow-y-auto)
│   ├── 🧠 思考气泡 (reasoning, 左对齐, 可折叠)
│   ├── 💬 AI回复气泡 (text, 左对齐, Markdown)
│   ├── 👤 用户气泡 (text, 右对齐)
│   ├── ▶️ 工具执行气泡 (tool, 左对齐, 含进度)
│   ├── 💻 工具结果气泡 (tool completed, 右对齐, 代码块)
│   ├── 📋 执行摘要气泡 (text, 左对齐)
│   └── ── 轮次分隔线 ── (step-start, 居中)
└── AIInputDock (sticky bottom-0)
```

---

## 四、修改文件清单

| 文件 | 修改内容 | 期次 |
|---|---|---|
| `app/api/claude-agent/route.ts` | `onToolEvent` 增加 `tool_progress` / `tool_use_summary` / `result` / `thinking_delta` 转发 | 第一期 |
| `app/lib/claude-agent-kit/server/server/agent-runner.ts` | 无修改（事件已全部正确输出） | — |
| `app/components/chat/ChatMessageList.tsx` | ① 修正 `getToolStatus` 去掉 isLast 依赖 ② `step-start` 改为分隔线 | 第二期 |
| `app/components/chat/AssistMessagePart.tsx` | **新增**：助手消息组件（Markdown + 操作栏 + MetadataTooltip） | 第二期 |
| `app/components/ToolMessagePart.tsx` | 增加 `elapsedTime` prop 显示进度 | 第二期 |
| `docs/prd/Chat His.md` | 重写消息类型表 + 布局结构 | 第三期 |

---

## 五、验证清单

- [ ] `thinking_delta` 事件 → 前端实时流式显示思考过程（非一次性出现）
- [ ] `tool_progress` 事件 → 工具执行气泡显示 "⏱️ 已执行 N 秒"
- [ ] `tool_use_summary` 事件 → 多工具调用后显示人可读摘要文本
- [ ] `result` 事件 → 会话结束数据写入 metadata.unstable_data，MetadataTooltip 可展示
- [ ] `step-start` → 渲染为轻量分隔线而非内容气泡
- [ ] 工具状态：非最后一条消息中的已完成工具不再错误显示为"执行中"
- [ ] 无回归：现有 `text` / `reasoning` / `tool_use` / `tool_result` 渲染不受影响
- [ ] `pnpm lint` + `pnpm test:run` 通过
