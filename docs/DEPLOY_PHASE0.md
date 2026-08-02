# Phase 0 生产部署指南

本指南覆盖「AI 图像创作应用」的生产底座：配置外置化、Redis 优雅降级、健康检查、登录/注册限流、以及三种部署方式（Docker / PM2+nginx / 原生）。

> 架构定位：这是前后端一体单服务（`server/server.js` 在 3001 同源托管前端 `dist/build2`）。**GitHub Pages 不行**——它需要 Node 运行时 + PostgreSQL + Redis，不是纯静态站。

---

## 1. 配置外置化（必须）

所有敏感/环境相关配置走环境变量，由 `server/server.js` 在启动时读取（通过 `dotenv/config` 加载仓库根 `.env`）。

### 变量清单

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | `production` 时 cookie 加 `Secure` |
| `PORT` | `3001` | HTTP 监听端口 |
| `JWT_SECRET` | `dev-only-change-me` | 会话签名密钥，**生产务必改** |
| `PG_HOST` | `localhost` | PostgreSQL 主机 |
| `PG_PORT` | `5432` | |
| `PG_DATABASE` | `huabu` | |
| `PG_USER` | `postgres` | |
| `PG_PASSWORD` | `0.0.1abcd` | |
| `PG_POOL_MAX` | `10` | 连接池上限（高并发调大） |
| `REDIS_HOST` | `localhost` | |
| `REDIS_PORT` | `6379` | |
| `REDIS_PASSWORD` | 空 | |

### 上手

```bash
cp .env.example .env      # 然后填入真实值（PG_PASSWORD / JWT_SECRET 必填）
```

---

## 2. Redis：优雅降级

`server/redis.cjs` 提供统一 `kvGet/kvSet/kvIncr/kvExpire` API：

- **Redis 可用** → 走 Redis（限流计数、缓存、未来队列）。
- **Redis 不可用**（没装/挂了）→ 自动落到内存 `Map` 兜底，服务**不崩**，仅限流精度在重启后清零。

启动日志会打印 `🔴 Redis:up` 或 `🔴 Redis:memory-fallback`。本地已有 Redis 7.2，已验证连接成功。

> 当前用到的 Redis 能力：登录/注册固定窗口限流。后续队列（异步生成任务）可直接复用 `kv*` API。

---

## 3. 健康检查 `/api/healthz`

公开端点（网关前放行），供容器探针 / nginx / 压测使用：

```bash
curl http://localhost:3001/api/healthz
# {"status":"ok","pg":true,"redis":true,"uptime":123,"version":"0.1.0","ts":...}
```

字段：`pg`（PG 是否连上）、`redis`（Redis 是否 up）、`uptime`（秒）、`version`、`ts`（毫秒）。

---

## 4. 限流

基于 `server/ratelimit.cjs`（固定窗口，Redis 支撑）：

| 接口 | 限制 | 超限响应 |
|---|---|---|
| `POST /api/auth/register` | 单 IP 60s 内 5 次 | `429` + `Retry-After` |
| `POST /api/auth/login` | 单 IP 60s 内 10 次 | `429` + `Retry-After` |

nginx 层额外有 `auth_limit`(10r/s burst 20) 与 `api_limit`(50r/s burst 100) 两道区（见 `deploy/nginx.conf`）。

---

## 5. 部署方式

### A. Docker Compose 一键（推荐）

```bash
# 生产前覆盖关键变量（或写进 .env 由 compose 读取）
export JWT_SECRET="$(openssl rand -hex 32)"
export PG_PASSWORD="强密码"

docker compose up -d --build
# 应用: http://localhost:3001
# 探针: curl localhost:3001/api/healthz
```

可选 nginx 反代：取消 `docker-compose.yml` 末尾 `nginx` 段注释，再把 `app` 的 `ports` 改为仅内部暴露。

### B. PgBouncer（高并发 >500 时）

```bash
docker compose -f deploy/docker-compose.pgbouncer.yml up -d --build
```

应用改连 `pgbouncer:6432`（transaction 池模式），降低 PG 连接压力。自定义 PG 密码后需重算 `deploy/userlist.txt` 的 md5：

```bash
printf '%s' '你的密码用户名' | md5sum   # 结果前加 md5
```

### C. PM2 + nginx（裸机/VM）

```bash
npm install --omit=dev --no-audit --no-fund   # 生产依赖（用 install 而非 ci，容忍 lock 漂移）
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
# nginx：把 deploy/nginx.conf 放到 /etc/nginx/conf.d/default.conf 后 nginx -t && nginx -s reload
```

PM2 集群模式（每 CPU 一进程，共享 3001），单进程超 1G 自动重启。

---

## 6. 压测（零依赖）

```bash
# 打 healthz，50 并发 1000 请求
node deploy/loadtest.mjs --url http://localhost:3001 --path /api/healthz --concurrency 50 --requests 1000

# 持续 30 秒压测 /api/media
node deploy/loadtest.mjs --url http://localhost:3001 --path /api/media --duration 30 --concurrency 100
```

输出 RPS、错误率、p50/p95/p99 延迟、状态码分布。

---

## 7. 文件清单

| 文件 | 作用 |
|---|---|
| `server/redis.cjs` | 优雅 Redis 层（内存兜底） |
| `server/ratelimit.cjs` | 固定窗口限流 |
| `server/server.js` | 接入 healthz / 限流 / initRedis |
| `.env.example` | 变量模板 |
| `deploy/nginx.conf` | 反代 + 限流 + 健康检查 |
| `deploy/ecosystem.config.cjs` | PM2 集群部署 |
| `deploy/loadtest.mjs` | 零依赖压测 |
| `Dockerfile` | 多阶段构建 |
| `docker-compose.yml` | PG+Redis+App 编排 |
| `deploy/docker-compose.pgbouncer.yml` | 含 PgBouncer 的编排 |
| `deploy/pgbouncer.ini` / `deploy/userlist.txt` | PgBouncer 配置 |
| `.dockerignore` | 构建上下文裁剪 |
