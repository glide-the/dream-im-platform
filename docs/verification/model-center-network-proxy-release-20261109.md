<!--
[Input] User-authorized automatic publication, exact GitHub Actions release and bounded read-only ECS probes.
[Output] Published commit/build identity, retained data/configuration and current proxy capability evidence.
[Pos] Production deployment receipt; separate from authenticated switch mutation or real-model acceptance.
-->
# 模型中心 Docker NAT 开关发布回执（2026-11-09）

## 发布结果

[PR #48](https://github.com/glide-the/dream-im-platform/pull/48) 已合并，[手动 Actions 发布](https://github.com/glide-the/dream-im-platform/actions/runs/42503997227)已成功。当前服务为 `ink-memory-admin.service`，使用专用 `ink-admin` 用户及原 `pnpm run start:embedded`，未在 ECS 构建。

| 项目 | 当前证据 |
| --- | --- |
| 发布提交 | `3e35e0ebf766e04a818f6142ab6df6cc14a0c3a5` |
| BUILD_ID | `djDxAslGhYehozy9oY6Z3` |
| 当前制品 | `/srv/ink-admin-releases/actions-42503997227-3e35e0ebf766/app` |
| 前一完整制品 | `/srv/ink-admin-releases/actions-42476219452-01139a32191b/app`，保留 |
| 制品清单 | 47005 个文件，SHA256 `6d9510123d141e456aae2a075392e7f228c5b97bf10a9709eb67158f23bee216` |
| 服务 | `active`，MainPID `2705462`，补充检查时 `NRestarts=0` |
| PostgreSQL 目录 | inode `1056781`，发布前后保持一致；发布只执行迁移检查 |
| 交换策略 | swap 禁用，zswap=`N`，`MemorySwapMax=0` |

代理入口核对为服务器现有 `127.0.0.1:17892` Docker NAT 监听。发布前仅在原私有配置追加 `MODEL_EGRESS_PROXY_URL=http://127.0.0.1:17892`，原有字节保留；新制品复制后的私有配置与前一制品一致，权限保持 `0600`。追加前的私有备份保存在服务器 `/var/backups/ink-memory-admin/model-egress-20261108T171004Z/env.local.before`，目录 `0700`、文件 `0600`。

## 验证命令与结果

| 命令或探针 | 退出码 | 关键结果 |
| --- | --- | --- |
| `gh pr checks 48 --watch --interval 15 --fail-fast` | 0 | 确定性检查、迁移历史检查通过；云端 2635 项单测通过、37 项跳过 |
| `gh pr merge 48 --merge --match-head-commit 241869366d0e6cd0fe2aa440975d20ba26f385e6` | 0 | 精确功能提交合并至 main |
| `gh workflow run deploy-admin.yml --ref main` | 0 | 触发上述唯一手动发布运行 |
| `gh run view 42503997227 --json status,conclusion,url,headSha` | 0 | `completed/success`，build/deploy 两个 job 均成功 |
| ECS 版本、配置与目录只读核对 | 0 | commit、BUILD_ID、运行目录、配置和原数据 inode 一致 |
| ECS 本机 HTTP 检查 | 0 | 登录页 200，约30毫秒；匿名网络配置 API 401，约31毫秒 |
| Mac 公网 `curl --max-time 15` | 0 | 登录页 200，约1.16秒；匿名网络配置 API 401，约1.37秒，`ADMIN_AUTH_REQUIRED` |
| 当前制品、运行用户和私有配置下的 Node.js 只读探针 | 0 | 原生产策略读取函数返回 `configured=true`、`desiredEnabled=false`、`effectiveEnabled=false`、`revision=null` |
| 当前制品 `undici.ProxyAgent` 完整价格目录 GET | 0 | HTTP200，5966081字节，235个供应商，1014毫秒 |

一次补充检查从 ECS 访问公网 API 时在十五秒期限读取超时，脚本退出1；随后分别检查本机与 Mac 公网入口均正常，服务 PID 保持不变，没有因此重启服务。`gh run watch` 另遇 GitHub API `unexpected EOF` 而退出1；之后直接读取最终运行状态及完整日志，确认发布成功。两项辅助检查失败没有作为应用故障或发布失败汇报。

## 验收边界

供应商页开关已随上述制品发布，服务器代理能力已配置。当前仍使用默认关闭状态，管理员可在[供应商页面](https://ink-admin.suoxya.com/admin/models/providers)启用。此次没有创建或修改网络策略行，没有操作真实账号、模型调用或价格版本；正常账户下的开关保存和价格同步属于后续可见业务操作。

原工作区和其他任务改动保留。发布提交从独立工作树整理，远端 main 已合并；原工作区未切换分支或重置。实现与组件验证见[原实现回执](model-center-network-proxy-20261109.md)，发布后的事实以本回执为准。
