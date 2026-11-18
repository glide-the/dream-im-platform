<!-- [Input] 现用发布入口、服务器所有的监控配置和已授权的数据采集边界。 -->
<!-- [Output] 应用发布、部署验收和回滚必须保持的监控要求。 -->
<!-- [Pos] 仓库只保存发布部署合同；详细运维说明、配置、图表和回执维护在 Notion。 -->
<!-- [Sync] 2026-11-19: 增加 Dream operation 入口、业务子 Span 与源码定位验收。 -->

# 监控发布部署要求

详细操作归 [Admin 运维手册｜Grafana、Prometheus 与 ARMS](https://app.notion.com/p/41830b7547c3810d9056c656f54c35af)，接入证据归其[验收记录](https://app.notion.com/p/41830b7547c3812d990fc118f7e4fcb5)。仓库不复制完整运维手册、当前云端地址清单、图表或排障回执。

## 发布与配置所有权

- 沿 [部署指南](deploy.md) 和 `AGENTS.md` 的现用外部 PostgreSQL 拓扑发布，保持明确的启动入口、服务账户及数据库身份；不自动启动保留的旧源库。
- 监控运行文件及锁定依赖由服务器管理，独立于应用完整制品；普通应用发布不覆盖、删除或自动升级 `/opt/ink-admin-observability`。
- 保留现有 observability systemd drop-in 和原 `NODE_OPTIONS`，监控 preload 只能追加；不得以整项覆盖的方式丢失原有启动设置。
- 私有监控配置及凭据留在服务器受限配置中，保持原所有权和权限；不进入 Git、应用制品、日志、截图或发布回执。
- 保持已授权的采集范围和脱敏策略；普通发布不启用模型正文、SQL 参数或应用日志采集，不扩大数据库监控账号的业务数据权限。

## 部署后验收

- 原服务、HTTP、认证与数据库能力继续通过既有发布检查。
- 分别核对主机及数据库指标在实际数据源持续更新、Admin 的近期接口和数据库调用链可查询；本机 exporter HTTP 200 或 SDK 初始化日志不能单独作为云端验收。
- 在新采样的 Admin 调用链中核对 Dream operation 的入口名称，例如 `POST /api/internal/dream/v1/operations/deck.default-plugin.resolve`。已注册 operation 用具体路径分组，未注册输入沿用路由模板。升级 Next.js 时回查入口 Span 名称及 `http.route`。
- 展开入口下的实际处理函数，例如 `handleDeckDefaultPluginResolve`。在 Span 属性中查看 `code.function.name`、`code.file.path` 和 `ink.dream.operation`。默认插件解析及默认 Deck 对齐还可查看输入校验、事务、业务服务及仓储 Span。输入校验 Span 的 `ink.dream.dto.name` 与 `ink.dream.dto.file` 标明合同行和定义文件。
- 数据库 exporter 的存活与其到 PostgreSQL 的连接成功分别检查。采集来源变化时先核对实际来源，再维护监控专用规则；不改原业务规则。
- 监控采样、角色权限及资源预算的修改单独留存变更和云端验收证据。正常流量快照不作为接口容量结论，连接池调整需要另行测量。

## 回滚与恢复

- 按变更所有权撤回对应监控覆盖项，保留原应用完整制品、私有配置和当前外部数据库；不将重新构建作为唯一恢复方式。
- 监控回退不覆盖整份数据库访问规则，不恢复已轮换失效的凭据，不改业务角色、账本或迁移历史。
- 沿用禁用 swap / zswap 与服务 `MemorySwapMax=0` 的部署要求。

服务入口和发布恢复的通用合同见 [服务部署文档](deploy-services.md)。详细配置、使用方法、数据流向图、业务时序图和执行记录在 Notion 维护。
