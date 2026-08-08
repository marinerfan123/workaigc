# 系统总体设计书（Master Design）— AI 创作 · 电商 · 智能体一体化平台

> **文档定位**：本文件是整套系统的「总纲 / 母文档」。
> 它把三份子文档收口成一份可以直接拿去立项、评审、招人、写代码的设计依据：
> - `DESIGN_AUTH_CREDITS.md` —— 业务架构总览（15 节：认证 / 账务 / 总控台 / 全局智能体 / 创作流水线 / 电商 / 千人在线 / 模块化）
> - `DETAILED_SPEC.md` —— 实现级规范（§A 部署配置 / §B 全表 DDL / §C API 契约 / §D 计费一致性 / §E 编排 / §F–§G 节点契约 / §H 监控 / §I 安全 / §J 配置总表）
> - `TECH_STACK.md` —— 技术栈清单 + 5K–10K 规模设计（§1 容量数学 / §2 技术栈 / §3–§12 落地片段）
>
> **阅读路线**：先读本文 Part I（理论）→ Part II（技术选型矩阵）→ Part III（架构）→ Part IV（模块）→ 落地看 Part V；需要逐字段 DDL/接口报文去对应子文档查。三者口径以本文件 + `TECH_STACK.md` 为准。
>
> **状态**：设计评审阶段，尚未编写业务代码。
> **规模基线**：5,000 ~ 10,000 并发在线（下称「10K 基线」）。

---

## 目录

- Part I 总体理论与设计成果
- Part II 整体技术栈决策 + 每点位技术选型矩阵
- Part III 系统总体架构
- Part IV 六大模块逐模块详细设计
- Part V 落地实施方案（Phase 0–5）
- Part VI 部署与运维
- Part VII 安全与合规
- Part VIII 验收标准与压测
- 附录 A 术语表 / 附录 B 全局错误码 / 附录 C 配置总表 / 附录 D 文档索引

---

# Part I　总体理论与设计成果

## I.1　产品愿景与系统定位

**一句话定位**：一个面向「内容创作者 + 中小电商卖家」的 **AI 创作 → 资产管理 → 电商变现** 一体化云平台，所有重节点都可由 **全局智能体（Agent）** 协助完成，并配 **运营总控台** 做全局态势感知。

**四类用户**：
1. **C 端创作者**：用点子孵化、小说转剧本、无限画布分镜、视频生成、剧集管理；逛商城买素材/模板。
2. **B 端卖家**：开店、上架商品、用智能体写详情页、承接订单、售后。
3. **平台运营 / 管理员**：用户管理、手动充值、消费流水、总控台、智能体管理、电商后台。
4. **系统本身（自动化运营智能体 ops_bot）**：异常 IP 封禁、错误率告警、简单咨询应答。

**核心理论命题**：
- 系统不是「一堆功能」，而是 **「横切底座 + 可注册能力节点」** 的开放架构。新增一种能力 = 注册一条 `skill_registry` 记录 + 一个 Agent 配置，不开新接口、不改核心。
- 计费、审计、监控、认证是 **横切关注点（cross-cutting）**，被所有节点复用，不重复造。

## I.2　七条核心设计原则

| # | 原则 | 落地体现 |
|---|---|---|
| P1 | **无状态优先** | JWT 认证（access 2h / refresh 30d），Node 进程无会话，PM2/K8s 随便水平扩。 |
| P2 | **横切底座复用** | Auth / Credits / Agent Layer / Skills / Console 五底座被所有节点共用。 |
| P3 | **能力可注册（Registry）** | 新增 skill/agent 只写 `skill_registry` + `agents` 记录，节点 API 形态不变。 |
| P4 | **节点独立且可编排** | 每个节点 = 独立 REST + 独立页面；Workflow 引擎只顺序调用节点 API 传产物，支持断点续跑/回退。 |
| P5 | **计费强一致、观测最终一致** | 余额用 PG 行锁原子预扣（绝不超扣）；日志/指标异步采集（绝不每请求写主库）。 |
| P6 | **零不必要原生依赖** | 密码 `crypto.scrypt`、JWT `jose`、队列 `BullMQ`、搜索 `tsvector/pgvector`——优先用 Node 内置或纯 JS，规避编译与原生模块坑。 |
| P7 | **故障可降级、容量可弹性** | 每依赖都有降级路径；K8s HPA 按 CPU/QPS 自动 4→12 扩；队列 Worker 独立扩。 |

## I.3　规模理论（10K 基线容量数学）

> 完整推导见 `TECH_STACK.md §1`。此处给结论与模型。

**Little's Law 应用**：`L = λ × W`（在途请求数 = 到达率 × 平均处理时长）。
- 10K 在线，活跃比 10–20% → 并发活跃用户 1K–2K。
- 人均操作频率 ~1–2 次/分钟 → 平均 RPS ≈ **1K–2K**，突发（活动/秒杀）峰值 **4K–6K RPS**。
- 单 Node 实例（Fastify，pino，无阻塞）处理能力 ≈ 1.5K–3K RPS（I/O 密集，受 PG/Redis 往返制约）。
- ⇒ **Node 实例数 = 4–6**（留余量到 8）。

**数据库连接容量**：
- 每实例连接池 ~20，PgBouncer 事务模式把 6×20=120 活跃连接收敛到 PG 主库 ~30 连接 + 只读副本分担读。
- 主库连接数预留 `< 80% max_connections`，避免雪崩。

**内存容量（Redis）**：在线 ZSET（10K 用户 × ~50B）+ 限流桶 + 黑名单 + 队列 ≈ **4–6 GB**，Sentinel 三节点 HA。

**带宽容量**：媒体/静态 100% 走 CDN，源站仅需承受 API + 回源，带宽压力 ≈ 0。

## I.4　一致性理论

| 数据 | 一致性要求 | 方案 |
|---|---|---|
| 用户余额 `users.credits_balance` | **强一致**（绝不超扣） | PG 行锁 `UPDATE ... SET balance = balance - :cost WHERE id=:uid AND balance >= :cost RETURNING`；失败回退写 `refund`。 |
| 积分流水 `credit_transactions` | 强一致 + 只追加 | 每笔带 `balance_after`，天然对账；不 UPDATE/DELETE。 |
| 订单 `orders` | 强一致 | 下单事务内行锁库存（`UPDATE ... WHERE stock >= n`）防超卖。 |
| 请求日志 / 审计 / 指标 | **最终一致** | OTel 采样 + 异步导出 Loki/Prometheus；不写主库。 |
| 在线统计 / 限流 | 最终一致 | Redis ZSET / Token Bucket，秒级误差可接受。 |

**幂等理论**：所有写操作带客户端 `task_id`，PG 唯一约束 + `ON CONFLICT DO NOTHING` 保证重试安全（生成、支付回调、下单）。

## I.5　模块化理论（能力注册 + 编排）

- **节点（Node）**：一个自包含的「输入→处理→输出」单元，对外暴露统一 REST 形态（见 `DETAILED_SPEC §E.1`）：`POST /api/nodes/:nodeKey/run`、`GET /api/nodes/:nodeKey/status/:taskId`。
- **能力（Skill/Agent）**：节点内部调用的 AI 能力，由 `skill_registry` 注册（`node_key`、`agent_key`、`provider`、`params_schema`、`cost_credits`、`enabled`）。
- **编排（Workflow）**：状态机 `draft→running→(node_running→node_done)→done/failed`，只顺序调用节点 API 并传递 `artifacts`，支持 `resume_from` 断点续跑与 `rollback_to` 回退。
- **同一套接口两种用法**：单独用 = 直接调节点 REST；整体联动 = Workflow 调同一批 REST。零额外开发。

## I.6　故障域与降级理论

> 完整表见 `TECH_STACK.md §11`。核心：

| 故障 | 降级路径 |
|---|---|
| Redis 不可用 | 限流退化为内存（单实例）、在线统计失效、队列暂停；黑名单退化内存（多实例不共享，故生产 Redis 必须 Sentinel HA）。 |
| PG 主库不可用 | 读走只读副本；写操作（生成/下单）返回 `503 + ERR_MAINTENANCE`，前端排队提示。 |
| 某供应商 API 超时 | dispatcher 令牌桶 + round-robin 切下一家；全部失败 → 任务标 `failed` + 回退积分。 |
| CDN 回源失败 | OSS 直链（私有桶后端代理）兜底，慢但不挂。 |
| 视频队列积压 | Worker 池 HPA 扩容 + 付费用户优先级 + 超时转异步通知。 |

---

# Part II　整体技术栈决策 + 每点位技术选型矩阵

## II.1　分层技术栈总表（详见 `TECH_STACK.md §2`）

| 层 | 选型 | 版本 | 备选 | 决策理由 |
|---|---|---|---|---|
| 前端框架 | React + TypeScript | 18 / 5 | Vue3 | 现有代码库即 React，人才池大。 |
| 构建 | Vite | 5 | Webpack | 快、ESM 原生、Tailwind v4 官方插件。 |
| 样式 | Tailwind CSS v4 | 4 | CSS Modules | 设计token系统化、原子化、体积小。 |
| 状态 | Zustand | 4 | Redux | 轻、无 Provider 嵌套、适合多 store。 |
| 服务端状态 | TanStack Query | 5 | SWR | retry/缓存/分页开箱即用。 |
| 动画 | Framer Motion | 11 | GSAP | 声明式、与 React 协作好（高级感微交互）。 |
| 校验 | Zod | 3 | Yup | 类型推导、前后端共用 schema。 |
| 路由 | react-router-dom | 6 | — | 路由守卫 `RequireAuth/RequireAdmin`。 |
| 后端框架 | **Fastify** | 5 | Express/Koa | 纯 JS、比 Express 快 2–3×、内置 pino+Ajv、schema 校验。 |
| 日志 | pino | 9 | winston | 结构化、零阻塞、OTel 友好。 |
| 密码哈希 | crypto.scrypt | Node22 内置 | bcrypt/argon2 | 零原生依赖、N=16384 参数可调。 |
| JWT | jose | 5 | jsonwebtoken | 维护活跃、Edge/Node 通用、HS256。 |
| ORM | Drizzle | 0.36 | Prisma/SQL | 类型安全 SQL、零运行时开销、Kit 迁移。 |
| PG 驱动 | pg | 8 | — | Node 标准。 |
| 连接池 | PgBouncer | 1.23 | pgpool-II | 事务模式、轻、稳。 |
| 读写分离 | PG 流副本 | 17 | — | 只读副本分担媒体/商品读。 |
| 缓存/限流/队列/在线/PubSub | Redis 7 + Sentinel | 7.2 | — | 单组件覆盖 5 个职责；Sentinel HA。 |
| 队列 | BullMQ | 5 | pg+SKIP LOCKED | 成熟、延迟/重试/优先级、基于 Redis。 |
| 关键词搜索 | tsvector | PG 内置 | — | 零组件、中文可用（需词典）。 |
| 语义搜索 | pgvector | 0.7 | — | 以图搜图/向量召回，复用 PG。 |
| 重搜索 | Meilisearch | 1.x | Elasticsearch | 中文分词更好（按需升级）。 |
| 对象存储 | 阿里云 OSS | — | S3 | 现有桶、私有+后端代理。 |
| CDN | Cloudflare / 阿里云 CDN | — | — | 静态/媒体分发、WAF、TLS。 |
| 反向代理/LB/TLS | Nginx + 云 LB | 1.27 | Traefik | 限流 zone、健康检查、gzip/brotli。 |
| 边缘安全 | Cloudflare | — | — | WAF、DDoS、Bot 管理、免费 TLS。 |
| 可观测 | OTel + Prometheus + Grafana + Loki | — | — | trace/metric/log 三件套，取代 PG 写日志。 |
| CI | GitHub Actions | — | GitLab CI | 与 GitHub 仓库同源。 |
| 容器 | Docker 多阶段 | — | — | 前端+后端单镜像。 |
| 编排 | Kubernetes + HPA | 1.30 | Docker Compose | 自动扩 4→12，HPA 按 CPU/QPS。 |
| 压测 | k6 | — | autocannon | 脚本化、云执行、指标全。 |

## II.2　关键技术决策与备选（需你最终拍板）

1. **后端框架 Fastify 迁移**：现有 `server.js` 是原生 Node HTTP。建议 **新模块全走 Fastify**，legacy（`/api/media`、OSS 代理、静态）渐进迁，`server.js` 阶段保留为「Fastify 宿主 + 静态 + 兼容层」。→ **默认采用，可复议**。
2. **编排 Kubernetes vs 简化**：10K 推荐 **K8s + HPA**。若运维不想碰 K8s，降级为「多机 Docker Compose + Nginx LB + 手动扩」（`TECH_STACK §9.3` 可改写）—— **默认 K8s，备选 Docker Compose，等你确认**。
3. **搜索**：先用 **PG 内置（tsvector + pgvector）** 足够；中文分词要求高再上 **Meilisearch**—— **默认 PG 内置，按需升级**。
4. **密码找回**：本期不含（需 SMTP）——可加，建议 Phase 2+。

## II.3　★ 每点位 → 技术选型矩阵（用户核心诉求：每个点位代码用什么技术）

> 下表是「功能点位 → 具体技术/库/落地文件」的映射，照表写代码即可。

### II.3.1　前端点位

| 点位 | 技术 | 库/版本 | 落点（示例） |
|---|---|---|---|
| 应用外壳 / 主题切换 | React + CSS 变量 | react@18 + tailwind v4 `dark:` | `src/App.tsx`、`src/index.css` |
| 路由 + 守卫 | react-router-dom@6 + 高阶组件 | `RequireAuth`/`RequireAdmin` | `src/routes/` |
| 全局状态（用户/积分） | Zustand | `useAuthStore`/`useCreditsStore` | `src/stores/` |
| 服务端数据（列表/分页/重试） | TanStack Query@5 | `useQuery`/`useInfiniteQuery` | `src/hooks/` |
| 表单校验 | Zod + react-hook-form | `z.object()` schema | `src/components/forms/` |
| 登录/注册页 | Tailwind + Framer Motion 入场 | `framer-motion@11` | `src/pages/Login`、`Register` |
| 顶栏用户菜单 + 积分徽章 | Tailwind + Zustand 订阅 | — | `src/components/Layout/UserMenu` |
| 媒体面板（参考图/批量） | 已实现，接入真实 API | `apiGetMedia` | `src/components/MediaPicker.tsx` |
| 生成栏（余额闸门） | Zustand + 轮询 | `pollTaskUntilDone` | `src/components/GenerationBar.tsx` |
| 总控台（实时看板） | SSE + Recharts/ECharts | `EventSource` + `echarts@5` | `src/pages/Admin/Console` |
| 无限画布（分镜） | **Konva** 或 **tldraw** | `react-konva` | `src/pages/Studio/Canvas` |
| 电商详情页 | Tailwind + Framer Motion | — | `src/pages/Shop/ProductDetail` |
| 图表库 | ECharts（国内友好） | `echarts-for-react` | 所有 dashboard |

### II.3.2　后端点位

| 点位 | 技术 | 库/版本 | 落点（示例） |
|---|---|---|---|
| HTTP 服务（新模块） | Fastify | `fastify@5` | `server/fastify/` |
| 静态 + legacy 兼容 | 原生 Node HTTP | — | `server/server.js`（保留） |
| 路由/校验 | Fastify 内置 schema（Ajv） | — | 各 `plugins/*.routes.js` |
| 日志 | pino | `pino@9` | `server/lib/logger.js` |
| 密码哈希 | crypto.scrypt | Node22 | `server/lib/password.js` |
| JWT 签发/验签 | jose | `jose@5` | `server/lib/jwt.js` |
| 认证中间件 | Fastify `onRequest` 钩子 | + API_TOKEN fallback | `server/plugins/auth.js` |
| ORM / 查询 | Drizzle + pg | `drizzle-orm@0.36` | `server/db/schema.ts` |
| 原子计费 SQL | 原生 `pg` 事务 | `UPDATE ... WHERE balance>=` | `server/lib/billing.js` |
| 限流（单节点） | @fastify/rate-limit | — | `server/plugins/ratelimit.js` |
| 限流（全局） | Redis Token Bucket（Lua） | `ioredis@5` | `server/lib/globalLimit.js` |
| 在线统计 | Redis ZSET | — | `server/lib/online.js` |
| 队列（视频/Webhook/通知） | BullMQ | `bullmq@5` | `server/queue/` |
| 支付回调验签 | 自研 adapter + crypto | 微信/支付宝 SDK | `server/lib/payments/` |
| SSE 推送 | Fastify `@fastify/sse` | — | `server/plugins/sse.js` |
| 智能体调度 | dispatcher + 注册表 | `skill_registry` | `server/lib/agent.js` |
| 搜索 | tsvector / pgvector | `pg` + `pgvector` | `server/lib/search.js` |

### II.3.3　数据 / 基础设施点位

| 点位 | 技术 | 落点 |
|---|---|---|
| 主数据库 | PostgreSQL 17（流副本） | 云 RDS / 自建 |
| 连接收敛 | PgBouncer 事务模式 | `pgbouncer.ini` |
| 缓存/队列/限流/在线/PubSub | Redis 7 Sentinel（3 节点） | `redis.conf` + sentinel |
| 对象存储 | 阿里云 OSS（私有桶 + 后端代理） | `server/oss/` |
| CDN / 边缘安全 | Cloudflare | DNS + WAF |
| 反向代理 / LB / TLS | Nginx + 云 LB | `app.conf` |
| 可观测 | OTel collector + Prometheus + Grafana + Loki | `otel-collector.yaml` |
| CI / 容器 / 编排 | GitHub Actions + Docker 多阶段 + K8s HPA | `.github/workflows/` + `Dockerfile` + `deploy/*.yaml` |
| 压测 | k6 | `scripts/load/*.js` |

---

# Part III　系统总体架构

## III.1　分层架构（见图 `arch_layered`）

```
┌─────────────────────────────────────────────────────────────┐
│  客户端层：Web(React/Vite) / 移动H5  —  Nginx + Cloudflare(边缘) │
└─────────────────────────────────────────────────────────────┘
            │  HTTPS / TLS  │  WAF / DDoS / Bot / 限流(limit_req)
┌─────────────────────────────────────────────────────────────┐
│  接入层：云 LB → Nginx(健康检查+gzip+brotli) → 多机 Node 集群   │
│           Node = Fastify(新) + server.js(legacy静态/兼容)       │
│           PM2 cluster / K8s Pod（4→12 自动扩）                  │
└─────────────────────────────────────────────────────────────┘
       ┌──────────────┬──────────────┬──────────────┐
       │  六大业务模块  │  横切底座(5)   │  自动化运营    │
       │ M1认证 M2账务  │ Auth Credits  │  ops_bot      │
       │ M3总控台 M4智能│ Agent Skills  │  (规则引擎)   │
       │ M5创作  M6电商 │ Console       │              │
       └──────────────┴──────────────┴──────────────┘
            │                │                │
┌─────────────────────────────────────────────────────────────┐
│  基础设施层：PgBouncer → PG主+只读副本 │ Redis Sentinel │ OSS+CDN │
│  异步：BullMQ(视频/Webhook/通知)  Worker独立HPA              │
│  可观测：OTel→Prometheus/Grafana/Loki                       │
└─────────────────────────────────────────────────────────────┘
```

## III.2　模块依赖与数据流向

- **依赖方向**：业务模块 → 横切底座 → 基础设施。底座不反向依赖业务。
- **复用关系**：
  - 所有写操作经 `Credits` 底座（M2）→ `credit_transactions` + `users.balance`。
  - 所有 AI 调用经 `Agent/Skills` 底座（M4）→ `agents` / `agent_calls` / `skill_registry`。
  - 所有页面经 `Auth` 底座（M1）→ JWT + `RequireAuth`。
  - 所有实时数据经 `Console` 底座（M3）→ SSE + Redis PubSub。
- **数据流示例（生成图片）**：前端 → Nginx → Node(auth → billing 预扣 → agent 调度 → OSS 存图) → 写 `media`+`credit_transactions` → 事件入 Redis → SSE 推总控台。

## III.3　一次请求的生命周期

**登录**：Client → Cloudflare(WAF) → Nginx(限流 login zone) → Node `/api/auth/login` → `password.js`(scrypt 验) → 服务端会话/JWT 签发 → 写 `users.last_login_at` → 设置 `HttpOnly`、`Secure`、`SameSite` Cookie；禁止使用 localStorage 保存令牌。

**生成（计费）**：Client(带 Bearer) → Node(auth 中间件) → `billing.js` 原子预扣（`UPDATE ... WHERE balance>=cost RETURNING`）→ dispatcher 调供应商（`agent.js` 查 `skill_registry`）→ OSS 上传 → 成功写 `consume` 流水 / 失败 `refund` 回退 → SSE 推 console。

**支付回调**：支付网关 → Cloudflare → Nginx → Node `/api/credits/orders/callback/:channel` → 验签 → 幂等(`pay_order_no` 唯一) → 写 `recharge` 流水 + 加余额 → 入 BullMQ 通知队列 → 推用户。

---

# Part IV　六大模块逐模块详细设计

> 每个模块给：职责 / 数据模型(§B 引用) / 关键接口(§C 引用) / 技术实现要点 / 智能体挂载点 / 耦合关系。深度字段见子文档。

## M1　认证与多用户（Phase 1）
- **职责**：注册、登录、JWT 签发/刷新/登出、角色(admin/user)、免费额度赠送。
- **数据模型**：`users`(§B.1)、`token_blacklist`(§B.4)。
- **接口**：§C.1–§C.5（`/api/auth/*`）。
- **技术要点**：scrypt(N=16384) 哈希；jose HS256（access 2h / refresh 30d，jti 黑名单走 Redis）；登录统一报错防枚举；`@fastify/rate-limit` + 全局 Redis 桶防爆破；保留旧 `API_TOKEN` 作 admin fallback。
- **智能体**：无（基础底座）。
- **耦合**：被 M2–M6 全部依赖（守卫 + 计费归属 `owner_id`）。

## M2　账务积分（Phase 1）
- **职责**：每用户余额、消费/充值/后台调整流水、生成前原子预扣、失败回退、本人流水查询、管理员手动充值。
- **数据模型**：`credit_transactions`(§B.2)、`recharge_orders`(§B.3)。
- **接口**：§C.6–§C.8；计费 SQL 见 §D.1–§D.3。
- **技术要点**：PG 行锁原子预扣（10K 并发绝不超扣）；`balance_after` 只追加对账；`task_id` 幂等；电商防超卖行锁见 §D.4。
- **智能体**：无（被 M4/M5/M6 计费调用）。
- **耦合**：被 M4 智能体调用计费、M5 创作计费矩阵、M6 积分抵现共用。

## M3　运营总控台（Phase 2）
- **职责**：全局流水/流量/动向/日志/告警态势感知（admin 专属，区别于操作型 Admin 页）。
- **数据模型**：`request_logs`(§B.5)、`audit_logs`(§B.6)（**仅采样/异步落库**，10K 下不每请求写主库，见 TECH_STACK §8）。
- **接口/协议**：§H.1 SSE（`metrics/traffic/flow/log/agent` 五事件）；§H.2 指标告警；§H.3 ops_bot 规则。
- **技术要点**：SSE 原生推送 + Redis PubSub 扇出；6 KPI + 实时 QPS 曲线 + 动向趋势 + 全局流水滚动 + 日志流 + 告警中心；OTel 取代 PG 写日志。
- **智能体**：ops_bot（自动封禁 IP / 错误率告警 / 咨询应答草稿）。
- **耦合**：监控 M1–M6 全部事件；消费 M2 流水、M4 agent 调用、M5/M6 业务事件。

## M4　全局智能体层（Phase 2）
- **职责**：把 AI 能力建模为一等公民——监控看板 + 管理页 + 自动化运营智能体。
- **数据模型**：`agents`/`agent_providers`/`agent_calls`/`agent_rules`/`agent_rule_logs`(§B.9)。
- **接口**：§H（并入总控台）+ `/api/admin/agents/*`(§12.6)。
- **技术要点**：dispatcher 令牌桶 + round-robin 多供应商；`skill_registry` 可插拔；调用明细只追加（`agent_calls`）；错误率/延迟/成本实时看板。
- **智能体**：本层即智能体中枢；被 M5/M6 各节点挂载（见 §13.5 / §15.6）。
- **耦合**：被 M5（创作 skill）、M6（电商 8 智能体）、M3（ops_bot）共用。

## M5　创意生产流水线（Phase 4）
- **职责**：点子 → 剧本 → 无限画布分镜 → 视频 → 剧集，五阶段可回退迭代；每个节点挂 skill/agent；无限画布技术预留。
- **数据模型**：`projects/ideas/scripts/scenes/canvas_nodes/storyboards/video_jobs/episodes/skill_registry`(§B.7)。
- **接口/契约**：§E（编排）+ §F（节点契约）。
- **技术要点**：节点统一 REST（§E.1）+ Workflow 状态机（§E.2 断点续跑/回退）；`canvas_nodes` 存坐标+data 预留多人协同；视频走 BullMQ 异步；计费矩阵（点子低/剧本中/分镜按张/视频高）复用 M2。
- **智能体挂载**：点子=头脑风暴、剧本=编剧、分镜=漫画布局、视频=视频生成、剧集=发布编排（均注册 `skill_registry`）。
- **耦合**：依赖 M1/M2/M4；监控接入 M3。

## M6　电商模块（Phase 5）
- **职责**：商城首页/详情/购物车/结算/订单/卖家中心/电商后台；8 节点每个挂智能体；积分抵现 + 真实支付。
- **数据模型**：`shops/products/product_skus/cart_items/orders/order_items/coupons/reviews/shipments`(§B.8)。
- **接口/契约**：§G（八节点×智能体 + 详情页字段 + 下单 6 步）。
- **技术要点**：详情页高并发读（Redis 缓存 + CDN + 只读副本）；下单削峰队列 + 库存行锁防超卖（§D.4）；积分抵现走 M2 原子预扣；微信/支付宝复用充值订单思路。
- **智能体挂载（8 节点）**：上架=product_writer、详情=product_designer、营销=copywriter、客服=smart_cs(复用 ops_bot)、推荐=recommender、搜索=search_agent、交易=deal_agent、售后=aftersale_agent（§15.3）。
- **耦合**：依赖 M1/M2/M4；支付 + 监控接 M3。

---

# Part V　落地实施方案（Phase 0–5）

> 规模统一按 10K 基线（`TECH_STACK.md` 口径）。每个 Phase 给：交付物 / 关键技术 / 验收 / 代码落点。

## Phase 0　基础设施底座（先于一切）
- **交付物**：PgBouncer 事务池、Redis Sentinel(3)、PG 只读副本、Nginx(LB+TLS+limit_req+healthz)、OTel/Prom/Grafana/Loki、BullMQ、k6 压测基线、`.env.example`、Dockerfile 多阶段。
- **关键技术**：`TECH_STACK §3–§12` 全文片段可直接复制运行。
- **验收**：k6 健康检查 p99<50ms；登录 1K 并发错误率 0、p99<300ms；生成吞吐 >200 rps。
- **代码落点**：`deploy/`、`server/lib/`(logger/password/jwt/online/globalLimit)、`scripts/load/`。

## Phase 1　认证 + 账务核心（地基，建议首个开工）
- **交付物**：`users`/`credit_transactions`/`recharge_orders` 表；scrypt + jose + requireAuth 中间件(+API_TOKEN fallback)；register/login/refresh/logout/me；登录限流；`/api/generate` 接 JWT + 原子预扣 + 成功落账/失败回退；本人流水；管理员手动充值 API。
- **前端**：AuthContext 替换 ApiTokenContext；apiFetch 自动带 JWT + 401 自动 refresh；`/login` `/register`；`RequireAuth/RequireAdmin`；顶栏用户菜单 + 实时积分徽章；GenerationBar 余额闸门。
- **验收**：多用户隔离；1000 并发生成不超扣；余额不足拦截；刷新 token 续期。
- **代码落点**：`server/lib/{password,jwt,billing,auth}.js`、`server/plugins/auth.js`、`server/fastify/`、`src/stores/`、`src/pages/{Login,Register}`、`src/components/Layout/UserMenu`。

## Phase 2　总控台 + 智能体层 + 管理后台
- **交付物**：`request_logs`/`audit_logs` + SSE 推送（§H.1）；总控台页面（6 KPI + 实时流量 + 动向 + 全局流水 + 日志流 + 告警）；`agents/*` 五表 + 智能体监控看板 + `/admin/agents` 管理页；ops_bot 规则引擎；AdminUsersPage/TransactionsPage/DashboardPage；充值订单 + 微信/支付宝 adapter(DEV 模拟)。
- **验收**：1 个 admin 连接实时收到全部事件；agent 调用/成本/成功率看板准确；ops_bot 自动封禁生效。
- **代码落点**：`server/plugins/sse.js`、`server/lib/agent.js`、`server/queue/`、`src/pages/Admin/*`。

## Phase 3　生产部署（脚本化）
- **交付物**：`ecosystem.config.js`(PM2) 或 K8s yaml(HPA)、nginx.conf 全文、PG 连接池 max~25、`.env.example`、README 部署章节、安全头中间件。
- **验收**：蓝绿/滚动发布零宕机；限流生效；TLS A+。
- **代码落点**：`deploy/`、`README.md`。

## Phase 4　创意生产流水线
- **交付物**：9 张表；`/studio` 项目列表 + 5 子页（点子/剧本/画布/视频/剧集）；`skill_registry` + `/admin/skills`；计费矩阵；无限画布骨架（Konva/tldraw）。
- **建议**：Phase 1 后先落 `/studio` 列表 + 点子孵化页跑通，其余滚动。
- **代码落点**：`server/db/schema.ts`(§B.7)、`src/pages/Studio/*`。

## Phase 5　电商模块
- **交付物**：9 张表；`/shop` + `/product/:id`(内嵌智能体面板) + `/cart` + `/checkout` + `/orders` + `/seller` + `/admin/ecommerce`；8 节点智能体；积分抵现 + 微信/支付宝；防超卖。
- **代码落点**：`server/db/schema.ts`(§B.8)、`src/pages/Shop/*`。

## V.1　server.js → Fastify 迁移策略
- 渐进：Phase 0 起新模块写 `server/fastify/`（Fastify 实例注册 legacy `server.js` 为静态/兼容插件）；legacy 路由逐个迁到 Fastify schema 校验；最终 `server.js` 退化为「Fastify 宿主 + 静态服务」。
- 不停机：Nginx 灰度切流，按路径分流（新 `/api/v2/*` → Fastify，旧 `/api/*` → legacy），验证后回收。

## V.2　数据库迁移（Drizzle Kit）
- `server/db/schema.ts` 定义全部表（`§B` 为准）；`drizzle-kit generate` 出迁移 SQL；CI 中 `migrate` 自动执行；**保留现有 `CREATE TABLE IF NOT EXISTS` 兜底**兼容老库。

## V.3　灰度与回滚
- 前端：按用户百分比放 CDN；后端：K8s 滚动更新（maxSurge=25%）+ readiness 探针；DB 迁移向前兼容（只加列/表，不删改旧列）；出问题 `kubectl rollout undo` 秒级回退。

---

# Part VI　部署与运维（引用 `TECH_STACK.md §3–§12`）

- **拓扑**：Cloudflare(边缘) → 云LB → Nginx(多机) → Node Pod(4→12) → PgBouncer → PG主+副本 / Redis Sentinel / OSS+CDN。
- **容量表**（10K）：Node 4–6 实例、PG 主 ~30 连接 + 副本、Redis 4–6GB、CDN 100% 静态。
- **连接池**：PgBouncer `pool_mode=transaction`、`max_client_conn=1000`、`default_pool_size=20`。
- **分区**：`request_logs`/`audit_logs`/`agent_calls`/`credit_transactions` 按月 `PARTITION BY RANGE`。
- **可观测**：OTel trace（每请求 span）→ Prometheus 指标 → Grafana 面板；Loki 日志（结构化 pino）；告警见 §H.2。
- **CI/CD**：GitHub Actions（lint→test→build→镜像→k8s apply）；Docker 多阶段（前端 build + Node 运行时单镜像）。
- **安全边缘**：Cloudflare WAF + Bot Management + 免费 TLS；Nginx `limit_req` 登录/生成 zone；Secret 走 K8s Secret / 云 Secret Manager，禁硬编码。

# Part VII　安全与合规（详见 `DETAILED_SPEC §I`）

- 密码 `crypto.scrypt`(N=16384, r=8, p=1, salt=16B)；JWT `jose` HS256，refresh jti 黑名单（Redis）。
- 防爆破：登录失败计数 + 渐进延迟 + IP 级 Redis 桶；防邮箱枚举：注册/登录统一 `ERR_AUTH_INVALID`。
- 全局错误码表（§I.4，12 码）统一前后端语义。
- OSS 私有桶 + 后端代理（签名 URL 7 天上限制约 → 永久代理转发）；HTTPS only；HSTS；CSP。
- 支付回调验签 + 幂等 + 金额二次校验防篡改。

# Part VIII　验收标准与压测（详见 `DETAILED_SPEC §A.7` + `TECH_STACK §12`）

- **功能**：多用户隔离、计费不超扣、刷新续期、参考图生图、总控台实时、电商防超卖。
- **性能（10K 基线）**：健康检查 p99<50ms；登录 1K 并发错误率 0 / p99<300ms；生成吞吐 >200 rps；详情页 CDN 命中率 >95%。
- **弹性**：Node HPA 4→12 自动扩；视频队列 Worker 独立 HPA；PG 连接不超 `max_connections` 80%。
- **工具**：k6 脚本化压测（`scripts/load/`）；Grafana 实时看板验收。

---

# 附录

## 附录 A　术语表
- **节点(Node)**：自包含处理单元，统一 REST 形态（`§E.1`）。
- **能力(Skill/Agent)**：节点内 AI 能力，注册于 `skill_registry`。
- **编排(Workflow)**：顺序调节点 API 传产物，支持断点续跑/回退。
- **横切底座**：Auth/Credits/Agent/Skills/Console 五共享服务。
- **原子预扣**：PG 行锁 `UPDATE ... WHERE balance>=cost RETURNING`，强一致计费。

## 附录 B　全局错误码（节选，全表见 `DETAILED_SPEC §I.4`）
`ERR_AUTH_INVALID`(401) / `ERR_TOKEN_EXPIRED`(401) / `ERR_PERMISSION`(403) / `ERR_NOT_FOUND`(404) / `ERR_VALIDATION`(422) / `ERR_RATE_LIMIT`(429) / `ERR_CREDIT_INSUFFICIENT`(402) / `ERR_MAINTENANCE`(503) / `ERR_DUPLICATE`(409) / `ERR_INTERNAL`(500) / `ERR_PROVIDER`(502) / `ERR_STOCK`(409)。

## 附录 C　配置总表（节选，全表见 `DETAILED_SPEC §J`）
PG pool(max:25)、Redis(4–6GB)、JWT(access 2h/refresh 30d)、scrypt(N=16384)、限流(login 5r/10s/IP + 全局)、上传上限(50MB)、免费额度(20)、HPA(4→12, CPU 70%)。

## 附录 D　文档索引与阅读路线
1. **总纲（本文件）** → 看全局、理论、技术矩阵、模块、Phase。
2. `DESIGN_AUTH_CREDITS.md` → 业务架构意图（15 节，图多）。
3. `DETAILED_SPEC.md` → 落地细节（DDL/API 报文/安全/配置）。
4. `TECH_STACK.md` → 技术栈 + 10K 规模（配置片段可直接复制）。
- **建议评审顺序**：本文件 Part I→II→III → `DESIGN` 业务节 → `DETAILED_SPEC` 对应章 → `TECH_STACK` 配置节。

---

> **下一步**：本文 + 三子文档构成完整设计依据。确认方向后，**先开工 Phase 0 + Phase 1**（基础设施底座 + 注册登录 + 每用户积分扣减 + 管理员手动充值 + 前端登录页/路由守卫）——这是 10K 并发 + 电商 + 创作 + 总控台所有模块的地基。任何一节要再下钻（如「展开 Fastify 迁移步骤」「BullMQ 全套代码」「K8s 完整 yaml」）直接说。
