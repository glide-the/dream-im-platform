<!-- [Input] 本次Admin分享源码、隔离验证回执和线上原实例。 -->
<!-- [Output] 发布目标、验证证据、迁移与服务采用状态。 -->
<!-- [Pos] 2026-11-12 Admin外部分享发布记录；真实账户验收单列。 -->
# Admin外部分享发布

用户要求部署Admin并验证。运维采用GitHub手动Actions完整制品流程，Dream服务保持原状态。luna-test-stage继续暂停，本轮由主Agent执行检查。

## 源码范围

本轮从最新main `3e35e0e`建立独立工作树，只包含统一AI/笔记分享、0087、相关文档及隔离规格。原工作区其他未提交改动保留。

## 发布前证据

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm --filter @ink-memory/db build` | 0 | 数据库package构建完成。 |
| `pnpm exec tsc --noEmit --pretty false` | 0 | 完整类型检查通过。 |
| 相关文件`pnpm exec eslint` | 0 | 分享实现与注册文件通过。 |
| `pnpm exec vitest run app/lib/dream/externalShareHandler.test.ts --reporter=default` | 0 | 5 passed。 |
| `pnpm test:config` | 0 | 35项配置合同与拓扑检查通过。 |
| `pnpm exec tsx scripts/validate-external-share-contract.mjs` | 0 | 具名隔离PG完整0086前缀及0087、并发/重复/漂移/ACL、归属/回执/快照/失效/能力失败关闭通过，88条迁移；真实Next公开API的4项Playwright请求通过。 |
| Dream `.venv/bin/python -m pytest tests/test_note_shares.py tests/test_external_shares.py -q` | 0 | 16 passed，Provider-free边界。 |

隔离验证首轮使用JSON属性顺序比较导致harness断言失败，改为结构比较后通过。该失败未修改正常数据。隔离数据库、端口、Next进程及临时目录均由harness管理并清理。

## 线上发布前身份

主机`iZ2ze9gvp834u057cbobbqZ`，Admin服务active/running，运行用户ink-admin，原release为`actions-42503997227-3e35e0ebf766/app`，BUILD_ID为`djDxAslGhYehozy9oY6Z3`。原数据库ink-memory、54329、目录`/var/lib/ink-memory-admin/postgres`、inode1056781、0700，87条迁移；external_shares表及share capability均缺失。

主机物理内存1685958656字节，可用约530MB，Admin有效MemoryMax1392508928、MemorySwapMax0，主机swap为空、zswap为N。构建沿GitHub Linux runner，ECS保留原完整制品。公网入口为`https://ink-admin.suoxya.com`。

## 采用状态

PR/CI、正常数据库迁移、Actions部署及部署后检查待执行。正常库仅应用已核对的新增0087，先保存Schema、迁移/capability元数据与原配置指纹，保留全部业务数据及原密钥。迁移沿原runner，应用启动保持check-only。发布仅操作Admin。

真实用户内容分享、Web/Native完整交互与真实模型验收保持独立；本记录的合成fixture技术验证与线上只读检查分别列示。
