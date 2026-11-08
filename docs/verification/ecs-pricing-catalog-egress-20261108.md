<!--
[Input] User-reported production pricing-sync failure and authorization to reuse the existing Docker NAT proxy.
[Output] Exact-domain egress change, private rollback location and bounded network verification evidence.
[Pos] ECS network-maintenance receipt; separate from application deployment and authenticated pricing apply.
[Sync] 2026-11-08: route models.dev through the existing ECS Docker NAT proxy without restarting Admin.
-->
# 价格目录ECS出口维护回执（2026-11-08）

## 问题与目标

线上`POST /api/admin/pricing-sync`在北京时间23:38:15、23:38:31和23:42:18返回500。当前价格同步源码将未分类异常统一转换为`ADMIN_INTERNAL_ERROR`，所以页面只显示“The admin service could not complete the request”。使用应用相同Node、运行用户和初始网络环境复现`UND_ERR_CONNECT_TIMEOUT`，耗时10518毫秒，探针退出2。

用户随后要求复用本机Docker NAT代理。本次只为价格目录加入现有出口，保留当前应用制品、数据库与原代理容器。

## 核对对象与变更

- 主机：`root@39.97.252.88`，实例名`iZ2ze9gvp834u057cbobbqZ`。
- Admin：`ink-memory-admin.service`，运行用户`ink-admin`，MainPID `2659668`，启动时间2026-11-08 20:02:25 CST。
- 当前完整制品：`/srv/ink-admin-releases/actions-42476219452-01139a32191b/app`，BUILD_ID `8j55EPjZRN3tSoqU4Ydtl`。
- 应用出口：原`HTTP_PROXY/HTTPS_PROXY`指向`http://127.0.0.1:17891`，Node启用`--use-env-proxy`。
- Tinyproxy原Google/Codex规则已使用`127.0.0.1:17892`，该端口由健康运行约六天的`ink-admin-egress-tun-proxy-1`映射到容器7890端口；配置挂载来自`/opt/ink-admin-egress/config.yaml`。

在`/etc/tinyproxy/tinyproxy.conf`追加：

```conf
# Pricing catalog: use the existing ECS Docker NAT egress.
Upstream http 127.0.0.1:17892 "models.dev"
```

仅执行`systemctl restart ink-admin-egress.service`，随后等待17891端口可连接再检查完整目录。配置保持root所有、原组和0640权限。原Google/Codex规则及其他直连规则保留。

第一次变更后即时探针失败，自动恢复原配置并重启出口，命令退出1；该次仅保留安全失败类型`RuntimeError`，未留存具体curl退出码，不推断为已确认的配置错误。核对原服务已恢复后，第二次加入端口就绪等待并成功，命令退出0。

## 验证证据

| 命令或探针 | 退出码 | 关键结果 |
| --- | --- | --- |
| ECS直接`curl --max-time 18 --noproxy '*' https://models.dev/api.json` | 28 | HTTP200后下载未完成，仅335818／5966066字节 |
| 修改前经Tinyproxy的`curl --proxy http://127.0.0.1:17891 --max-time 15` | 28 | 仅93770／5966066字节，十五秒超时 |
| 直接经现有Docker NAT的`curl --proxy http://127.0.0.1:17892 --max-time 15` | 0 | HTTP200，完整5966066字节，1.254874秒 |
| 添加规则后经17891的完整GET与JSON解析 | 0 | 完整5966066字节、235个Provider，2.327秒 |
| 添加规则后以`ink-admin`、应用相同Node及网络环境执行相同`fetch`选项，十五秒总期限 | 0 | HTTP200，完整5966066字节、235个Provider，852毫秒 |
| `systemctl show ink-memory-admin.service` | 0 | active，MainPID及启动时间保持原值 |
| `curl http://127.0.0.1:3000/admin/login` | 0 | HTTP200 |

完整目录探针使用与应用相同的`Accept-Encoding: identity`、user agent及十五秒期限，读取完整正文并解析JSON，只输出字节数、Provider数量、耗时和安全错误类别。探针不调用模型，不发送账户凭证。

成功变更的配置摘要：

- 原SHA256：`aafd55e278527ca9a999dcf5bcc0db0309e1ae12b841461644a1c573f5115c35`。
- 新SHA256：`e8c71defaa85ca28b81f95a9b8a2bb371fb14e64215c11a7208450f7bc61de18`。
- 原配置及安全回执保存在服务器`/var/backups/ink-memory-admin/pricing-egress-20261108T155719Z/`，目录0700，文件0600；原配置文件名为`tinyproxy.conf.before`。
- 首次回退的原配置另保留在`/var/backups/ink-memory-admin/pricing-egress-20261108T155637Z/`。

## 范围与后续验收

网络修复已生效，Admin原进程及其数据库生命周期保持。本次没有应用发布、数据库写入、价格版本应用、账户会话创建或代理容器重建。未代替真实账户执行页面同步与差异确认；上述证据证明应用相同网络请求能够完整获取目录。历史文件复制、Google登录与真实模型调用分别验收。

本地文档校验：Python检查本次六份Markdown的121个本地链接，缺失路径0；新增回执已登记到文档索引与verification目录合同。链接检查及具名文档的`git diff --check`均退出0。本次未修改应用代码。
