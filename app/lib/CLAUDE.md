# 业务逻辑模块

> **导航**: [← 返回根目录](../../CLAUDE.md) / 业务逻辑模块
> **路径**: `app/lib/`
> **最后更新**: 2026-02-03

---

## 📋 变更记录 (Changelog)

### 2026-02-03
- **新增 file-storage 模块**: 从 better-chatbot 迁移的文件存储模块
  - 支持 S3 和 Vercel Blob 两种存储驱动
  - 提供统一的文件上传、下载、删除接口
  - 支持 presigned URL 客户端直传
- **新增工具模块**: 
  - `utils.ts` - 通用工具函数 (UUID、超时、类型检查等)
  - `errors.ts` - 自定义错误类 (文件存储错误等)
  - `const.ts` - 环境常量
  - `logger.ts` - 日志工具
- **新增依赖**:
  - `@aws-sdk/client-s3` - AWS S3 客户端
  - `@aws-sdk/s3-request-presigner` - S3 预签名 URL
  - `@vercel/blob` - Vercel Blob 存储
  - `server-only` - 服务端专用标记
- **TypeScript 配置**: 添加 `@/*` 路径别名到 tsconfig.json

### 2026-01-29
- **新增 queries 模块**: `queries.ts` 封装 React Query Hooks
- **类型安全增强**: 完整的 TypeScript 类型定义和泛型支持
- **状态管理优化**: 使用 React Query 替代手动 API 调用
- **缓存策略**: 5 分钟 staleTime，30 分钟 gcTime
- **自动重新验证**: 数据变更后自动刷新相关查询

### 2026-01-29 (早期)
- **数据库操作重构**: 从 JSON 文件迁移到 PostgreSQL + Drizzle ORM
- **新增 schema 模块**: `app/lib/db/schema.ts` 定义数据库表结构
- **连接池管理**: 使用 pg Pool 管理数据库连接
- **事务支持**: 新增事务式操作函数
- **索引优化**: 为常用查询字段添加数据库索引

---

## 📋 模块概览

业务逻辑模块包含核心业务逻辑、数据库操作、类型定义和 React Query Hooks，是应用的核心层。

### 核心职责

- 数据库读写操作
- 业务逻辑封装
- 类型定义与约束
- 服务器状态管理
- 工具函数提供

### 技术特点

- **类型安全**: 完整的 TypeScript 类型系统
- **纯函数**: 大部分函数无副作用
- **可测试**: 逻辑与 UI 分离
- **缓存优化**: React Query 自动缓存与重新验证

---

## 📁 文件列表

```
app/lib/
├── db/
│   └── schema.ts       # Drizzle ORM 数据库表定义
├── file-storage/       # 文件存储模块 (新增)
│   ├── index.ts        # 入口文件，导出 serverFileStorage
│   ├── file-storage.interface.ts  # 存储接口定义
│   ├── s3-file-storage.ts         # S3 存储实现
│   ├── vercel-blob-storage.ts     # Vercel Blob 存储实现
│   └── storage-utils.ts           # 存储工具函数
├── types.ts            # 类型定义
├── db.ts               # 数据库操作
├── agent.ts            # AI 客户卡片生成
├── query.ts            # 查询/过滤/排序/分页 (已弃用，功能迁移到 db.ts)
├── queries.ts          # React Query Hooks
├── id.ts               # ID 生成与哈希
├── format.ts           # 格式化工具
├── client.ts           # API 客户端
├── utils.ts            # 通用工具函数 (新增)
├── errors.ts           # 自定义错误类 (新增)
├── const.ts            # 环境常量 (新增)
├── logger.ts           # 日志工具 (新增)
└── seed.ts             # 种子数据
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

## 🗄️ 数据库 Schema (`db/schema.ts`)

### 表定义

使用 Drizzle ORM 定义 PostgreSQL 表结构。

#### customers 表

```typescript
export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  name: text("name"),
  company: text("company"),
  title: text("title"),
  phones: text("phones").array(),
  emails: text("emails").array(),
  wechat: text("wechat"),
  address: text("address"),
  tags: text("tags").array(),
  profile_markdown: text("profile_markdown"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  source: text("source"),
  last_verified_at: timestamp("last_verified_at", { withTimezone: true, mode: "date" })
});
```

#### todos 表

```typescript
export const todos = pgTable("todos", {
  id: text("id").primaryKey(),
  title: text("title"),
  description: text("description"),
  priority: text("priority"),
  status: text("status"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
});
```

#### conversations 表

```typescript
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title"),
  status: text("status"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  messages: jsonb("messages").$type<Conversation["messages"]>(),
  attachments: jsonb("attachments").$type<Conversation["attachments"]>(),
  context_customer_ids: text("context_customer_ids").array(),
  ai_outputs: jsonb("ai_outputs").$type<Conversation["ai_outputs"]>(),
  linked_customer_id: text("linked_customer_id")
});
```

---

## 📁 文件存储模块 (`file-storage/`)

从 better-chatbot 项目迁移的文件存储模块，提供统一的文件存储接口，支持 S3 和 Vercel Blob 两种存储驱动。

### 环境变量配置

```bash
# 选择存储驱动 (vercel-blob 或 s3)，默认为 vercel-blob
FILE_STORAGE_TYPE=s3

# 存储路径前缀，默认为 uploads
FILE_STORAGE_PREFIX=uploads

# S3 配置 (当 FILE_STORAGE_TYPE=s3 时)
FILE_STORAGE_S3_BUCKET=my-bucket
FILE_STORAGE_S3_REGION=us-east-2
FILE_STORAGE_S3_ENDPOINT=http://localhost:9000  # 可选，用于 MinIO 等
FILE_STORAGE_S3_FORCE_PATH_STYLE=true           # 可选，MinIO 需要
FILE_STORAGE_S3_PUBLIC_BASE_URL=https://cdn.example.com  # 可选，CDN URL

# Vercel Blob 配置 (当 FILE_STORAGE_TYPE=vercel-blob 时)
BLOB_READ_WRITE_TOKEN=xxx  # Vercel Blob 访问令牌
```

### 核心接口

#### FileStorage

```typescript
interface FileStorage {
  /** 从服务端上传文件 */
  upload(content: UploadContent, options?: UploadOptions): Promise<UploadResult>;

  /** 创建客户端上传 URL (presigned URL) */
  createUploadUrl?(options: UploadUrlOptions): Promise<UploadUrl | null>;

  /** 下载文件 */
  download(key: string): Promise<Buffer>;

  /** 删除文件 */
  delete(key: string): Promise<void>;

  /** 检查文件是否存在 */
  exists(key: string): Promise<boolean>;

  /** 获取文件元数据 */
  getMetadata(key: string): Promise<FileMetadata | null>;

  /** 获取文件公开 URL */
  getSourceUrl(key: string): Promise<string | null>;

  /** 获取强制下载 URL (可选) */
  getDownloadUrl?(key: string): Promise<string | null>;
}
```

### 使用示例

```typescript
import { serverFileStorage } from "@/lib/file-storage";

// 上传文件
const result = await serverFileStorage.upload(
  Buffer.from("Hello World"),
  { filename: "hello.txt", contentType: "text/plain" }
);
console.log(result.sourceUrl); // 公开访问 URL

// 创建客户端上传 URL (S3)
const uploadUrl = await serverFileStorage.createUploadUrl?.({
  filename: "image.png",
  contentType: "image/png",
  expiresInSeconds: 600
});
// 返回 presigned URL，客户端可直接上传

// 下载文件
const buffer = await serverFileStorage.download(result.key);

// 删除文件
await serverFileStorage.delete(result.key);
```

### 工具函数

```typescript
import {
  sanitizeFilename,        // 清理文件名中的非法字符
  getContentTypeFromFilename,  // 根据扩展名推断 MIME 类型
  resolveStoragePrefix,    // 解析存储路径前缀
  storageKeyFromUrl,       // 从 URL 提取存储 key
  toBuffer,                // 将各种格式转换为 Buffer
  getBase64Data,           // 获取 base64 编码的图片数据
} from "@/lib/file-storage";
```

---

## 💾 数据库操作 (`db.ts`)

### 连接池管理

使用 pg Pool 管理 PostgreSQL 连接。

```typescript
function getPool() {
  const globalPool = globalThis as GlobalPool;
  if (!globalPool.__ai4sales_pg_pool__) {
    const connectionString = process.env.DATABASE_URL;
    globalPool.__ai4sales_pg_pool__ = new Pool({
      connectionString,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE
    });
  }
  return globalPool.__ai4sales_pg_pool__;
}
```

### 核心函数

#### 1. 初始化数据库

```typescript
async function ensureInitialized()
```

**功能**: 自动创建表结构、索引和种子数据

**特性**:
- 自动建表 (customers, todos, conversations)
- 创建索引优化查询性能
- 首次启动写入种子数据

**索引列表**:
- `idx_customers_name`: customers(name)
- `idx_customers_company`: customers(company)
- `idx_customers_updated_at`: customers(updated_at DESC)
- `idx_customers_tags`: customers USING GIN(tags)
- `idx_todos_status`: todos(status)
- `idx_todos_priority`: todos(priority)
- `idx_todos_updated_at`: todos(updated_at DESC)
- `idx_conversations_status`: conversations(status)
- `idx_conversations_updated_at`: conversations(updated_at DESC)
- `idx_conversations_linked_customer`: conversations(linked_customer_id)

#### 2. 读取数据库

```typescript
export async function readDb(): Promise<DbShape>
```

**功能**: 读取所有数据

**特性**:
- 自动初始化数据库
- 使用连接池
- 类型安全的返回值

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
- **事务支持**: 使用 PostgreSQL 事务
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

#### 4. 客户操作

```typescript
// 列表查询 (支持分页、搜索、过滤、排序)
export async function listCustomers(params: CustomerListParams)

// 按 ID 查询
export async function getCustomerById(id: string)

// 查找重复客户
export async function findDuplicateCustomers(name?: string, company?: string)

// 创建客户
export async function createCustomer(customer: Customer)

// 更新客户
export async function updateCustomer(customer: Customer)

// 删除客户
export async function deleteCustomer(id: string)

// 创建客户并关联对话 (事务)
export async function createCustomerWithConversationLink(
  customer: Customer,
  conversationId?: string
)
```

#### 5. 待办操作

```typescript
// 列表查询 (支持分页、搜索、过滤、排序)
export async function listTodos(params: TodoListParams)

// 按 ID 查询
export async function getTodoById(id: string)

// 创建待办
export async function createTodo(todo: Todo)

// 更新待办
export async function updateTodo(todo: Todo)

// 删除待办
export async function deleteTodo(id: string)
```

#### 6. 对话操作

```typescript
// 列表查询 (支持分页、搜索、过滤)
export async function listConversations(params: ConversationListParams)

// 创建对话
export async function createConversation(conversation: Conversation)

// 更新对话
export async function updateConversation(conversation: Conversation)

// 更新对话关联 (部分更新)
export async function updateConversationLink(
  id: string,
  updates: Partial<Pick<Conversation, "status" | "linked_customer_id" | "ai_outputs" | "updated_at">>
)
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

## 🔄 React Query Hooks (`queries.ts`)

### Query Keys

```typescript
export const queryKeys = {
  todos: (params = {}) => ["todos", params] as const,
  todo: (id) => ["todo", id] as const,
  customers: (params = {}) => ["customers", params] as const,
  customer: (id) => ["customer", id] as const,
  conversations: (params = {}) => ["conversations", params] as const,
  conversation: (id) => ["conversation", id] as const,
  searchCustomer: (query, contextCustomerIds = []) =>
    ["searchCustomer", query, contextCustomerIds] as const,
} as const;
```

### Todos Hooks

#### useTodos

```typescript
export function useTodos(params: TodoListParams = {}, options?)
```

**功能**: 获取待办列表

**参数**:
- `params.page`: 页码
- `params.pageSize`: 每页数量
- `params.search`: 搜索关键字
- `params.sort`: 排序字段
- `params.order`: 排序方向 (asc/desc)
- `params.status`: 状态过滤
- `params.priority`: 优先级过滤

**示例**:

```typescript
const { data, isLoading, error } = useTodos(
  { page: 1, pageSize: 10, status: "open" },
  {
    staleTime: 1000 * 60 * 5, // 5 分钟
  }
);
```

#### useCreateTodo

```typescript
export function useCreateTodo()
```

**功能**: 创建待办

**特性**:
- 成功后自动刷新待办列表
- 使用 `invalidateQueries` 重新验证

**示例**:

```typescript
const createTodo = useCreateTodo();
createTodo.mutate({
  title: "完成客户拜访",
  priority: "P1",
  status: "open"
});
```

#### useUpdateTodo / useDeleteTodo

类似的 Hook 用于更新和删除待办。

### Customers Hooks

#### useCustomers

```typescript
export function useCustomers(params: CustomerListParams = {}, options?)
```

**功能**: 获取客户列表

**参数**:
- `params.page`: 页码
- `params.pageSize`: 每页数量
- `params.search`: 搜索关键字
- `params.sort`: 排序字段
- `params.order`: 排序方向 (asc/desc)
- `params.tag`: 标签过滤
- `params.hasContact`: 有无联系方式过滤

**示例**:

```typescript
const { data, isLoading, error } = useCustomers(
  { page: 1, pageSize: 6, tag: "高潜" },
  {
    staleTime: 1000 * 60 * 5, // 5 分钟
  }
);
```

#### useCustomer

```typescript
export function useCustomer(id: string, options?)
```

**功能**: 获取单个客户详情

**特性**:
- `enabled: !!id`: 仅在 ID 存在时才执行查询
- 自动缓存客户详情

**示例**:

```typescript
const { data: customer, isLoading } = useCustomer(customerId);
```

#### useCreateCustomer / useUpdateCustomer / useDeleteCustomer

类似的 Hook 用于创建、更新和删除客户。

**特性**:
- 成功后自动刷新客户列表
- 创建成功后同时刷新对话列表

### Conversations Hooks

#### useConversations

```typescript
export function useConversations(params: ConversationListParams = {}, options?)
```

**功能**: 获取对话列表

**参数**:
- `params.page`: 页码
- `params.pageSize`: 每页数量
- `params.status`: 状态过滤
- `params.search`: 搜索关键字

#### useUpdateConversation

```typescript
export function useUpdateConversation()
```

**功能**: 更新对话状态

**示例**:

```typescript
const updateConversation = useUpdateConversation();
updateConversation.mutate({
  id: conversationId,
  data: { status: "canceled" }
});
```

### AI Search Hooks

#### useSearchCustomer

```typescript
export function useSearchCustomer()
```

**功能**: AI 检索客户

**参数**:
- `query_text`: 查询文本
- `attachments`: 附件列表 (可选)
- `context_customer_ids`: 上下文客户 ID 列表 (可选)

**返回**:
- `conversation_id`: 对话 ID
- `customer_card`: 客户卡片
- `action_suggestions`: 操作建议

**示例**:

```typescript
const searchCustomer = useSearchCustomer();
searchCustomer.mutate({
  query_text: "阿里巴巴 张三",
  context_customer_ids: ["cus_xxx"]
});
```

### Query Client 配置

在 `app/app/providers.tsx` 中配置：

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,    // 5 分钟
      gcTime: 1000 * 60 * 30,      // 30 分钟
      retry: 1,                    // 失败重试 1 次
      refetchOnWindowFocus: false,  // 窗口聚焦时不重新获取
    },
  },
});
```

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

> **注意**: 此文件已弃用，功能已迁移到 `db.ts`。

原有的查询、过滤、排序、分页函数已整合到 `db.ts` 的各个 `list*` 函数中。

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

### 新增 React Query Hook

1. 在 `queries.ts` 中定义 Query Key
2. 创建 Hook 函数
3. 使用 `useQuery` 或 `useMutation`
4. 配置 `invalidateQueries` 自动刷新
5. 在组件中导入使用

**示例**:

```typescript
// 1. 定义 Query Key
export const queryKeys = {
  myResource: (params = {}) => ["myResource", params] as const,
} as const;

// 2. 创建 Hook
export function useMyResource(params = {}, options?) {
  return useQuery({
    queryKey: queryKeys.myResource(params),
    queryFn: () => apiRequest(`/api/my-resource?${params}`),
    ...options,
  });
}

// 3. 创建 Mutation Hook
export function useCreateMyResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => apiRequest("/api/my-resource", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myResource"] });
    },
  });
}

// 4. 在组件中使用
function MyComponent() {
  const { data, isLoading } = useMyResource();
  const createMyResource = useCreateMyResource();

  // ...
}
```

### 数据库操作模式

```typescript
// 使用 Drizzle ORM 查询
const customers = await withClient(async (client) => {
  const db = drizzle(client);
  return await db.select().from(customers).where(eq(customers.id, id));
});

// 使用事务
const result = await withTransaction(async (db) => {
  await db.insert(customers).values(customer);
  await db.update(conversations).set({ status: "confirmed" });
  return customer;
});
```

---

## 🐛 已知问题

1. **AI 模拟**: `buildCustomerCard` 仅为演示，需接入真实 LLM API
2. **并发控制**: 简单队列机制，高并发场景需优化
3. **错误处理**: 缺少详细的错误分类和恢复机制
4. **query.ts 废弃**: 旧代码尚未完全清理

---

## 📊 性能考虑

1. **连接池**: 使用 pg Pool 管理连接，避免频繁创建/销毁
2. **索引优化**: 为常用查询字段添加索引
3. **查询效率**: 使用 Drizzle ORM 生成优化的 SQL
4. **事务支持**: 保证数据一致性
5. **React Query 缓存**: 减少不必要的网络请求
6. **自动重新验证**: 数据变更后保持数据新鲜度

---

**生成时间**: 2026-01-29 16:38:08
