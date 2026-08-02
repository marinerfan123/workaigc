# 系统总体设计书 v2（演进式落地版）

> **文档定位**：`MASTER_DESIGN.md`（v1）的**升级版（非重写）**。
> v1 的产品模块、技术栈大方向、六大模块设计、10K 规模目标**全部保留**，本文件只落地外部架构评审稿的 **21 项修正**，加 **2 项专业保留**，并补一个评审稿未覆盖、但对本项目（**已在生产运行的 E:\code**）最关键的修正：**演进式落地，不在开工前先搭 K8s 集群**。
>
> **阅读方式**：未改动的部分仍看 v1（`MASTER_DESIGN.md` Part I–VIII）+ 三子文档（`DESIGN_AUTH_CREDITS.md` / `DETAILED_SPEC.md` / `TECH_STACK.md`）。本文件 §0 是修订清单，§1 是关键修正详述，§2 是演进式落地原则与启动切片蓝图，§3 是重排后的 Phase 映射。
>
> **状态**：设计评审阶段，尚未编写业务代码（用户要求「先细化，不动 E:\code」）。
> **规模基线**：5,000 ~ 10,000 并发在线（最终态）；**起步态**为现有单服务（~100 人可用，随规模触发升级）。

---

## 0. v2 修订总览

### 0.1 修订来源

| 来源 | 内容 | 处置 |
|---|---|---|
| 外部评审稿《AI平台总体指导意见与实施建议》 | 21 项架构缺陷修正 | ✅ 全部采纳（见 §0.2） |
| 本工程实际约束（E:\code 已上线单服务） | 评审稿假设 greenfield，Phase1 即 K8s | ✅ 新增「演进式落地」修正（见 §2） |
| 本人专业判断 | 2 项不完全照单 | ⚠️ 保留（见 §0.3） |

### 0.2 评审稿 21 点采纳映射

| # | 评审修正 | 落在本文 / v1 何处 |
|---|---|---|
| ① | 容量数学按业务类型建模（读多写少/生成长任务/实时低频分别算 RPS） | §1.1 重写容量模型 |
| ② | 删除「10K=4–6 实例」静态公式，改按指标 HPA 弹性 | §1.1 + §3 |
| ③ | 删 Docker Compose 生产备选，只作本地/演示 | §1.8 明确 |
| ④ | K8s 不写死 1.30，用云厂商当前稳定版 + 季度升级 | §1.8 |
| ⑤ | M4 智能体拆「运行层 + 控制平面」 | §1.5 |
| ⑥ | JWT 改 Cookie/BFF，不存 localStorage | §1.2 |
| ⑦ | 移除生产 API_TOKEN 全局 fallback | §1.2 |
| ⑧ | RBAC 扩角色（admin/user 不够，加 operator/auditor/…） | §1.2 |
| ⑨ | 积分 reserve/commit/release 三段式 | §1.3 |
| ⑩ | 加 Transactional Outbox | §1.3 + §1.4 |
| ⑪ | Redis 拆 Queue/Cache/Security 三隔离 | §1.4 |
| ⑫ | Pub/Sub 仅非关键实时，关键事件走持久化总线 | §1.4 |
| ⑬ | BullMQ 与事件总线职责分离 | §1.4 |
| ⑭ | Workflow 改 DAG（并行/回退/补偿） | §1.6 |
| ⑮ | Skill Registry 仅声明，handler 受信任代码 | §1.6 |
| ⑯ | 审计日志不采样（合规全量） | §1.7 |
| ⑰ | 告警结构化（trace_id/severity/影响范围/回滚入口） | §1.7 |
| ⑱ | HA/DR 加 PITR + 混沌工程 | §1.8 |
| ⑲ | 阶段重排 Phase 0–6（观察3→自动4→创作5→电商6） | §3 |
| ⑳ | 控制平面独立 namespace | §1.5 + §3 |
| ㉑ | 观测从「PG 写日志」改 OTel 采样 + 指标 | §1.7 |

### 0.3 两项专业保留（不完全照单）

1. **密码哈希保留 `crypto.scrypt`**（零原生依赖原则）
   - 评审建议优先 Argon2id。但 Argon2id 在 Node 需原生编译（`@node-rs/argon2` / `argon2`），带来部署复杂度与跨平台坑。
   - 采用：scrypt（Node22 内置，`crypto.scrypt`）+ **参数版本化**（`scrypt_params` 表或列存 N/r/p，按登录节点 CPU 实测）+ **并发哈希上限**（登录洪峰时排队，防资源耗尽）+ 登录时渐进升级参数版本。Argon2id 作为**可选升级路径**写入 ADR，不阻塞起步。
2. **控制平面放 Phase C–D，勿误读成 Phase A/B 就要全做**
   - 评审把「智能体观察」放在 Phase 3（基础设施之后），这是正确的顺序——**避免 scope creep**。
   - 起步阶段（Phase A）**只做确定性地基**（auth + 账务 + 生成闭环 + 基础可观测），智能体只读观察是 Phase C 才引入，自主执行 Phase D。控制平面绝不进入强一致主路径（积分/支付/库存）。

### 0.4 ★ 新增核心修正：演进式落地（评审稿未覆盖）

> 评审稿整体按 **greenfield（全新项目）** 假设：Phase 1 就是「Kubernetes 多可用区 + PG HA + Redis 隔离 + 事件总线」。
> 但 **E:\code 是已在生产运行的 React + Node(`server.js`) 单服务应用**（端口 3001，PG 17，Redis 已配未启用，OSS 私有桶已接）。
> **不能为了「符合架构」先花数月搭 K8s 再让用户能注册**——那本末倒置。
>
> **v2 核心原则：演进优先于基础设施重构。**
> 先在现有 `server.js` 上**增量**把「身份 + 账务 + 一条生成闭环」跑通（Phase A），业务价值立刻产生；当真实并发/可用性要求触发时，再按 §3 的 Phase B 把分布式基础设施叠上去。**地基逻辑（auth/计费/幂等/Outbox）在两种形态下完全复用，不浪费。**

---

## 1. 关键修正详述

### 1.1 容量模型（修正 ①②）

**废弃**：「10K 在线 = 4–6 Node 实例」「平均 1K–2K RPS / 峰值 4K–6K RPS」静态公式。

**采用**：按业务类型分别建模（建《容量模型与压测基线》文档）。

| 业务类型 | 建模方式 | 扩容指标 |
|---|---|---|
| 普通 API（浏览/列表） | 读多写少，CDN + 只读副本分担 | CPU / QPS / P99 |
| 生成任务提交 | 写少但长任务，立即返回 taskId，异步完成 | 队列长度 / 最老任务等待 |
| SSE 长连接（总控台） | 连接数敏感，非 QPS | 活动连接数 / 每连接消息率 |
| 文件上传/回源 | 带宽敏感，走 OSS 直传/代理 | 出口带宽 |
| 商城读 | 高缓存命中，Redis Cache + CDN | 缓存命中率 |
| 下单/支付/秒杀 | 强一致短事务，行锁 | 事务量 / 锁等待 |
| 后台批处理/智能体 | 离线，非实时 | 队列 / 调度 |

- **Little's Law 仍可用**，但必须分类型带入：10K 在线 × 10–20% 活跃 × 1–2 次/分 → **平均 16–67 RPS 普通 API**（非 1K+）。AI 任务提交速率单独算（受供应商 RPM/并发额度约束）。
- **HPA 按指标弹性**：API Pod（CPU+QPS）、Worker（队列深度）、SSE（连接数）、Dispatcher（供应商并发/错误率）各自独立扩，禁止单一 CPU 公式。

### 1.2 认证与安全（修正 ⑥⑦⑧ + 保留密码哈希）

| 项 | v1 | v2 |
|---|---|---|
| Token 存储 | JWT 存 localStorage | **HttpOnly + Secure + SameSite Cookie**（access 短时效存内存/ cookie；refresh 用服务端可撤销会话，Token Family 轮换） |
| XSS 防护 | — | 去 localStorage 消除令牌劫持面；CSP + HSTS |
| 生产 API_TOKEN | 保留作 admin fallback | **生产移除**（修正⑦）；本地 dev 仅留 `ALLOW_DEV_TOKEN=0` 默认关的开关 |
| 角色 | admin / user | **RBAC 扩展**：user / creator / seller / cs / operator / finance / auditor / admin / service（修正⑧），动作检查「角色+资源归属+动作类型」 |
| 密码哈希 | scrypt N=16384 | 保留 scrypt + 参数版本化 + 并发哈希上限（保留项 1） |
| 登出/改密 | — | 撤销 refresh token family（Cookie 清除 + 服务端标记 revoked） |
| MFA | — | 管理员启用 MFA（Phase B） |

### 1.3 账务一致性（修正 ⑨⑩）

**废弃**：「先扣减，失败再退款」模糊流程。

**采用 reserve → commit / release 三段式**：

```
reserve  : UPDATE users SET held = held + :cost WHERE id=:uid AND (balance - held) >= :cost  -- 预占，不减少可用余额
commit   : 事务内 UPDATE users SET balance = balance - :cost, held = held - :cost WHERE id=:uid  -- 成功确认
release  : UPDATE users SET held = held - :cost WHERE id=:uid                                          -- 失败/取消释放
```

- 余额与流水**同一 PG 事务**写入（`credit_transactions.balance_after` 只追加对账）。
- 金额用**整数/定点数**（分），禁浮点。
- 每操作唯一 `idempotency_key`，reserve/commit/release 各自幂等。
- 外部 Provider 超时 → 标 `pending_confirm`（待确认），**不立即认定失败**；后台对账任务扫悬挂 reserve。
- **Transactional Outbox（修正⑩）**：账务/订单/支付关键事务提交时，同事务写 `outbox` 表；独立发布器投递到持久化事件总线（见 §1.4）；消费者用 `inbox`/唯一键幂等。

### 1.4 Redis / 队列 / 事件（修正 ⑪⑫⑬）

**Redis 三隔离（修正⑪）**：

| 实例 | 用途 | 策略 |
|---|---|---|
| Redis Queue | BullMQ 专用（图/视频/Webhook/通知） | 禁淘汰、AOF、备份、死信 |
| Redis Cache | 商品/页面/状态缓存、在线用户、限流桶 | 可淘汰 |
| Redis Security | 登录会话、token 撤销、风险计数 | 持久、HA |

**Pub/Sub 降级（修正⑫）**：仅用于总控台即时刷新、在线状态、非关键 UI 动态。**禁用于**支付/积分/订单/智能体命令/审批/核心告警/配置变更——这些走持久化事件总线。

**BullMQ 与事件总线分离（修正⑬）**：
- BullMQ = 具体后台任务（图/视频/通知/Webhook 重试）。
- Durable Event Bus = 系统状态/路由配置/智能体决策/审批/跨模块业务事件。选型 Redis Streams / NATS JetStream / Kafka（按团队能力，ADR 定）。

### 1.5 全局智能体（修正 ⑤⑳）

M4 拆两层（修正⑤）：

1. **AI 能力运行层（数据平面）**：模型调用、Provider Adapter、Skill 注册、成本统计、业务智能体。确定性、低延迟。
2. **全局智能体控制平面（独立 namespace，修正⑳）**：状态聚合 → 分析 → 决策 → 策略校验 → 审批 → 执行 → 验证 → 修正/回滚。

**五级权限闸门（评审 4.3）**：

| 级 | 权限 | 示例 |
|---|---|---|
| L0 | 只观察 | 看指标/队列/成本 |
| L1 | 只建议 | 建议扩容/降级 |
| L2 | 低风险自动 | 临时降故障 Provider 权重、重试幂等任务 |
| L3 | 审批后执行 | 大范围配置/封禁/价格规则 |
| L4 | 永久禁止自动 | 改账务流水/读根密钥/不可逆删除/Shell |

- **强制人工审批（L3/L4）**：改余额、真实退款、改权限、删用户/订单/审计、改支付配置、大范围封禁、关关键服务。
- 控制平面故障**不拖垮**数据平面；数据平面用「最后有效策略」继续工作。
- 智能体**不直连** DB 超级权限 / K8s 管理 / 支付密钥；所有动作过 Command Gateway，可追踪/审批/撤销/补偿。
- **新增核心组件**：Event Gateway、Global State Aggregator、Agent Supervisor、Policy Engine、Approval Service、Command Gateway、Feedback Evaluator、Agent Audit Ledger、Last Known Good Policy Store。

### 1.6 工作流与 Skill（修正 ⑭⑮）

**Workflow 改 DAG（修正⑭）**：首期可实现部分能力，但** schema/接口不能设计成不可扩展的线性链表**。最低预留：串行 / 并行 fan-out / fan-in / 条件分支 / 人工审核 / 超时 / 取消 / 单节点重试 / 部分成功 / 补偿 / 子工作流。

**Skill Registry 仅声明（修正⑮）**：

```
skill_registry      : 能力元数据 + 参数 Schema + 成本 + 可用状态（声明）
provider_adapter    : 供应商请求/鉴权/回调/错误映射
handler_registry    : 已实现并通过审核的代码处理器（受信任）
policy_binding      : 某 Agent 可调哪些 Skill
version             : 能力/协议版本
```

> DB 记录只能**启用已存在的受信任处理器**，不能让 DB 配置任意执行代码。

### 1.7 可观测与审计（修正 ⑯⑰㉑）

- **OTel 统一 Trace/Metric/Log**（修正㉑），贯通 API/队列/Worker/Provider/DB/智能体决策链路。
- **采样策略分流（修正⑯）**：高频成功 Trace、性能 Span、普通访问日志 → 可采样；**审计不采样**（管理员充值、余额修改、退款、角色权限变化、支付状态、配置/密钥变更、智能体高风险动作、数据导出/删除、封禁解封）→ 全量、防篡改、访问隔离、归档。
- **告警结构化（修正⑰）**：每条含 影响范围 / 严重等级 / 关联服务版本 / 最近变更 / trace_id / 推荐步骤 / 是否允许智能体自动处理 / 回滚入口。

### 1.8 高可用、灾备、版本（修正 ③④⑱）

- **K8s 版本（修正④）**：用云厂商当前稳定版，季度审查升级；禁用于停止安全更新的版本。不写死 `1.30`。
- **Docker Compose（修正③）**：仅本地开发/集成测试/演示，**不写入生产架构**。
- **HA/DR（修正⑱）**：API+Worker 跨 AZ 多副本；PG 主备自动转移 + **PITR**；Redis HA；OSS 多副本；Ingress 无单点；Secret 专用管理；蓝绿/滚动发布 + Last Known Good。
- **混沌工程（修正⑱）**：上线前验证 杀 Pod / 杀 Worker / Redis 主切换 / PG 主备切换 / Provider 超时重复回调 / 消息重复投递 / 控制平面失效 / 配置回滚 / 区域抖动。

---

## 2. ★ 演进式落地原则与启动切片蓝图（对接现有 E:\code）

### 2.1 现状事实（必须正视）

| 项 | 现状（E:\code） | 影响 |
|---|---|---|
| 运行形态 | 单 Node `server.js`（端口 3001）serve `dist/build2` | 无 K8s / 无 PM2 cluster / 无多实例 |
| 认证 | 仅共享 `API_TOKEN`（`/api/token` 返回） | 无用户、无登录态 |
| 账务 | `models.credit_cost` 仅前端展示，后端无扣减/余额 | 无任何计费逻辑 |
| 数据库 | PG 17，表：media/providers/models/settings/generation_tasks/oss_config | 无 users/credit_transactions/sessions |
| Redis | 已配置但 **server.js 完全未引用** | 起步阶段不能依赖 Redis |
| 生成 | `POST /api/generate` 已异步 + dispatcher 多供应商均衡（真实可用） | 改造钩子已就位 |
| 前端 | React + Vite + Tailwind v4，当前 `ApiTokenContext` | 需替换为 `AuthContext` |

**结论**：业务闭环的「骨架」已存在（生成/多供应商/OSS），缺的是「身份」与「记账」两堵承重墙。这正是 Phase A 要补的。

### 2.2 原则：演进优先于基础设施重构

1. **先跑通业务，再堆基础设施**。Phase A 在现有 `server.js` 上增量加 auth + 账务 + 生成闭环，用户立刻能注册/登录/生成/扣费。
2. **地基逻辑跨形态复用**。auth 中间件、reserve/commit 计费、幂等、Outbox 在「单服务」和「K8s 集群」下代码一致，Phase B 只是把运行形态换掉，不重写业务。
3. **Redis 暂未启用 → 用 PG 替代起步**。session 撤销、限流计数、在线统计先用 PG 表/轻查询；Phase B 启 Redis 后无缝迁移到三隔离实例。
4. **每步 git 分支可逆**。用户明确要求「只能看不能动」是评审期约束；一旦授权开工，每步独立 commit，出问题 `git revert`。
5. **规模触发升级**。100 人 → 单服务够用；当并发/可用性 SLA 触发时，再上 Phase B 分布式底座，不提前过度工程。

### 2.3 Phase A 启动垂直切片蓝图（具体可落地）

> 目标：**注册 → 登录 → 生成 1 张图 → 扣积分 → 进媒体列表** 一条链路完整跑通。这是验证整套架构的最小闭环。

#### A.1 数据模型（新增 PG 表，向前兼容现有表）

```sql
-- 用户（替代共享 API_TOKEN）
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                 -- scrypt(N=16384,r=8,p=1,salt=16B)
  scrypt_params SMALLINT NOT NULL DEFAULT 1,   -- 参数版本，登录时渐进升级
  role          TEXT NOT NULL DEFAULT 'user',  -- RBAC（§1.2）
  balance       BIGINT NOT NULL DEFAULT 0,     -- 分；可用余额
  held          BIGINT NOT NULL DEFAULT 0,     -- 预占额度（reserve/commit）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 积分流水（只追加，reserve/commit/release/recharge/adjust）
CREATE TABLE credit_transactions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL,                -- reserve|commit|release|recharge|adjust
  amount         BIGINT NOT NULL,              -- 分（正=增/负=减，含 held 语义）
  balance_after  BIGINT NOT NULL,              -- 只追加对账
  idempotency_key TEXT UNIQUE,                 -- 幂等
  ref            TEXT,                         -- 关联 task_id / order_no
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ct_user ON credit_transactions(user_id, created_at DESC);

-- 刷新令牌族（替代 Redis 会话；Phase B 迁 Redis Security）
CREATE TABLE refresh_tokens (
  token_family UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at   TIMESTAMPTZ NOT NULL
);

-- 幂等/Outbox（起步用 PG；Phase B 可迁事件总线）
CREATE TABLE idempotency (
  key         TEXT PRIMARY KEY,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE outbox (                       -- Transactional Outbox（§1.3）
  id          BIGSERIAL PRIMARY KEY,
  aggregate   TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  published   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### A.2 后端路由（在 `server.js` 增量加，不动现有生成逻辑）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/auth/register` | POST | 邮箱+密码 → scrypt 哈希 → 送免费额度（INSERT credit_transactions recharge +20）→ 发 Cookie |
| `/api/auth/login` | POST | scrypt 验 → 签 access(Cookie, 15min) + refresh(token_family, 30d) → 登录限流 |
| `/api/auth/refresh` | POST | 验 refresh family（未 revoked）→ 轮换 access |
| `/api/auth/logout` | POST | 标记 family revoked + 清 Cookie |
| `/api/auth/me` | GET | 返回用户+balance（Cookie 鉴权） |
| `/api/generate` | POST | **改造**：Cookie 鉴权 → `reserve` 预占 → dispatcher → 成功 `commit` / 失败 `release` → 写 outbox |
| `/api/credits/transactions` | GET | 本人流水（按 user_id） |
| `/api/admin/users` `/recharge` | （Phase B） | 管理员手动充值（RBAC operator+） |

- **鉴权中间件**：从 Cookie 取 access → jose 验签 → `req.user`。旧 `API_TOKEN` 仅 `ALLOW_DEV_TOKEN=1` 时作为 dev fallback（生产默认关，修正⑦）。
- **计费原语** `server/lib/billing.js`：`reserve/commit/release` 三段式（§1.3），同事务写 `credit_transactions` + `outbox`。
- **Outbox 发布器**：简单 PG 轮询 `outbox WHERE published=false` → 暂存内存事件（Phase B 接事件总线）。

#### A.3 前端改造

| 改造点 | 做法 |
|---|---|
| `ApiTokenContext` → `AuthContext` | Cookie 自动随请求发送，无需手动塞 header；内存持 access 用于 401 刷新 |
| `/login` `/register` 页 | Tailwind + Framer Motion 入场 |
| `RequireAuth` 路由守卫 | 未登录跳 `/login` |
| 顶栏用户菜单 + 积分徽章 | 订阅 AuthContext，实时显示 balance |
| `GenerationBar` 余额闸门 | 提交前查 balance，不足提示充值；生成中显示 held |
| `apiFetch` | 401 自动 `/api/auth/refresh` 重试一次 |

#### A.4 Redis 暂未启用的替代（起步）

| 需求 | Phase A（无 Redis） | Phase B（启 Redis 三隔离） |
|---|---|---|
| 刷新令牌撤销 | `refresh_tokens.revoked` PG 列 | Redis Security（token 黑名单） |
| 登录限流 | PG `idempotency`/简单计数 或 内存（单实例可接受） | Redis Security 桶 |
| 在线统计 | 暂不做 / PG 轻查询 | Redis Cache ZSET |
| 事件推送 | 轮询 `outbox` / 前端轮询 | BullMQ + 事件总线 + SSE |

> 单实例下「限流用内存」可接受（修正⑪ 的风险仅在多实例才显著）；Phase B 多实例时迁 Redis。

#### A.5 Phase A 验收

- [ ] 多用户隔离：A 的生成不扣 B 的余额。
- [ ] 并发 reserve 不超扣（1000 并发生成，balance 永不为负）。
- [ ] Provider 超时 → 标 `pending_confirm` + 悬挂 reserve 被对账任务释放，不丢钱。
- [ ] 刷新 token 续期；登出/改密撤销 family。
- [ ] 重复 `idempotency_key` 不重复消费。
- [ ] 真实生成 1 张图 → balance 正确扣减 → 进媒体列表。

#### A.6 理论测试补丁（schema 补丁 + 异步计费时序 + 单位口径）★ 开工前必读

> 来源：`docs/PHASE_A_THEORETICAL_TEST.md` 对照真实 `E:\code` 代码（server.js / dispatcher.cjs / 前端 GenerationBar / 现有表）发现 **4 个阻塞空洞 + 1 个单位歧义**。以下为落地前必补，否则会写出真实 bug（信用泄漏 / 多用户串号 / 双扣）。

**A.6.1 单位口径（G5，必拍板）**
- `users.balance` / `credit_transactions.amount` 统一为 **虚拟积分（整数 credits）**，非人民币「分」。
- 新用户免费额度：**50 credits**（D2 默认建议，原「20」偏紧）。
- `models.credit_cost` 即单张图消耗 credits（如 5）；视频 / 更高分辨率可取更高值。
- DDL 注释把「分」改为「credits」；reserve SQL 两边单位一致，否则静默出错。

**A.6.2 `generation_tasks` 补 `user_id`（G1，阻塞）**
```sql
ALTER TABLE generation_tasks ADD COLUMN user_id UUID REFERENCES users(id);
CREATE INDEX idx_gt_user ON generation_tasks(user_id, created_at DESC);
```
- `dispatcher.generateAsync(pgPool, opts)` 增加 `user_id` 参数并写入 INSERT（dispatcher.cjs:332）。
- `listActiveTasks(pgPool, userId?)` 增加 `WHERE user_id=$1`（传 null 的管理员可不过滤）。
- 服务端 `GET /api/generate/active` 按 `req.user.id` 过滤（刷新恢复不再泄漏他人任务）。

**A.6.3 `media` 补 owner（G2，阻塞）**
```sql
ALTER TABLE media ADD COLUMN user_id UUID REFERENCES users(id);
CREATE INDEX idx_media_user ON media(user_id, created_at DESC);
```
- `POST /api/media` 强制 `user_id = req.user.id`（**不可由前端伪造**）。
- `GET /api/media` 默认 `WHERE user_id=$1`；素材库「公开」概念留 Phase 后续（加 `is_public` 标志）。
- 现有 mock/seed 行：回填一个固定 UUID 的 `system` 用户，或标 `source='seed'` 在查询时豁免过滤。

**A.6.4 异步计费时序（G3，阻塞—最危险）**
> 现有 `POST /api/generate` handler 调 `dispatcher.generateAsync` 后**立即返回 taskId**；成功/失败在 `dispatcher.cjs:345-350` 后台 `UPDATE generation_tasks SET status` 回调里。commit/release **必须落在后台回调**，否则 `held` 信用永不被结算（用户余额被永久冻结）。

```
POST /api/generate（handler，同步）:
  1. user = req.user
  2. cost = (SELECT credit_cost FROM models WHERE …) * count        // A.6.5
  3. idempotency_key = body.idempotency_key || 由 pendingIds 派生     // G4
  4. 查 generation_tasks 同 key 且 status<>'failed' → 有则复用 taskId，跳过 5-6
  5. reserve(user_id, cost, idempotency_key)                          // 余额不足即返 402
  6. generateAsync(pgPool, { …, user_id, cost, idempotency_key })
  7. 返回 { status:'pending', taskId }

后台完成回调（dispatcher.cjs:345 UPDATE generation_tasks SET status）:
  status==='done'    → billing.commit(user_id, cost, idempotency_key) + 写 outbox
  status==='failed'  → billing.release(user_id, cost, idempotency_key)
悬挂兜底: 对账任务扫 generation_tasks 已完成但 credit_transactions 无对应 commit 的行 → release
```

**A.6.5 成本解析步骤（G6）**
- `body.model` 解析：复用 display_name 分组规则，取第一个启用行 → 其 `credit_cost`。
- `cost = credit_cost * count`（count ∈ 1..4）。
- 模型未启用 / 解析失败 → 400。

**A.6.6 `/api/generate` 端点幂等（G4，阻塞）**
- 前端传 `idempotency_key`（由 pendingIds 派生，刷新可重建）。
- handler 命中同 key 未 failed task → 复用，不再 reserve（防网络重试双扣）。
- `credit_transactions.idempotency_key` 已 `UNIQUE`，reserve 本身幂等兜底。

**A.6.7 非阻塞范围项（带进代码，不阻塞开工）**
- **G7** OSS 代理 `GET /api/oss/media/:key` 校验 owner（防越权看他人图）。
- **G8** Phase A 至少给写操作（POST/PUT/DELETE media/providers/models/agent）加鉴权；读可暂留。
- **G9** dev 跨域：vite proxy 同源代理 `/api`（Cookie 正常）；或后端 CORS + 前端 `fetch credentials:'include'`（`SameSite=None; Secure` 在 http dev 下发不出）。
- **G10** `/api/generate` 加 auth 是 breaking change；定义 `ALLOW_DEV_TOKEN` 是否覆盖该端点（默认仅 dev 开）。
- **G11** reserve 走 PG 行锁 `UPDATE … WHERE (balance-held)>=cost`，单实例 1000 并发串行化在该用户行（逻辑正确，吞吐受 PG 限制，符合 A.4）。
- **G12** 计费 commit 与写 media 是两事件（commit 在后台 task 完成；media 行由前端 task 完成后 POST），实现时勿误以为 commit 时要同时写 media。

---

## 3. 落地 Phase 映射（演进顺序）

> 评审稿 Phase 0–6 重排为**演进优先**顺序：先业务地基（现有 app），再分布式基础设施，再智能体，再创作，最后电商。

| Phase | 名称 | 目标 | 关键交付物 | 与 E:\code 关系 | 触发条件 |
|---|---|---|---|---|---|
| **A** | 演进式地基（垂直切片） | 身份+账务+生成闭环 | users/credit_transactions/sessions 表、auth 路由、scrypt/jose、reserve-commit、生成接入、前端登录 | **在现有 server.js 增量改** | 立即（用户授权后） |
| **B** | 分布式基础设施 | 多实例/HA/事件可靠 | K8s 多 AZ、PG HA+PgBouncer、Redis 三隔离、OTel/Prom/Grafana/Loki、Outbox→事件总线、Secret 管理、CI/CD 灰度 | 换运行形态，业务逻辑复用 | 并发/可用性 SLA 触发 |
| **C** | 智能体观察（L0/L1） | 只读总控台+建议 | Global State Aggregator、Supervisor/Ops/Routing Agent、决策记录、只读总控台、Agent Audit Ledger | 新增控制平面 namespace | Phase B 后 |
| **D** | 有限自动执行（L2/L3） | 低风险自动+审批 | Policy Engine、Command Gateway、Approval Service、L2 动作、回滚评估 | 控制平面扩展 | 观察期稳定后 |
| **E** | 创作流水线 | 点子→剧本→分镜→视频→剧集 | 9 表、/studio 系列、skill_registry、DAG Workflow、计费矩阵、无限画布骨架 | 新增模块，复用 A/B/C 底座 | D 进行中可并行 |
| **F** | 电商模块 | 商品→订单→支付→售后 | 9 表、/shop 系列、8 节点智能体、积分抵现+真实支付、防超卖 | 新增模块，复用 A/B/C 底座 | E 稳定后 |

**关键修正点（相对评审稿）**：
- 评审稿 Phase 1（基础设施）在 greenfield 下先于 Phase 2（认证）。本 v2 把**认证账务（Phase A）提到基础设施（Phase B）之前**——因为现有 app 已能跑，先产生业务价值，基础设施按需触发，不前置阻塞。
- 评审稿的「Phase 0 架构冻结」对应本 v2 §0–§1 的设计修订（已完成于本文件），不再作为独立开工阻塞。
- 智能体（C/D）、创作（E）、电商（F）顺序沿用评审稿，控制平面独立 namespace（修正⑳）。

---

## 4. 与 v1 未变部分（仍看 MASTER_DESIGN.md）

以下 v1 内容**未被评审推翻**，继续有效：
- Part I 产品愿景、七原则（P1–P7，P1 无状态优先仍成立，token 存储改 Cookie 见 §1.2）、模块化理论、故障域降级理论。
- Part II 技术栈大方向（React/Vite/Tailwind/Zustand/TanStack Query/Framer Motion/Zod；Fastify5/pino/jose/Drizzle/pg/PgBouncer/OSS+CDN/Nginx+Cloudflare/OTel/K8s/k6）—— 仅密码哈希（保留 scrypt）、Redis 三隔离（修正⑪）、K8s 版本（修正④）三处微调。
- Part IV 六大模块职责、数据模型归属、智能体挂载点 —— 仅 M4 拆运行层/控制平面（§1.5）。
- Part VI/VII/VIII 部署/安全/验收框架 —— 吸收 §1.2/§1.7/§1.8 修正。
- 三子文档 `DESIGN_AUTH_CREDITS.md` / `DETAILED_SPEC.md` / `TECH_STACK.md` 的**细节字段**仍为准，但需按本 v2 的 §1 修正同步更新（DDL 加 `held` 列、refresh 表、outbox 表；API 契约加 Cookie 鉴权；RBAC 扩角色；Workflow 改 DAG）。

---

## 5. 待拍板决策（需用户最终确认）

| # | 决策 | 默认建议 |
|---|---|---|
| D1 | Phase A 是否用 `UUID` 主键 vs `BIGSERIAL` | UUID（分布式友好，Phase B 免改） |
| D2 | 免费额度数值 | 新用户送 20（分？还是「20 次」需统一单位） |
| D3 | access token 时效 | 15min（Cookie，内存持） |
| D4 | 密码哈希参数版本首发值 | scrypt N=16384,r=8,p=1（保留项 1） |
| D5 | Phase B Redis 选型 | 先 Redis Streams 作事件总线（轻，免引 Kafka） |
| D6 | 控制平面实现形态 | 独立 Node 服务 + 独立 namespace（Phase C 定） |

---

> **下一步**：本 v2 即「架构冻结」交付物。用户授权动代码后，**从 Phase A 启动垂直切片**开工（§2.3）—— 这是 10K 并发 + 电商 + 创作 + 总控台所有模块的地基，且 100% 复用现有 E:\code 运行形态，不浪费。
> 任何一节要再下钻（如「Phase A 完整 SQL 迁移脚本」「auth 中间件代码」「前端 AuthContext 树」）直接说。
