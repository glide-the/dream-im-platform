# Security Audit Module (Flyweight Pattern) — Design Document

## 1. Architecture Overview

**层级关系**：配置层 → 规则工厂（享元池）→ 审计引擎 → Hook 拦截点 → ClaudeAgentRunner 集成

- **配置层**：加载 `SecurityAuditConfig`（JSON/TS 对象 + Zod 校验 + 环境覆盖）
- **规则工厂**：`AuditRuleFactory` 维护享元池，按规则签名去重
- **审计引擎**：`SecurityAuditEngine` 负责运行时评估与决策
- **Hook 拦截点**：`PreToolUse / PostToolUse / PermissionRequest / SessionStart / Stop`
- **ClaudeAgentRunner 集成**：在 `runStreaming()` 的 `canUseTool` 中注入审计逻辑

## 2. Core Interfaces & Types

```ts
import { z } from "zod";

type AuditAction = "allow" | "deny" | "ask" | "log";

type AuditEvent =
  | "session_start"
  | "pre_tool_use"
  | "post_tool_use"
  | "permission_request"
  | "session_stop";

type AuditRuleType = "network" | "filesystem" | "bash" | "tool_access" | "mcp_tool" | "generic";

interface AuditContext {
  event: AuditEvent;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  sessionId?: string;
  timestamp: string;
  cwd?: string;
  toolUseId?: string;
  toolUsage?: { count: number; maxCalls: number; windowMs: number };
  metadata?: Record<string, unknown>;
}

interface AuditDecision {
  action: AuditAction;
  reason?: string;
  ruleId?: string;
  updatedInput?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface AuditRule {
  id: string;
  type: AuditRuleType;
  event: AuditEvent;
  matcher: RegExp;
  action: AuditAction;
  reason?: string;
  evaluate(context: AuditContext): AuditDecision | null;
}

interface SecurityAuditConfig {
  rules: AuditRuleConfig[];
  sandbox?: {
    network?: { allowedDomains?: string[] };
    filesystem?: { protectedPaths?: string[] };
    excludedCommands?: string[];
  };
  hooks?: Partial<Record<AuditEvent, string[]>>;
  defaultAction?: AuditAction;
  configVersion?: string;
}
```

## 3. Flyweight Pattern Implementation

- **内在状态（Intrinsic State）**：规则本身（规则类型 + matcher regex + action + reason + 约束参数）
- **外在状态（Extrinsic State）**：运行时上下文（`toolName / toolInput / sessionId / timestamp / cwd`）
- **共享机制**：同一规则签名由 `AuditRuleFactory` 缓存复用，跨会话不重复实例化

```ts
class AuditRuleFactory {
  private rulePool = new Map<string, AuditRule>();

  getOrCreateRule(config: AuditRuleConfig): AuditRule {
    const key = this.createRuleKey(config);
    const cached = this.rulePool.get(key);
    if (cached) return cached;
    const rule = this.instantiateRule(config);
    this.rulePool.set(key, rule);
    return rule;
  }
}
```

## 4. Audit Rule Categories

### NetworkAuditRule
- **目标**：审查 `WebFetch` / `WebSearch` 的 URL、域名白名单
- **示例**：仅允许访问 `example.com`

```ts
{
  type: "network",
  event: "pre_tool_use",
  matcher: "WebFetch|WebSearch",
  action: "deny",
  allowedDomains: ["example.com"],
  reason: "Domain not in allowlist"
}
```

### FileSystemAuditRule
- **目标**：审查 `Read`/`Write`/`Edit` 路径，保护敏感文件

```ts
{
  type: "filesystem",
  event: "pre_tool_use",
  matcher: "Read|Write|Edit|MultiEdit",
  action: "deny",
  protectedPaths: ["/etc", "/.ssh"],
  reason: "Protected path access denied"
}
```

### BashCommandAuditRule
- **目标**：审查 `Bash` 命令危险模式（`rm -rf`、`curl | sh`、`sudo`）

```ts
{
  type: "bash",
  event: "pre_tool_use",
  matcher: "Bash",
  action: "allow",
  reason: "Confirm dangerous commands"
}
```

### ToolAccessAuditRule
- **目标**：控制工具调用频率 / 权限

```ts
{
  type: "tool_access",
  event: "pre_tool_use",
  matcher: "WebFetch",
  action: "deny",
  rateLimit: { maxCalls: 10, windowMs: 60000 },
  reason: "Too many tool calls"
}
```

### MCPToolAuditRule
- **目标**：审查 MCP 工具（`mcp__*__*`）调用

```ts
{
  type: "mcp_tool",
  event: "pre_tool_use",
  matcher: "mcp__.*__.*",
  action: "ask",
  reason: "MCP tool requires approval"
}
```

## 5. Configuration Schema

**JSON/TS 结构**（Claude Code settings.json 风格兼容）：

```ts
const config: SecurityAuditConfig = {
  configVersion: "2024-09-01",
  defaultAction: "allow",
  rules: [
    {
      id: "network-allowlist",
      type: "network",
      event: "pre_tool_use",
      matcher: "WebFetch|WebSearch",
      action: "deny",
      allowedDomains: ["example.com"],
      reason: "Domain not in allowlist",
    },
  ],
  sandbox: {
    network: { allowedDomains: ["example.com", "api.example.com"] },
    filesystem: { protectedPaths: ["/etc", "/.ssh"] },
    excludedCommands: ["curl | sh", "rm -rf"],
  },
  hooks: {
    pre_tool_use: ["security-audit"],
  },
};
```

- **rules[]**：每条规则支持 `event / matcher / action / reason`
- **sandbox**：网络域名白名单、文件路径保护、排除命令
- **hooks**：映射 `PreToolUse` / `PostToolUse` 等事件
- **运行时热更新**：支持配置文件 watch 或 API 推送刷新

## 6. Integration with ClaudeAgentRunner

- 在 `runStreaming()` 内构建 `SecurityAuditEngine`
- 将审计判断注入 `canUseTool`：
  - `deny` → 直接拒绝
  - `ask` → 触发 `onToolConfirmationRequest`
  - `allow` / `log` → 放行
- `post_tool_use` 在 `tool_result` 阶段记录审计日志

## 7. Audit Logging & Decision Flow

**日志格式**：

```ts
interface AuditLogEntry {
  timestamp: string;
  event: AuditEvent;
  toolName?: string;
  toolUseId?: string;
  sessionId?: string;
  action: AuditAction;
  reason?: string;
  ruleId?: string;
  metadata?: Record<string, unknown>;
}
```

**决策流程**：
- `deny` → 拒绝 + 记录
- `ask` → 触发 `onToolConfirmationRequest` + 记录
- `allow` → 放行 + 记录
- `log` → 放行 + 记录

## 8. Hot-Reload & Runtime Config Update

- `watchSecurityAuditConfig(configPath, onUpdate)` 使用 `fs.watch` 监听配置文件变更
- `SecurityAuditEngine.updateConfig(newConfig)` 支持运行时热更新
- 支持 API 推送更新（由上层调用 `updateConfig`）

## 9. File Structure

```
app/lib/claude-agent-kit/server/security/
├── audit-config-watcher.ts
├── audit-engine.ts
├── audit-rule-factory.ts
├── audit-rule.ts
├── config-schema.ts
├── index.ts
├── types.ts
└── rules/
    ├── bash-command-audit-rule.ts
    ├── filesystem-audit-rule.ts
    ├── generic-audit-rule.ts
    ├── mcp-tool-audit-rule.ts
    ├── network-audit-rule.ts
    ├── rule-utils.ts
    └── tool-access-audit-rule.ts
```

## 10. Test Strategy

- **规则缓存复用**：同规则配置返回同一实例
- **deny/allow/ask**：覆盖关键决策路径
- **配置热更新**：`updateConfig` 后规则池更新
- **边界条件**：非法 URL、缺失 `toolInput` 等

建议新增单测：
- `SecurityAuditEngine` 规则匹配与判定
- `AuditRuleFactory` 享元复用
- `sandbox` 派生规则
