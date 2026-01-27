# 前端页面模块

> **导航**: [← 返回根目录](../../CLAUDE.md) / 前端页面模块
> **路径**: `app/(app)/`
> **最后更新**: 2026-01-27 17:25:20

---

## 📋 模块概览

前端页面模块包含所有用户可见的页面组件，采用 Next.js App Router 的路由组 (Route Group) 模式，共享统一的应用布局。

### 核心职责

- 渲染用户界面
- 处理用户交互
- 调用 API 获取/更新数据
- 管理页面级状态

### 技术特点

- **客户端组件**: 所有页面使用 `"use client"` 指令
- **共享布局**: 通过 `layout.tsx` 提供底部导航和悬浮按钮
- **响应式设计**: 移动优先，适配桌面端

---

## 📁 目录结构

```
app/(app)/
├── layout.tsx              # 应用布局 (底部导航 + 悬浮按钮)
├── ai-assistant/
│   └── page.tsx           # AI 助手页面
├── customers/
│   ├── page.tsx           # 客户列表页面
│   └── [id]/
│       └── page.tsx       # 客户详情页面
├── todo/
│   └── page.tsx           # 待办列表页面
└── me/
    └── page.tsx           # 个人中心页面
```

---

## 🎨 共享布局 (`layout.tsx`)

### 功能说明

提供所有子页面的统一布局框架，包含：
- 响应式容器 (最大宽度 6xl)
- 底部导航栏 (`BottomNav`)
- 右下角悬浮 AI 按钮 (`FloatingAIButton`)

### 关键代码

```typescript
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        {children}
      </div>
      <BottomNav />
      <FloatingAIButton />
    </div>
  );
}
```

### 样式特点

- `pb-20`: 底部留白，避免被底部导航遮挡
- `max-w-6xl`: 桌面端最大宽度限制
- 响应式内边距: `px-4 sm:px-6 lg:px-10`

---

## 🤖 AI 助手页面 (`ai-assistant/page.tsx`)

### 功能概览

核心页面，提供 AI 驱动的客户信息检索与入库功能。

### 主要功能

1. **快捷输入**: 预设常用查询提示
2. **对话历史**: 展示最近 5 条对话记录
3. **客户资料卡片**:
   - 结构化字段编辑 (姓名、公司、职位等)
   - 非结构化信息 (Markdown)
   - 可信度与来源展示
4. **上下文选择**:
   - 文件上传 (预留)
   - 相册/拍照 (预留)
   - @客户选择器
5. **操作流程**: 检索 → 确认/修改/取消

### 状态管理

```typescript
const [query, setQuery] = useState("");                    // 输入框内容
const [loading, setLoading] = useState(false);             // 加载状态
const [card, setCard] = useState<CustomerCard | null>(null); // 客户卡片
const [editCard, setEditCard] = useState<CustomerCard>(emptyCard); // 编辑中的卡片
const [conversationId, setConversationId] = useState<string | null>(null); // 对话 ID
const [history, setHistory] = useState<Conversation[]>([]); // 对话历史
const [editMode, setEditMode] = useState(false);           // 编辑模式
const [contextCustomers, setContextCustomers] = useState<CustomerOption[]>([]); // 上下文客户
```

### 核心流程

#### 1. 检索客户 (`handleSearch`)

```typescript
async function handleSearch() {
  const response = await apiRequest<SearchResponse>(
    "/api/agent/search-customer",
    {
      method: "POST",
      body: JSON.stringify({
        query_text: query,
        attachments,
        context_customer_ids: contextCustomers.map((item) => item.id)
      })
    }
  );
  setCard(response.customer_card);
  setConversationId(response.conversation_id);
}
```

#### 2. 确认入库 (`handleConfirm`)

```typescript
async function handleConfirm() {
  await apiRequest("/api/customers", {
    method: "POST",
    body: JSON.stringify({
      ...editCard.structured_fields,
      profile_markdown: editCard.profile_markdown,
      source: "ai_search",
      conversation_id: conversationId
    })
  });
  setToast("客户已新增");
}
```

#### 3. 取消入库 (`handleCancel`)

```typescript
async function handleCancel() {
  await apiRequest(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "canceled" })
  });
  setToast("已取消，未新增客户");
}
```

### UI 组件结构

```
AI 助手页面
├── 标题区 (AI 助手 + Beta 标签)
├── 欢迎语区 (标题 + 描述)
├── 快捷输入区 (3 个预设按钮)
├── 对话历史区 (最近 5 条)
├── 客户资料卡片区
│   ├── 状态标签 (检索中/待确认/编辑中)
│   ├── 结构化字段 (8 个字段)
│   ├── 非结构化信息 (Markdown)
│   ├── 来源与可信度
│   └── 操作按钮 (确认/修改/取消)
└── 输入区
    ├── 上下文选择 (文件/相册/拍照/@客户)
    ├── 附件列表
    ├── 文本输入框
    └── 发送按钮
```

### 关键特性

- **防抖搜索**: 客户选择器使用 `useDebounce` (300ms)
- **URL 参数**: 支持 `?contextCustomerId=xxx` 预填充上下文客户
- **编辑模式**: 切换只读/编辑状态，保留原始卡片数据
- **Toast 提示**: 操作成功/失败的用户反馈

---

## 👥 客户列表页面 (`customers/page.tsx`)

### 功能概览

展示所有客户的卡片列表，支持搜索、排序、过滤、分页。

### 主要功能

1. **卡片列表**: 展示客户基本信息
2. **搜索**: 按姓名/公司/联系方式/备注关键字
3. **排序**: 最近更新、最近创建、姓名 A-Z
4. **过滤**: 标签、是否有联系方式
5. **分页**: 滚动加载或分页按钮

### API 调用

```typescript
GET /api/customers?page=1&pageSize=6&search=xxx&sort=updated_at&order=desc&tag=xxx&hasContact=1
```

### 响应数据

```typescript
{
  data: Customer[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    tagOptions: string[];
    totalCustomers: number;
  };
}
```

---

## 📋 待办列表页面 (`todo/page.tsx`)

### 功能概览

管理待办事项，支持 CRUD、优先级、状态管理。

### 主要功能

1. **TODO 列表**: 展示所有待办
2. **CRUD 操作**: 增删改查
3. **优先级**: P0-P3 四档
4. **状态**: 未完成/已完成
5. **搜索**: 标题/描述关键字
6. **排序**: 优先级、创建时间、更新时间
7. **过滤**: 优先级、状态

### API 调用

```typescript
GET /api/todos?page=1&pageSize=10&search=xxx&sort=priority&order=asc&priority=P0&status=open
POST /api/todos
PATCH /api/todos/{id}
DELETE /api/todos/{id}
```

---

## 👤 个人中心页面 (`me/page.tsx`)

### 功能概览

用户个人信息与设置。

### 主要功能 (MVP)

1. **账号信息**: 姓名/公司/角色
2. **设置**: 语言、数据导出、隐私与协议
3. **反馈入口**: 用户反馈表单

---

## 👥 客户详情页面 (`customers/[id]/page.tsx`)

### 功能概览

展示单个客户的完整信息，支持编辑。

### 主要功能

1. **结构化字段展示**: 所有客户字段
2. **非结构化信息**: Markdown 渲染
3. **编辑功能**: 修改客户信息
4. **关联待办**: 查看与该客户相关的待办 (后续迭代)

### API 调用

```typescript
GET /api/customers/{id}
PATCH /api/customers/{id}
```

---

## 🎨 样式设计系统

### 颜色变量

```css
--color-bg-primary: 背景主色
--color-bg-secondary: 背景次色
--color-surface: 表面色
--color-accent: 强调色
--color-accent-light: 强调色浅色
--color-text-primary: 文本主色
--color-text-secondary: 文本次色
--color-text-tertiary: 文本三级色
--color-border: 边框色
```

### 阴影系统

- `shadow-subtle`: 轻微阴影 (0 4px 20px #0F172A0A)
- `shadow-medium`: 中等阴影 (0 10px 30px #0F172A0A)
- `shadow-accent`: 强调阴影 (0 8px 20px #2F6FED40)

### 圆角规范

- 小组件: `rounded-xl` (12px)
- 卡片: `rounded-2xl` (16px)
- 页面容器: `rounded-[32px]` / `rounded-[40px]`
- 按钮: `rounded-full`

---

## 🔧 开发建议

### 新增页面

1. 在 `app/(app)/` 下创建新目录
2. 添加 `page.tsx` 文件
3. 使用 `"use client"` 指令
4. 自动继承 `layout.tsx` 的布局

### 状态管理

- 页面级状态: `useState`
- 跨组件状态: Context API (按需)
- 服务端状态: API 调用 + 本地缓存

### 错误处理

```typescript
try {
  const response = await apiRequest(...);
  // 处理成功
} catch (err) {
  setError(err instanceof Error ? err.message : "操作失败");
}
```

### 加载状态

```typescript
setLoading(true);
try {
  // API 调用
} finally {
  setLoading(false);
}
```

---

## 📊 性能优化

1. **防抖输入**: 搜索框使用 `useDebounce`
2. **条件渲染**: 避免不必要的组件渲染
3. **懒加载**: 图片和大组件按需加载
4. **Memo 优化**: 复杂计算使用 `useMemo`

---

## 🐛 已知问题

1. **语音输入**: 仅预留 UI，未实现功能
2. **文件上传**: 仅预留 UI，未实现上传逻辑
3. **客户详情**: 功能简单，需增强编辑体验
4. **待办关联**: 未实现与客户的关联功能

---

**生成时间**: 2026-01-27 17:25:20
