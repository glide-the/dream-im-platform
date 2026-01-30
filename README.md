# AI4Sales PWA 应用

<div align="center">

**面向 B2B 销售人员的智能客户管理助手**

[![Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0.0-blue?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5.4-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1.18-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/license-Private-red.svg)](LICENSE)

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [技术栈](#-技术栈) • [项目结构](#-项目结构) • [开发指南](#-开发指南)

</div>

---

## 📖 项目简介

AI4Sales 是一个移动优先的 PWA（Progressive Web App）应用，专为 B2B 销售人员设计。通过 AI 助手快速收集客户信息并结构化沉淀为客户档案,提升销售信息收集与行动效率。

### 核心价值

- 🤖 **AI 驱动的客户信息收集**: 输入"单位+姓名" → AI 联网检索 → 生成可编辑客户卡片 → 确认入库
- 📱 **移动优先体验**: PWA 架构,支持添加到桌面、离线访问
- 💼 **轻量级 CRM**: 客户管理、待办事项、对话历史一体化
- ⚡ **高效工作流**: 30 秒内完成客户信息从检索到入库的全流程

### 目标用户

- **一线销售**: 高频拜访,需要快速查客户背景
- **大客户销售/BD**: 需要丰富的客户画像
- **销售主管**: 关注团队客户沉淀与行动执行

---

## ✨ 功能特性

### 🎯 AI 助手

- **智能客户检索**: 基于 Claude Agent SDK + Exa MCP Server 的 Agentic Search
- **结构化卡片生成**: 自动抽取姓名、公司、职位、联系方式等字段
- **二次确认机制**: 可编辑卡片内容后再入库,降低误入库风险
- **对话历史**: 可追溯的对话记录,支持上下文复用

### 👥 客户管理

- **客户列表**: 卡片式展示,支持分页加载
- **搜索与过滤**: 按姓名、公司、联系方式、标签等多维度搜索
- **排序功能**: 最近更新、最近创建、姓名 A-Z 等多种排序方式
- **客户详情**: 结构化字段 + Markdown 非结构化信息

### ✅ 待办管理

- **CRUD 操作**: 完整的待办事项增删改查
- **优先级管理**: P0-P3 四级优先级
- **状态跟踪**: 未完成/已完成状态管理
- **搜索排序**: 按标题、描述、优先级、时间等维度

### 🔮 即将推出

- 📸 上传上下文 (相册/拍照/文件)
- 🏷️ @客户选择器
- 🔗 客户与待办关联
- 🎴 OCR 名片识别
- 👥 团队版协作与权限

---

## 🚀 快速开始

### 环境要求

- **Node.js**: 18.0 或更高版本
- **包管理器**: pnpm (推荐) 或 npm
- **Docker**: 用于本地 PostgreSQL 数据库

### 安装

```bash
# 克隆仓库
git clone <repository-url>
cd ai4sales-pwa-app

# 安装依赖
pnpm install
# 或
npm install

# 启动 PostgreSQL (使用 Docker Compose)
docker-compose up -d

# 配置环境变量
cp .env.local.example .env.local
# 编辑 .env.local，设置以下变量：
# DATABASE_URL=postgres://ai4sales:ai4sales@localhost:5433/ai4sales
# 或设置 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
```

### 开发

```bash
# 启动开发服务器
pnpm dev
# 或
npm run dev

# 应用将在 http://localhost:3000 启动
```

### 构建

```bash
# 构建生产版本
pnpm build
# 或
npm run build

# 启动生产服务器
pnpm start
# 或
npm start
```

### 测试

```bash
# 运行测试
pnpm test
# 或
npm test

# 运行测试并生成覆盖率报告
pnpm test:coverage

# 运行测试 UI
pnpm test:ui
```

### 数据库管理

```bash
# 生成数据库迁移文件
pnpm db:generate

# 推送 schema 到数据库
pnpm db:migrate
```

---

## 🛠️ 技术栈

### 前端框架

- **[Next.js 16.1.6](https://nextjs.org/)**: App Router、Server Components、Route Handlers
- **[React 19.0.0](https://reactjs.org/)**: 函数式组件、Hooks
- **[TypeScript 5.5.4](https://www.typescriptlang.org/)**: 类型安全

### 样式方案

- **[Tailwind CSS 4.1.18](https://tailwindcss.com/)**: 实用优先的 CSS 框架
- **自定义设计系统**: CSS 变量 + Tailwind 扩展配置
  - 颜色系统: primary/secondary/surface, accent, text-primary/secondary/tertiary
  - 阴影系统: subtle/medium/accent
  - 字体系统: display/body/mono

### AI 搜索引擎

- **[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)**: Anthropic 官方 SDK
- **Exa MCP Server**: 高质量 AI 搜索引擎,通过 MCP 协议集成
  - web_search_exa: 高质量网页搜索
  - company_research_exa: 公司信息研究
  - people_search_exa: 人物信息搜索

### 数据管理

- **[PostgreSQL 16](https://www.postgresql.org/)**: 生产级关系型数据库
- **[Drizzle ORM 0.38.0](https://orm.drizzle.team/)**: 类型安全的 ORM 框架
- **[pg 8.13.3](https://node-postgres.com/)**: PostgreSQL 客户端
- **连接池管理**: 使用 pg Pool 管理数据库连接
- **写入队列机制**: 全局队列防止并发写入冲突
- **类型安全**: 完整的 TypeScript 类型定义

### 数据库特性

- **自动建表**: 首次启动自动创建表结构
- **索引优化**: 为常用查询字段添加索引
  - customers: name, company, updated_at, tags (GIN)
  - todos: status, priority, updated_at
  - conversations: status, updated_at, linked_customer_id
- **种子数据**: 首次启动自动写入示例数据
- **事务支持**: 使用 PostgreSQL 事务保证数据一致性

### 开发工具

- **[Docker Compose](https://docs.docker.com/compose/)**: 本地开发环境配置
- **[Drizzle Kit 0.29.0](https://orm.drizzle.team/kit-docs/overview)**: 数据库迁移管理工具
- **[Vitest 4.0.18](https://vitest.dev/)**: 快速的单元测试框架
- **[@vitest/ui](https://vitest.dev/guide/ui.html)**: 测试 UI 界面

### PWA 特性

- **Manifest**: 应用元数据配置
- **图标**: SVG 格式应用图标
- **预留**: 离线缓存、推送通知 (后续迭代)

---

## 📁 项目结构

```
ai4sales-pwa-app/
├── app/                        # Next.js App Router
│   ├── (app)/                  # 应用页面组 (共享布局)
│   │   ├── ai-assistant/       # AI 助手页面
│   │   ├── customers/          # 客户列表与详情
│   │   ├── todo/               # 待办列表
│   │   └── me/                 # 个人中心
│   ├── api/                    # API 路由
│   │   ├── agent/              # AI 代理相关
│   │   ├── customers/          # 客户 CRUD
│   │   ├── todos/              # 待办 CRUD
│   │   └── conversations/      # 对话管理
│   ├── components/             # 共享组件
│   ├── hooks/                  # 自定义 Hooks
│   ├── lib/                    # 业务逻辑与工具
│   │   ├── db/                 # 数据库 Schema
│   │   │   └── schema.ts       # Drizzle ORM 表定义
│   │   ├── agent.ts            # AI 客户卡片生成
│   │   ├── db.ts               # 数据库操作
│   │   ├── query.ts            # 查询/过滤/排序
│   │   └── types.ts            # 类型定义
│   ├── globals.css             # 全局样式
│   ├── layout.tsx              # 根布局
│   ├── manifest.ts             # PWA Manifest
│   └── page.tsx                # 首页 (重定向)
├── docs/                       # 文档目录
├── public/                     # 静态资源
├── docker-compose.yml          # Docker Compose 配置
├── drizzle.config.ts           # Drizzle Kit 配置
├── CLAUDE.md                   # 项目架构文档
├── PRD.md                      # 产品需求文档
├── next.config.js              # Next.js 配置
├── tailwind.config.js          # Tailwind 配置
├── tsconfig.json               # TypeScript 配置
└── package.json                # 项目依赖
```

---

## 💻 开发指南

### 命名约定

- **组件**: PascalCase (e.g., `CustomerCard.tsx`)
- **函数/变量**: camelCase (e.g., `handleSearch`)
- **类型/接口**: PascalCase (e.g., `Customer`, `TodoPriority`)
- **常量**: UPPER_SNAKE_CASE (e.g., `DATA_FILE`)
- **文件**: kebab-case 或 PascalCase (组件)

### 代码风格

- **TypeScript**: 优先使用类型推断,复杂类型显式声明
- **React**: 函数式组件 + Hooks,避免类组件
- **异步处理**: async/await,统一错误处理
- **注释**: 关键业务逻辑添加中文注释

### 组件设计原则

- **单一职责**: 每个组件只负责一个功能
- **可复用性**: 提取通用组件到 `app/components/`
- **类型安全**: 所有 props 和状态都有明确类型
- **无障碍性**: 使用语义化 HTML,添加 ARIA 属性

### Git 工作流

```bash
# 创建功能分支
git checkout -b feature/your-feature-name

# 提交代码
git add .
git commit -m "feat: your feature description"

# 推送到远程
git push origin feature/your-feature-name
```

### 代码检查

```bash
# 运行 ESLint
pnpm lint
# 或
npm run lint
```

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

## 🔐 安全与性能

### 安全措施

- ✅ **输入验证**: API 层验证所有用户输入
- ✅ **错误处理**: 统一错误响应格式,不暴露敏感信息
- ✅ **连接池管理**: 使用 pg Pool 管理数据库连接,防止连接泄漏
- ✅ **SQL 注入防护**: 使用 Drizzle ORM 参数化查询
- 🔜 **文件上传**: 类型和大小限制 (预留)

### 性能优化

- ✅ **服务端渲染**: 利用 Next.js SSR/SSG
- ✅ **代码分割**: 自动路由级代码分割
- ✅ **数据库索引**: 为常用查询字段添加索引
- ✅ **连接池复用**: 全局单例 Pool,避免重复创建连接
- ✅ **写入队列**: 防止并发写入冲突
- 🔜 **图片优化**: 使用 Next.js Image 组件 (预留)

---

## 🗺️ 开发路线图

### ✅ M1 (已完成)

- PWA 框架 + 3 Tab 导航
- 客户/待办基础 CRUD
- AI 助手页面与对话历史
- PostgreSQL 数据库迁移
- Drizzle ORM 集成

### 🚧 M2 (进行中)

- Agentic Search 返回客户卡片
- 客户入库闭环
- 上传上下文 (相册/拍照/文件)
- @客户选择器

### 📋 M3 (规划中)

- 排序/过滤完善
- 客户去重/合并
- TODO 与客户关联

### 🔮 M4 (未来)

- OCR 名片识别
- 企业工商/新闻动态增强
- 团队版协作与权限
- 推送提醒与离线模式

---

## 📚 相关文档

- [项目架构文档 (CLAUDE.md)](./CLAUDE.md) - 详细的技术架构和模块说明
- [产品需求文档 (PRD.md)](./PRD.md) - 完整的产品需求和业务逻辑
- [Next.js 官方文档](https://nextjs.org/docs)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [Drizzle ORM 文档](https://orm.drizzle.team/)
- [PostgreSQL 文档](https://www.postgresql.org/docs/)

---

## 🐛 已知问题

1. **AI 检索模拟**: 当前使用 `app/lib/agent.ts` 模拟 AI 检索,未接入真实 LLM API
2. **并发控制**: 写入队列机制简单,高并发场景需优化
3. **类型检查**: `tsconfig.json` 中 `strict: false`,建议逐步启用严格模式
4. **测试覆盖**: 缺少单元测试和集成测试

---

## 🤝 贡献指南

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 贡献要求

- 遵循现有代码风格和架构模式
- 所有新功能需更新相应的 CLAUDE.md 文档
- 提交前运行 `pnpm lint` 检查代码质量
- 重大变更需更新 PRD.md 和架构图
- 数据库 schema 变更需生成迁移文件

---

## 📄 许可证

本项目为私有项目,未经授权不得使用、复制或分发。

---

## 📧 联系方式

如有问题或建议,请通过以下方式联系:

- 提交 Issue
- 发送邮件至项目维护者

---

<div align="center">

**用 AI 赋能销售,让客户管理更高效** 🚀

Made with ❤️ by AI4Sales Team

</div>
