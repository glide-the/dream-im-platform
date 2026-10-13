<!-- [Input] Reviewed Image design, implemented source, current migration history, Luna receipts, isolated PostgreSQL/Chrome receipts, and full regression output. -->
<!-- [Output] Implementation map, correction history, tiered validation evidence, cleanup, and remaining real-provider gates. -->
<!-- [Pos] Current Image Model Center implementation receipt; isolated evidence never stands in for normal-database or real-model acceptance. -->
<!-- [Sync] 2026-10-09: record the completed implementation and current validation boundary. -->
<!-- [Sync] 2026-10-09: add the normal-environment read-only readiness audit without exposing identities or credentials. -->
<!-- [Sync] 2026-10-09: record the backed-up normal-database migration and Admin configuration while keeping real-provider acceptance pending. -->
<!-- [Sync] 2026-10-09: record the real Codex generation/edit, settlement, safe Admin trace, and subscription timestamp fix. -->
<!-- [Sync] 2026-10-09: record the final read-only gate audit and reject public estimates as managed reservation upper bounds. -->
<!-- [Sync] 2026-10-09: record terminal blocked status after repeated external-gate audits. -->
<!-- [Sync] 2026-10-09: record the completion-audit fixes, provenance gate, and final isolated recovery E2E. -->
<!-- [Sync] 2026-10-09: enforce and test the Provider-matched Image pricing basis without a schema change. -->
<!-- [Sync] 2026-10-10: resume acceptance and correct platform settlement versus optional upstream price references. -->
<!-- [Sync] 2026-10-10: record the independent center, final current-source Luna receipts and fresh normal-account Codex acceptance. -->
# Image 模型中心实现与验证回执

> 日志与计费归属已在后续修正：现行 Image 中心只有配置，旧请求页跳转已有 Gateway 日志；本次新回执见[职责修正](image-model-center-module-boundaries-20261010.md)。下文保留原交付时的实际实现与验收，不代表请求入口仍在本中心。

## 0. 上轮交付回执（2026-10-10）

本节保留上轮交付状态。后续Provider摘要移除和models.dev价格同步的当前状态见[本次增量回执](image-model-center-pricing-sync-20261010.md)，不得用本节旧命令替代新验证。后面的早期命令、失败和真实调用也是历史记录，其中已撤销的来源门禁不再构成产品规则。

最终目标工具回执：既有任务 `01a120ae-3bb0-7432-88a2-4755ecb4275a`、`status=complete`；全部当前完成条件闭合后才更新。目标累计时间2996秒（约50分钟），未设置Token预算。真实OpenAI状态仍为未验收，不是“所有真实提供商都通过”。

### 0.1 页面归属与修订

AI 模型中心和 Image 模型中心已成为并列入口，后者使用 `/admin/image-models/**`，内部只有 Provider、Models、Pricing 三栏；请求记录为辅助入口。新增、编辑、价格替换、授权成功和返回都留在 Image 中心。原 `/admin/models/images?view=...` 只兼容重定向。两者复用相同 Provider/模型/价格 API、RBAC、表单、注册表和账本，没有第二套管理框架、新业务表、任务队列或环境分支。

实际稿复审及本轮执行发现并修正：隐藏金额控件导致价格提交400、nullable价格误转0、Image Provider可选Anthropic/marker可删、隐藏能力丢失混合文本配置风险。修订仅改变展示范围和共享序列化；全量字段值、整数金额、null与显式0均保留。PRD和正式设计更新前的完整原文分别归档。

### 0.2 最新静态、单元、回归与构建

以下均由既有 `luna_test_runner` 对最后一次功能修正后的源码执行，不使用旧回执代替：

| 命令 | 退出码 | 关键输出和覆盖 |
| --- | ---: | --- |
| `pnpm exec tsc --noEmit` | 0 | 无类型错误 |
| 定向 `pnpm exec eslint`（独立Image全路由、共享中心/表单、导航、注册表、价格、Provider面板、resources、E2E、AdminResourceManager） | 0 | 无error/warning；具体可复执行命令见下 |
| `pnpm exec vitest run app/components/admin/AdminModulePage.test.ts app/components/admin/AdminResourceManager.test.ts app/lib/admin/provider-resources.test.ts app/components/admin/ProviderManagedAuthPanel.test.ts` | 0 | 4files、33/33tests；三栏、隐藏字段保留、null/0金额、Provider规范化和服务端资源 |
| `pnpm test:run` | 0 | 312passed、18skipped files；2302passed、37skipped tests；0failed，127.82s；integration suites由仓库脚本排除 |
| `pnpm lint` | 0 | 全仓ESLint无错误 |
| `INK_ADMIN_E2E_DIST_DIR=.next-e2e-image-independent-center-build pnpm build` | 0 | DB包与Next production build成功；独立Image全部路由及两个Images入口生成；只清理具名产物且确认不存在 |

上轮实际定向静态命令覆盖的文件集（历史原样保留；其中ImageProviderReadiness已在后续删除，不是当前可复执行命令）：

```bash
pnpm exec eslint 'app/(admin)/admin/(workspace)/image-models' \
  'app/(admin)/admin/(workspace)/models' \
  'app/(admin)/admin/(workspace)/_components/AdminNavigation.tsx' \
  app/components/admin/AdminModulePage.tsx app/components/admin/AdminModulePage.test.ts \
  app/components/admin/ImageModelCenterPage.tsx app/components/admin/ImageProviderReadiness.tsx \
  app/components/admin/ProviderFormPage.tsx app/components/admin/ModelFormPage.tsx \
  app/components/admin/AdminResourceFormPage.tsx app/components/admin/AdminResourceManager.tsx \
  app/components/admin/AdminResourceManager.test.ts app/components/admin/AIProviderRegistry.tsx \
  app/components/admin/AIModelRegistry.tsx app/components/admin/AIPricingTimeline.tsx \
  app/components/admin/PricingVersionFormPage.tsx app/components/admin/ProviderManagedAuthPanel.tsx \
  app/components/admin/ProviderManagedAuthPanel.test.ts app/lib/admin/resources.ts \
  tests/e2e/image-model-center.spec.ts
```

### 0.3 全新隔离 PostgreSQL/Chrome 完整流程

主执行者用 `node --import tsx scripts/prepare-gateway-deadlock-postgres.mjs` 准备具名可删除数据库 `ink_gateway_deadlock_test_ec99b829cb1b{,_ui}`，端口61225；前向迁移79/79。Luna执行：

```bash
node scripts/verify-image-model-center-e2e.mjs /var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-iz9q1l/fixture.json
```

exit0，已安装Chrome/Playwright `1 passed (53.9s)`。通过公开Admin/Gateway入口覆盖：独立Provider→手工与预设OpenAI marker→模型保存/本中心返回→无来源平台价格/替换→generation-only的null输入价与0输出价→套餐/授权→生成→参考图及mask编辑→完整图结果→真实形状usage/平台费用/Token账本→请求详情/筛选。还覆盖权限拒绝、模型停用、输入拒绝、上游失败、非2xx可信usage、无图、usage缺失、重复不重派发、取消、新幂等键重试、known/unknown恢复、报表未知数量、零payload/禁止揭示、桌面与390px窄屏、AI三栏和旧链接重定向。fake只提供上游协议，不是任何真实模型验收。

主执行者已目视查看本轮两个截图：桌面明确有并列AI/Image各三栏；390px页面无整页横向溢出。截图位于本回执4.3所列同名路径，当前文件是本轮成功复跑产物。

失败没有被抹掉：第一轮旧标签断言失败；提取共享表单后源码测试假设失效；价格表单实际400；改正后重用固定账户fixture触发409 `SUBSCRIPTION_ALREADY_CALLABLE`，属于harness数据污染且尚未进入Images，不是产品缺陷。前三项相应修订，最后一项更换全新fixture，以上exit0是最终完整复跑。

### 0.4 本轮正常账户真实 Codex 验收

本机正常Admin/Gateway（3000）和真实PostgreSQL（54329），使用现有 `Codex Dream Live E2E`、`codex-main`、`codex-gpt-image-2`、Free v7订阅；没有clone、影子订阅或隔离账本。生成和编辑发生于2026-10-10 00:26（UTC起止16:26:23.945–16:26:56.762），在来源语义修正后、页面归属修正前；之后只改管理展示/表单，没有再次改变Images协议或结算算法。页面修正后，公开Admin详情/Token流水及新Image请求记录再次核对了下列实际事实。因此它是本轮Gateway真实验收，不冒充新页面E2E。

| 事实 | generation | edit（使用刚生成图作参考） |
| --- | --- | --- |
| request ID | `req_9df2e7bce8d74fd1a5a0940ae457aab4` | `req_5299301c0ae74404866d78cf412a035c` |
| HTTP/持久状态 | 200、settled/succeeded | 200、settled/succeeded |
| 完整PNG结果 | 1,015,431bytes | 1,420,161bytes |
| 实际text input/image input/image output | 16/0/515 | 30/1521/515 |
| total Token | 531 | 2066 |
| 平台基础金额micro-USD | 7765 | 13884 |
| 调用方收费micro-USD | 0（Token订阅覆盖） | 0（Token订阅覆盖） |
| Token reserve/capture/release | 120052/531/119521 | 124858/2066/122792 |
| 最终冻结额度 | 0 | 0 |

两次冻结的价格版本为 `price_5a39d67e2cd54808af2021155f434171`：text input=2500000、image input=4000000、image output=15000000 micro-USD/1M Token；text output/cache=0。平台基础金额可独立复算：16×2.5+515×15=7765；30×2.5+1521×4+515×15=13884。它不是Codex逐请求美元账单。

公开Admin `GET` 两条请求详情与Token流水均HTTP200；浏览器可见实际Token、价格快照、平台基础金额、调用方收费和安全summary。只读 `node --input-type=module`/`pg`核验exit0：两次请求的request payload、response payload、events均0行，capture=`policy_disabled`；正常库19432条请求，迁移前19428条，operation缺失0。第一次诊断误读不存在的`.env`返回exit1；改读项目实际`.env.local`后exit0，未输出DSN/Secret，没有修改正常库。

一次预检携带Codex不支持的output_format，得到400 `CODEX_IMAGE_OPTION_UNSUPPORTED`，派发前拒绝；移除该选项才执行上述两次真实调用。验收key只含models:list/images:create且限时1h，明文仅在浏览器内存；调用完成后公开Admin revoke HTTP200，内存结果/明文已清除。正常请求和Token记录保留供复核。

### 0.5 未验证与最终边界

真实OpenAI尚无官方Provider/服务器凭据，未执行generation/edit；需要正常Admin配置官方连接和服务器Secret后才能获得真实回执。Codex故障注入、外部网络中断后的自然恢复、0078锁时长和破坏性备份恢复未做真实环境验证。确定性故障/恢复由单元和隔离流程证明；integration suites的其余独立合同没有因为unit通过而宣称通过。本轮不修改Claude主循环或IM消费者，也不声称已完成消费者端到端接线。

### 0.6 本轮清理与正常服务保留

最新fixture由主执行者向自有session81556发送换行，原harness完成关闭和清理，exit0，输出 `cleanup=owned PostgreSQL cluster and private fixture removed`。`test ! -e /var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-iz9q1l` exit0；`lsof -nP -iTCP:61225 -sTCP:LISTEN` exit1且无输出，确认隔离端口已释放。Luna只关闭其E2E Admin/fake进程与具名dist；正常3000/54329未停止。

两套更早的本轮失败fixture已关闭各自进程，残留私密目录仅可恢复地移动至 `/Users/dmeck/.Trash/ink-admin-image-fixture-8oK1A3` 与 `/Users/dmeck/.Trash/ink-admin-image-fixture-0nXq1Z`，没有清空Trash或移除真实业务记录。正常只读smoke `curl -s -o /dev/null -w '%{http_code}\\n' http://localhost:3000/admin/image-models/models` exit0/HTTP307（无Session的登录重定向）；`lsof -nP -iTCP:54329 -sTCP:LISTEN` exit0，正常PostgreSQL仍运行。已登录Chrome实际显示独立Image三栏、现有启用模型和当前请求详情。

### 0.7 最终独立复审与文档检查

独立执行者基于落盘PRD、正式设计、源码和实际回执最终复审通过，无残余P0/P1、无过度设计。两处P2只涉及源码行号和图数量，已校正，不更改功能。Luna重新执行0.2完整定向ESLint命令exit0、`git diff --check` exit0；窄范围Markdown inventory/link检查exit0，8个显式目标全部存在、28个Markdown、81本地引用、missing0。两份历史原文归档另行补查exit0。随后仅追加回执/目标状态和校正引用文字，不改本地链接目标。

<details>
<summary>本次实际Markdown检查命令</summary>

```bash
node --input-type=module <<'NODE'
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
const root = process.cwd();
const explicit = [
  'docs/README.md', 'docs/design/image-model-center.md', 'docs/design/.folder.md',
  'docs/prd/image-model-center/README.md',
  'docs/verification/image-model-center-investigation.md',
  'docs/verification/image-model-center-design-review.md',
  'docs/verification/image-model-center-implementation.md',
  'docs/task/image-model-center-plan.md',
];
const folderDirs = [
  'app/(admin)/admin/(workspace)/image-models', 'app/(admin)/admin/(workspace)/models',
  'app/(admin)/admin/(workspace)/_components', 'app/components/admin',
  'app/lib/admin', 'app/lib/billing', 'app/lib/db', 'app/lib/gateway',
  'app/lib/models', 'app/lib/providers', 'app/lib/subscriptions', 'app/v1', 'config',
  'docs/prd/image-model-center', 'docs/task', 'docs/verification', 'drizzle',
  'packages/db/src/schema', 'scripts', 'tests/e2e',
];
const files = new Set(explicit.filter((p) => existsSync(join(root, p))));
const archiveInventory = [];
function walkFolderDocs(relDir) {
  const absDir = join(root, relDir);
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    const rel = join(relDir, name);
    const abs = join(root, rel);
    const st = statSync(abs);
    if (st.isDirectory()) walkFolderDocs(rel);
    else if (name === '.folder.md') files.add(rel);
  }
}
for (const dir of folderDirs) walkFolderDocs(dir);
const archiveDir = join(root, 'docs/prd/image-model-center');
if (existsSync(archiveDir)) {
  for (const name of readdirSync(archiveDir)) {
    if (/archive|history|原文/i.test(name)) archiveInventory.push(join('docs/prd/image-model-center', name));
  }
}
const inventoryMissing = explicit.filter((p) => !existsSync(join(root, p)));
const refs = [];
for (const rel of [...files].sort()) {
  const text = await readFile(join(root, rel), 'utf8');
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(text))) {
    let raw = match[1].trim().replace(/^<|>$/g, '');
    if (!raw || raw.startsWith('#') || /^(?:[a-z]+:)?\/\//i.test(raw) || /^mailto:/i.test(raw)) continue;
    raw = decodeURIComponent(raw.split('#')[0].split('?')[0]).replace(/:\d+$/, '');
    if (!raw) continue;
    const candidate = raw.startsWith('/Users/') ? raw
      : raw.startsWith('/') ? resolve(root, `.${raw}`) : resolve(root, dirname(rel), raw);
    const candidates = [candidate];
    if (!extname(candidate)) candidates.push(`${candidate}.md`, join(candidate, 'README.md'), join(candidate, 'index.md'));
    refs.push({ source: rel, target: raw, ok: candidates.some((p) => existsSync(p)) });
  }
}
const missing = refs.filter((r) => !r.ok);
console.log(JSON.stringify({
  explicitInventoryCount: explicit.length, explicitMissing: inventoryMissing,
  archivedInventoryEntries: archiveInventory, scannedMarkdownFiles: files.size,
  localLinkReferences: refs.length, missingLocalLinks: missing,
  folderDocs: [...files].filter((p) => p.endsWith('.folder.md')).sort(),
}, null, 2));
process.exitCode = inventoryMissing.length || missing.length ? 1 : 0;
NODE
node --input-type=module -e "import { existsSync } from 'node:fs'; const paths=['docs/prd/image-model-center/history-20261010.md','docs/design/image-model-center.history-20261010.md']; const result=Object.fromEntries(paths.map(p=>[p,existsSync(p)])); console.log(JSON.stringify(result)); process.exitCode=Object.values(result).every(Boolean)?0:1;"
```

</details>

## 早期实现与回执（历史）

## 1. 处理结论

Image 模型中心已按评审后的最小方案实现：继续使用现有 Provider、模型、价格版本、Gateway Key/runtime delegation、Subscription/Permission、请求生命周期、Token allowance、账本和 Admin 页面框架；新增两个独立 Images 路由及 Codex/OpenAI 协议适配，没有创建 Image 业务表、图片资产中心、后台任务、独立账本、自动 failover 或文本协议分支。

技术实现与隔离业务流程已经通过。正常业务 PostgreSQL 已在可恢复备份后执行 `0078`，当前为 `79/79`；此前配置的 Codex `gpt-image-2` 曾通过正常 Admin/Gateway 入口各完成一次 generation 和 edit，真实 usage、Token allowance、Admin 平台价格结算与安全请求记录均已落入正常数据库并可在 Admin 查看。该平台价格数值参考了 OpenAI API 美元价，但只代表 Admin 面向调用方的结算价格，不代表 Codex 上游逐请求账单。2026-10-10 已撤销预留来源、Provider 合同引用和 credit→USD 的运行门槛；来源信息只作可选审计。真实 OpenAI 仍因没有官方 OpenAI Provider/服务器侧凭据而未执行，不能用现有腾讯 Provider 或隔离 fake 上游替代。

## 2. 实现范围

| 范围 | 实现 |
| --- | --- |
| Admin | 当前 `/admin/image-models/**` 为独立Provider/Models/Pricing，复用模型卡、价格时间线和Gateway请求详情；原嵌套路径只重定向；本轮证据见0节 |
| Provider | Codex registry 拥有 Image endpoints/headers；OpenAI generic Provider 必须显式 `config.imageApi.kind=openai` |
| 模型与价格 | 复用 `ai_models` 与 revisioned `ai_pricing_rules`；增加 generation/edit 能力、每图预留 budget、图片输入/输出 Token 平台单价；metadata/source/ref/version 与 `source_metadata.imagePricingBasis` 只保存可选审计依据 |
| Gateway | `POST /v1/images/generations` 接收严格 JSON；`POST /v1/images/edits` 接收并重建严格 multipart；不经过 Messages/Chat adapter |
| 计费 | 按上游 text-input、image-input、image-output Token 明细和 Admin 请求价格快照结算；禁止按图片数或虚构 Token 计费；内部 `provider_cost` 是 markup/discount 前的平台基础金额，不代表真实上游账单 |
| 恢复 | 已知 usage 的结算失败只重做幂等结算；未知 usage 在 grace 后保守消费 reservation 并转为 settled，实际 usage/provider cost 保持未知；不重发 Provider |
| 安全记录 | 保存 operation、用量、费用、输出数量/格式和安全 request ID；Image payload 写入与 Admin 读取两侧都 fail closed |
| Schema | 新增前向 `0078_absent_puppet_master.sql` 和 `gateway.images.v1` capability；无 runtime DDL、SQLite/JSON/内存回退 |

## 3. 实现中发现并修订的问题

1. 初版直接扩展共享 delegation 输出 enum，完整回归发现三个冻结 Dream operation 的 schema/hash 变化。修订后，通用 runtime delegation 可显式申请 `images:create`，历史 claim-turn/task-result 使用冻结 DTO，自动授权范围不扩大。
2. OpenAI Images 的 `output_tokens_details` 实际可缺省。parser 改为缺省时把全部 output Token 解释为 image output；字段存在时仍校验明细总量且拒绝非零 text output。
3. 初版空/无效图片结果会丢失同时返回的可信 usage。现按可信实际 usage 结算失败请求；只有 usage 缺失或矛盾才进入 unknown 分支。
4. 初版 base64 只检查非空，第二版只检查 magic bytes。最终在有界字节/像素内用 `sharp` 完整解码 PNG/JPEG/WebP，拒绝截断、损坏和多帧图片；不把完整图片复制进日志或持久化。
5. multipart/上游响应的无声明 chunked body 可能绕过简单 `content-length` 检查。现使用共享 bounded stream reader 限制实际读取字节。
6. 隔离 E2E 首次在截图和断言完成后被 fake HTTP keep-alive 卡住；增加测试自有连接关闭后复跑通过。该次失败属于 harness 清理，不作为产品通过证据。
7. 完整回归首次暴露冻结合同和三个旧测试夹具问题；均修订后重新执行完整套件通过，没有通过更新旧 Dream hash 或放宽生产校验来规避失败。
8. 带 mask 的最终隔离 E2E 已完成全部 API、结算和请求记录断言，但同路径 `?view=requests`→`?view=models` 的 Next 开发态切换仍处于 Rendering 时，原 5 秒可见性断言先超时。测试改为先等待目标 URL/栏目 heading，再检查模型卡；保留该次 exit 1，并以修订后的完整复跑为最终证据。
9. 正常业务验收首次排队 Free v7 时触发 `SUBSCRIPTION_STATE_CONFLICT`：PostgreSQL 周期边界保留微秒，而非续期 action 把同一时间经 JavaScript `Date` 毫秒精度往返后重新写入，被不可变 trigger 识别为边界变化。修订后，upgrade/downgrade/pause/resume/cancel 等非续期写入让 PostgreSQL 原样保留 period start/end/number，只有 renew 推进周期；新增 focused unit 并重新通过 typecheck、lint、production build。未通过直写 SQL 绕过领域规则。
10. 完成度复核发现 dispatch 前取消、非 2xx usage、完整 capture、未知成本展示、Provider/日期筛选、OpenAI preset marker 和 Image readiness 均有缺口；逐项修正后新增 handler/transport/资源/E2E 覆盖。
11. 完成度复核一度错误地把 Codex reservation/价格来源证据和 credit→USD 当作 runtime 前置。2026-10-10 已修正：数值 reservation budget 与有效 Admin 平台分项价格决定 readiness；来源 ref/version/basis 为可选审计三元组，缺失不阻断；Codex included usage 不换算逐请求美元。
12. 最终隔离 E2E 先后暴露并修复 conservative recovery 状态未转 settled、已知失败缺 `usageKnown`、Provider 预设默认 `usageSource` 为空以及 fake 缺 `/models` 目录。增加来源门禁负例后，首轮 fresh fixture 又发现两个测试模型复用了 `(provider_id, upstream_model)` 唯一键；改用独立 upstream model 后，由 Luna 在另一套全新隔离数据库完整复跑通过。该 `409` 是 harness 数据前置冲突，没有作为产品失败或通过证据。

## 4. 验证证据

### 4.1 文档与合同

| 命令/检查 | 退出码 | 结果 |
| --- | ---: | --- |
| Markdown inventory 与本地链接检查（pricing basis 最终复验） | 0 | 当前 inventory 238 个 Markdown；28 个变更 Markdown 的 85 个本地引用、0 缺失 |
| Markdown inventory 与本地链接检查（外部门禁最终只读复核） | 0 | 当前 inventory 238 个 Markdown；26 个变更 Markdown 的 85 个本地引用、0 缺失 |
| `git diff --check` | 0 | 无空白错误 |
| Runtime delegation artifact 与源码完整结构比对 | 0 | 4/4 contract、requirements、capability 与 SHA 同步；冻结 Dream operation 回归通过 |

### 4.2 确定性静态与单元/回归

| 命令 | 退出码 | 关键输出 |
| --- | ---: | --- |
| `pnpm exec tsc --noEmit`（最终 Luna） | 0 | TypeScript 通过 |
| `pnpm lint`（最终 Luna） | 0 | ESLint 通过 |
| Image/计费/安全/冻结合同 focused Vitest（最终 Luna） | 0 | 12 files，82/82 tests，1.99 秒 |
| `pnpm test:run`（修订前） | 1 | 327 files 中 26 failed；2324 tests 中 27 failed，准确暴露冻结合同/夹具问题，不作为通过证据 |
| `pnpm test:run`（Image 实现修订后，真实验收前） | 0 | 309 passed、18 skipped files；2287 passed、37 skipped tests，188.69 秒 |
| `pnpm build` | 0 | DB package 与 Next production build 通过；产物包含 Image Admin 与两个 Images routes |
| `pnpm exec vitest run app/lib/subscriptions/service.test.ts`（真实验收修复后，Luna） | 0 | 1 file、5/5 tests；覆盖非 renew 保留 PostgreSQL period 边界 |
| `pnpm exec tsc --noEmit`（修复后，Luna） | 0 | 无类型错误 |
| `pnpm exec eslint app/lib/subscriptions/service.ts app/lib/subscriptions/service.test.ts`（修复后，Luna） | 0 | 无 lint 错误 |
| `pnpm build`（修复后，Luna） | 0 | DB package 与 Next production build 通过；Image Admin/两条 routes 仍生成 |
| `pnpm test:run`（订阅修复后 fresh Luna） | 0 | 309 passed、18 skipped files；2288 passed、37 skipped tests，140.36 秒；integration suites 由脚本按合同排除 |
| `pnpm test:run`（最终 Luna） | 0 | 311 passed、18 skipped files；2295 passed、37 skipped tests，151.91 秒；integration suites 由脚本按合同排除 |
| `INK_ADMIN_E2E_DIST_DIR=.next-e2e-image-final-build pnpm build`（最终 Luna） | 0 | 独立产物目录 production build 通过，Image Admin 与两条 Images routes 均生成；随后只清理该具名目录并确认不存在 |
| `pnpm exec tsc --noEmit`（Codex credit 来源修订，Luna） | 0 | 无类型错误 |
| `pnpm exec eslint app/components/admin/AdminResourceViews.tsx app/components/admin/PricingVersionFormPage.tsx`（Luna） | 0 | OpenAI API USD / Codex credit→USD 提示无 lint 错误 |
| `pnpm exec vitest run app/components/admin/AdminModulePage.test.ts`（Luna） | 0 | 1 file、1/1 test，153ms |
| `pnpm exec tsc --noEmit`（pricing basis 最终 Luna） | 0 | 无类型错误 |
| 定向 ESLint（pricing basis 最终 Luna） | 0 | 新增 billing contract、Admin mutation/readiness、Resolver、价格表单/时间线与 E2E 无 lint 错误 |
| pricing basis focused Vitest（最终 Luna） | 0 | 4 files、17/17 tests，582ms；覆盖序列化、readiness SQL 与 OpenAI/Codex basis 纯函数 |
| `pnpm test:run`（pricing basis 最终 Luna） | 0 | 312 passed、18 skipped files；2297 passed、37 skipped tests，147.59 秒；integration suites 由脚本按合同排除 |
| `INK_ADMIN_E2E_DIST_DIR=.next-e2e-image-pricing-basis-build pnpm build`（最终 Luna） | 0 | DB package 与 Next production build 通过；Image Admin/两条 Images routes 均生成；仅删除具名构建目录并确认不存在 |

最终 focused 命令为：

```bash
pnpm exec vitest run app/lib/gateway/image-protocols.test.ts app/lib/gateway/image-handler.test.ts app/lib/gateway/image-transport.test.ts app/lib/gateway/request-body.test.ts app/lib/gateway/settlement-worker.test.ts app/lib/admin/provider-resources.test.ts app/lib/admin/gateway-payloads.test.ts app/lib/db/image-api-schema-contract.test.ts app/lib/billing/money.test.ts app/lib/billing/repository.test.ts app/lib/gateway/models.test.ts app/lib/providers/registry.test.ts
```

### 4.3 隔离 PostgreSQL 与 Chrome 业务流程

命令：

```bash
node scripts/verify-image-model-center-e2e.mjs /var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-TNdaJd/fixture.json
```

Luna 回执为退出码 0，Playwright/Chrome `1 passed (54.9s)`。wrapper 在明确命名的隔离 PostgreSQL 中从 `0000` 前向应用到 `0078`，状态为 `79/79 current`、`pending=[]`，然后走公开 Admin/Gateway 入口完成：OpenAI preset/显式 marker → Image 模型/reservation 与依据 → Image 价格/合同来源 → Subscription/Permission/Key → models discovery → generation → 带 mask 的 multipart edit（预留 `estimated_tokens=213`）→ 结果校验 → 实际用量/费用结算 → 安全请求详情。

结构化 pricing basis 修订后，主执行者重新创建全新具名隔离 PostgreSQL，Luna 再执行同一 wrapper，退出码 `0`、Chrome/Playwright `1 passed (59.0s)`。该轮新增证明 active Image 价格缺 `imagePricingBasis` 会被拒绝、OpenAI Provider 选择 `codex_managed_usd_contract` 会被拒绝、正确 `openai_api_usd` 会进入既有不可变 `source_metadata` 并通过 Gateway Resolver；随后仅清理该轮数据库、进程、端口和私密 fixture，正常服务未参与。

同一流程覆盖未认证、缺 scope、模型停用、缺来源价格、无效 edit、上游失败、带可靠 usage 的非 2xx、可靠 usage 但无图、实际 usage 超过 reservation 后的 settlement recovery、未知 usage 的 conservative recovery、取消、新 key 重试、重复请求不重发、模型/价格真实表单、Provider/时间请求视图、payload 表无正文且读取 API 返回 403。fake OpenAI 只承担确定性协议夹具，不代表真实 OpenAI/Codex。

截图：

- `test-results/image-model-center/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/image-request-detail-1440x1000.png`
- `test-results/image-model-center/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/image-model-center-390x844.png`

主执行者已目视检查桌面请求详情与 390px Image 模型列表；未见横向溢出或正文泄漏。

### 4.4 清理与不影响证明

- E2E 只关闭本轮 fake upstream、Admin 进程、具名数据库 `ink_gateway_deadlock_test_324794f591dd{,_ui}` 和 fixture；最终确认 fixture 目录不存在、端口 53310 不再监听，回执为 `cleanup=owned PostgreSQL cluster and private fixture removed`。
- 隔离验证没有停止或修改本机既有 3000 端口服务；正常发布阶段随后按明确范围重启了仓库自有 Admin/embedded PostgreSQL，使已构建的 Image routes 和 migration 生效。
- 正常库执行前向 `0078`、新增 Codex Image 模型/价格、Free v7 与五项权益；随后只把既有 `Codex Dream Live E2E` 订阅排队到 Free v7 并在已过期边界续期，创建一个仅含 `models:list`/`images:create` 的固定用户验收 Key，并保留本轮两条 Image 请求及其正常 Token 流水供复核。没有修改 Provider 凭据、主账户订阅、历史正文或无关账本。
- 创建正常库备份后才执行 migration；备份目录和文件权限分别为 `0700`/`0600`，`pg_restore --list` 可读，未做破坏性恢复演练。

### 4.5 正常业务 Codex 历史真实模型回执

在最终来源门禁加入前，通过已登录的正常 Admin 创建固定用户 Gateway Key；明文仅存在于一次性回执和浏览器内存，调用完成后离开回执页，未进入终端、模型上下文、日志或文档。随后通过正常 Admin API 对既有验收订阅执行 upgrade + renew，并通过正常 `localhost:3000` Gateway 各调用一次真实 Codex generation 和 edit。浏览器只回收安全摘要，图片 base64 和参考图始终留在内存中。该回执证明真实传输、结果、usage、Token allowance 和安全记录，不证明手工价格等于 Codex managed backend 的账单合同。

| 步骤 | 回执 | 结果 |
| --- | --- | --- |
| Admin `POST .../upgrade` | HTTP 200，request ID `admin_47a270331d4b42aab7fec407afee3d1f` | 非续期周期边界不再触发微秒精度冲突，subscription version 2 |
| Admin `POST .../renew` | HTTP 200，request ID `admin_7cebf512c2894fa782678a38318f45f0` | subscription version 3、Free v7、period 2、100,000,000 Token allowance |
| `POST /v1/images/generations` | HTTP 200，request ID `req_06bf570365134d298a23c756ad7935f0` | 1 张 PNG，1,021,829 bytes；17 text input + 515 image output = 532 tokens |
| `POST /v1/images/edits` | HTTP 200，request ID `req_01234b7c5382478bb91e0597a4feae9c` | 1 张 PNG，1,389,637 bytes；29 text input + 1,521 image input + 515 image output = 2,065 tokens |

正常 PostgreSQL 只读核验命令使用 `node --input-type=module` + `pg`，只输出上述 request/usage/price/ledger 安全字段，退出码 0。结果：

- 两条请求均为 `status=settled`、`outcome=succeeded`、HTTP 200、`usageKnown=true`、Provider=`codex-main`、model=`codex-gpt-image-2`。
- generation 的应用计算字段为 `7,768` micro-USD；edit 为 `13,882` micro-USD。它们来自当时手工价格快照（text input `2,500,000`、image input `4,000,000`、image output `15,000,000` micro-USD / 1M Token），不是已核验的 Codex 上游账单金额。
- 订阅覆盖模式为 `token_allowance`，因此调用方 charged 为 0；Token 流水各有 reserve → actual capture → unused release，最终 allowance `reserved=0`、`consumed=2,597`。
- `gateway_request_payloads` 对两条 request 都是 0 行，`payload_capture_status=policy_disabled`；Admin 请求详情明确显示“图像请求按策略永久关闭报文捕获”，只展示安全 summary、用量、价格快照、成本、状态和 upstream request ID。
- Gateway Key 仅保存前缀/哈希并更新 `last_used_at`；scope 精确为 `models:list`、`images:create`，未授予文本调用权限。

Admin 页面已目视核验 edit 请求详情：operation=`images.edits`、settled/succeeded、usage known、四类 Token、三类有效价格、Provider cost 和安全 response summary 均可见，Prompt、参考图和结果图不可见。

## 5. 未验证与必要条件

### 5.1 正常环境发布与配置回执

正常数据库迁移前已创建自包含 custom-format 备份：

- 路径：`.ink-memory/backups/0078-20261009T141349Z-PpvaSw/ink-memory-before-0078.dump`
- 大小：`1,303,004,569` bytes；`pg_restore --list` 为 `1308` 条目录项。
- SHA-256：`330cf4e35b28336eaa2a08b00007f67bd534288a03aa7e4b36bf449ccc99798b`。
- 回执：`.ink-memory/backups/0078-20261009T141349Z-PpvaSw/receipt.json`；备份文件和回执均为 `0600`。

迁移命令通过显式子进程把正常 `DATABASE_URL` 绑定为 `MIGRATION_DATABASE_URL`，未打印 DSN：

```bash
pnpm db:migrate
pnpm db:migrate:check
```

两者退出码均为 0；最终 `status=current`、`appliedCount=79`、`targetCount=79`、`pendingTags=[]`、最新 migration 为 `0078_absent_puppet_master`。只读 capability 核验得到：

真实验收结束后的直接 `pnpm db:migrate:check` 返回 exit 1，因为正常 `start:embedded` 正在持有同一数据目录 PID；按 harness 合同没有停止正常服务，也没有把它判为 schema 失败。随后由 Node 子进程把现有 `DATABASE_URL` 仅作为未打印的 `MIGRATION_DATABASE_URL` 传入同一 runner，exit 0，仍为 `79/79 current`、`pendingTags=[]`、latest=`0078_absent_puppet_master`。

- `gateway.images.v1`，version `1`。
- contract SHA-256 `073808fc6d828d46266d35ee4d7649477dddddb0e8f0e40351f34d52137b4eed`。
- metadata 明确 providers=`codex/openai`、operations=`images.generations/images.edits`、usage unit=`provider-image-tokens`、payload capture=`disabled`。

通过正常 Admin 页面完成并可见核验：

- `codex-main` 下存在 `codex-gpt-image-2`，上游模型 `gpt-image-2`，generation/edit 能力和手工 reservation budget 已保存；`imageReservationSource` 为空只表示依据未记录，不影响 readiness。
- 平台价格为 text input `$2.50/M`、image input `$4/M`、image output `$15/M`，output text `$0`；记录来源为 `manual`，这是有效的 Admin 平台价格。数值参考 OpenAI API 价，但不代表 Codex 上游逐请求收费。
- Free v7 已发布，月度额度保持 `100,000,000` Token；五项权益包括原有四个文本模型和一个仅授予 `models:list`、`images:create` 的 Codex Image 模型。
- 真实验收前只读核验曾确认正常库 Image Gateway Key/request 都为 0；用户明确批准后才创建 1 个最小 scope Key 和上述 2 条 Codex request。当前回执以 4.5 节的持久记录为准。

正常 3000 端口对两个生产入口各执行一次无凭证轻量 smoke，均未触发 Provider：

| 命令范围 | 退出码 | HTTP/结果 |
| --- | ---: | --- |
| `curl POST /v1/images/generations`（严格 JSON、无 Key） | 0 | HTTP 401，`GATEWAY_API_KEY_REQUIRED` |
| `curl POST /v1/images/edits`（multipart、无 Key） | 0 | HTTP 401，`GATEWAY_API_KEY_REQUIRED` |

这只证明已部署路由及认证边界，不是授权调用或真实模型验收。

价格数值与 OpenAI 官方 `gpt-image-2` API Token 单价一致，并不能推出 Codex managed backend 使用同一收费合同。最终代码将其视为 Admin 平台价格；可选来源标签用于说明参考依据，不参与运行门禁。

真实 OpenAI 前置已做无秘密只读复核，并在继续执行时再次核对：正常 `ink-memory` 数据库（54329）中 active、显式 `config.imageApi.kind=openai` 的 Provider 为 0，其中带有效凭据者也为 0；服务器环境中的 `OPENAI_API_KEY`、`OPENAI_IMAGE_API_KEY` 均未配置。同期 Codex active Image model 为 1；可选 reservation/price source 为空不影响其平台结算 readiness。检查命令退出码 0，只输出计数和布尔值，未读取或打印凭据。

先前阻塞审计得到 official OpenAI active/credential=`0/0`、Codex active Image model/reservation source/matching managed price=`1/0/0`。2026-10-10 重新判断后，只有 OpenAI `0/0` 仍是 OpenAI 真实验收前置；Codex 的两个来源计数是审计信息，不构成平台调用或结算阻塞。Goal 已恢复为 active。

OpenAI 官方 pricing 与 Image guide 于 2026-10-09 复核：公开 API 的 `gpt-image-2` 使用文本输入、图片输入、图片输出 Token 计价，当前标准价格分别为 `$2.50/M`、`$4/M`、`$15/M`；cached-input 折扣不适用于直接 Images API。该证据可以作为未来官方 OpenAI Provider 价格版本的来源，但不能推导 ChatGPT Codex managed backend 使用相同 monetary contract。

ChatGPT Learn 的 Codex pricing 同期明确：managed/subscription 路径与 API Key 路径分开；当前 Codex 账号使用 included plan limit，没有逐请求美元成本。本事实只说明不能把 Admin 平台价格称为 Codex 上游账单，不要求平台建立 credit→USD 换算，也不影响使用实际 Token usage 与 Admin 价格结算。

最终继续执行又复核了官方 Image guide 与本机 Codex extension：官方尺寸/质量 Token 只能用于估算，`auto` 取决于实际生成；Codex generation/edit 均发送 `quality:auto`、`size:auto`。这些数据可以辅助管理员制定 reservation budget，但 budget 始终只用于并发额度保护，不冒充实际 usage 或上游成本。

| 未验证项 | 原因 | 继续所需条件 |
| --- | --- | --- |
| 真实 OpenAI generation/edit | 正常控制面没有官方 OpenAI Image Provider/凭据；现有 `openai-main` 实际指向腾讯服务，不能改名或挪用 | 通过正常 Admin 新增官方 OpenAI Provider 并由用户在服务器侧配置凭据，再授权一次 generation 与一次 edit |
| 当前代码修正后的 Codex 复验 | 本轮已完成，详见0.4；两次200且settled、Token流水、平台快照和零payload已核对 | 无该项阻碍；不替代OpenAI真实验收 |

## 6. 状态判断

- 调研、现行 PRD、正式设计、独立评审修订、实现、隔离技术验证：完成。
- 正常数据库 migration 与 Free v7 权益发布：完成；现有 Codex Image 模型、数值 reservation budget 和平台价格满足来源修正后的 readiness 语义。
- 真实 Codex generation/edit、usage、Token 流水与 Admin 请求详情：历史回执保留，本轮当前实现复验完成，见0.4。
- 真实 OpenAI generation/edit：缺少官方 OpenAI Provider/服务器侧凭据，未执行。
- Codex goal：最终独立复审与文档检查已闭合，当前目标完成条件满足；程序状态以工具最终回执为准。真实OpenAI凭据只影响OpenAI真实验收，不阻断已完成Codex验收。

## 7. 逐项完成度审计

| 用户要求 | 权威证据 | 判断 |
| --- | --- | --- |
| 调查 AI 模型中心、Provider、Gateway、权限、请求、计费和既有 Image 能力 | 源码调查逐项给出路径、符号、行号与“实现/推断/建议/未验证”标签 | 已证明 |
| 核实 OpenAI 与 Codex URL、认证、输入、结果、usage，区分两类上游 | 调查第 6、7 节；OpenAI 官方文档与本机 Codex 源码分别取证 | 已证明；真实响应仍单列验收 |
| 现行 PRD、桌面/窄屏骨架和业务功能描述 | `docs/prd/image-model-center/README.md` | 已证明 |
| 正式交互/技术设计和三类 Mermaid | `docs/design/image-model-center.md` 的正常时序、异常恢复时序和一张页面/派生业务状态图 | 已证明 |
| 基于实际设计独立评审并先修订后实现 | `docs/verification/image-model-center-design-review.md` 及本回执第 3 节 | 已证明 |
| 复用现有 Provider/Model/Permission/Gateway/Billing/Request | 现有表和生命周期扩展；没有 Image 业务表、第二账本或平行管理框架 | 已证明 |
| 仅 Codex/OpenAI；生成与编辑两条独立入口 | Provider resolver/registry、`app/v1/images/**`、route build 产物 | 已证明 |
| 管理页面沿用 AI 模型中心体验 | 正常 Admin 配置回执和隔离桌面/390px Playwright 截图 | 已证明 |
| 按上游 Image Token 明细与 Admin 平台价格结算，不按图片数或虚构 Token | 四类 usage/价格快照、严格一致性校验、known/unknown 恢复测试 | 已证明技术合同；平台金额不宣称上游实际成本 |
| Schema 只用 Drizzle 前向 migration/capability | `0078_absent_puppet_master`、`79/79 current`、capability 精确哈希 | 已证明 |
| 权限拒绝、停用、输入/上游/无图/usage/重复/取消/重试及文本回归 | 本轮focused33/33、全量2302passed、隔离Chrome `1 passed (53.9s)`；命令见0.2/0.3 | 已证明隔离技术行为 |
| 正常业务发布和 Admin 可见配置 | 正常库备份、migration、Codex 模型/Admin 平台价格、Free v7 五项权益 | 已证明存量事实；可选来源缺失不影响 readiness |
| 真实 Codex generation/edit、usage、费用和请求记录 | 本轮正常库两条request均settled/succeeded；usage/Token ledger/Admin safe detail与零payload已核验，金额按Admin价格快照计算 | 当前真实链路已证明；见0.4 |
| 真实 OpenAI generation/edit、usage、费用和请求记录 | 无官方 OpenAI Provider/凭据；腾讯 Provider 未挪用 | 未证明；缺服务器侧 Provider 前置 |

平台语义与独立中心修订后的当前确定性、隔离E2E、真实Codex验收、最终独立复审和文档检查均已取得本轮回执，目标完成条件已满足。真实OpenAI仍因缺官方Provider/凭据而单独标记未验证，不能由腾讯Provider或隔离fake替代。
