# ai4sales-pwa-app 部署指南

本文档说明如何使用 Docker 构建和部署 ai4sales-pwa-app。

---

## 目录

- [前置要求](#前置要求)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [环境变量说明](#环境变量说明)
- [部署方式](#部署方式)
  - [一键部署（推荐）](#一键部署推荐)
  - [仅构建镜像](#仅构建镜像)
  - [手动 Docker 构建](#手动-docker-构建)
- [服务说明](#服务说明)
- [更新部署（Redeploy）](#更新部署redeploy)
- [常用运维命令](#常用运维命令)
- [数据持久化](#数据持久化)
- [健康检查](#健康检查)
- [自定义配置](#自定义配置)
- [故障排查](#故障排查)

---

## 前置要求

| 依赖 | 最低版本 |
|------|---------|
| Docker | 24.0+ |
| Docker Compose | v2.20+ (docker compose 命令) |

> 服务器建议配置：2 核 CPU、4 GB 内存、20 GB 磁盘。

---

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                  Docker Compose                     │
│                                                     │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────┐ │
│  │ ai4sales-app │  │ postgres  │  │    minio     │ │
│  │  (Next.js)   │→ │(PG 16)    │  │ (S3 存储)    │ │
│  │  Port: 3000  │  │ Port: 5432│  │ Port: 9000   │ │
│  └──────────────┘  └───────────┘  │ Console:9001 │ │
│         │                         └──────────────┘ │
│         │          ┌──────────────┐                 │
│         └─────────→│  minio-init  │ (初始化桶后退出)│
│                    └──────────────┘                 │
└─────────────────────────────────────────────────────┘
```

---

## 快速开始

```bash
# 1. 进入 docker 目录
cd docker

# 2. 复制环境变量模板
cp .env.example .env

# 3. 编辑 .env，填入必要的 API Key
#    至少需要填写 ANTHROPIC_API_KEY
vim .env

# 4. 构建并启动所有服务
docker compose up -d --build

# 5. 查看日志
docker compose logs -f ai4sales-app
```

启动后访问：
- **应用**：http://localhost:3000
- **MinIO Console**：http://localhost:9001（默认账号 `minioadmin` / `minioadmin`）

---

## 环境变量说明

环境变量模板位于 `docker/.env.example`，复制为 `docker/.env` 后编辑。

### 必填项

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥，从 [console.anthropic.com](https://console.anthropic.com/) 获取 |

### 数据库（PostgreSQL）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `POSTGRES_USER` | `ai4sales` | 数据库用户名 |
| `POSTGRES_PASSWORD` | `ai4sales` | 数据库密码 |
| `POSTGRES_DB` | `ai4sales` | 数据库名 |
| `DATABASE_URL` | `postgres://ai4sales:ai4sales@postgres:5432/ai4sales` | 应用连接串，Docker 内部使用服务名 `postgres` 作为 host |

### 文件存储（MinIO / S3）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FILE_STORAGE_TYPE` | `s3` | 存储类型 |
| `FILE_STORAGE_S3_BUCKET` | `vibesales` | S3 桶名 |
| `FILE_STORAGE_S3_ENDPOINT` | `http://minio:9000` | MinIO 端点（Docker 内部服务名） |
| `FILE_STORAGE_S3_FORCE_PATH_STYLE` | `true` | MinIO 需要 path-style |
| `AWS_ACCESS_KEY_ID` | `minioadmin` | MinIO 访问密钥 |
| `AWS_SECRET_ACCESS_KEY` | `minioadmin` | MinIO 访问密钥 |

### MinIO 容器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINIO_USER` | `minioadmin` | MinIO root 用户 |
| `MINIO_PASSWORD` | `minioadmin` | MinIO root 密码 |
| `MINIO_PORT` | `9000` | S3 API 端口映射 |
| `MINIO_CONSOLE_PORT` | `9001` | Console UI 端口映射 |

### Agent 设置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_BUDGET_USD` | `0.5` | 每次查询最大预算（美元） |
| `MAX_TURNS` | `10` | Agent 最大对话轮次 |
| `AGENT_CWD` | `./agent-workspaces` | Agent 工作目录 |

### 其他可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ANTHROPIC_BASE_URL` | — | 自定义 Anthropic API 端点 |
| `EXA_API_KEY` | — | Exa 搜索 API 密钥 |
| `WEKNORA_API_KEY` | — | WeKnora 知识库密钥 |
| `WEKNORA_BASE_URL` | `https://weknora.fanmikeji.cn` | WeKnora 服务地址 |
| `APP_PORT` | `3000` | 应用宿主机端口映射 |

---

## 部署方式

### 一键部署（推荐）

在项目根目录使用 pnpm 脚本：

```bash
# 构建并启动
pnpm docker:up

# 查看应用日志
pnpm docker:logs

# 停止所有服务
pnpm docker:down
```

### 仅构建镜像

```bash
pnpm docker:build
```

### 手动 Docker 构建

```bash
# 在项目根目录构建镜像
docker build -f docker/Dockerfile -t ai4sales-app .

# 或进入 docker 目录使用 compose
cd docker
docker compose up -d --build
```

---

## 服务说明

| 服务 | 镜像 | 说明 |
|------|------|------|
| `ai4sales-app` | 自构建（Dockerfile） | Next.js 应用，standalone 模式运行 |
| `postgres` | `postgres:16-alpine` | 数据持久化，支持健康检查 |
| `minio` | `minio/minio:latest` | S3 兼容对象存储，用于文件上传 |
| `minio-init` | `minio/mc:latest` | 一次性容器，自动创建存储桶后退出 |

---

## 更新部署（Redeploy）

当代码有更新需要重新部署时，按照以下流程操作。此流程确保旧容器完全清理、代码同步到最新、镜像全量重建。

### 标准更新流程

```bash
# 1. 进入 docker 目录
cd ~/claude-agent-next-kit/docker

# 2. 停止并移除所有容器和网络
docker compose down

# 预期输出：
# [+] down 5/5
#  ✔ Container docker-ai4sales-app-1 Removed
#  ✔ Container ai4sales-minio-init   Removed
#  ✔ Container docker-minio-1        Removed
#  ✔ Container docker-postgres-1     Removed
#  ✔ Network docker_ai4sales-network Removed

# 3. 拉取最新代码（回到项目根目录）
cd ~/claude-agent-next-kit
git pull
# 如果需要使用指定 SSH 密钥：
# GIT_SSH_COMMAND="ssh -i ~/.ssh/id_your_key" git pull

# 4. 回到 docker 目录，无缓存重新构建镜像
cd docker
docker compose build --no-cache

# 5. 启动所有服务
docker compose up -d

# 6. 检查服务状态
docker compose ps

# 7. 跟踪应用日志，确认启动正常
docker compose logs -f ai4sales-app
```

### 快速更新（使用缓存构建）

如果改动较小且无依赖变化，可使用缓存构建以加速：

```bash
cd ~/claude-agent-next-kit/docker
docker compose down
cd .. && git pull && cd docker
docker compose up -d --build
docker compose logs -f ai4sales-app
```

### 仅更新应用（不影响数据库和存储）

如果仅需重建应用镜像而不重启 Postgres/MinIO：

```bash
cd ~/claude-agent-next-kit
git pull
cd docker
docker compose build --no-cache ai4sales-app
docker compose up -d ai4sales-app
docker compose logs -f ai4sales-app
```

### 一行命令快速部署

适合写进 cron 或 CI 脚本的单行命令：

```bash
cd ~/claude-agent-next-kit/docker && docker compose down && cd .. && git pull && cd docker && docker compose build --no-cache && docker compose up -d
```

### 更新后验证

部署完成后，执行以下检查确认服务正常：

```bash
# 检查所有容器运行状态（State 应为 running / healthy）
docker compose ps

# 确认应用可访问
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# 应返回 200

# 确认数据库连接正常
docker compose exec postgres pg_isready -U ai4sales
# 应返回 "accepting connections"

# 确认 MinIO 健康
curl -s http://localhost:9000/minio/health/ready
# 应返回 200
```

### 注意事项

| 场景 | 建议 |
|------|------|
| 数据库 schema 有变更 | `entrypoint.sh` 会在启动时自动执行迁移，无需手动操作 |
| 依赖包有变更 | 务必使用 `--no-cache` 构建以确保依赖更新 |
| `.env` 配置有变更 | 先编辑 `docker/.env`，再执行构建流程 |
| 需要保留数据 | `docker compose down` 不会删除数据卷，数据安全 |
| 需要完全重置 | 使用 `docker compose down -v` 删除数据卷（⚠️ 不可恢复） |

---

## 常用运维命令

```bash
# 进入 docker 目录（以下命令均在 docker/ 下执行）
cd docker

# 启动所有服务（后台）
docker compose up -d

# 重新构建并启动
docker compose up -d --build

# 仅重启应用（不重建）
docker compose restart ai4sales-app

# 查看所有服务状态
docker compose ps

# 查看应用日志（实时）
docker compose logs -f ai4sales-app

# 查看 Postgres 日志
docker compose logs -f postgres

# 进入应用容器调试
docker compose exec ai4sales-app sh

# 进入数据库
docker compose exec postgres psql -U ai4sales -d ai4sales

# 停止所有服务（保留数据卷）
docker compose down

# 停止并删除数据卷（⚠️ 清除所有数据）
docker compose down -v
```

---

## 数据持久化

Docker Compose 使用命名卷持久化数据，`docker compose down` 不会丢失数据。

| 卷名 | 用途 |
|------|------|
| `postgres_data` | PostgreSQL 数据文件 |
| `minio_data` | MinIO 存储文件 |
| `agent_workspaces` | Agent 工作区文件 |

**备份数据库：**

```bash
docker compose exec postgres pg_dump -U ai4sales ai4sales > backup_$(date +%Y%m%d).sql
```

**恢复数据库：**

```bash
cat backup_20260206.sql | docker compose exec -T postgres psql -U ai4sales -d ai4sales
```

---

## 健康检查

| 服务 | 检查方式 | 间隔 |
|------|---------|------|
| `ai4sales-app` | `curl http://localhost:3000/` | 30s |
| `postgres` | `pg_isready` | 5s |
| `minio` | `curl http://localhost:9000/minio/health/live` | 30s |

应用启动依赖 Postgres 和 MinIO 的健康检查通过后才会启动。

---

## 自定义配置

### 修改端口

编辑 `docker/.env`：

```dotenv
APP_PORT=8080        # 应用映射到宿主机 8080
MINIO_PORT=9100      # MinIO API 映射到 9100
MINIO_CONSOLE_PORT=9101  # MinIO Console 映射到 9101
```

### 使用外部数据库

如果你已有 PostgreSQL 实例，修改 `docker/.env`：

```dotenv
DATABASE_URL=postgres://user:password@your-pg-host:5432/ai4sales
```

然后在 `docker/compose.yml` 中注释掉 `postgres` 服务和相关的 `depends_on`。

### 使用外部 S3

修改 `docker/.env`：

```dotenv
FILE_STORAGE_TYPE=s3
FILE_STORAGE_S3_BUCKET=your-bucket
FILE_STORAGE_S3_REGION=ap-southeast-1
FILE_STORAGE_S3_ENDPOINT=https://s3.amazonaws.com
FILE_STORAGE_S3_FORCE_PATH_STYLE=false
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

然后在 `docker/compose.yml` 中注释掉 `minio`、`minio-init` 服务。

### 生产环境安全建议

1. **修改默认密码**：更改 `POSTGRES_PASSWORD`、`MINIO_USER`/`MINIO_PASSWORD`
2. **不暴露 MinIO 端口**：如果应用通过内部网络访问 MinIO，移除 `minio` 的 `ports` 映射
3. **使用反向代理**：在前面加 Nginx/Caddy 处理 HTTPS 和域名
4. **限制 DNS**：如不需要外网，移除 `dns` 配置

---

## 故障排查

### 应用启动失败

```bash
# 查看详细日志
docker compose logs ai4sales-app

# 检查环境变量是否正确加载
docker compose exec ai4sales-app env | grep DATABASE_URL
```

### 数据库连接失败

```bash
# 确认 postgres 已就绪
docker compose ps postgres

# 手动测试连接
docker compose exec postgres pg_isready -U ai4sales
```

### MinIO 桶未创建

```bash
# 检查 minio-init 日志
docker compose logs minio-init

# 手动创建
docker compose run --rm minio-init
```

### 构建缓慢

Dockerfile 已配置阿里云 Alpine 镜像和 npmmirror 加速。如果仍然慢，检查网络或考虑设置 Docker 镜像代理：

```bash
# 在 ~/.docker/daemon.json 中配置镜像加速
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"]
}
```

### 磁盘空间不足

```bash
# 清理未使用的 Docker 资源
docker system prune -a --volumes
```

---

## Docker 文件结构

```
docker/
├── Dockerfile         # 多阶段构建（builder → runner）
├── compose.yml        # Docker Compose 编排文件
├── entrypoint.sh      # 容器启动入口脚本
└── .env.example       # 环境变量模板
.dockerignore          # 构建排除规则
```
