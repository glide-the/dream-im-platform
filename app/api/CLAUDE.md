# API 路由模块

> **导航**: [← 返回根目录](../../CLAUDE.md) / API 路由模块
> **路径**: `app/api/`
> **最后更新**: 2026-01-27 17:25:20

---

## 📋 模块概览

API 路由模块提供 RESTful API 端点，处理客户、待办、对话和 AI 检索等业务逻辑。采用 Next.js App Router 的 Route Handlers 模式。

### 核心职责

- 处理 HTTP 请求 (GET/POST/PATCH/DELETE)
- 数据验证与转换
- 调用业务逻辑层
- 返回标准化 JSON 响应

### 技术特点

- **Runtime**: `nodejs` (服务端运行)
- **类型安全**: 完整的 TypeScript 类型定义
- **错误处理**: 统一的错误响应格式
- **数据验证**: 输入参数校验

---

## 📁 目录结构

```
app/api/
├── agent/
│   └── search-customer/
│       └── route.ts       # AI 客户检索
├── customers/
│   ├── route.ts           # 客户列表 (GET) + 创建 (POST)
│   └── [id]/
│       └── route.ts       # 客户详情 (GET/PATCH/DELETE)
├── todos/
│   ├── route.ts           # 待办列表 (GET) + 创建 (POST)
│   └── [id]/
│       └── route.ts       # 待办详情 (GET/PATCH/DELETE)
├── conversations/
│   ├── route.ts           # 对话列表 (GET) + 创建 (POST)
│   └── [id]/
│       └── route.ts       # 对话详情 (GET/PATCH)
└── storage/
    ├── route.ts           # 存储配置信息 (GET)
    ├── upload/
    │   └── route.ts       # 文件直接上传 (POST)
    └── upload-url/
        └── route.ts       # 获取预签名上传 URL (POST)
```

---

## 🤖 AI 客户检索 API

### 端点

```
POST /api/agent/search-customer
```

### 请求体

```typescript
{
  query_text: string;              // 必填: 查询文本 (公司 + 姓名)
  attachments?: Attachment[];      // 可选: 附件列表
  context_customer_ids?: string[]; // 可选: 上下文客户 ID
}
```

### 响应

```typescript
{
  conversation_id: string;         // 对话 ID
  customer_card: CustomerCard;     // 客户资料卡片
  action_suggestions: string[];    // 操作建议
}
```

### 业务流程

1. 验证 `query_text` 非空
2. 调用 `buildCustomerCard()` 生成客户卡片
3. 创建 Conversation 记录 (status: pending)
4. 返回客户卡片和对话 ID

### 关键代码

```typescript
export async function POST(request: Request) {
  const body = await request.json();
  const queryText = body?.query_text?.trim();

  if (!queryText) {
    return jsonError("请输入查询内容");
  }

  const { card } = buildCustomerCard(queryText);

  const conversation = await withDb((db) => {
    const conv: Conversation = {
      id: createId("conv"),
      title: queryText,
      status: "pending",
      messages: [
        {
          id: createId("msg"),
          role: "user",
          content: queryText,
          created_at: now
        }
      ],
      ai_outputs: { customer_card: card },
      created_at: now,
      updated_at: now
    };
    return {
      db: { ...db, conversations: [conv, ...db.conversations] },
      result: conv
    };
  });

  return NextResponse.json({
    conversation_id: conversation.id,
    customer_card: card,
    action_suggestions: ["确认新增", "修改后入库", "取消"]
  });
}
```

---

## 👥 客户 API

### 1. 获取客户列表

```
GET /api/customers?page=1&pageSize=6&search=xxx&sort=updated_at&order=desc&tag=xxx&hasContact=1
```

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| pageSize | number | 6 | 每页数量 |
| search | string | "" | 搜索关键字 |
| sort | string | "updated_at" | 排序字段 |
| order | "asc" \| "desc" | "desc" | 排序方向 |
| tag | string | "" | 标签过滤 |
| hasContact | "1" \| "" | "" | 是否有联系方式 |

#### 响应

```typescript
{
  data: Customer[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    tagOptions: string[];        // 所有可用标签
    totalCustomers: number;      // 总客户数
  };
}
```

#### 业务流程

1. 解析查询参数
2. 读取数据库
3. 搜索过滤 (`searchCustomers`)
4. 条件过滤 (`filterCustomers`)
5. 排序 (`sortCustomers`)
6. 分页 (`paginate`)
7. 返回数据和元信息

### 2. 创建客户

```
POST /api/customers
```

#### 请求体

```typescript
{
  name?: string;
  company?: string;
  title?: string;
  phones?: string | string[];
  emails?: string | string[];
  wechat?: string;
  address?: string;
  tags?: string | string[];
  profile_markdown?: string;
  source?: "ai_search" | "manual" | "import";
  conversation_id?: string;      // 关联对话 ID
}
```

#### 验证规则

- **必填**: `name` 或 `company` 至少一个
- **自动处理**:
  - 列表字段支持逗号分隔字符串
  - 自动生成 ID (`cus_xxx`)
  - 自动设置时间戳

#### 业务流程

1. 验证请求体格式
2. 验证必填字段
3. 规范化列表字段 (`normalizeList`)
4. 创建客户对象
5. 写入数据库
6. 如果有 `conversation_id`，更新对话状态为 `confirmed`
7. 返回创建的客户

#### 关键代码

```typescript
export async function POST(request: Request) {
  const body = await request.json();
  const name = body?.name?.trim();
  const company = body?.company?.trim();

  if (!name && !company) {
    return jsonError("至少填写姓名或公司");
  }

  const customer: Customer = {
    id: createId("cus"),
    name,
    company,
    // ... 其他字段
    created_at: now,
    updated_at: now,
    source: body?.source ?? "manual"
  };

  const result = await withDb((db) => {
    const conversations = db.conversations.map((conv) => {
      if (body?.conversation_id && conv.id === body.conversation_id) {
        return {
          ...conv,
          status: "confirmed" as const,
          linked_customer_id: customer.id,
          updated_at: now
        };
      }
      return conv;
    });
    return {
      db: {
        ...db,
        customers: [customer, ...db.customers],
        conversations
      },
      result: customer
    };
  });

  return NextResponse.json({ data: result }, { status: 201 });
}
```

### 3. 获取客户详情

```
GET /api/customers/{id}
```

#### 响应

```typescript
{
  data: Customer;
}
```

### 4. 更新客户

```
PATCH /api/customers/{id}
```

#### 请求体

```typescript
{
  name?: string;
  company?: string;
  // ... 其他可更新字段
}
```

### 5. 删除客户

```
DELETE /api/customers/{id}
```

---

## 📋 待办 API

### 1. 获取待办列表

```
GET /api/todos?page=1&pageSize=10&search=xxx&sort=priority&order=asc&priority=P0&status=open
```

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| pageSize | number | 10 | 每页数量 |
| search | string | "" | 搜索关键字 |
| sort | string | "priority" | 排序字段 |
| order | "asc" \| "desc" | "asc" | 排序方向 |
| priority | "P0" \| "P1" \| "P2" \| "P3" | "" | 优先级过滤 |
| status | "open" \| "done" | "" | 状态过滤 |

### 2. 创建待办

```
POST /api/todos
```

#### 请求体

```typescript
{
  title: string;                 // 必填
  description?: string;
  priority: "P0" | "P1" | "P2" | "P3"; // 必填
  status?: "open" | "done";      // 默认 "open"
}
```

### 3. 更新待办

```
PATCH /api/todos/{id}
```

### 4. 删除待办

```
DELETE /api/todos/{id}
```

---

## 💬 对话 API

### 1. 获取对话列表

```
GET /api/conversations?page=1&pageSize=5&sort=updated_at&order=desc
```

#### 响应

```typescript
{
  data: Conversation[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

### 2. 创建对话

```
POST /api/conversations
```

#### 请求体

```typescript
{
  title: string;
  messages: ConversationMessage[];
  attachments?: Attachment[];
  context_customer_ids?: string[];
}
```

### 3. 获取对话详情

```
GET /api/conversations/{id}
```

### 4. 更新对话状态

```
PATCH /api/conversations/{id}
```

#### 请求体

```typescript
{
  status: "pending" | "confirmed" | "canceled";
}
```

---

## 📁 存储 API

文件存储 API，支持 Vercel Blob 和 S3 存储后端。详细文档参见 [docs/storage-api.md](../../docs/storage-api.md)。

### 1. 获取存储配置信息

```
GET /api/storage
```

#### 响应

```typescript
{
  type: "vercel-blob" | "s3";        // 存储驱动类型
  supportsDirectUpload: boolean;     // 是否支持客户端直传
  isConfigured: boolean;             // 是否正确配置
  error?: string;                    // 配置错误信息
  solution?: string;                 // 解决方案
}
```

### 2. 直接上传文件

```
POST /api/storage/upload
Content-Type: multipart/form-data
```

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | ✅ | 要上传的文件 |

#### 响应

```typescript
{
  success: true;
  key: string;           // 存储 key
  url: string;           // 公开访问 URL
  metadata: {
    key: string;
    filename: string;
    contentType: string;
    size: number;
    uploadedAt: string;
  };
}
```

### 3. 获取预签名上传 URL

```
POST /api/storage/upload-url
Content-Type: application/json
```

#### 请求体

```typescript
{
  filename?: string;     // 文件名
  contentType?: string;  // MIME 类型
}
```

#### 响应（S3）

```typescript
{
  directUploadSupported: true;
  key: string;           // 存储 key
  url: string;           // 预签名上传 URL
  method: "PUT";
  expiresAt: string;     // 过期时间
  headers: Record<string, string>;
  sourceUrl: string;     // 上传后的公开访问 URL
}
```

#### 响应（不支持直传）

```typescript
{
  directUploadSupported: false;
  fallbackUrl: "/api/storage/upload";
  message: string;
}
```

### 环境变量配置

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `FILE_STORAGE_TYPE` | 否 | 存储类型：`vercel-blob`（默认）或 `s3` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob | Vercel Blob 访问令牌 |
| `FILE_STORAGE_S3_BUCKET` | S3 | S3 存储桶名称 |
| `FILE_STORAGE_S3_REGION` | S3 | S3 区域 |

---

## 🛠️ 工具函数

### 1. 错误响应

```typescript
function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
```

### 2. 列表规范化

```typescript
function normalizeList(input?: string | string[]) {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter(Boolean);
  return input
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
```

### 3. 数字转换

```typescript
function toNumber(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}
```

---

## 📊 响应格式规范

### 成功响应

```typescript
// 单个资源
{
  data: Resource;
}

// 资源列表
{
  data: Resource[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    // ... 其他元信息
  };
}
```

### 错误响应

```typescript
{
  error: string;  // 错误消息
}
```

### HTTP 状态码

- `200`: 成功 (GET/PATCH)
- `201`: 创建成功 (POST)
- `204`: 删除成功 (DELETE)
- `400`: 请求参数错误
- `404`: 资源不存在
- `500`: 服务器错误

---

## 🔒 安全措施

### 输入验证

1. **必填字段检查**: 所有必填字段都有验证
2. **类型检查**: 使用 TypeScript 类型系统
3. **字符串清理**: `trim()` 去除首尾空格
4. **列表规范化**: 统一处理逗号分隔字符串

### 错误处理

```typescript
try {
  const body = await request.json();
} catch {
  return jsonError("请求体格式错误");
}
```

### 数据库写入保护

- 使用 `withDb` 队列机制防止并发冲突
- 所有写操作都在事务中完成

---

## 🚀 性能优化

1. **分页**: 所有列表接口都支持分页
2. **索引**: 按更新时间排序 (数据库层面优化)
3. **缓存**: 可在前端层面添加缓存策略

---

## 🐛 已知问题

1. **AI 检索模拟**: `buildCustomerCard` 仅为模拟实现
2. **并发控制**: 简单队列机制，高并发场景需优化
3. **权限控制**: 缺少用户认证和授权
4. **速率限制**: 无 API 调用频率限制

---

## 📝 开发建议

### 新增 API 端点

1. 在 `app/api/` 下创建目录
2. 添加 `route.ts` 文件
3. 导出 HTTP 方法函数 (GET/POST/PATCH/DELETE)
4. 使用 `export const runtime = "nodejs"`

### 错误处理模式

```typescript
export async function POST(request: Request) {
  try {
    const body = await request.json();
    // 业务逻辑
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("API Error:", error);
    return jsonError("操作失败", 500);
  }
}
```

### 数据库操作模式

```typescript
const result = await withDb((db) => {
  // 修改数据
  const newData = [...db.collection, newItem];

  return {
    db: { ...db, collection: newData },
    result: newItem
  };
});
```

---

**生成时间**: 2026-01-27 17:25:20
