# 技术栈全景 + 5K–10K 并发在线规模设计（落地版）

> 本文档**修订并替代** `DESIGN_AUTH_CREDITS.md` §14 的"千人在线"口径，以及 `DETAILED_SPEC.md` §A 的基础设施配置。
> 目标基线：**5,000 ~ 10,000 并发在线用户**（"在线"= 持有有效会话 + 心跳；非峰值 RPS）。
> 原则延续：尽量纯 JS / 零原生编译依赖（沿用项目既定路线），只在确需时使用成熟组件。

---

## 目录

1. [容量基线数学（先算账，再选型）](#1)
2. [完整技术栈清单（分层 + 版本 + 选型理由 + 备选）](#2)
3. [各层在 10K 下的部署形态与容量](#3)
4. [数据层：连接池 / 读写分离 / 分区 / 迁移](#4)
5. [缓存与实时层：Redis 高可用 / 限流 / 在线统计 / WS](#5)
6. [异步与队列：视频生成 / Webhook / 通知](#6)
7. [搜索层：媒体与商品检索](#7)
8. [可观测性（取代 PG 写日志方案）](#8)
9. [CI/CD 与容器化](#9)
10. [安全与边缘（WAF / DDoS / TLS）](#10)
11. [故障模式与容量兜底（10K 特有）](#11)
12. [落地顺序与配置速查](#12)

---

<a id="1"></a>
## 1. 容量基线数学（先算账，再选型）

### 1.1 定义与换算

| 指标 | 估算 | 说明 |
|---|---|---|
| 并发在线 | 10,000 | 持有会话 + 每 30s 心跳 |
| 活跃比 | 10%–20% | 同一时刻真正发请求的比例 |
| 平均 RPS | 1,000–2,000 | 10K×15%×~1 req/s |
| 峰值 RPS（突发） | 4,000–6,000 | 活动/促销瞬时 |
| 单请求平均耗时 | 20–80ms（API）/ 最长 120s（视频） | 视频类是异步，不占同步连接 |
| 数据库写 QPS | 200–500 | 生成扣费/流水为主，读走副本+缓存 |
| 数据库读 QPS | 2,000–5,000 | 媒体列表/详情，靠缓存+副本吸收 |

### 1.2 关键资源测算

- **Node 进程**：单实例（4 vCPU）稳妥承载 ~3,000 并发连接 / ~1,500 RPS 轻接口。10K 在线 + 峰值 5K RPS → 需 **4–6 个实例**（2–4 vCPU/实例）。
- **PostgreSQL 连接**：经 PgBouncer 事务池，每 Node 实例持 15–20 池化连接 → 6 实例≈120 活跃服务端连接，PG `max_connections=300` 绰绰有余；读流量分流到 1 个只读副本。
- **Redis**：10K 在线心跳 + 计数器 + 限流 + 缓存 + 队列 + Pub/Sub。内存峰值 ~4–6GB（按每在线用户 ~300KB 会话/计数估算）。单实例可扛，但需 **Sentinel 至少 1 主 2 从** 保 HA；超过 20K 再上 Cluster。
- **静态/媒体**：全部走 CDN（OSS+CDN），Node 不吐媒体字节，源站带宽压力≈0。
- **带宽**：假设峰值 5K RPS × 平均响应 5KB = 25MB/s ≈ 200Mbps，CDN 边缘吸收 90%+。源站只需 ~20Mbps。

---

<a id="2"></a>
## 2. 完整技术栈清单（分层 + 版本 + 选型理由 + 备选）

### 2.1 前端层

| 技术 | 版本 | 用途 | 为什么选 | 备选 / 备注 |
|---|---|---|---|---|
| React | 18.x / 19.x | UI 框架 | 生态成熟、团队已在用 | — |
| TypeScript | 5.x | 类型安全 | 必须与后端共享 schema | — |
| Vite | 5/6 | 构建/Dev | 已在用，快 | — |
| Tailwind CSS | v4 | 样式 | 已在用，原子化 | — |
| Zustand | 4/5 | 轻量状态 | 比 Redux 轻，hooks 友好 | Redux Toolkit（重型） |
| TanStack Query | 5 | 服务端状态/缓存 | 请求缓存、重试、轮询开箱 | SWR（更轻） |
| React Router | 6/7 | 路由/守卫 | 已在用 | — |
| Framer Motion | 11 | 动画 | 60fps 微交互 | GSAP（更底层） |
| lucide-react | 最新 | 图标 | 已在用 | — |
| Zod | 3 | 前后端共享校验 | 一份 schema 两端用 | Ajv（仅后端） |

### 2.2 后端运行时与框架

| 技术 | 版本 | 用途 | 为什么选 | 备选 / 备注 |
|---|---|---|---|---|
| Node.js | **22 LTS** | 运行时 | 已在用；原生 `crypto`、`fetch`、worker_threads | 20（已弃用边缘） |
| ESM | — | 模块 | 项目已 ESM | — |
| **Fastify** | 5.x | **API 框架（新模块）** | 纯 JS 无原生编译、pino 日志、Ajv 校验、低开销、比 Express 快 2–3× | Express（慢/无内置校验）；保留现有原生 `server.js` 仅做静态+legacy，新 API 全走 Fastify |
| @fastify/static | 7 | 托管 `dist/build2` | 替代原生静态 | — |
| @fastify/rate-limit | 9 | 单节点限流兜底 | 配合 Redis 全局限流 | — |
| pino | 9 | 结构化日志 | Fastify 内置，极低开销 | winston（慢） |

> **迁移策略（Phase 0）**：先引入 Fastify 作为新 API 路由层，与原 `server.js` 共存（Fastify 监听同进程另一端口或挂载子路由）；legacy 接口逐步迁到 Fastify。静态资源最终交给 Nginx/CDN，Node 只跑 API。

### 2.3 认证与安全（纯 JS，零编译）

| 技术 | 用途 | 为什么选 | 备注 |
|---|---|---|---|
| Node `crypto.scrypt` | 密码哈希 | 内置，N=16384 单次 <50ms | 不引 argon2（需原生编译） |
| **jose** | JWT 签发/验签 | 纯 JS，支持 HS256/EdDSA、JWKS、可验 exp | 替代 jsonwebtoken（已停更感） |
| Zod | 入参校验 | 前后端共享 | 经 Fastify 集成 |
| helmet / @fastify/secure-headers | 安全头 | 防常见 Web 漏洞 | — |

### 2.4 数据层

| 技术 | 版本 | 用途 | 为什么选 | 备选 |
|---|---|---|---|---|
| PostgreSQL | **17** | 主数据库 | 已在用；JSONB、事务、行锁、`SKIP LOCKED`、tsvector、pgvector | — |
| **Drizzle ORM** | 0.3x | 类型安全查询 | 轻量、近原生性能、TS 优先、可按需降级原生 SQL | Prisma（重/生成慢）；Knex（无类型） |
| node-postgres (`pg`) | 8 | 驱动 | 已在用 | — |
| **PgBouncer** | 1.22 | 连接池（事务模式） | 必需，10K 下连接复用 | 应用层 pg.Pool（不够） |
| 只读副本 | PG 流复制 | 读分流 | 媒体列表/控制台查询 | — |

> **取舍**：热路径（积分原子预扣 `UPDATE ... WHERE balance>=cost`）继续用**原生 SQL**（Drizzle `sql` 模板），其余 CRUD 用 Drizzle 提效。迁移脚本用 **Drizzle Kit**（TS 原生）+ 保留现有 `CREATE TABLE IF NOT EXISTS` 兜底引导建表。

### 2.5 缓存 / 会话 / 队列 / 实时

| 技术 | 版本 | 用途 | 为什么选 | 备选 |
|---|---|---|---|---|
| Redis | **7.2** | 缓存/限流/在线计数/Pub-Sub/队列/黑名单 | 已在规划；ioredis 已装 | KeyDB（兼容） |
| ioredis | 5 | Redis 客户端 | 已装（server.js 未用 → Phase 0 启用） | node-redis |
| **BullMQ** | 5 | 异步任务队列（视频/Webhook/通知） | 基于 Redis、纯 JS、延迟/重试/优先级/面板 | Redis Streams 自研（轻但费事） |
| Socket.IO / `ws` | 8 / 8 | 协作画布实时（可选） | `ws` 轻；Socket.IO 带 Redis adapter 可水平扩 | — |

> 10K 下有状态实时（画布协作）需 **WS 服务独立部署 + Redis adapter** 跨节点广播。若仅控制台（单 admin SSE），无需 WS，原生 SSE 即可。

### 2.6 搜索层

| 技术 | 用途 | 为什么选 | 备选 |
|---|---|---|---|
| PostgreSQL `tsvector` | 关键词搜索（媒体/商品标题） | 零额外组件，已在 PG | — |
| **pgvector** | 语义/以图搜图向量检索 | 同库、向量索引 ivfflat/hnsw | 外部 Meilisearch / Typesense（独立服务，更强但增运维） |

> 初期用 tsvector + pgvector 足够；若搜索成为瓶颈或需中文分词优化，引入 **Meilisearch**（中文分词开箱）作为独立搜索服务。

### 2.7 对象存储 / CDN

| 技术 | 用途 | 现状 |
|---|---|---|
| 阿里云 OSS | 图片/视频对象存储（私有桶） | 已在用，后端代理转发 |
| 阿里云 CDN / DCDN | 静态资源 + 媒体全站加速 | 需开通，回源护源站 |

### 2.8 反向代理 / LB / TLS

| 技术 | 用途 | 为什么选 | 备选 |
|---|---|---|---|
| Nginx | 前端 LB + TLS 终止 + 限流 + 静态缓存 | 已在设计 | Caddy（自动 TLS 更简单）；云 ALB |
| 云 LB（ALB/SLB） | 多机流量分发 + 探活 | 生产必备 | 自建 Keepalived+VIP |
| Cloudflare | DNS + WAF + DDoS + 边缘缓存 | 10K 下护源站 | 阿里云 WAF |

### 2.9 可观测性（**取代 PG 写 request_logs 方案**）

| 技术 | 用途 | 为什么选 | 备选 |
|---|---|---|---|
| OpenTelemetry | 链路追踪 + 指标采集 | 厂商中立，前端+后端统一 | Zipkin（仅 trace） |
| Prometheus | 指标存储/告警 | 标配 | VictoriaMetrics（更省资源） |
| Grafana | 仪表盘 | 标配 | — |
| Loki | 日志聚合 | 轻量、标签索引 | ELK（重） |
| Alertmanager | 告警路由 | 标配 | — |

> **重要修订**：原 DESIGN §11 把 `request_logs` 落到 PG，在 10K 下每请求写库会压垮 PG。改为 **OTel 采样 + Prometheus 指标 + Loki 日志（异步批量）**，控制台实时数据改走 Prometheus 查询 + Redis 实时计数，不再逐请求写 PG。

### 2.10 CI/CD 与编排

| 技术 | 用途 | 为什么选 | 备选 |
|---|---|---|---|
| GitHub Actions | CI（lint/test/build/镜像） | 已在用 GitHub | GitLab CI |
| Docker | 容器化 | 环境一致 | — |
| Docker Compose | 单机/预发编排 | 简单 | — |
| **Kubernetes** | 生产编排 + HPA 自动扩缩 | 10K 需弹性 | Nomad（轻）/ Swarm（弱） |
| ArgoCD / Flux | GitOps 部署（可选） | 声明式 | 手动 kubectl |
| 镜像仓库 | GHCR / 阿里云 ACR | 就近 | Docker Hub（慢） |
| k6 | 负载测试（脚本化） | 比 autocannon 强，可写场景 | autocannon（快验） |

---

<a id="3"></a>
## 3. 各层在 10K 下的部署形态与容量

```
                         ┌──────────────┐
   用户(10K在线) ───────► │ Cloudflare   │ DNS+WAF+DDoS+边缘缓存
                         └──────┬───────┘
                                │ HTTPS
                         ┌──────▼───────┐
                         │ 云 LB(ALB)   │ 多可用区 + 健康检查
                         └──────┬───────┘
              ┌─────────────────┼─────────────────┐
        ┌─────▼─────┐    ┌─────▼─────┐      ┌─────▼─────┐
        │ Nginx #1  │    │ Nginx #2  │      │ Nginx #3  │  (TLS终止+限流+静态缓存)
        └─────┬─────┘    └─────┬─────┘      └─────┬─────┘
              └─────────────────┼─────────────────┘
              ┌─────────────────▼─────────────────┐
              │  Fastify API 集群 (6 实例, HPA)    │  Pod 化，无状态
              │  - 认证 / 账务 / 创作 / 电商 / 后台 │
              └───┬───────────────┬──────────────┬─┘
                  │               │              │
          ┌───────▼───┐   ┌───────▼────┐  ┌──────▼─────┐
          │ PostgreSQL │   │   Redis    │  │  BullMQ    │
          │ 主 + 副本  │   │ Sentinel   │  │ (视频队列) │
          │ PgBouncer │   │ 1主2从     │  │ Workers×N  │
          └───────────┘   └────────────┘  └────────────┘
                  │               │
          ┌───────▼───┐   ┌───────▼────┐
          │  OSS+CDN  │   │ Prometheus │
          │  媒体存储  │   │ Grafana    │
          └───────────┘   │ Loki/OTel  │
                          └────────────┘
```

| 组件 | 实例数 | 规格 | 扩缩依据 |
|---|---|---|---|
| Fastify API | 4–6 | 2–4 vCPU / 2–4GB | HPA：CPU>60% 或 RPS>3000 扩容 |
| Nginx | 2–3 | 1–2 vCPU | 前面挂云 LB，本身不脆 |
| PostgreSQL 主 | 1 | 8 vCPU / 16GB | 写瓶颈时升配或分库 |
| PostgreSQL 副本 | 1 | 4 vCPU / 8GB | 读 QPS>3000 加副本 |
| PgBouncer | 与主同机或独立 | 2 vCPU | 连接数逼近上限时扩 |
| Redis（Sentinel） | 3（1主2从） | 4 vCPU / 8GB | 内存>70% 扩；OTel 采样降压 |
| BullMQ Workers | 2–4（独立 Pod） | 2 vCPU | 队列积压>50 弹性扩 |
| Prometheus/Grafana | 1 | 4 vCPU / 8GB | 指标保留 15–30 天 |

---

<a id="4"></a>
## 4. 数据层：连接池 / 读写分离 / 分区 / 迁移

### 4.1 连接池（PgBouncer 事务模式）

```ini
# pgbouncer.ini
[databases]
huabu = host=pg-primary port=5432 dbname=huabu

[pgbouncer]
pool_mode = transaction
max_client_conn = 5000          # 应对 10K 连接尖峰
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 10
server_idle_timeout = 60
```

Node 侧：
```js
// pg.Pool（或 Drizzle 的 pg 驱动）
new Pool({
  connectionString: process.env.DATABASE_URL, // 指向 PgBouncer:6432
  max: 20,            // 每实例；6 实例 × 20 = 120 活跃连接 < PG max_connections
  idleTimeoutMillis: 30000,
  allowExitOnIdle: true,
});
```

### 4.2 读写分离

- Drizzle 配置 `read` 指向副本连接串，`write` 指向主。
- 适用：`/api/media` 列表、`/admin/stats`、详情页读取。
- 写后读一致性：写入主库后，强一致读仍走主（如刚下单查订单）；弱一致读走副本。

### 4.3 大表分区（10K 下必做）

- `credit_transactions` / `request_metrics`（若仍落库）/ `audit_logs` / `agent_calls`：**按月 RANGE 分区**。
```sql
CREATE TABLE credit_transactions_2026_08 PARTITION OF credit_transactions
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
```
- 自动建分区：cron 每月初建下月分区，旧分区可归档到冷存/OSS。

### 4.4 迁移工具

- 开发期：Drizzle Kit（`drizzle-kit generate` 生成 SQL migration）。
- 运行时兜底：保留 `server.js` 内置 `CREATE TABLE IF NOT EXISTS` 自动建表（现有模式），保证新 clone 直接跑。
- 数据回填（如现有 91 条 media 补 `category`）：一次性 migration 脚本，跑完即删。

---

<a id="5"></a>
## 5. 缓存与实时层：Redis 高可用 / 限流 / 在线统计 / WS

### 5.1 Redis Sentinel（HA，非单机）

```ini
# redis.conf（每节点）
maxmemory 6gb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec
```

Sentinel 配置（3 节点）：
```ini
sentinel monitor mymaster 10.0.0.21 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 10000
```
ioredis 连接串：`redis://:pass@mymaster?sentineInodes=10.0.0.31:26379,10.0.0.32:26379,10.0.0.33:26379`

### 5.2 全局限流（跨节点，Redis Token Bucket）

> 原 nginx `limit_req` 是**单节点**的，多 Nginx 不共享。10K 下必须 Redis 全局限流兜底。

```js
// 简化 Token Bucket（ioredis + lua 脚本保证原子）
async function rateLimit(key, capacity, refillPerSec, cost=1) {
  const now = Date.now()/1000;
  const lua = `
    local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
    local tokens = tonumber(data[1]) or ARGV[1]
    local ts = tonumber(data[2]) or ARGV[3]
    local delta = math.min(ARGV[1], tokens + (ARGV[3]-ts)*ARGV[2])
    if delta < ARGV[4] then return 0 else return 1 end`;
  // 用 redis.eval 执行，key=rate:{ip}:{route}
}
```
- 登录：`capacity=20, refill=1/s`（单 IP 宽限少量，防爆）
- API 通用：`capacity=100, refill=30/s`（每 IP）
- 全局 API：`capacity=6000, refill=4000/s`（全站峰值护栏）

### 5.3 在线统计（10K 心跳）

```redis
# 心跳：用户每 30s ZADD
ZADD online:users <timestamp> <userId>
# 统计：ZCOUNT 近 60s
ZCOUNT online:users <now-60> +inf
# 定时清理离线：ZREMRANGEBYSCORE online:users 0 <now-90>
```
- 写入频率低（30s/人），10K → 333 writes/s，Redis 轻松。

### 5.4 WebSocket（协作画布，可选）

- 独立 `ws` 服务 Pod，多副本通过 **Redis Pub/Sub adapter** 跨节点广播节点移动。
- 仅当用户启用"实时协作画布"才启；否则画布为本地单人编辑（§F 预留）。

---

<a id="6"></a>
## 6. 异步与队列：视频生成 / Webhook / 通知

### 6.1 BullMQ（基于 Redis，纯 JS）

```js
// 生产者（API 内）
await videoQueue.add('render', { jobId, projectId, inputRef, creditsCost },
  { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000 });

// Worker（独立进程/Pod）
videoQueue.process(async (job) => {
  const ok = await renderVideo(job.data);
  if (ok) await finalize(job.data);   // 写 video_jobs 状态 + 扣费确认
  return { ok };
});
```

- 队列积压监控：BullMQ 面板 / Prometheus exporter。
- 优先级：付费用户 `priority=1`，免费 `priority=5`。
- 弹性 Worker：K8s HPA 按队列长度扩缩。

### 6.2 Webhook（支付回调）

- `/api/credits/orders/callback/:channel` 同步验签后，**入队**异步处理到账，立即返回 200（防支付宝/微信超时重试打满）。
- 验签失败 → 记 `audit_logs` + 返回 400。

---

<a id="7"></a>
## 7. 搜索层：媒体与商品检索

### 7.1 关键词（tsvector，零组件）

```sql
ALTER TABLE products ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', title||' '||coalesce(subtitle,''))) STORED;
CREATE INDEX idx_prod_search ON products USING GIN(search_tsv);
-- 查： WHERE search_tsv @@ plainto_tsquery('simple', $1)
```
中文：`simple` 词典按字切；更好用 `zhparser`（需扩展）或外部 Meilisearch。

### 7.2 语义 / 以图搜图（pgvector）

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE media ADD COLUMN embedding vector(1536);  -- 模型维度
CREATE INDEX ON media USING hnsw (embedding vector_cosine_ops);
-- 相似： ORDER BY embedding <=> $1 LIMIT 12
```
- 嵌入由 Agent Layer 调用 embedding 模型生成，异步写回。

---

<a id="8"></a>
## 8. 可观测性（取代 PG 写日志方案）

### 8.1 采集架构

```
Fastify(pino日志) ──OTel──► Collector ──► Loki(日志)
Fastify(metrics)  ──OTel──► Collector ──► Prometheus(指标) ──► Grafana
前端(OTel Web)    ─────────► Collector ──► Tempo(链路)
```

### 8.2 关键指标（Grafana 面板）

| 指标 | 来源 | 告警 |
|---|---|---|
| `http_requests_total` | OTel | — |
| `http_request_duration_p95` | OTel histogram | > 1s 告警 |
| `online_users` | Redis ZCOUNT | — |
| `credit_balance_total` | PG 聚合（定时） | — |
| `video_queue_depth` | BullMQ | > 50 告警 |
| `redis_memory_used` | Redis exporter | > 70% 告警 |
| `pg_active_connections` | PG exporter | > 80% max 告警 |
| `5xx_rate` | OTel | > 2% 告警 |

### 8.3 日志策略

- 仅 ERROR/WARN 落 Loki（异步批量），INFO 抽样 1%–5%。
- 审计日志（`audit_logs`）仍落 PG（量小、需强一致、不可删）。

---

<a id="9"></a>
## 9. CI/CD 与容器化

### 9.1 Dockerfile（多阶段，前端+后端一镜像）

```dockerfile
# 阶段1：前端构建
FROM node:22-alpine AS fe
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build          # 输出 dist/build2

# 阶段2：运行时
FROM node:22-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=fe /app/dist ./dist
COPY drizzle.config.ts ./
EXPOSE 3001
CMD ["node", "server/server.js"]
```

### 9.2 GitHub Actions（CI）

```yaml
name: ci
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run lint
      - run: npm run test            # Vitest
      - run: npm run build
      - run: npm run test:e2e        # Playwright
  image:
    needs: build-test
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@v6
        with: { push: true, tags: ghcr.io/marinerfan123/workaigc:${{ github.sha }} }
```

### 9.3 部署（K8s 片段示意）

```yaml
# deployment.yaml（节选）
spec:
  replicas: 4
  strategy: { type: RollingUpdate, maxSurge: 1, maxUnavailable: 0 }
---
# hpa.yaml
spec:
  minReplicas: 4
  maxReplicas: 12
  metrics: [{ type: Resource, resource: { name: cpu, target: { type: Utilization, averageUtilization: 60 } } }]
```

---

<a id="10"></a>
## 10. 安全与边缘（WAF / DDoS / TLS）

- **Cloudflare** 前置：DNS 托管、HTTPS 强制、WAF 规则（OWASP）、DDoS L3/L7 防护、Bot 管理。
- **TLS**：Cloudflare 边缘证书 + 源站 Full(strict) 或 Caddy 自动 Let's Encrypt。
- **Secrets**：`.env` 不入镜像；经 K8s Secret / Docker Secret 注入；敏感 AK/SK 用 SOPS 加密提交。
- **最小权限**：PG 应用账号仅 CRUD 业务库；Redis 设密码 + 绑定内网。
- **防爆破**：Redis 全局限流（§5.2）+ 失败计数封 IP（ops_bot）。

---

<a id="11"></a>
## 11. 故障模式与容量兜底（10K 特有）

| 故障场景 | 影响 | 兜底 |
|---|---|---|
| Redis 主挂 | 限流/会话/队列失效 | Sentinel 自动 failover（<10s）；限流降级为 nginx 单节点宽松限 |
| PG 主挂 | 写全断 | 流复制自动提副本（或手动）；只读功能仍可用 |
| 某 Nginx 挂 | 部分流量 | 云 LB 探活剔除 |
| 视频队列积压 | 生成变慢 | Worker HPA 弹性扩 + 优先级调度 |
| CDN 回源风暴 | 源站压力 | CDN 缓存命中率 >95%；回源限流 |
| 突发 10K→20K | 资源满 | HPA 扩容上限 + Cloudflare 排队/Challenge |
| 支付回调洪峰 | 接口拥塞 | 入队异步 + 立即 200 |

---

<a id="12"></a>
## 12. 落地顺序与配置速查

### 12.1 顺序（与 DETAILED_SPEC §J 对齐，规模升级）

1. **Phase 0 基建**：Fastify 接入 + PgBouncer + Redis Sentinel + OTel/Prometheus/Loki 最小可用 + Dockerfile + 分区脚本。
2. **Phase 1 认证/账务**：在 Fastify 上实现 §C 接口 + §D 原子计费；前端 TanStack Query + AuthContext。
3. **Phase 2 总控台/智能体**：SSE（单 admin）+ BullMQ + Agent Layer。
4. **Phase 3 部署**：K8s manifest + HPA + Cloudflare + TLS + 压测（k6 跑 10K 在线场景）。
5. **Phase 4 创作流水线** / **Phase 5 电商**：按节点接入。

### 12.2 10K 配置速查

| 参数 | 值 |
|---|---|
| Fastify 实例 | 4–6（HPA 4→12） |
| pg.Pool max / 实例 | 20 |
| PgBouncer default_pool_size | 20；max_client_conn 5000 |
| PG max_connections | 300 |
| Redis 内存 | 6GB/节点；Sentinel 1主2从 |
| 在线心跳 ZSET TTL | 90s 清理 |
| 全局 API 限流 | bucket 6000 / refill 4000s |
| 登录限流 | bucket 20 / refill 1s |
| 视频 Worker | 2–4（按队列深度 HPA） |
| 静态/媒体 | 100% CDN |
| 日志 | ERROR/WARN 全量 + INFO 抽样 5% → Loki |
| 监控保留 | Prometheus 30d / Loki 15d |

---

> 本文件优先于 `DESIGN_AUTH_CREDITS.md §14` 与 `DETAILED_SPEC.md §A` 的"千人在线"口径。
> 需要我把任一技术（如 Fastify 迁移步骤、BullMQ 完整代码、K8s 全套 yaml、Meilisearch 接入）再往下钻到"可直接复制运行"的级别，说"展开 X"即可。
