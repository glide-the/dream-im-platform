# 模块 PRD：Storage 与文件资源

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[Storage](../../design/modules/07-storage.md)

## 1. 目标

保留并运营现有 S3/Vercel Blob 文件能力，为授权管理员提供配置健康、资源查询、受控上传/读取/下载和审计。Storage 不使用数据库替代实现，不引入本地 JSON/内存回退。

## 2. 页面与 API

| 能力 | 路由/API | 权限 |
|---|---|---|
| 文件资源页 | `/admin/resources/storage` | `storage.read` |
| 配置状态 | `GET /api/storage` | 应用安全状态 |
| 列表/详情 | `/api/admin/storage-resources/**` | `storage.read` |
| 上传/签名 | `/api/storage/upload`、`/api/storage/upload-url` | Admin 管理操作使用 `storage.write`；业务调用沿用现有服务端授权边界 |
| 安全读取 | `/api/storage/file/**` | 鉴权、路径安全 |
| 删除 | Admin resource command | `storage.delete` + 高风险确认 |

## 3. 规则

- Driver 只允许项目已有 S3-compatible 或 Vercel Blob；配置缺失返回明确不可用。
- Key/prefix 规范化并防路径遍历；下载使用受控代理或短时签名 URL。
- Access Key/Secret、Blob Token 不出现在 API、日志、错误或页面。
- 列表/exists/metadata 使用真实 driver 能力；不虚构文件数量或成功。
- 删除必须显示完整对象 key、影响、确认值并写 Audit；未知结果不得提示成功。

## 4. 验收

- STOG-01：配置健康准确区分已配置/缺字段；Secret 不回显。
- STOG-02：上传、列表、下载、exists/metadata 在隔离 MinIO 或显式测试 driver 中通过。
- STOG-03：路径遍历、越权读取/删除返回 400/403，不访问对象。
- STOG-04：长 key 可复制且不造成页面横向溢出。
- STOG-05：平台用户、订阅、Gateway 等改动不导致 Storage 回归。
