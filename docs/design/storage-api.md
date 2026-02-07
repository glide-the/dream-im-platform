# Storage API 文档

> **路径**: `app/api/storage/`
> **最后更新**: 2026-02-04

---

## 📋 概述

Storage API 提供文件上传和存储服务，支持多种存储后端：
- **Vercel Blob**: Vercel 提供的对象存储服务（默认）
- **S3**: AWS S3 或兼容的对象存储（如 MinIO、DigitalOcean Spaces）

---

## 🐳 Docker 本地开发

项目提供 `docker-compose.yml` 用于本地开发测试，包含：
- **PostgreSQL 16**: 数据库
- **MinIO**: S3 兼容的对象存储

### 启动服务

```bash
# 启动所有服务
docker compose up -d

# 查看服务状态
docker compose ps

# 查看 MinIO 初始化日志
docker compose logs minio-init
```

### 访问地址

| 服务 | 地址 | 说明 |
|------|------|------|
| MinIO API | http://localhost:9000 | S3 兼容 API |
| MinIO Console | http://localhost:9001 | Web 管理界面 |
| PostgreSQL | localhost:5432 | 数据库 |

### 默认凭证

| 项目 | 用户名/密码 |
|------|-------------|
| MinIO | `minioadmin` / `minioadmin` |
| PostgreSQL | `postgres` / `postgres` |
| 数据库名 | `ai4sales` |
| S3 Bucket | `vibesales` (自动创建，设为公开访问) |

### 配置环境变量

创建 `.env.local` 文件使用 Docker MinIO：

```bash
# 使用 Docker MinIO
FILE_STORAGE_TYPE=s3
FILE_STORAGE_S3_BUCKET=vibesales
FILE_STORAGE_S3_REGION=us-east-1
FILE_STORAGE_S3_ENDPOINT=http://localhost:9000
FILE_STORAGE_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
FILE_STORAGE_PREFIX=uploads

# PostgreSQL
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai4sales
```

---

## 🔧 环境变量配置

### 通用配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `FILE_STORAGE_TYPE` | 否 | `vercel-blob` | 存储驱动类型，可选 `vercel-blob` 或 `s3` |
| `FILE_STORAGE_PREFIX` | 否 | `uploads` | 文件存储路径前缀 |

### Vercel Blob 配置

当 `FILE_STORAGE_TYPE=vercel-blob` 时需要配置：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `BLOB_READ_WRITE_TOKEN` | ✅ 是 | Vercel Blob 访问令牌，从 Vercel Dashboard > Storage > Blob Store 获取 |

### S3 配置

当 `FILE_STORAGE_TYPE=s3` 时需要配置：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `FILE_STORAGE_S3_BUCKET` | ✅ 是 | S3 存储桶名称 |
| `FILE_STORAGE_S3_REGION` | ✅ 是 | S3 区域（如 `us-east-1`），可用 `AWS_REGION` 作为备选 |
| `AWS_REGION` | 否 | AWS 区域，作为 `FILE_STORAGE_S3_REGION` 的备选 |
| `FILE_STORAGE_S3_ENDPOINT` | 否 | 自定义端点 URL，用于 S3 兼容存储（MinIO 等） |
| `FILE_STORAGE_S3_FORCE_PATH_STYLE` | 否 | 设为 `1` 或 `true` 使用路径样式 URL（MinIO 需要） |
| `FILE_STORAGE_S3_PUBLIC_BASE_URL` | 否 | 自定义公开访问 URL（CDN URL） |

---

## 📡 API 端点

### 1. 获取存储配置信息

```
GET /api/storage
```

获取当前存储配置状态，用于客户端判断上传策略。

#### 响应示例

**配置正确时：**
```json
{
  "type": "s3",
  "supportsDirectUpload": true,
  "isConfigured": true
}
```

**配置错误时：**
```json
{
  "type": "vercel-blob",
  "supportsDirectUpload": true,
  "isConfigured": false,
  "error": "BLOB_READ_WRITE_TOKEN is not set",
  "solution": "Please add Vercel Blob to your project:\n1. Go to your Vercel Dashboard\n..."
}
```

---

### 2. 直接上传文件

```
POST /api/storage/upload
Content-Type: multipart/form-data
```

直接上传文件到存储后端。

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | ✅ 是 | 要上传的文件 |

#### 支持的文件类型

- **图片**: JPEG, PNG, GIF, WebP, SVG
- **文档**: PDF, Word (.doc, .docx), Excel (.xls, .xlsx)
- **文本**: TXT, CSV, Markdown, JSON
- **压缩**: ZIP, TAR, GZIP
- **媒体**: MP3, WAV, MP4, WebM

#### 响应示例

**成功：**
```json
{
  "success": true,
  "key": "uploads/abc123-file.txt",
  "url": "https://bucket.s3.us-east-1.amazonaws.com/uploads/abc123-file.txt",
  "metadata": {
    "key": "uploads/abc123-file.txt",
    "filename": "abc123-file.txt",
    "contentType": "text/plain",
    "size": 1234,
    "uploadedAt": "2026-02-03T12:00:00.000Z"
  }
}
```

**失败：**
```json
{
  "error": "No file provided. Use 'file' field in FormData."
}
```

#### 使用示例

**JavaScript/TypeScript：**
```typescript
const formData = new FormData();
formData.append('file', file);

const response = await fetch('/api/storage/upload', {
  method: 'POST',
  body: formData,
});

const result = await response.json();
console.log(result.url); // 文件公开访问 URL
```

**cURL：**
```bash
curl -X POST /api/storage/upload \
  -F "file=@/path/to/file.txt"
```

---

### 3. 获取预签名上传 URL

```
POST /api/storage/upload-url
Content-Type: application/json
```

获取预签名 URL 或客户端令牌，用于客户端直接上传到存储后端（绕过服务器）。

#### 请求体

**S3/通用请求：**
```json
{
  "filename": "document.pdf",
  "contentType": "application/pdf"
}
```

**Vercel Blob 请求：**
```json
{
  "type": "blob.generate-client-token",
  "payload": {
    "pathname": "documents/file.pdf",
    "callbackUrl": "https://your-app.com/api/storage/upload-url"
  }
}
```

#### 响应示例

**S3 预签名 URL：**
```json
{
  "directUploadSupported": true,
  "key": "uploads/abc123-document.pdf",
  "url": "https://bucket.s3.us-east-1.amazonaws.com/uploads/abc123-document.pdf?X-Amz-Algorithm=...",
  "method": "PUT",
  "expiresAt": "2026-02-03T13:00:00.000Z",
  "headers": {
    "Content-Type": "application/pdf"
  },
  "sourceUrl": "https://bucket.s3.us-east-1.amazonaws.com/uploads/abc123-document.pdf"
}
```

**不支持直接上传时的回退响应：**
```json
{
  "directUploadSupported": false,
  "fallbackUrl": "/api/storage/upload",
  "message": "Use multipart/form-data upload to fallbackUrl"
}
```

#### 客户端直接上传流程（S3）

```typescript
// 1. 获取预签名 URL
const { url, headers, key, sourceUrl } = await fetch('/api/storage/upload-url', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filename: 'photo.jpg',
    contentType: 'image/jpeg'
  })
}).then(r => r.json());

// 2. 直接上传到 S3
await fetch(url, {
  method: 'PUT',
  headers,
  body: file
});

// 3. 使用 sourceUrl 作为文件公开访问地址
console.log('File uploaded:', sourceUrl);
```

---

## 🔐 安全注意事项

1. **认证**: 当前 API 未实现认证，生产环境应添加：
   - 用户身份验证
   - 请求频率限制
   - 文件大小限制

2. **内容类型验证**: 上传 API 会验证并规范化 Content-Type

3. **文件名清理**: 所有文件名都会被清理，移除特殊字符

---

## 🏗️ 架构说明

```
┌──────────────────┐
│   客户端         │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│  /api/storage    │────▶│  检查存储配置     │
│  (GET)           │     └──────────────────┘
└──────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  /api/storage/   │────▶│  serverFileStorage │────▶│  Vercel Blob /   │
│  upload (POST)   │     │  .upload()         │     │  S3              │
└──────────────────┘     └──────────────────┘     └──────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  /api/storage/   │────▶│  serverFileStorage │────▶│  预签名 URL /    │
│  upload-url      │     │  .createUploadUrl()│     │  客户端令牌      │
│  (POST)          │     └──────────────────┘     └──────────────────┘
└──────────────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│   客户端直接上传  │────▶│  Vercel Blob /   │
│   (PUT)          │     │  S3              │
└──────────────────┘     └──────────────────┘
```

---

## 📝 使用场景

### 场景 1: 小文件上传（< 10MB）

推荐使用 `/api/storage/upload` 直接上传。

### 场景 2: 大文件上传（> 10MB）

推荐使用 `/api/storage/upload-url` 获取预签名 URL，然后客户端直接上传到存储后端，避免服务器压力。

### 场景 3: 用户头像/图片上传

```typescript
async function uploadAvatar(file: File) {
  // 检查存储配置
  const config = await fetch('/api/storage').then(r => r.json());
  
  if (!config.isConfigured) {
    throw new Error(config.error);
  }
  
  // 小文件直接上传
  if (file.size < 10 * 1024 * 1024) {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/storage/upload', {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  }
  
  // 大文件使用预签名 URL
  const { url, headers, sourceUrl } = await fetch('/api/storage/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type
    })
  }).then(r => r.json());
  
  await fetch(url, { method: 'PUT', headers, body: file });
  return { url: sourceUrl };
}
```

---

## 🔗 相关链接

- [Vercel Blob 文档](https://vercel.com/docs/storage/vercel-blob)
- [AWS S3 文档](https://docs.aws.amazon.com/s3/)
- [MinIO 文档](https://min.io/docs/minio/linux/index.html)
