<!-- [Input] Dream统一AI/笔记分享范围、现有OAuth/回执协议和共享PostgreSQL合同。 -->
<!-- [Output] Admin快照、归属、终态、匿名读取、capability及采用边界。 -->
<!-- [Pos] Admin分享持久化设计；Dream PRD与正式交互稿拥有产品规则和业务图。 -->
<!-- [Sync] 2026-11-12: 0087与精确能力已应用；技术检查及完整制品发布分别留证。 -->
# 外部分享持久化

## 背景与问题

用户要求AI对话与笔记统一链接分享，并在设置中使单条链接失效。参考[better-chatbot公开分享](https://github.com/keinsaasforever/better-chatbot/tree/6f4183566bc48616303cb84055f11f79578c82fe/apps/web/src/app/%28public%29)的独立快照、认证创建、归属删除与独立公开页面。Dream拥有内容投影与产品呈现，Admin拥有共享持久化、身份和状态。

## 目标与边界

新增`external_shares`、四个闭合内部操作和匿名只读入口。数据库变更仅使用Drizzle前向expand。原内容、旧表、旧operation位置和账本保持原合同。评论、到期、访客密码、站点HTML与访问统计未纳入范围。

## 概念与规则

- `externalShareDto.ts`定义note/chat严格判别快照及管理DTO。匿名DTO只含title、created_at和正文，不输出用户、源ID、token或管理状态。
- `externalShareRepository.ts`按OAuth canonical用户筛选管理记录。create事务内按用户查源Thread/Session并持有共享锁，使用随机32字节token与UUID插入不可变快照。客户端无法提供owner。
- `externalShareHandler.ts`沿`handleInternalAuthRequest`与`principalForServiceToken`验证服务和用户；读`dream:read`、写`dream:write`。create/revoke沿ReceiptRepository提交回执和审计，同一key同输入返回原结果。
- 列表按created_at/id倒序keyset，返回当前用户记录和两类active数量。source_available通过原表存在性计算；源删除后记录保留。
- revoke只更新当前用户的active记录及数据库失效时间，重复提交保持revoked终态。重新分享创建独立token。
- `GET /api/public/shares/[token]`不要求用户或服务凭证。先验证43字符格式，再以token与active读取；缺失/失效404，能力/存储/DTO异常503。逐次查库，no-store、noindex/nofollow和no-referrer。
- 原文件token和归属回填由Dream兼容边界处理，Admin无文件内容读取和用户归属推断。

## Schema与权限

`packages/db/src/schema/dream.ts`为表定义。`0087_external_shares.sql`、journal和snapshot经Drizzle生成，本轮新SQL追加DATA权限与精确`dream.external-share.v1`能力。历史0086及更早记录保持原值。新增表仅向唯一已识别的有限DATA角色授予SELECT/INSERT/UPDATE，存在多个候选角色时迁移失败；无候选时由原显式角色激活流程授予。`auth-access-policy-plan.mjs`仅在精确capability匹配后加入相同权限，无PUBLIC授权。

token具有唯一索引，owner/kind/status/created_at/id拥有列表索引。user_id只关联canonical users，源ID保留文字引用，原Thread/Session删除保留快照。新表空表增加约束及索引，迁移按原runner事务执行；源业务表无回填及类型修改。

操作在Registry尾部追加，仅在identity、runtime-purpose及精确share物理能力满足时提供。公开入口只依赖精确share能力。Dream通过`generate-external-share-contracts.ts`生成的操作摘要消费，独立于全局Drizzle head。

## 采用与验证

用户要求部署并验证后，本次技术检查由主Agent执行，luna-test-stage保持暂停。完整类型/lint、Node20的2641项单元、具名隔离PG完整88条迁移、并发/重复/漂移/ACL及4项原Next匿名HTTP规格通过。正常ECS沿原编译入口完成0087，88/88及精确能力已登记，迁移前后原业务计数、私有配置指纹和数据目录inode保持。

发布顺序为expand → Admin代码与capability → Dream代码采用 → 正常业务验收。三轮Actions的源码、制品、上传期限与部署后检查见[执行记录](../verification/external-share-release-20261112.md)。前两轮均在服务切换前取消慢速上传，原服务继续运行，第三轮使用90分钟按次期限并完成制品采用与线上只读接口检查。缺能力时fail closed。应用回退须保留快照、终态、回执及逐次状态检查，保留新增Schema；旧文件token读取继续关闭。

Dream设计位于其仓库`docs/design/sharing/external-links.md`，执行记录位于`docs/exec/external-share-refactor-20261112.md`。
