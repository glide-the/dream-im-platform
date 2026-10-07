<!-- [Input] Existing Settings manual/automatic sync and stuck syncing evidence. -->
<!-- [Output] Product boundaries for single-owner metadata synchronization and interruption recovery. -->
<!-- [Pos] Notion PRD; no new page or product expiry threshold. -->
# Notion 同步执行归属

## 背景与问题

跨进程同步没有持久执行归属。中断后 syncing 永久阻止自动同步，旧执行也能迟到覆盖结果。最近成功索引仍应保持可读范围内可用。

## 目标与边界

同一连接只允许一个有效执行；用户立即同步与自动同步共用执行路径。活跃执行返回忙碌，服务器证明租约失效后才可恢复。保留轻量 metadata-only 索引，不同步正文，不新增页面、队列或确认弹窗。正常账户不用于并发/故障测试。

现有界面骨架保持：
```text
Settings > Notion
├─ 连接与授权状态
├─ 资源范围（数据库 / 独立页面）
├─ 同步策略：自动开关、间隔、保存
└─ 已挂载来源：最近成功、状态、立即同步
窄屏：同样区域纵向滚动；不新增弹窗。
```

## 概念与规则

default/desired/effective/revision 是现行策略；执行状态由 Admin 当前 run 所有。关闭自动不禁止立即同步，策略保存不能被旧完成回滚。来源或授权发生 A→B→A 变化仍使旧执行失效。失败保留最近成功索引，读取继续与当前范围求交。租约和 heartbeat 是明确服务器配置，不是产品同步频率或用户过期限制。

实现和发布门禁见 [正式设计](../../design/notion-sync-ownership.md)。Admin 合同交付不能单独宣称 Dream 缓存及自动恢复已完成。
