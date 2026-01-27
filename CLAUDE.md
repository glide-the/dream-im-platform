# AI4Sales PWA 应用

> **最后更新**: 2026-01-27 17:25:20
> **项目类型**: Next.js 14 PWA 应用
> **技术栈**: React 18 + TypeScript + Tailwind CSS

---

## 📋 项目概览

AI4Sales 是一个面向 B2B 销售人员的移动优先 PWA 应用，通过 AI 助手快速收集客户信息并结构化沉淀为客户档案，提升销售信息收集与行动效率。

### 核心价值主张

- **AI 驱动的客户信息收集**: 输入"单位+姓名" → AI 联网检索 → 生成可编辑客户卡片 → 确认入库
- **轻量级 CRM**: 客户管理、待办事项、对话历史一体化
- **移动优先**: PWA 架构，支持离线访问、添加到桌面

### 目标用户

- 一线销售：高频拜访、快速查客户背景
- 大客户销售/BD：需要丰富的客户画像
- 销售主管：关注团队客户沉淀与行动执行

---

## 🏗️ 架构总览

```mermaid
graph TB
    subgraph "前端层 (Next.js App Router)"
        A[根布局 app/layout.tsx]
        B[应用布局 app/app/layout.tsx]
        C[AI 助手页面]
        D[客户列表页面]
        E[待办列表页面]
        F[我的页面]
        G[全局组件]
    end

    subgraph "API 层 (Route Handlers)"
        H[/api/agent/search-customer]
        I[/api/customers]
        J[/api/todos]
        K[/api/conversations]
    end

    subgraph "业务逻辑层"
        L[app/lib/agent.ts - AI 客户卡片生成]
        M[app/lib/db.ts - 数据库操作]
        N[app/lib/query.ts - 查询/过滤/排序]
        O[app/lib/types.ts - 类型定义]
    end

    subgraph "数据层"
        P[data/db.json - JSON 文件数据库]
    end

    B --> C
    B --> D
    B --> E
    B --> F
    B --> G

    C --> H
    D --> I
    E --> J
    C --> K

    H --> L
    I --> M
    J --> M
    K --> M

    L --> M
    M --> N
    M --> O
    M --> P

    style C fill:#e1f5ff
    style H fill:#fff4e1
    style L fill:#ffe1f5
    style P fill:#e1ffe1
```

---

## 📁 模块索引

### 1. 前端页面模块 (`app/(app)/`)
- **路径**: `app/(app)/`
- **职责**: 用户界面层，包含所有页面组件
- **详细文档**: [app/(app)/CLAUDE.md](app/(app)/CLAUDE.md)

### 2. API 路由模块 (`app/api/`)
- **路径**: `app/api/`
- **职责**: RESTful API 端点，处理客户、待办、对话、AI 检索
- **详细文档**: [app/api/CLAUDE.md](app/api/CLAUDE.md)

### 3. 业务逻辑模块 (`app/lib/`)
- **路径**: `app/lib/`
- **职责**: 核心业务逻辑、数据库操作、类型定义
- **详细文档**: [app/lib/CLAUDE.md](app/lib/CLAUDE.md)

### 4. 共享组件模块 (`app/components/`)
- **路径**: `app/components/`
- **职责**: 可复用的 UI 组件
- **详细文档**: [app/components/CLAUDE.md](app/components/CLAUDE.md)

---

## 🎯 核心功能流程

### AI 客户检索与入库流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant AI as AI 助手页面
    participant API as /api/agent/search-customer
    participant Agent as app/lib/agent.ts
    participant DB as data/db.json

    U->>AI: 输入"公司名 + 姓名"
    AI->>API: POST 请求 (query_text)
    API->>Agent: buildCustomerCard()
    Agent-->>API: 返回 CustomerCard
    API->>DB: 创建 Conversation (pending)
    API-->>AI: 返回客户卡片
    AI->>U: 展示可编辑卡片
    U->>AI: 确认/修改/取消

    alt 确认新增
        AI->>API: POST /api/customers
        API->>DB: 写入客户 + 更新 Conversation (confirmed)
        API-->>AI: 成功响应
        AI->>U: Toast "客户已新增"
    else 取消
        AI->>API: PATCH /api/conversations/{id}
        API->>DB: 更新 Conversation (canceled)
        API-->>AI: 成功响应
        AI->>U: Toast "已取消"
    end
```

---

## 🔧 技术栈详情

### 前端框架
- **Next.js 14.2.4**: App Router、Server Components、Route Handlers
- **React 18.3.1**: 函数式组件、Hooks
- **TypeScript 5.5.4**: 严格类型检查（strict: false）

### 样式方案
- **Tailwind CSS 3.4.7**: 实用优先的 CSS 框架
- **自定义设计系统**: CSS 变量 + Tailwind 扩展配置
  - 颜色系统: bg-primary/secondary/surface, accent, text-primary/secondary/tertiary
  - 阴影系统: subtle/medium/accent
  - 字体系统: display/body/mono

### 数据管理
- **JSON 文件数据库**: `data/db.json`
- **写入队列机制**: 全局队列防止并发写入冲突
- **类型安全**: 完整的 TypeScript 类型定义

### PWA 特性
- **Manifest**: `app/manifest.ts` 定义应用元数据
- **图标**: `app/icon.svg`
- **预留**: 离线缓存、推送通知（后续迭代）

---

## 📊 数据模型

### Customer (客户)
```typescript
{
  id: string;              // cus_xxx
  name?: string;           // 姓名
  company?: string;        // 公司
  title?: string;          // 职位
  phones?: string[];       // 手机号列表
  emails?: string[];       // 邮箱列表
  wechat?: string;         // 微信号
  address?: string;        // 地址
  tags?: string[];         // 标签
  profile_markdown?: string; // 非结构化补充信息
  created_at: string;      // ISO 时间戳
  updated_at: string;      // ISO 时间戳
  source: "ai_search" | "manual" | "import";
  last_verified_at?: string;
}
```

### Todo (待办)
```typescript
{
  id: string;              // todo_xxx
  title: string;           // 标题
  description?: string;    // 描述
  priority: "P0" | "P1" | "P2" | "P3";
  status: "open" | "done";
  created_at: string;
  updated_at: string;
}
```

### Conversation (对话)
```typescript
{
  id: string;              // conv_xxx
  title: string;           // 对话标题
  status: "pending" | "confirmed" | "canceled";
  messages: ConversationMessage[];
  attachments?: Attachment[];
  context_customer_ids?: string[];
  ai_outputs?: {
    customer_card?: CustomerCard;
  };
  linked_customer_id?: string;
  created_at: string;
  updated_at: string;
}
```

---

## 🚀 开发指南

### 环境要求
- Node.js 18+
- pnpm (推荐) 或 npm

### 快速开始
```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 启动生产服务器
pnpm start
```

### 项目结构
```
ai4sales-pwa-app/
├── app/
│   ├── (app)/              # 应用页面组 (共享布局)
│   │   ├── ai-assistant/   # AI 助手页面
│   │   ├── customers/      # 客户列表与详情
│   │   ├── todo/           # 待办列表
│   │   └── me/             # 个人中心
│   ├── api/                # API 路由
│   │   ├── agent/          # AI 代理相关
│   │   ├── customers/      # 客户 CRUD
│   │   ├── todos/          # 待办 CRUD
│   │   └── conversations/  # 对话管理
│   ├── components/         # 共享组件
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 业务逻辑与工具
│   ├── globals.css         # 全局样式
│   ├── layout.tsx          # 根布局
│   ├── manifest.ts         # PWA Manifest
│   └── page.tsx            # 首页 (重定向)
├── data/
│   └── db.json             # JSON 数据库
├── PRD.md                  # 产品需求文档
├── next.config.js          # Next.js 配置
├── tailwind.config.js      # Tailwind 配置
└── tsconfig.json           # TypeScript 配置
```

---

## 📝 编码规范

### 命名约定
- **组件**: PascalCase (e.g., `CustomerCard.tsx`)
- **函数/变量**: camelCase (e.g., `handleSearch`)
- **类型/接口**: PascalCase (e.g., `Customer`, `TodoPriority`)
- **常量**: UPPER_SNAKE_CASE (e.g., `DATA_FILE`)
- **文件**: kebab-case 或 PascalCase (组件)

### 代码风格
- **TypeScript**: 优先使用类型推断，复杂类型显式声明
- **React**: 函数式组件 + Hooks，避免类组件
- **异步处理**: async/await，统一错误处理
- **注释**: 关键业务逻辑添加中文注释

### 组件设计原则
- **单一职责**: 每个组件只负责一个功能
- **可复用性**: 提取通用组件到 `app/components/`
- **类型安全**: 所有 props 和状态都有明确类型
- **无障碍性**: 使用语义化 HTML，添加 ARIA 属性

---

## 🔐 安全与性能

### 安全措施
- **输入验证**: API 层验证所有用户输入
- **错误处理**: 统一错误响应格式，不暴露敏感信息
- **文件上传**: 类型和大小限制（预留）

### 性能优化
- **服务端渲染**: 利用 Next.js SSR/SSG
- **代码分割**: 自动路由级代码分割
- **图片优化**: 使用 Next.js Image 组件（预留）
- **数据库优化**: 写入队列防止并发冲突

---

## 📈 后续迭代计划

### M1 (已完成)
- ✅ PWA 框架 + 3 Tab 导航
- ✅ 客户/待办基础 CRUD
- ✅ AI 助手页面与对话历史

### M2 (进行中)
- ✅ Agentic Search 返回客户卡片
- ✅ 客户入库闭环
- ⏳ 上传上下文 (相册/拍照/文件)
- ⏳ @客户选择器

### M3 (规划中)
- 排序/过滤完善
- 客户去重/合并
- TODO 与客户关联

### M4 (未来)
- OCR 名片识别
- 企业工商/新闻动态增强
- 团队版协作与权限
- 推送提醒与离线模式

---

## 🐛 已知问题与限制

1. **AI 检索模拟**: 当前使用 `app/lib/agent.ts` 模拟 AI 检索，未接入真实 LLM API
2. **数据持久化**: 使用 JSON 文件，不适合生产环境大规模数据
3. **并发控制**: 写入队列机制简单，高并发场景需优化
4. **类型检查**: `tsconfig.json` 中 `strict: false`，建议逐步启用严格模式
5. **测试覆盖**: 缺少单元测试和集成测试

---

## 📚 相关文档

- [产品需求文档 (PRD)](./PRD.md)
- [UI/UX 设计稿](./ui-ux.pen)
- [Next.js 官方文档](https://nextjs.org/docs)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)

---

## 🤝 贡献指南

1. 遵循现有代码风格和架构模式
2. 所有新功能需更新相应的 CLAUDE.md 文档
3. 提交前运行 `pnpm lint` 检查代码质量
4. 重大变更需更新 PRD.md 和架构图

---

**生成时间**: 2026-01-27 17:25:20
**文档版本**: v1.0.0
