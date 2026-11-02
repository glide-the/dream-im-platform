<!-- [Input] Active ECS source snapshot, reviewed exact account callback patch and failed constrained builds. -->
<!-- [Output] Source-bound Linux CI artifact, runtime input hashes and deployment checks. -->
<!-- [Pos] Release execution record; this branch preserves deployed business source and performs no production mutation. -->
<!-- [Sync] 2026-11-02: separate complete Linux build from the small-memory ECS supervisor startup. -->

# Exact deployed-source Linux build

The source baseline is the deployed ee0497b43115 release with its existing live overlays and the reviewed account callback patch from PR41. A read-only comparison checked 917 runtime input files; 12 existing deployed overlays were copied byte-for-byte with SHA-256 checks. These overlays retain the deployed business behavior. The account patch preserves the same Client, HTTP callback, S256, grants, scopes and credentials.

This isolated branch reuses the existing manual Test Suite workflow. Config, unit, lint, type, build and isolated migration qualification remain. Node22.23.4 matches the verified ECS runtime. The completed Linux x64 build is archived with runtime input and output SHA-256 manifests. The archive excludes env files, credentials, business data, node_modules and the Next cache. Retention is seven days. Uploading a CI artifact performs no production deployment.

The ECS operator must compare every runtime source and the lock hash, verify the archive and extracted output digests, and retain the original private config, dependency graph, database directory and permissions. Existing pnpm build and start:embedded stages retain their owners; this release runs the complete build in CI and only the original supervisor on ECS. Failed activation returns to the original verified artifact. No schema migration or credentials are carried by the artifact.

The Dream issue record owns physical-device and public-auth acceptance. A successful CI build alone does not prove Google identity verification, account creation, mobile UI, or service availability.

## 第一次CI与同步

run41403579754的unit阶段23项失败，构建与制品步骤未执行。21项由Registry293源码与旧生成清单不一致触发，2项采用已部署Run绑定和catalog变更之前的断言。现从已提交c0ddbde恢复catalog测试和生成清单，并从原Admin工作区只读复制两份对应现有实现的测试；运行源码保持逐字节一致，门禁继续完整执行。Google选择连续性采用独立PR42的3份实现及相关测试，保持原账户与权限；候选运行源码清单按此增量重新核对。
