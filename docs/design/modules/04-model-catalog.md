# 模块交互：Provider、Model、Pricing 与模型权限

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[模型供应链](../../prd/modules/04-model-catalog.md)

## 1. Provider

列表采用单列紧凑条目：身份（name/code/protocol/base URL）→ Credential/网络/同步/模型数/价格覆盖 → 常显“同步模型、查看用量、编辑”。筛选 keyword/protocol/status/sync status；不依赖 hover。

新增/编辑为覆盖 Admin Shell 的固定全窗口层：64px Header、可滚动中段、72px Footer。字段：preset/protocol select、code/name text、base URL、Credential password、status、timeout/max retries number、auth mode/output token param select、未知 config JSON。编辑不回填 Secret，空值表示不轮换。

保存成功与 Discover 是两个结果。Discover 进度显示脱敏 endpoint、阶段、request/snapshot ID；失败允许编辑/重试。Diff 页固定分类：新增、能力更新、未变化、冲突、未定价；Apply 前显示选择与 alias，stale 409 要求重新发现。

## 2. Model 与 Pricing

Model 列表列 provider、alias、upstream model、capabilities、context/output、enabled、updated。独立表单使用 Provider combobox、alias text、候选 upstream model combobox + 受控自定义、capability checkboxes、整数窗口、enabled switch。

Pricing 列表列 model/tier、四类价格、markup/discount、source/status/effective window。新版本独立页：Model/Tier relation → 当前版本 → 四类 micro-USD integer → markup/discount → effective time → before/after diff。历史行只读；无直接编辑窗口。

目录同步页显示 catalog version/hash、exact/normalized/ambiguous/unmatched 证据；只有 exact 默认选。

## 3. 模型权限

Drawer 字段：平台用户 relation、Model relation、enabled switch、daily/monthly Token integer；当前不显示 RPM 编辑。列表按用户/模型/enabled 筛选，删除 override 的确认文案明确“恢复默认策略”。

## 4. 状态、响应式与验收

- Credential、连接、Discover、Pricing 覆盖分别显示，不能合并成一个“健康”。
- Desktop Provider 操作常显；Mobile 条目改为纵向，主动作仍在首屏，配置层全屏。
- JSON/URL/alias 长值局部换行；价格使用 mono/tabular。
- UI-MOD-01：历史 Secret 不进入 DOM；一次草稿显隐不持久化。
- UI-MOD-02：Discover 失败不显示 Provider 保存失败；stale Apply 可恢复。
- UI-MOD-03：价格单位、旧/新版本和生效时间同时可见。
- UI-MOD-04：模型权限用户选择器覆盖所有 canonical 用户。

