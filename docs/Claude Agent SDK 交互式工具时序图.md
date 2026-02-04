> 来源: When Claude Can't Ask: Building Interactive Tools for the Agent SDK
> 

## 核心交互模式

当 Claude 调用自定义 MCP 工具时，整个流程如下：

```mermaid
sequenceDiagram
    participant User as 用户
    participant Browser as 浏览器 (Frontend)
    participant App as 应用服务器 (Your App)
    participant Claude as Claude (子进程)

    Note over User,Claude: 用户发起对话

    User->>Browser: 发送消息
    Browser->>App: POST /chat
    App->>Claude: client.query(message)

    Note over Claude: Claude 决定需要询问用户

    Claude->>App: 调用 ask_user 工具<br/>(带 questions 参数)

    Note over App: Tool Handler 开始执行

    App->>App: event = asyncio.Event()
    App->>Browser: SSE 推送问题
    Browser->>Browser: 显示问答模态框

    Note over App: Handler 阻塞等待

    App->>App: await event.wait()

    User->>Browser: 填写表单并提交
    Browser->>App: POST /submit (answers)

    App->>App: answers = request.json()
    App->>App: event.set() (解除阻塞)

    Note over App: Handler 继续执行

    App-->>Claude: 返回工具结果<br/>"User answered: ..."

    Note over Claude: Claude 继续对话

    Claude-->>App: 返回最终回复
    App-->>Browser: 返回响应
    Browser->>User: 显示 Claude 回复

```

## 工具定义与注册

```mermaid
sequenceDiagram
    participant Dev as 开发者
    participant SDK as Claude Agent SDK
    participant MCP as MCP Server
    participant Claude as Claude

    Dev->>SDK: @tool 装饰器定义工具
    Note over Dev: ask_user_tool(args)

    Dev->>MCP: create_sdk_mcp_server()<br/>注册工具

    Dev->>SDK: ClaudeAgentOptions 配置
    Note over Dev: allowed_tools: ["mcp__user__ask_user"]<br/>disallowed_tools: ["AskUserQuestion"]

    SDK->>Claude: 启动 Claude 子进程
    Claude->>MCP: 工具调用请求
    MCP->>Dev: 执行自定义 handler

```

## 使用 canUseTool 实现工具确认

Claude Agent SDK 提供 `canUseTool` 回调作为官方权限处理器，用于在工具执行前控制是否允许。这是实现工具确认的推荐方式。

> 参考: https://platform.claude.com/docs/en/agent-sdk/user-input

```mermaid
sequenceDiagram
    participant User as 用户
    participant Browser as 浏览器 (Frontend)
    participant App as 应用服务器
    participant CanUseTool as canUseTool 回调
    participant Claude as Claude Agent

    Note over User,Claude: 用户发起对话（toolChoice="manual"）

    User->>Browser: 发送消息
    Browser->>App: POST /api/claude-agent
    App->>Claude: query(message, { canUseTool })

    Note over Claude: Claude 决定调用工具

    Claude->>CanUseTool: 触发 canUseTool 回调<br/>(toolName, input, { toolUseID })

    Note over CanUseTool: 回调拦截工具调用

    CanUseTool->>App: 发送 tool-input-available 事件
    App->>Browser: SSE 推送工具调用信息
    Browser->>Browser: 显示 Approve/Reject 按钮

    CanUseTool->>CanUseTool: createPendingToolConfirmation()<br/>创建 Promise 并阻塞等待

    User->>Browser: 点击 Approve 或 Reject
    Browser->>App: POST /api/claude-agent/tool-confirm<br/>{toolCallId, approved: true|false}
    App->>CanUseTool: resolvePendingToolConfirmation()<br/>解除 Promise 阻塞

    alt approved = true
        CanUseTool-->>Claude: 返回 { behavior: "allow" }
        Note over Claude: 工具继续执行
        Claude->>Claude: 执行工具
        Claude-->>App: 返回工具结果
    else approved = false
        CanUseTool-->>Claude: 返回 { behavior: "deny", message: "..." }
        Note over Claude: 工具被阻止
        Claude-->>App: 返回拒绝消息
    end

    App-->>Browser: Stream 响应
    Browser->>User: 显示结果

```

### canUseTool 配置（TypeScript）

```typescript
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// canUseTool 回调函数
const canUseTool: CanUseTool = async (
  toolName: string,
  toolInput: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string }
): Promise<PermissionResult> => {
  const toolCallId = options.toolUseID;
  
  // 通知 UI 显示确认按钮
  await sendToolApprovalRequest(toolCallId, toolName, toolInput);
  
  // 阻塞等待用户确认
  const result = await createPendingToolConfirmation(toolCallId, toolName, toolInput);
  
  if (result.approved) {
    return {
      behavior: 'allow',
      toolUseID: toolCallId,
    };
  } else {
    return {
      behavior: 'deny',
      message: result.reason || '用户拒绝',
      toolUseID: toolCallId,
    };
  }
};

// SDK Options 配置
const sdkOptions = {
  canUseTool,  // 注册权限处理器
  permissionMode: "bypassPermissions",  // 跳过内置权限提示
};
```

## 用户批准/拒绝决策分支

```mermaid
sequenceDiagram
    participant User as 用户
    participant Browser as 浏览器
    participant App as 应用服务器
    participant Claude as Claude

    App->>Browser: SSE 推送问题
    Browser->>Browser: 显示问答模态框

    alt 用户提交答案
        User->>Browser: ✅ 填写并提交
        Browser->>App: POST /submit {answers}
        App->>App: event.set()
        App-->>Claude: 返回用户答案
        Claude->>Claude: 基于答案继续处理
        Claude-->>App: 返回处理结果
        App-->>Browser: 推送结果
        Browser->>User: 显示最终回复
    else 用户超时/取消
        User->>Browser: ❌ 关闭模态框
        Browser->>App: POST /cancel 或超时
        App->>App: asyncio.wait_for() 超时
        App-->>Claude: 返回超时/取消消息
        Claude-->>App: 返回错误处理回复
        App-->>Browser: 推送错误信息
        Browser->>User: 显示超时提示
    end

```

## 关键代码模式

### Tool Handler 阻塞模式（Python）

```python
# 在工具 handler 中:
event = asyncio.Event()
await send_questions_to_browser(questions)  # SSE 推送
await event.wait()  # 阻塞等待用户响应
return answers

# 在 /submit endpoint 中:
answers = request.json()
event.set()  # 解除阻塞

```

### Tool Confirmation Store（TypeScript/Node.js）

```typescript
// tool-confirmation-store.ts
// 创建待确认项并返回 Promise（阻塞）
export function createPendingToolConfirmation(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>
): Promise<ToolConfirmationResult> {
  return new Promise((resolve, reject) => {
    pendingConfirmations.set(toolCallId, { resolve, reject, ... });
    
    // 超时保护
    setTimeout(() => {
      if (pendingConfirmations.has(toolCallId)) {
        pendingConfirmations.delete(toolCallId);
        reject(new Error('Confirmation timeout'));
      }
    }, 300000); // 5分钟
  });
}

// 解除阻塞（在 /api/claude-agent/tool-confirm 中调用）
export function resolvePendingToolConfirmation(
  toolCallId: string,
  result: { approved: boolean; reason?: string }
): boolean {
  const pending = pendingConfirmations.get(toolCallId);
  if (pending) {
    pending.resolve(result);
    pendingConfirmations.delete(toolCallId);
    return true;
  }
  return false;
}
```

### 超时处理

```python
# Python: 添加超时保护，防止 handler 永久阻塞
await asyncio.wait_for(event.wait(), timeout=300)  # 5分钟超时

```

```typescript
// TypeScript: 在 createPendingToolConfirmation 中已内置超时
// timeout 参数可配置，默认 5 分钟
```

## 应用场景

此模式可扩展到多种交互场景：

| 场景 | 描述 |
| --- | --- |
| 审批工作流 | 显示 diff，等待批准/拒绝 |
| 文件选择器 | 让用户基于提示浏览和选择文件 |
| 配置向导 | 带验证的多步骤表单 |
| 人工介入 | 在执行破坏性操作前暂停审核 |
| 富输入 | 图片标注、拖放等前端支持的任何交互 |