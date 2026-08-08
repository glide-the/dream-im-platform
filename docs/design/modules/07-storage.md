# 模块交互：Storage 与文件资源

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[Storage](../../prd/modules/07-storage.md)

> 实现状态：已实现；本文用于 Storage 回归与后续优化。

## 1. 页面目的

资源运营和管理员检查 driver/config health，查询真实对象并执行受控上传、读取、下载或删除；页面不得伪造文件列表或容量指标。

## 2. 页面结构 `/admin/resources/storage`

顺序：Driver 状态 → 配置诊断（不含 Secret）→ Query Bar → 文件表 → 详情/操作。

| 列 | 展示 |
|---|---|
| Key | mono、前后保留截断、完整 Copy |
| Size/type | bytes 格式化 + MIME |
| Updated/etag | 时间、短 fingerprint |
| Driver/prefix | 状态文字 |
| Actions | 查看 metadata、下载；有权限时删除 |

筛选 prefix/key/type；排序 key/updated/size；真实 driver 支持时分页。无资源说明当前 prefix；配置错误时不请求列表。

## 3. 上传、详情与删除

- 上传 Drawer：File input、目标 prefix/key text、content type 只读/可确认；显示大小限制和冲突策略。上传进度可取消，未知结果通过 exists/metadata 确认。
- 详情 Drawer：key、URL 策略、size/type/etag/updated、exists、受控下载；Secret 不显示。
- 删除 Modal：完整 key、driver、不可恢复性、类型化确认；需要 `storage.delete`，409/404 保留安全回执。

## 4. 响应式与验收

- 长 key 在单元格和 Drawer 自身换行/横滚，document 不横滚。
- File input 有 label；上传进度和完成进入 live region；下载错误提供 request ID。
- UI-STOG-01：配置缺失显示具体字段类别但不泄露值，并提供重试。
- UI-STOG-02：无删除权限时控件不存在，直接 API 返回 403。
- UI-STOG-03：390×844 可完成上传、复制 key、下载和危险确认。
- UI-STOG-04：空列表不展示伪容量/文件数。
