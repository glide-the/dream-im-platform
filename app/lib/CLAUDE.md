# 业务逻辑模块

> **导航**: [← 返回根目录](../../CLAUDE.md) / 业务逻辑模块
> **路径**: `app/lib/`
> **最后更新**: 2026-01-27 17:25:20

---

## 📋 模块概览

业务逻辑模块包含核心业务逻辑、数据库操作、类型定义和工具函数，是应用的核心层。

### 核心职责

- 数据库读写操作
- 业务逻辑封装
- 类型定义与约束
- 工具函数提供

### 技术特点

- **类型安全**: 完整的 TypeScript 类型系统
- **纯函数**: 大部分函数无副作用
- **可测试**: 逻辑与 UI 分离

---

## 📁 文件列表

```
app/lib/
├── types.ts        # 类型定义
├── db.ts           # 数据库操作
├── agent.ts        # AI 客户卡片生成
├── query.ts        # 查询/过滤/排序/分页
├── id.ts           # ID 生成与哈希
├── format.ts       # 格式化工具
├── client.ts       # API 客户端
└── seed.ts         # 种子数据
```

---

## 📝 类型定义 (`types.ts`)

### 核心类型

#### Customer (客户)

```typescript
export type CustomerSource = "ai_search" | "manual" | "import";

export type Customer = {
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
  source: CustomerSource;  // 来源
  last_verified_at?: string; // 最后验证时间
};
```

#### Todo (待办)

```typescript
export type TodoPriority = "P0" | "P1" | "P2" | "P3";
export type TodoStatus = "open" | "done";

export type Todo = {
  id: string;              // todo_xxx
  title: string;           // 标题
  description?: string;    // 描述
  priority: TodoPriority;  // 优先级
  status: TodoStatus;      // 状态
  created_at: string;      // ISO 时间戳
  updated_at: string;      // ISO 时间戳
};
```

#### Conversation (对话)

```typescript
export type Conversation = {
  id: string;              // conv_xxx
  title: string;           // 对话标题
  status: "pending" | "confirmed" | "canceled";
  created_at: string;
  updated_at: string;
  messages: ConversationMessage[];
  attachments?: Attachment[];
  context_customer_ids?: string[];
  ai_outputs?: {
    customer_card?: CustomerCard;
  };
  linked_customer_id?: string;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};
```

#### CustomerCard (客户卡片)

```typescript
export type CustomerCard = {
  structured_fields: {
    name?: string;
    company?: string;
    title?: string;
    phones?: string[];
    emails?: string[];
    wechat?: string;
    address?: string;
    tags?: string[];
  };
  profile_markdown: string;
  confidence?: number;      // 可信度 0-1
  sources?: { label: string; url?: string }[];
};
```

#### DbShape (数据库结构)

```typescript
export type DbShape = {
  customers: Customer[];
  todos: Todo[];
  conversations: Conversation[];
};
```

---

## 💾 数据库操作 (`db.ts`)

### 文件存储

- **路径**: `data/db.json`
- **格式**: JSON
- **编码**: UTF-8
- **缩进**: 2 空格

### 核心函数

#### 1. 读取数据库

```typescript
export async function readDb(): Promise<DbShape> {
  await ensureDbFile();
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  return JSON.parse(raw) as DbShape;
}
```

**功能**: 读取并解析 JSON 数据库文件

**特性**:
- 自动创建文件 (如果不存在)
- 自动初始化种子数据

#### 2. 写入数据库 (内部函数)

```typescript
async function writeDb(db: DbShape) {
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf-8");
}
```

**功能**: 将数据写入 JSON 文件

**特性**:
- 格式化输出 (2 空格缩进)
- 异步写入

#### 3. 事务式写入

```typescript
export async function withDb<T>(
  mutator: (db: DbShape) => Promise<{ db: DbShape; result: T }> | {
    db: DbShape;
    result: T;
  }
): Promise<T>
```

**功能**: 提供事务式数据库操作

**特性**:
- **全局队列**: 防止并发写入冲突
- **原子操作**: 读取 → 修改 → 写入一气呵成
- **类型安全**: 泛型返回值

**使用示例**:

```typescript
const newCustomer = await withDb((db) => {
  const customer: Customer = {
    id: createId("cus"),
    name: "张三",
    // ...
  };

  return {
    db: {
      ...db,
      customers: [customer, ...db.customers]
    },
    result: customer
  };
});
```

### 并发控制机制

```typescript
type GlobalQueue = typeof globalThis & { __ai4sales_write_queue__?: DbQueue };

const globalQueue = globalThis as GlobalQueue;
if (!globalQueue.__ai4sales_write_queue__) {
  globalQueue.__ai4sales_write_queue__ = Promise.resolve();
}

globalQueue.__ai4sales_write_queue__ = globalQueue.__ai4sales_write_queue__
  .then(async () => {
    // 执行数据库操作
  })
  .catch((error) => {
    console.error("DB write failed", error);
    throw error;
  });
```

**原理**: 使用全局 Promise 链串行化所有写操作

---

## 🤖 AI 客户卡片生成 (`agent.ts`)

### 核心函数

#### buildCustomerCard

```typescript
export function buildCustomerCard(queryText: string): {
  card: CustomerCard;
  debug: { name?: string; company?: string };
}
```

**功能**: 根据查询文本生成模拟客户卡片

**算法**:
1. 解析查询文本 (最后一个词为姓名,前面为公司)
2. 使用稳定哈希生成确定性随机数据
3. 生成结构化字段 (职位、标签、手机号)
4. 生成非结构化信息 (Markdown)
5. 计算可信度 (基于输入长度)

**示例**:

```typescript
const { card, debug } = buildCustomerCard("阿里巴巴 张三");

// card.structured_fields.name === "张三"
// card.structured_fields.company === "阿里巴巴"
// card.structured_fields.title === "采购负责人" (随机)
// card.confidence === 0.72
```

### 数据源

```typescript
const titles = [
  "采购负责人",
  "业务拓展经理",
  "销售总监",
  "BD 经理",
  "渠道负责人",
  "项目经理"
];

const tags = ["高潜", "重点跟进", "新线索", "需验证", "已联系"];

const insights = [
  "近期完成新一轮融资，扩建销售团队。",
  "公开活动中提到关注数字化销售流程。",
  // ...
];
```

### 稳定哈希

使用 `stableHash()` 确保相同输入生成相同输出，便于演示和测试。

---

## 🔍 查询工具 (`query.ts`)

### 核心函数

#### 1. 搜索

```typescript
export function searchCustomers(
  customers: Customer[],
  search: string
): Customer[]
```

**功能**: 按关键字搜索客户

**搜索字段**:
- 姓名 (`name`)
- 公司 (`company`)
- 职位 (`title`)
- 手机号 (`phones`)
- 邮箱 (`emails`)
- 微信 (`wechat`)
- 地址 (`address`)
- 标签 (`tags`)
- 补充信息 (`profile_markdown`)

**特性**:
- 不区分大小写
- 支持部分匹配

#### 2. 过滤

```typescript
export function filterCustomers(
  customers: Customer[],
  filters: {
    tag?: string;
    hasContact?: boolean;
  }
): Customer[]
```

**功能**: 按条件过滤客户

**过滤条件**:
- `tag`: 包含指定标签
- `hasContact`: 有联系方式 (手机/邮箱/微信)

#### 3. 排序

```typescript
export function sortCustomers(
  customers: Customer[],
  sort: string,
  order: "asc" | "desc"
): Customer[]
```

**功能**: 按字段排序

**支持字段**:
- `updated_at`: 更新时间
- `created_at`: 创建时间
- `name`: 姓名 (字母序)

#### 4. 分页

```typescript
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number
): {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

**功能**: 分页处理

**返回**:
- `data`: 当前页数据
- `meta`: 分页元信息

### 工具函数

#### toNumber

```typescript
export function toNumber(
  value: string | null,
  defaultValue: number
): number
```

**功能**: 安全地将字符串转换为数字

---

## 🆔 ID 生成 (`id.ts`)

### 核心函数

#### createId

```typescript
export function createId(prefix: string): string
```

**功能**: 生成唯一 ID

**格式**: `{prefix}_{timestamp}_{random}`

**示例**:
- `cus_1706345120000_abc123`
- `todo_1706345120001_def456`
- `conv_1706345120002_ghi789`

#### stableHash

```typescript
export function stableHash(input: string): number
```

**功能**: 生成稳定的哈希值

**用途**: 确保相同输入生成相同随机数据 (用于演示)

---

## 📅 格式化工具 (`format.ts`)

### 核心函数

#### formatRelativeTime

```typescript
export function formatRelativeTime(isoString: string): string
```

**功能**: 将 ISO 时间戳转换为相对时间

**输出示例**:
- "刚刚" (< 1 分钟)
- "5 分钟前"
- "2 小时前"
- "3 天前"
- "2024-01-27" (> 7 天)

---

## 🌐 API 客户端 (`client.ts`)

### 核心函数

#### apiRequest

```typescript
export async function apiRequest<T>(
  url: string,
  options?: RequestInit
): Promise<T>
```

**功能**: 封装 fetch API

**特性**:
- 自动添加 `Content-Type: application/json`
- 自动解析 JSON 响应
- 统一错误处理
- 类型安全

**使用示例**:

```typescript
const response = await apiRequest<{ data: Customer[] }>(
  "/api/customers?page=1"
);

const customer = await apiRequest<{ data: Customer }>(
  "/api/customers",
  {
    method: "POST",
    body: JSON.stringify({ name: "张三" })
  }
);
```

---

## 🌱 种子数据 (`seed.ts`)

### 核心函数

#### seedData

```typescript
export function seedData(): DbShape
```

**功能**: 生成初始种子数据

**内容**:
- 3-5 个示例客户
- 3-5 个示例待办
- 1-2 个示例对话

**用途**: 首次启动时初始化数据库

---

## 🔧 开发建议

### 新增类型

1. 在 `types.ts` 中定义
2. 导出类型
3. 在其他模块中导入使用

### 新增业务逻辑

1. 在 `lib/` 下创建新文件
2. 导出纯函数
3. 添加 TypeScript 类型注解
4. 在 API 或组件中调用

### 数据库操作模式

```typescript
// 读取
const db = await readDb();
const customers = db.customers;

// 写入
const result = await withDb((db) => {
  // 修改数据
  const newData = [...db.customers, newCustomer];

  return {
    db: { ...db, customers: newData },
    result: newCustomer
  };
});
```

---

## 🐛 已知问题

1. **JSON 数据库**: 不适合生产环境，需迁移到真实数据库
2. **并发控制**: 简单队列机制，高并发场景需优化
3. **AI 模拟**: `buildCustomerCard` 仅为演示，需接入真实 LLM API
4. **错误处理**: 缺少详细的错误分类和恢复机制

---

## 📊 性能考虑

1. **内存占用**: 所有数据加载到内存，大数据量需优化
2. **文件 I/O**: 每次写入都重写整个文件，需增量写入
3. **查询效率**: 线性搜索，需添加索引机制

---

**生成时间**: 2026-01-27 17:25:20
