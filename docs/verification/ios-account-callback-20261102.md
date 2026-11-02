<!-- [Input] Dream iOS构建24回调配置、公网Client检查及现有兼容补丁。 -->
<!-- [Output] 精确App回调兼容范围、验证结果与发布前提。 -->
<!-- [Pos] iOS账号回调兼容的项目执行记录。 -->
<!-- [Sync] 2026-11-02: 独立收录现有移动回调兼容补丁，原工作区未提交改动保持。 -->

# 同一Client的App回调兼容

## 范围

Dream iOS构建24的Native账号适配要求App私有回调，包内BFF继续采用原HTTP回调。Google入口在原生精确校验处失败；公网现有版本同时缺少对应的附加回调配置及服务端校验能力。

本补丁保留原Client ID、原HTTP redirectUri、S256、grant、scope、secret和用户权限。服务配置可为loopback来源声明精确的额外App回调；交换只接受所属服务配置中的URI。OAuth登记仅允许对应Client追加回调及其必要的web到native元数据转换，其他字段漂移时停止操作。

## 验证

隔离目录`/tmp/ink-admin-ios-compat-20261102`采用原HEAD源码及本补丁，原工作区、数据库、真实账户和服务保持。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm exec vitest run app/lib/auth/config.test.ts app/lib/auth/browserSessionService.test.ts app/lib/auth/oauthClientCatalog.test.ts` | 0 | 3文件、25项通过；精确回调、拒绝越界URI、原交换恢复、元数据与原权限保持 |
| `pnpm exec tsc --noEmit --incremental false --pretty false` | 2 | 原安装依赖缺少embedded-postgres类型，唯一诊断为packages/db/src/embedded-postgres.ts:115的TS2307；未安装依赖，完整Linux构建继续作为发布前提 |

## 发布准备

ECS当前服务与用户已按运维手册核实。候选目录从实际运行源码复制，复用原依赖和数据位置，仅覆盖上述4份实现/CLI文件；原运行目录及其私有配置保持。候选仅为localhost服务追加`com.inkmemory.mobile.auth:/auth/callback`。

原登记CLI的`--browser-redirects` dry-run已通过：只更新一个已有Client，新增URI一项，必要的applicationType为native；scope与secret变更为0。正式apply、生产构建/重启与真机Google回调仍需对应回执；本记录中的候选与测试资格独立于上线结果。

正式采用沿原Admin服务执行，保留数据库目录、加密材料、身份与审计。故障恢复使用原运行目录和原配置；新增回调保持精确所属关系，删除原回调及扩大权限均退出本次范围。实际设备与上线回执由Dream本轮账号修复记录维护。
