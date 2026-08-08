# 模块交互：Usage、账户、Ledger 与报表

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[账务运营](../../prd/modules/06-billing.md)

## 1. Usage Dashboard

全局筛选：Date Range/timezone、protocol、Provider、Model、平台用户、outcome、refresh。筛选同时驱动事实摘要、趋势和“请求日志 / Provider 统计 / 模型统计”；聚合不可用时显示不可用，不用当前页合计替代。

Usage 表列 request ID、user、provider/model、四类 Token、coverage mode、allowance/cash charge、status、time。详情复用 Gateway Request Drawer，账务分区突出价格快照、reserve/capture/release、Ledger 链接。

## 2. 计费账户

列表列平台用户、currency、available、reserved、lifetime debited、version、updated；筛选 user/tier，金额 mono/tabular。详情宽 Drawer：cash → current Subscription/Allowance → recent Ledger/Usage → 调账入口。

调账 Modal 控件：类型 radio（credit/debit/reversal 边界）、amount micro-USD integer + USD preview、reason textarea、external ticket text、idempotency key。显示 before/after 预览；不能直接输入目标余额。

## 3. Ledger 与报表

Ledger 列 entry type、signed amount、available/reserved after、user、request/subscription、actor、created；筛选 user/account/type/request/subscription/time；只读，无行编辑/删除。纠错从原 entry 发起新的 reversal，并在确认中显示双向关联。

报表选择日期、时区、Provider/Model/User、币种展示；显示 Usage 与 Ledger 的真实聚合、舍入规则和数据更新时间。CSV 仅当前筛选，导出前显示行数/时间范围，不包含 Prompt/Secret。

## 4. 状态与验收

- 未知 Usage 显示“未知/待处置”，不能显示 0 Token 或成功结算。
- 409 保留调账输入并刷新当前 version/balance；网络未知先查询 idempotency result。
- Mobile 摘要纵向，金额标签不省略；表格局部横滚。
- UI-BIL-01：Allowance 与 cash 始终分区，并能追到 Subscription/Request/Ledger。
- UI-BIL-02：调账只能追加 Ledger，重复提交只显示一次结果。
- UI-BIL-03：Ledger 无编辑/删除控件，审计角色可完整键盘查询。
- UI-BIL-04：报表不可用时不显示假指标或空 CSV。

