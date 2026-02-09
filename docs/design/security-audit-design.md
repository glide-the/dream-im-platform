# Security Audit Module — 详细设计说明

> 基于享元模式 (Flyweight Pattern) 的 ClaudeAgentRunner 会话安全审查模块

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Configuration Layer                          │
│  security-audit-config.json / Zod Schema / ENV overrides       │
│  (声明式规则定义, 兼容 Claude Code settings.json 风格)           │
└────────────────────────────┬────────────────────────────────────┘
                             │ parse & validate
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  AuditRuleFactory (享元工厂)                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Flyweight Pool: Map<ruleKey, AuditRule>                │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│  │  │ Network  │ │FileSystem│ │  Bash    │ │ ToolAccess│  │   │
│  │  │AuditRule │ │AuditRule │ │AuditRule │ │AuditRule  │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────│   │
│  └─────────────────────────────────────────────────────────┘   │
│  热更新: watch file / API push → incremental refresh pool      │
└────────────────────────────┬────────────────────────────────────┘
                             │ getRule(key)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SecurityAuditEngine                          │
│  evaluate(context: AuditContext) → AuditDecision               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. Match rules by event + toolName                       │  │
│  │ 2. 优先级: deny > ask > allow > log                      │  │
│  │ 3. 聚合结果, 记录审计日志                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ decision
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Hook Integration Layer                             │
│  注入到 ClaudeAgentRunner.runStreaming() 的 canUseTool 回调      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ PreToolUse  → audit.evaluate() → deny/allow/ask          │  │
│  │ PostToolUse → audit.logResult()                           │  │
│  │ SessionStart → audit.initSession()                        │  │
│  │ Stop → audit.finalizeSession()                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ClaudeAgentRunner                             │
│  runStreaming(opts, callbacks) — 可选启用 SecurityAuditEngine    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Interfaces & Types

```typescript
// app/lib/claude-agent-kit/server/security/types.ts

import { z } from "zod";

// ============================================================
// 2.1 审计决策
// ============================================================

/** 审计判定动作 — 对齐 Claude Code hooks 的 permissionDecision */
export type AuditAction = "allow" | "deny" | "ask" | "log";

/** 审计判定结果 */
export interface AuditDecision {
  /** 最终动作 */
  action: AuditAction;
  /** 判定原因（deny 时反馈给 Claude，ask 时展示给用户） */
  reason?: string;
  /** 触发该判定的规则 ID */
  ruleId: string;
  /** 审计时间戳 */
  timestamp: number;
  /** 如果 action=allow 且需要修改输入 */
  updatedInput?: Record<string, unknown>;
}

// ============================================================
// 2.2 审计上下文 — 外在状态 (Extrinsic State)
// ============================================================

/** 每次工具调用时的运行时上下文，作为参数传入享元 */
export interface AuditContext {
  /** 生命周期事件类型 */
  event: AuditEventType;
  /** 工具名称 (Bash, Write, Read, WebFetch, mcp__*__* 等) */
  toolName: string;
  /** 工具输入参数 */
  toolInput: Record<string, unknown>;
  /** 工具调用 ID */
  toolCallId?: string;
  /** 会话 ID */
  sessionId: string;
  /** 当前工作目录 */
  cwd: string;
  /** 时间戳 */
  timestamp: number;
  /** 工具输出（仅 PostToolUse 可用）*/
  toolOutput?: unknown;
  /** 错误信息（仅 PostToolUseFailure 可用）*/
  error?: string;
}

export type AuditEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PermissionRequest"
  | "SessionStart"
  | "Stop";

// ============================================================
// 2.3 审计规则接口 — 享元接口 (Flyweight)
// ============================================================

/**
 * AuditRule — 享元对象
 *
 * 内在状态（不可变，缓存在工厂池中）：
 * - ruleId, category, matcher (regex), action, reason
 *
 * 外在状态（每次调用时传入）：
 * - AuditContext (toolName, toolInput, sessionId, timestamp...)
 */
export interface AuditRule {
  /** 规则唯一标识（也是工厂池的 key） */
  readonly ruleId: string;
  /** 规则类别 */
  readonly category: AuditRuleCategory;
  /** 匹配的事件类型 */
  readonly event: AuditEventType;
  /** 工具名 matcher（正则字符串，对齐 Claude Code hooks matcher） */
  readonly matcher: string;
  /** 默认判定动作 */
  readonly action: AuditAction;
  /** 判定原因模板 */
  readonly reason: string;

  /**
   * 核心方法：评估外在状态，返回判定结果
   * 享元模式的关键 — 自身不持有任何会话级状态
   */
  evaluate(context: AuditContext): AuditDecision | null;

  /**
   * 用于享元池 key 的签名（相同签名 = 可复用同一实例）
   */
  getSignature(): string;
}

export type AuditRuleCategory =
  | "network"       // WebFetch, WebSearch
  | "filesystem"    // Read, Write, Edit, Glob, Grep
  | "bash"          // Bash
  | "tool-access"   // 任意工具的频率/权限控制
  | "mcp-tool";     // mcp__*__* 模式

// ============================================================
// 2.4 审计规则工厂 — 享元工厂 (Flyweight Factory)
// ============================================================

export interface IAuditRuleFactory {
  /** 从池中获取或创建规则享元 */
  getRule(config: AuditRuleConfig): AuditRule;
  /** 获取所有已缓存的规则 */
  getAllRules(): ReadonlyMap<string, AuditRule>;
  /** 按事件类型获取匹配的规则列表 */
  getRulesForEvent(event: AuditEventType): AuditRule[];
  /** 热更新：传入新配置，增量刷新池 */
  refreshPool(configs: AuditRuleConfig[]): void;
  /** 池统计信息 */
  getPoolStats(): { totalRules: number; categories: Record<string, number> };
}

// ============================================================
// 2.5 配置结构
// ============================================================

export interface AuditRuleConfig {
  /** 规则 ID（可选，自动生成） */
  id?: string;
  /** 规则类别 */
  category: AuditRuleCategory;
  /** 匹配的生命周期事件 */
  event: AuditEventType;
  /** 工具名 matcher（正则，如 "Bash", "Write|Edit", "mcp__.*__write.*"） */
  matcher: string;
  /** 判定动作 */
  action: AuditAction;
  /** 判定原因 */
  reason: string;
  /** 类别特有的额外参数 */
  params?: Record<string, unknown>;
}

/** 顶层安全审计配置 */
export interface SecurityAuditConfig {
  /** 是否启用安全审计 */
  enabled: boolean;
  /** 审计规则列表 */
  rules: AuditRuleConfig[];
  /** 沙箱相关配置 */
  sandbox?: {
    /** 网络域名白名单 */
    allowedDomains?: string[];
    /** 网络域名黑名单 */
    blockedDomains?: string[];
    /** 受保护的文件路径模式列表（deny Read/Write/Edit） */
    protectedPaths?: string[];
    /** Bash 排除命令 */
    blockedBashPatterns?: string[];
  };
  /** 审计日志配置 */
  logging?: {
    /** 是否启用审计日志 */
    enabled: boolean;
    /** 日志级别 */
    level: "all" | "deny-only" | "deny-and-ask";
    /** 日志输出目标 */
    output: "console" | "file" | "callback";
    /** 日志文件路径（output=file 时） */
    filePath?: string;
  };
  /** 配置热更新 */
  hotReload?: {
    enabled: boolean;
    /** 监听配置文件路径 */
    watchPath?: string;
    /** 刷新间隔 (ms) */
    intervalMs?: number;
  };
}
```

---

## 3. Flyweight Pattern Implementation

### 3.1 内在/外在状态分离

```
┌─────────────────────────────────────────────────────┐
│              AuditRule (享元对象)                      │
│                                                      │
│  内在状态 (Intrinsic - 不可变, 缓存共享):             │
│  ├─ ruleId: "bash-block-rm-rf"                       │
│  ├─ category: "bash"                                 │
│  ├─ event: "PreToolUse"                              │
│  ├─ matcher: "Bash"                                  │
│  ├─ action: "deny"                                   │
│  ├─ reason: "Destructive command blocked"            │
│  └─ params: { pattern: "rm\\s+-rf" }                 │
│                                                      │
│  外在状态 (Extrinsic - 每次调用传入):                 │
│  └─ evaluate(context) 的 context 参数:               │
│     ├─ toolName: "Bash"                              │
│     ├─ toolInput: { command: "rm -rf /tmp" }         │
│     ├─ sessionId: "sess_abc123"                      │
│     ├─ cwd: "/home/user/project"                     │
│     └─ timestamp: 1707465600000                      │
└─────────────────────────────────────────────────────┘
```

### 3.2 AuditRuleFactory 实现

```typescript
// app/lib/claude-agent-kit/server/security/audit-rule-factory.ts

import type {
  AuditRule,
  AuditRuleConfig,
  AuditRuleCategory,
  AuditEventType,
  IAuditRuleFactory,
} from "./types";
import { NetworkAuditRule } from "./rules/network-audit-rule";
import { FileSystemAuditRule } from "./rules/filesystem-audit-rule";
import { BashCommandAuditRule } from "./rules/bash-command-audit-rule";
import { ToolAccessAuditRule } from "./rules/tool-access-audit-rule";
import { MCPToolAuditRule } from "./rules/mcp-tool-audit-rule";

/**
 * 生成规则签名 — 用于享元池的去重 key
 * 相同签名的规则共享同一实例
 */
function computeRuleSignature(config: AuditRuleConfig): string {
  return `${config.category}::${config.event}::${config.matcher}::${config.action}::${JSON.stringify(config.params ?? {})}`;
}

/**
 * AuditRuleFactory — 享元工厂
 *
 * 职责：
 * 1. 维护 Map<signature, AuditRule> 享元池
 * 2. 按签名去重，同一规则定义只实例化一次
 * 3. 支持 refreshPool() 热更新 — 增量 diff，仅新增/移除变化的规则
 */
export class AuditRuleFactory implements IAuditRuleFactory {
  /** 享元池：signature → AuditRule */
  private pool: Map<string, AuditRule> = new Map();

  /** 事件索引：event → Set<signature>，加速按事件查询 */
  private eventIndex: Map<AuditEventType, Set<string>> = new Map();

  /** 创建具体规则实例 — 工厂方法 */
  private createRule(config: AuditRuleConfig): AuditRule {
    const creators: Record<AuditRuleCategory, (c: AuditRuleConfig) => AuditRule> = {
      "network":     (c) => new NetworkAuditRule(c),
      "filesystem":  (c) => new FileSystemAuditRule(c),
      "bash":        (c) => new BashCommandAuditRule(c),
      "tool-access": (c) => new ToolAccessAuditRule(c),
      "mcp-tool":    (c) => new MCPToolAuditRule(c),
    };

    const creator = creators[config.category];
    if (!creator) {
      throw new Error(`Unknown audit rule category: ${config.category}`);
    }
    return creator(config);
  }

  getRule(config: AuditRuleConfig): AuditRule {
    const signature = computeRuleSignature(config);

    // 享元复用：池中已有则直接返回
    const existing = this.pool.get(signature);
    if (existing) {
      return existing;
    }

    // 创建新享元并缓存
    const rule = this.createRule(config);
    this.pool.set(signature, rule);

    // 更新事件索引
    if (!this.eventIndex.has(config.event)) {
      this.eventIndex.set(config.event, new Set());
    }
    this.eventIndex.get(config.event)!.add(signature);

    return rule;
  }

  getAllRules(): ReadonlyMap<string, AuditRule> {
    return this.pool;
  }

  getRulesForEvent(event: AuditEventType): AuditRule[] {
    const signatures = this.eventIndex.get(event);
    if (!signatures) return [];
    return Array.from(signatures)
      .map((sig) => this.pool.get(sig))
      .filter((r): r is AuditRule => r !== undefined);
  }

  /**
   * 热更新：增量刷新享元池
   * 1. 计算新配置的签名集合
   * 2. 移除不再需要的旧规则
   * 3. 新增尚未存在的规则
   */
  refreshPool(configs: AuditRuleConfig[]): void {
    const newSignatures = new Set(configs.map(computeRuleSignature));

    // 移除旧规则
    for (const [sig] of this.pool) {
      if (!newSignatures.has(sig)) {
        this.pool.delete(sig);
        for (const [, sigs] of this.eventIndex) {
          sigs.delete(sig);
        }
      }
    }

    // 新增/更新规则
    for (const config of configs) {
      this.getRule(config); // getRule 内部已有去重
    }
  }

  getPoolStats(): { totalRules: number; categories: Record<string, number> } {
    const categories: Record<string, number> = {};
    for (const rule of this.pool.values()) {
      categories[rule.category] = (categories[rule.category] ?? 0) + 1;
    }
    return { totalRules: this.pool.size, categories };
  }
}
```

### 3.3 享元复用示例

```
场景：配置中有 3 条规则，其中 2 条签名相同

Config Rules:
  rule-1: { category: "bash", event: "PreToolUse", matcher: "Bash", action: "deny", params: { pattern: "rm -rf" } }
  rule-2: { category: "bash", event: "PreToolUse", matcher: "Bash", action: "deny", params: { pattern: "rm -rf" } }  ← 重复
  rule-3: { category: "network", event: "PreToolUse", matcher: "WebFetch", action: "deny", params: { blockedDomains: ["evil.com"] } }

Pool after initialization:
  pool.size = 2  (rule-1 和 rule-2 共享同一实例)
  "bash::PreToolUse::Bash::deny::{...}"   → BashCommandAuditRule instance
  "network::PreToolUse::WebFetch::deny::{...}" → NetworkAuditRule instance
```

---

## 4. Audit Rule Categories

### 4.1 NetworkAuditRule

```typescript
// app/lib/claude-agent-kit/server/security/rules/network-audit-rule.ts

import type { AuditRule, AuditContext, AuditDecision, AuditRuleConfig, AuditRuleCategory, AuditEventType, AuditAction } from "../types";

export class NetworkAuditRule implements AuditRule {
  readonly ruleId: string;
  readonly category: AuditRuleCategory = "network";
  readonly event: AuditEventType;
  readonly matcher: string;
  readonly action: AuditAction;
  readonly reason: string;

  // 内在状态：编译好的域名白/黑名单
  private readonly allowedDomains: RegExp[];
  private readonly blockedDomains: RegExp[];
  private readonly matcherRegex: RegExp;

  constructor(config: AuditRuleConfig) {
    this.ruleId = config.id ?? `network-${config.matcher}-${config.action}`;
    this.event = config.event;
    this.matcher = config.matcher;
    this.action = config.action;
    this.reason = config.reason;
    this.matcherRegex = new RegExp(config.matcher);

    const params = config.params as {
      allowedDomains?: string[];
      blockedDomains?: string[];
    } | undefined;

    this.allowedDomains = (params?.allowedDomains ?? []).map(
      (d) => new RegExp(d.replace(/\*/g, ".*"))
    );
    this.blockedDomains = (params?.blockedDomains ?? []).map(
      (d) => new RegExp(d.replace(/\*/g, ".*"))
    );
  }

  evaluate(context: AuditContext): AuditDecision | null {
    // 1. 匹配工具名
    if (!this.matcherRegex.test(context.toolName)) return null;

    // 2. 提取 URL
    const url = (context.toolInput as { url?: string }).url;
    if (!url) return null;

    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return {
        action: "deny",
        reason: `Invalid URL: ${url}`,
        ruleId: this.ruleId,
        timestamp: context.timestamp,
      };
    }

    // 3. 检查黑名单
    if (this.blockedDomains.some((re) => re.test(hostname))) {
      return {
        action: "deny",
        reason: `${this.reason}: domain ${hostname} is blocked`,
        ruleId: this.ruleId,
        timestamp: context.timestamp,
      };
    }

    // 4. 如果有白名单且不在白名单中
    if (this.allowedDomains.length > 0 && !this.allowedDomains.some((re) => re.test(hostname))) {
      return {
        action: "deny",
        reason: `${this.reason}: domain ${hostname} not in allowed list`,
        ruleId: this.ruleId,
        timestamp: context.timestamp,
      };
    }

    // 5. 通过
    return {
      action: this.action === "deny" ? "allow" : this.action,
      reason: `Network access allowed: ${hostname}`,
      ruleId: this.ruleId,
      timestamp: context.timestamp,
    };
  }

  getSignature(): string {
    return `${this.category}::${this.event}::${this.matcher}::${this.action}::${JSON.stringify({
      allowedDomains: this.allowedDomains.map(r => r.source),
      blockedDomains: this.blockedDomains.map(r => r.source),
    })}`;
  }
}
```

### 4.2 FileSystemAuditRule

```typescript
// app/lib/claude-agent-kit/server/security/rules/filesystem-audit-rule.ts

import path from "node:path";
import type { AuditRule, AuditContext, AuditDecision, AuditRuleConfig, AuditRuleCategory, AuditEventType, AuditAction } from "../types";

export class FileSystemAuditRule implements AuditRule {
  readonly ruleId: string;
  readonly category: AuditRuleCategory = "filesystem";
  readonly event: AuditEventType;
  readonly matcher: string;
  readonly action: AuditAction;
  readonly reason: string;

  // 内在状态
  private readonly protectedPaths: RegExp[];
  private readonly matcherRegex: RegExp;

  constructor(config: AuditRuleConfig) {
    this.ruleId = config.id ?? `fs-${config.matcher}-${config.action}`;
    this.event = config.event;
    this.matcher = config.matcher;
    this.action = config.action;
    this.reason = config.reason;
    this.matcherRegex = new RegExp(config.matcher);

    const params = config.params as { protectedPaths?: string[] } | undefined;
    this.protectedPaths = (params?.protectedPaths ?? []).map(
      (p) => new RegExp(p.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"))
    );
  }

  evaluate(context: AuditContext): AuditDecision | null {
    if (!this.matcherRegex.test(context.toolName)) return null;

    const filePath = (context.toolInput as { file_path?: string }).file_path
      ?? (context.toolInput as { path?: string }).path;
    if (!filePath) return null;

    const resolved = path.resolve(context.cwd, filePath);

    // 检查是否匹配保护路径
    if (this.protectedPaths.some((re) => re.test(resolved) || re.test(filePath))) {
      return {
        action: "deny",
        reason: `${this.reason}: path "${filePath}" is protected`,
        ruleId: this.ruleId,
        timestamp: context.timestamp,
      };
    }

    // 额外检查路径穿越
    if (filePath.includes("..")) {
      return {
        action: "ask",
        reason: `Path traversal detected: "${filePath}" — requires confirmation`,
        ruleId: this.ruleId,
        timestamp: context.timestamp,
      };
    }

    return null; // 不匹配，不做判定
  }

  getSignature(): string {
    return `${this.category}::${this.event}::${this.matcher}::${this.action}::${JSON.stringify({
      protectedPaths: this.protectedPaths.map(r => r.source),
    })}`;
  }
}
```

### 4.3 BashCommandAuditRule

```typescript
// app/lib/claude-agent-kit/server/security/rules/bash-command-audit-rule.ts

import type { AuditRule, AuditContext, AuditDecision, AuditRuleConfig, AuditRuleCategory, AuditEventType, AuditAction } from "../types";

export class BashCommandAuditRule implements AuditRule {
  readonly ruleId: string;
  readonly category: AuditRuleCategory = "bash";
  readonly event: AuditEventType;
  readonly matcher: string;
  readonly action: AuditAction;
  readonly reason: string;

  // 内在状态：预编译的危险命令模式
  private readonly blockedPatterns: RegExp[];
  private readonly matcherRegex: RegExp;

  constructor(config: AuditRuleConfig) {
    this.ruleId = config.id ?? `bash-${config.action}`;
    this.event = config.event;
    this.matcher = config.matcher;
    this.action = config.action;
    this.reason = config.reason;
    this.matcherRegex = new RegExp(config.matcher);

    const params = config.params as { blockedPatterns?: string[] } | undefined;
    this.blockedPatterns = (params?.blockedPatterns ?? [
      "rm\\s+-rf",
      "curl.*\\|.*sh",
      "wget.*\\|.*sh",
      "sudo\\s+",
      "chmod\\s+777",
      ":(){ :\\|:& };:",      // fork bomb
      "> /dev/sd",              // disk overwrite
    ]).map((p) => new RegExp(p, "i"));
  }

  evaluate(context: AuditContext): AuditDecision | null {
    if (!this.matcherRegex.test(context.toolName)) return null;

    const command = (context.toolInput as { command?: string }).command;
    if (!command) return null;

    for (const pattern of this.blockedPatterns) {
      if (pattern.test(command)) {
        return {
          action: "deny",
          reason: `${this.reason}: command matches blocked pattern "${pattern.source}"`,
          ruleId: this.ruleId,
          timestamp: context.timestamp,
        };
      }
    }

    return null;
  }

  getSignature(): string {
    return `${this.category}::${this.event}::${this.matcher}::${this.action}::${JSON.stringify({
      blockedPatterns: this.blockedPatterns.map(r => r.source),
    })}`;
  }
}
```

### 4.4 ToolAccessAuditRule

```typescript
// app/lib/claude-agent-kit/server/security/rules/tool-access-audit-rule.ts

import type { AuditRule, AuditContext, AuditDecision, AuditRuleConfig, AuditRuleCategory, AuditEventType, AuditAction } from "../types";

/**
 * 审查特定工具的调用权限和频率限制
 *
 * 注意：频率计数器是外在状态的一部分，
 * 通过 AuditEngine 维护的 sessionState 传入，
 * 而非存储在享元内部 — 保持享元无状态
 */
export class ToolAccessAuditRule implements AuditRule {
  readonly ruleId: string;
  readonly category: AuditRuleCategory = "tool-access";
  readonly event: AuditEventType;
  readonly matcher: string;
  readonly action: AuditAction;
  readonly reason: string;

  private readonly matcherRegex: RegExp;
  private readonly maxCallsPerSession: number;
  private readonly deniedTools: Set<string>;

  constructor(config: AuditRuleConfig) {
    this.ruleId = config.id ?? `tool-access-${config.matcher}`;
    this.event = config.event;
    this.matcher = config.matcher;
    this.action = config.action;
    this.reason = config.reason;
    this.matcherRegex = new RegExp(config.matcher);

    const params = config.params as {
      maxCallsPerSession?: number;
      deniedTools?: string[];
    } | undefined;

    this.maxCallsPerSession = params?.maxCallsPerSession ?? Infinity;
    this.deniedTools = new Set(params?.deniedTools ?? []);
  }

  evaluate(context: AuditContext): AuditDecision | null {
    if (!this.matcherRegex.test(context.toolName)) return null;

    // 绝对禁止的工具
    if (this.deniedTools.has(context.toolName)) {
      return {
        action: "deny",
        reason: `${this.reason}: tool "${context.toolName}" is explicitly denied`,
        ruleId: this.ruleId,
        timestamp: context.timestamp,
      };
    }

    // 频率限制：由外部 AuditEngine 传入 callCount
    // (context 可通过扩展字段携带)
    return null;
  }

  getSignature(): string {
    return `${this.category}::${this.event}::${this.matcher}::${this.action}::${JSON.stringify({
      maxCallsPerSession: this.maxCallsPerSession,
      deniedTools: Array.from(this.deniedTools),
    })}`;
  }

  getMaxCallsPerSession(): number {
    return this.maxCallsPerSession;
  }
}
```

### 4.5 MCPToolAuditRule

```typescript
// app/lib/claude-agent-kit/server/security/rules/mcp-tool-audit-rule.ts

import type { AuditRule, AuditContext, AuditDecision, AuditRuleConfig, AuditRuleCategory, AuditEventType, AuditAction } from "../types";

/**
 * 审查 MCP 工具的调用
 * MCP 工具名称格式: mcp__<server>__<tool>
 */
export class MCPToolAuditRule implements AuditRule {
  readonly ruleId: string;
  readonly category: AuditRuleCategory = "mcp-tool";
  readonly event: AuditEventType;
  readonly matcher: string;
  readonly action: AuditAction;
  readonly reason: string;

  private readonly matcherRegex: RegExp;
  private readonly allowedServers: Set<string>;
  private readonly blockedServers: Set<string>;

  constructor(config: AuditRuleConfig) {
    this.ruleId = config.id ?? `mcp-${config.matcher}`;
    this.event = config.event;
    this.matcher = config.matcher;
    this.action = config.action;
    this.reason = config.reason;
    this.matcherRegex = new RegExp(config.matcher);

    const params = config.params as {
      allowedServers?: string[];
      blockedServers?: string[];
    } | undefined;

    this.allowedServers = new Set(params?.allowedServers ?? []);
    this.blockedServers = new Set(params?.blockedServers ?? []);
  }

  evaluate(context: AuditContext): AuditDecision | null {
    // 只处理 MCP 工具
    if (!context.toolName.startsWith("mcp__")) return null;
    if (!this.matcherRegex.test(context.toolName)) return null;

    // 解析 server 名称
    const parts = context.toolName.split("__");
    const serverName = parts[1] ?? "";

    if (this.blockedServers.has(serverName)) {
      return {
        action: "deny",
        reason: `${this.reason}: MCP server "${serverName}" is blocked`,
        ruleId: this.ruleId,
        timestamp: context.timestamp,
      };
    }

    if (this.allowedServers.size > 0 && !this.allowedServers.has(serverName)) {
      return {
        action: "deny",
        reason: `${this.reason}: MCP server "${serverName}" not in allowed list`,
        ruleId: this.ruleId,
        timestamp: context.timestamp,
      };
    }

    return null;
  }

  getSignature(): string {
    return `${this.category}::${this.event}::${this.matcher}::${this.action}::${JSON.stringify({
      allowedServers: Array.from(this.allowedServers),
      blockedServers: Array.from(this.blockedServers),
    })}`;
  }
}
```

---

## 5. Configuration Schema (Zod)

```typescript
// app/lib/claude-agent-kit/server/security/config-schema.ts

import { z } from "zod";

export const auditRuleConfigSchema = z.object({
  id: z.string().optional(),
  category: z.enum(["network", "filesystem", "bash", "tool-access", "mcp-tool"]),
  event: z.enum([
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "SessionStart",
    "Stop",
  ]),
  matcher: z.string().min(1),
  action: z.enum(["allow", "deny", "ask", "log"]),
  reason: z.string(),
  params: z.record(z.unknown()).optional(),
});

export const securityAuditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  rules: z.array(auditRuleConfigSchema).default([]),
  sandbox: z
    .object({
      allowedDomains: z.array(z.string()).optional(),
      blockedDomains: z.array(z.string()).optional(),
      protectedPaths: z.array(z.string()).optional(),
      blockedBashPatterns: z.array(z.string()).optional(),
    })
    .optional(),
  logging: z
    .object({
      enabled: z.boolean().default(true),
      level: z.enum(["all", "deny-only", "deny-and-ask"]).default("all"),
      output: z.enum(["console", "file", "callback"]).default("console"),
      filePath: z.string().optional(),
    })
    .optional(),
  hotReload: z
    .object({
      enabled: z.boolean().default(false),
      watchPath: z.string().optional(),
      intervalMs: z.number().default(5000),
    })
    .optional(),
});

export type SecurityAuditConfigParsed = z.infer<typeof securityAuditConfigSchema>;
```

### 示例配置文件

```jsonc
// .claude/security-audit.json
// 兼容 Claude Code settings.json hooks 风格
{
  "enabled": true,
  "rules": [
    {
      "id": "block-destructive-bash",
      "category": "bash",
      "event": "PreToolUse",
      "matcher": "Bash",
      "action": "deny",
      "reason": "Destructive command blocked by security audit",
      "params": {
        "blockedPatterns": ["rm\\s+-rf", "sudo\\s+", "curl.*\\|.*sh"]
      }
    },
    {
      "id": "protect-env-files",
      "category": "filesystem",
      "event": "PreToolUse",
      "matcher": "Read|Write|Edit",
      "action": "deny",
      "reason": "Protected file access blocked",
      "params": {
        "protectedPaths": [".env", ".env.*", "secrets/**", "*.pem", "*.key"]
      }
    },
    {
      "id": "network-domain-allowlist",
      "category": "network",
      "event": "PreToolUse",
      "matcher": "WebFetch|WebSearch",
      "action": "deny",
      "reason": "Network access restricted by domain allowlist",
      "params": {
        "allowedDomains": ["*.github.com", "*.npmjs.org", "docs.anthropic.com"],
        "blockedDomains": ["*.malware.com"]
      }
    },
    {
      "id": "mcp-server-allowlist",
      "category": "mcp-tool",
      "event": "PreToolUse",
      "matcher": "mcp__.*",
      "action": "deny",
      "reason": "MCP server not in allowed list",
      "params": {
        "allowedServers": ["user", "memory", "github"],
        "blockedServers": ["filesystem"]
      }
    },
    {
      "id": "log-all-tool-results",
      "category": "tool-access",
      "event": "PostToolUse",
      "matcher": ".*",
      "action": "log",
      "reason": "Audit log for all tool executions"
    }
  ],
  "sandbox": {
    "allowedDomains": ["github.com", "*.npmjs.org"],
    "protectedPaths": [".env", ".env.*", "secrets/**"],
    "blockedBashPatterns": ["rm -rf /", ":(){ :|:& };:"]
  },
  "logging": {
    "enabled": true,
    "level": "all",
    "output": "file",
    "filePath": "./agent-workspaces/audit.log"
  },
  "hotReload": {
    "enabled": true,
    "watchPath": ".claude/security-audit.json",
    "intervalMs": 5000
  }
}
```

---

## 6. SecurityAuditEngine

```typescript
// app/lib/claude-agent-kit/server/security/audit-engine.ts

import type {
  AuditContext,
  AuditDecision,
  AuditAction,
  AuditEventType,
  SecurityAuditConfig,
  AuditRuleConfig,
  IAuditRuleFactory,
} from "./types";
import { AuditRuleFactory } from "./audit-rule-factory";
import { securityAuditConfigSchema } from "./config-schema";

export interface AuditLogEntry {
  timestamp: number;
  sessionId: string;
  event: AuditEventType;
  toolName: string;
  toolInput: Record<string, unknown>;
  decision: AuditDecision;
}

/**
 * SecurityAuditEngine — 审计引擎核心
 *
 * 编排流程：
 * 1. 接收 AuditContext（外在状态）
 * 2. 从 AuditRuleFactory 获取匹配的享元规则
 * 3. 按优先级评估：deny > ask > allow > log
 * 4. 返回最终 AuditDecision
 * 5. 记录审计日志
 */
export class SecurityAuditEngine {
  private factory: IAuditRuleFactory;
  private config: SecurityAuditConfig;
  private auditLog: AuditLogEntry[] = [];
  private logCallback?: (entry: AuditLogEntry) => void;

  /** 会话级工具调用计数器（外在状态） */
  private toolCallCounts: Map<string, number> = new Map();

  constructor(config: SecurityAuditConfig, logCallback?: (entry: AuditLogEntry) => void) {
    // 验证配置
    this.config = securityAuditConfigSchema.parse(config);
    this.factory = new AuditRuleFactory();
    this.logCallback = logCallback;

    // 加载 rules 到享元池
    this.initializeRules(this.config.rules);

    // 自动从 sandbox 配置生成补充规则
    this.initializeSandboxRules();
  }

  private initializeRules(rules: AuditRuleConfig[]): void {
    for (const ruleConfig of rules) {
      this.factory.getRule(ruleConfig);
    }
  }

  /** 从 sandbox 快捷配置自动生成享元规则 */
  private initializeSandboxRules(): void {
    const sandbox = this.config.sandbox;
    if (!sandbox) return;

    // sandbox.protectedPaths → FileSystemAuditRule
    if (sandbox.protectedPaths?.length) {
      this.factory.getRule({
        id: "__sandbox_fs_protect",
        category: "filesystem",
        event: "PreToolUse",
        matcher: "Read|Write|Edit",
        action: "deny",
        reason: "Protected by sandbox configuration",
        params: { protectedPaths: sandbox.protectedPaths },
      });
    }

    // sandbox.blockedBashPatterns → BashCommandAuditRule
    if (sandbox.blockedBashPatterns?.length) {
      this.factory.getRule({
        id: "__sandbox_bash_block",
        category: "bash",
        event: "PreToolUse",
        matcher: "Bash",
        action: "deny",
        reason: "Blocked by sandbox configuration",
        params: { blockedPatterns: sandbox.blockedBashPatterns },
      });
    }

    // sandbox.allowedDomains / blockedDomains → NetworkAuditRule
    if (sandbox.allowedDomains?.length || sandbox.blockedDomains?.length) {
      this.factory.getRule({
        id: "__sandbox_network",
        category: "network",
        event: "PreToolUse",
        matcher: "WebFetch|WebSearch",
        action: "deny",
        reason: "Restricted by sandbox network policy",
        params: {
          allowedDomains: sandbox.allowedDomains,
          blockedDomains: sandbox.blockedDomains,
        },
      });
    }
  }

  /**
   * 核心方法：评估审计上下文
   *
   * 优先级（对齐 Claude Code permission rules）：
   * deny > ask > allow > log
   * 第一个 deny 立即返回
   */
  evaluate(context: AuditContext): AuditDecision {
    if (!this.config.enabled) {
      return {
        action: "allow",
        reason: "Security audit disabled",
        ruleId: "__disabled",
        timestamp: context.timestamp,
      };
    }

    const rules = this.factory.getRulesForEvent(context.event);
    const decisions: AuditDecision[] = [];

    for (const rule of rules) {
      const decision = rule.evaluate(context);
      if (decision) {
        decisions.push(decision);
        // deny 优先级最高，立即短路返回
        if (decision.action === "deny") {
          this.recordLog(context, decision);
          return decision;
        }
      }
    }

    // 按优先级排序：ask > allow > log
    const priorityOrder: Record<AuditAction, number> = {
      deny: 0,
      ask: 1,
      allow: 2,
      log: 3,
    };

    decisions.sort((a, b) => priorityOrder[a.action] - priorityOrder[b.action]);

    const finalDecision = decisions[0] ?? {
      action: "allow" as AuditAction,
      reason: "No matching audit rules",
      ruleId: "__default",
      timestamp: context.timestamp,
    };

    this.recordLog(context, finalDecision);

    // 更新工具调用计数器
    const count = (this.toolCallCounts.get(context.toolName) ?? 0) + 1;
    this.toolCallCounts.set(context.toolName, count);

    return finalDecision;
  }

  private recordLog(context: AuditContext, decision: AuditDecision): void {
    const logConfig = this.config.logging;
    if (!logConfig?.enabled) return;

    // 按 level 过滤
    if (logConfig.level === "deny-only" && decision.action !== "deny") return;
    if (logConfig.level === "deny-and-ask" && !["deny", "ask"].includes(decision.action)) return;

    const entry: AuditLogEntry = {
      timestamp: context.timestamp,
      sessionId: context.sessionId,
      event: context.event,
      toolName: context.toolName,
      toolInput: context.toolInput,
      decision,
    };

    this.auditLog.push(entry);

    if (this.logCallback) {
      this.logCallback(entry);
    }

    if (logConfig.output === "console") {
      console.log(`[SecurityAudit] ${decision.action.toUpperCase()} | ${context.toolName} | ${decision.reason}`);
    }
  }

  /** 热更新配置 */
  updateConfig(newConfig: SecurityAuditConfig): void {
    this.config = securityAuditConfigSchema.parse(newConfig);
    this.factory.refreshPool(this.config.rules);
    this.initializeSandboxRules();
  }

  /** 获取审计日志 */
  getAuditLog(): ReadonlyArray<AuditLogEntry> {
    return this.auditLog;
  }

  /** 获取享元池统计 */
  getPoolStats() {
    return this.factory.getPoolStats();
  }

  /** 重置会话状态（工具计数器等） */
  resetSession(): void {
    this.toolCallCounts.clear();
    this.auditLog = [];
  }
}
```

---

## 7. Integration with ClaudeAgentRunner

```typescript
// 在 agent-runner.ts 的 runStreaming() 方法中集成

// ============================================================
// 方案：通过 canUseTool 回调注入审计引擎
// ============================================================

// AgentRunOptions 扩展（新增可选字段）
export interface AgentRunOptions {
  // ... existing fields ...

  /** 可选：安全审计配置。传入后自动启用审计引擎 */
  securityAudit?: SecurityAuditConfig;
}

// runStreaming() 内部改动示意
async runStreaming(
  opts: AgentRunOptions,
  callbacks: AgentStreamingCallbacks
): Promise<AgentRunResult> {
  // ... existing destructure ...
  const { securityAudit, ...restOpts } = opts;

  // 初始化审计引擎（可选）
  let auditEngine: SecurityAuditEngine | null = null;
  if (securityAudit?.enabled) {
    auditEngine = new SecurityAuditEngine(securityAudit, (entry) => {
      // 可通过 callbacks.onMessage 将审计事件传给前端
      if (callbacks.onToolEvent) {
        callbacks.onToolEvent({
          type: "security-audit",
          toolName: entry.toolName,
          state: entry.decision.action === "deny" ? "error" : "output-available",
          output: entry,
        });
      }
    });
  }

  // 原有的 canUseTool 回调增强
  const originalCanUseTool: CanUseTool | undefined = /* existing logic */;

  const enhancedCanUseTool: CanUseTool = async (
    toolName, toolInput, options
  ): Promise<PermissionResult> => {
    // ===== 审计引擎拦截（优先于用户确认） =====
    if (auditEngine) {
      const auditContext: AuditContext = {
        event: "PreToolUse",
        toolName,
        toolInput,
        toolCallId: options.toolUseID,
        sessionId: threadId,
        cwd: cwd ?? process.cwd(),
        timestamp: Date.now(),
      };

      const decision = auditEngine.evaluate(auditContext);

      if (decision.action === "deny") {
        return {
          behavior: "deny",
          message: decision.reason ?? "Blocked by security audit",
          toolUseID: options.toolUseID,
        };
      }

      if (decision.action === "ask") {
        // 降级为用户确认流程
        // 继续执行原有的 manual confirmation 逻辑
      }

      // allow / log → 继续
    }

    // ===== 原有 canUseTool 逻辑（manual confirmation） =====
    if (originalCanUseTool) {
      return originalCanUseTool(toolName, toolInput, options);
    }

    return { behavior: "allow", toolUseID: options.toolUseID };
  };

  // 构建 sdkOptions 时使用增强后的 canUseTool
  const sdkOptions: Partial<SDKOptions> = {
    // ... existing options ...
    canUseTool: enhancedCanUseTool,
  };

  // ... rest of runStreaming ...
}
```

### 配置入口使用方式

```typescript
// app/api/claude-agent/route.ts 中的调用示例

import { SecurityAuditConfig } from "../../lib/claude-agent-kit/server/security/types";

// 从配置文件或环境变量加载
const securityAuditConfig: SecurityAuditConfig = {
  enabled: process.env.SECURITY_AUDIT_ENABLED === "true",
  rules: [
    {
      category: "bash",
      event: "PreToolUse",
      matcher: "Bash",
      action: "deny",
      reason: "Destructive command blocked",
      params: { blockedPatterns: ["rm\\s+-rf", "sudo\\s+"] },
    },
    {
      category: "filesystem",
      event: "PreToolUse",
      matcher: "Read|Write|Edit",
      action: "deny",
      reason: "Protected file",
      params: { protectedPaths: [".env", ".env.*", "secrets/**"] },
    },
  ],
  sandbox: {
    allowedDomains: ["github.com", "*.npmjs.org"],
    protectedPaths: [".env", "secrets/**"],
    blockedBashPatterns: ["rm -rf /"],
  },
  logging: { enabled: true, level: "all", output: "console" },
};

const result = await agentRunner.runStreaming(
  {
    threadId,
    userMessage: messageText,
    securityAudit: securityAuditConfig, // ← 配置入口
    // ... other options
  },
  callbacks
);
```

---

## 8. Audit Decision Flow

```
                    ┌──────────────┐
                    │ Tool Call     │
                    │ 触发事件      │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Build        │
                    │ AuditContext  │
                    │ (外在状态)    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ AuditEngine  │
                    │ .evaluate()  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Factory  │ │ Factory  │ │ Factory  │
        │ getRule  │ │ getRule  │ │ getRule  │
        │ (享元复用)│ │ (享元复用)│ │ (享元复用)│
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ rule     │ │ rule     │ │ rule     │
        │.evaluate │ │.evaluate │ │.evaluate │
        │(context) │ │(context) │ │(context) │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             ▼            ▼            ▼
        ┌─────────────────────────────────────┐
        │ 优先级聚合: deny > ask > allow > log│
        └──────────────┬──────────────────────┘
                       │
           ┌───────────┼───────────┬───────────┐
           ▼           ▼           ▼           ▼
      ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
      │ DENY   │  │  ASK   │  │ ALLOW  │  │  LOG   │
      │        │  │        │  │        │  │        │
      │ 拒绝   │  │ 触发   │  │ 放行   │  │ 仅记录 │
      │ + 记录 │  │confirm │  │ + 记录 │  │        │
      │ + 反馈 │  │request │  │        │  │        │
      │Claude  │  │        │  │        │  │        │
      └────────┘  └────────┘  └────────┘  └────────┘
```

---

## 9. Hot-Reload & Runtime Config Update

```typescript
// app/lib/claude-agent-kit/server/security/config-watcher.ts

import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { securityAuditConfigSchema } from "./config-schema";
import type { SecurityAuditConfig } from "./types";
import type { SecurityAuditEngine } from "./audit-engine";

/**
 * 配置文件热加载器
 *
 * 两种模式：
 * 1. File Watch — 监听配置文件变更，自动刷新审计引擎
 * 2. API Push — 暴露 updateConfig() 供 API route 调用
 */
export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private engine: SecurityAuditEngine;
  private configPath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(engine: SecurityAuditEngine, configPath: string) {
    this.engine = engine;
    this.configPath = configPath;
  }

  /** 启动文件监听 */
  startWatching(): void {
    this.watcher = watch(this.configPath, { persistent: false }, (eventType) => {
      if (eventType === "change") {
        // 防抖：500ms 内多次变更只处理最后一次
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.reload(), 500);
      }
    });
  }

  /** 停止监听 */
  stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  /** 从文件重新加载配置 */
  async reload(): Promise<void> {
    try {
      const raw = await readFile(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      const validated = securityAuditConfigSchema.parse(parsed);
      this.engine.updateConfig(validated);
      console.log("[SecurityAudit] Config hot-reloaded from", this.configPath);
    } catch (error) {
      console.error("[SecurityAudit] Config reload failed:", error);
      // 保持旧配置，不中断服务
    }
  }

  /** API Push 入口 */
  pushConfig(config: SecurityAuditConfig): void {
    this.engine.updateConfig(config);
  }
}
```

---

## 10. File Structure

```
app/lib/claude-agent-kit/server/security/
├── index.ts                    # 模块公共导出
├── types.ts                    # 所有接口与类型定义
├── config-schema.ts            # Zod 校验 schema
├── audit-engine.ts             # SecurityAuditEngine 核心编排
├── audit-rule-factory.ts       # AuditRuleFactory 享元工厂
├── config-watcher.ts           # 配置热加载器
├── rules/
│   ├── index.ts                # 规则模块导出
│   ├── network-audit-rule.ts   # NetworkAuditRule
│   ├── filesystem-audit-rule.ts# FileSystemAuditRule
│   ├── bash-command-audit-rule.ts # BashCommandAuditRule
│   ├── tool-access-audit-rule.ts  # ToolAccessAuditRule
│   └── mcp-tool-audit-rule.ts  # MCPToolAuditRule
└── __tests__/
    ├── audit-rule-factory.test.ts
    ├── audit-engine.test.ts
    ├── network-audit-rule.test.ts
    ├── filesystem-audit-rule.test.ts
    ├── bash-command-audit-rule.test.ts
    └── config-watcher.test.ts
```

---

## 11. Test Strategy

| 测试类别 | 用例 | 验证点 |
|----------|------|--------|
| **享元复用** | 相同签名的规则配置 × 2 → 池中只有 1 个实例 | `factory.getPoolStats().totalRules === 1` |
| **享元隔离** | 不同签名的规则 → 各自独立实例 | 不同 ruleId，不同 evaluate 结果 |
| **Deny 判定** | Bash `rm -rf` → deny | `decision.action === "deny"` |
| **Allow 判定** | Bash `npm test` → 无规则匹配 → allow | `decision.action === "allow"` |
| **Ask 判定** | 路径穿越 `../secrets/key.pem` → ask | `decision.action === "ask"` |
| **优先级** | 同一工具有 allow + deny 规则 → deny 优先 | deny 短路返回 |
| **网络白名单** | WebFetch `https://evil.com` → deny | 域名不在允许列表 |
| **MCP 审查** | `mcp__filesystem__read_file` → deny | filesystem server 在黑名单 |
| **配置热更新** | 更新配置后新规则生效，旧规则移除 | `factory.getPoolStats()` 变化 |
| **Zod 校验** | 非法配置抛出 ZodError | `expect(() => ...).toThrow()` |
| **日志记录** | deny 事件 → 被记录到 auditLog | `engine.getAuditLog().length === 1` |
| **集成** | ClaudeAgentRunner + securityAudit config → Bash 被拦截 | mock canUseTool 验证 |

### 示例测试

```typescript
// app/lib/claude-agent-kit/server/security/__tests__/audit-engine.test.ts

import { describe, it, expect } from "vitest";
import { SecurityAuditEngine } from "../audit-engine";
import type { AuditContext, SecurityAuditConfig } from "../types";

describe("SecurityAuditEngine", () => {
  const config: SecurityAuditConfig = {
    enabled: true,
    rules: [
      {
        id: "block-rm",
        category: "bash",
        event: "PreToolUse",
        matcher: "Bash",
        action: "deny",
        reason: "Destructive command blocked",
        params: { blockedPatterns: ["rm\\s+-rf"] },
      },
    ],
    logging: { enabled: true, level: "all", output: "console" },
  };

  it("should deny rm -rf commands", () => {
    const engine = new SecurityAuditEngine(config);
    const context: AuditContext = {
      event: "PreToolUse",
      toolName: "Bash",
      toolInput: { command: "rm -rf /tmp/build" },
      sessionId: "test-session",
      cwd: "/home/user",
      timestamp: Date.now(),
    };

    const decision = engine.evaluate(context);
    expect(decision.action).toBe("deny");
    expect(decision.reason).toContain("rm\\s+-rf");
  });

  it("should allow safe commands", () => {
    const engine = new SecurityAuditEngine(config);
    const context: AuditContext = {
      event: "PreToolUse",
      toolName: "Bash",
      toolInput: { command: "npm test" },
      sessionId: "test-session",
      cwd: "/home/user",
      timestamp: Date.now(),
    };

    const decision = engine.evaluate(context);
    expect(decision.action).toBe("allow");
  });

  it("should reuse flyweight rules with same signature", () => {
    const configWithDupes: SecurityAuditConfig = {
      enabled: true,
      rules: [
        { ...config.rules[0] },
        { ...config.rules[0], id: "block-rm-copy" }, // 同签名不同 id
      ],
    };
    const engine = new SecurityAuditEngine(configWithDupes);
    const stats = engine.getPoolStats();
    expect(stats.totalRules).toBe(1); // 享元池去重
  });
});
```

---

## Summary

本设计通过享元模式将**审计规则的判定逻辑（内在状态）** 与 **每次工具调用的运行时上下文（外在状态）** 分离，实现：

1. **内存效率**：相同规则配置只实例化一次，跨会话复用
2. **配置驱动**：声明式 JSON 配置兼容 Claude Code settings.json 风格，支持 sandbox 快捷配置
3. **可插拔集成**：通过 `AgentRunOptions.securityAudit` 可选注入，不侵入现有 `ClaudeAgentRunner` 稳定接口
4. **热更新**：支持 file watch 和 API push 两种配置刷新方式
5. **全生命周期覆盖**：PreToolUse（拦截）、PostToolUse（审计日志）、SessionStart/Stop（会话级管理）
6. **优先级对齐**：deny > ask > allow > log，与 Claude Code 的 permission rules 一致
