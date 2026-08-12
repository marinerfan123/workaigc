# 墨灵AI · ModelHub V3 增量升级 — Phase 0 事实审计

> **阶段**：Phase 0（仅审计，零代码改动，零提交）
> **日期**：2026-08-11
> **范围**：现有 ModelHub V2 的真实事实状态，作为 V3（Model Catalog + Provider Registry + Provider Model Binding + Pricing + Generation Job/Attempt + Routing Policy + Provider Health + Circuit Breaker + Adaptive Weighted Router + Audit Log）增量升级的基线。
> **方法**：实读源码 + `grep` 全仓依赖检索。所有结论均附文件路径与行号。**严禁推测项目结构**——下文每条均来自本次读取。
> **图例**：✅ = 已确认事实（已读源码/SQL 实证）；❓ = 仍需继续核实（下一阶段需 read 源码或查库确认）。

---

## 0. 审计范围与已读文件清单

**前端**
- `src/data/models.ts` ✅（IModelProvider / IAiModel 接口、`getEffectiveModelName`、MOCK 数据）
- `src/hooks/useModelHub.ts` ✅（模块级内存 store + 全量同步 API）
- `src/services/api.ts` ✅（apiGetProviders/Save/Delete、apiGetModels/Save/Delete/Patch、apiGetModelPriceHistory）
- `src/utils/groupModels.ts` ✅（`groupModelsByModelId` 按 `modelId` 聚合）
- `src/components/GenerationBar.tsx` ✅（生成时模型选择 + `apiGenerate` 调用）
- `src/pages/ModelHubPage/**`（6 个文件）✅ 目录确认存在，本阶段未逐行读（管理 UI，不影响生成闭环链路，列于 G 节需补读项）

**后端**
- `server/server.js` ✅（DDL initDB、SNAKE_MAP、/api/generate、/api/providers、/api/models、/api/admin/model-price-history）
- `server/dispatcher.cjs` ✅（routing、RR、bucket、persistProviderTaskId、resume）
- `server/billing.cjs` ✅（reserve/commit/release 三段式）
- `server/accounting.cjs` ✅（model_cost_rates 写/读、consumption_ledger）
- `server/shop.cjs` ✅（runSkill 选模型方式）
- `server/realtime.cjs` ✅（上一会话已读，SSE 推送）

**脚本/种子**
- `scripts/seed-model-hub.cjs` ✅（幂等 upsert）
- `scripts/seed/model-hub.config.json` ✅（43 个模型，配置即真相）

---

## A. 当前真实架构

### A.1 端到端闭环（已确认）
```
前端 ModelHubPage（管理：增删改 provider/model）
   │ 全量同步
   ▼
apiSaveProviders / apiSaveModels ──POST /api/providers | /api/models──▶ server.js（upsert providers/models 表）
                                                                          │
前端 GenerationBar（用户选模型 + 填 prompt）                              │
   │ settings.model = displayName（见 G）                                 │
   ▼                                                                       │
apiGenerate({ model: settings.model, prompt, ... })                      │
   │ POST /api/generate                                                   ▼
   ▼                                                               server.js:2374 路由
① 限流(30/60s) → ② 幂等键查重 → ③ resolvePayment（查 models.credit_cost）→ ④ reserveCredits（仅此处扣）
   │ 构造 genOpts（model = body.model = displayName）
   ▼
dispatcher.generateAsync（INSERT generation_tasks running + onSubmitted 持久化 provider_task_id/model_id）
   ▼
dispatcher.generate（server/dispatcher.cjs:547）
   │ 路由：WHERE display_name=$1（否则 model_id=$1）→ 收集该 model_id 全部启用行 → 组装 (model×provider) pairs
   ▼
dispatchOne（RR_POINTER 轮询 pairs；attemptOnAccount → imageGenerate/videoGenerate → providers/video/*）
   │ 终态：success / failed / timeout（仅 timeout 保留，绝不算失败、绝不释放积分）
   ▼
① commitCredits（success） / releaseCredits（failed/canceled） ② updateTaskStatus ③ realtime.emitTaskUpdate（SSE）
   ▼
前端 useGenerationStream.waitForTask（SSE + 3s 轮询兜底）→ processResultImages
```

**结论**：用户给的闭环「前端 ModelHub → API → PostgreSQL providers/models → billing → dispatcher → provider → 实际生成」✅ 完全成立，且额外有 `model_cost_rates` / `consumption_ledger` 双侧账务与 SSE 实时回传。

### A.2 关键事实：调度入口 `dispatcher.generate` 的路由身份
`server/dispatcher.cjs:564-577`：
```js
let mrows = await pgPool.query('SELECT * FROM models WHERE display_name=$1 AND enabled=true', [model]);
let modelIds = [...new Set((mrows.rows||[]).map(r=>r.model_id))];
if (modelIds.length === 0) {
  const m2 = await pgPool.query('SELECT * FROM models WHERE model_id=$1 AND enabled=true', [model]);
  modelIds = [...new Set((m2.rows||[]).map(r=>r.model_id))];
}
const allModels = await pgPool.query('SELECT * FROM models WHERE model_id=ANY($1) AND enabled=true', [modelIds]);
```
➡️ **`display_name` 是首要路由身份，`model_id` 是兜底**。这与你要求的「严禁继续让 display_name 承担核心运行身份」直接冲突，是 V3 必须解耦的核心点（见 D、J）。

---

## B. 当前数据库 Schema

### B.1 `providers`（server.js:108）✅
```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'official',
  base_url TEXT DEFAULT '',
  api_key TEXT DEFAULT '',
  supported_types TEXT[] DEFAULT '{}',
  enabled BOOLEAN DEFAULT TRUE,
  protocol TEXT DEFAULT 'openai-compatible',
  remark TEXT DEFAULT '',
  default_endpoint JSONB DEFAULT '{}',
  capacity_model TEXT DEFAULT 'limited',   -- 'limited' | 'unlimited'
  bucket_max INT,
  cooldown_ms INT DEFAULT 60000,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
> 注：`max_concurrent`、`rate_limits` 列在 `server.js:2330` 的 INSERT 中出现，但 **未在 DDL（:108）显式列出**。✅ 经 `grep` 确认它们由后续 `ALTER TABLE` 添加（与 `mapping_name` 同机制，见 server.js:118 附近）。❓ 精确 ALTER 语句行号与默认值需在 initDB 中再定位一次，确保迁移脚本精确对齐。

### B.2 `models`（server.js:109）✅
```sql
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,            -- 接口模型 ID（当前亦被当作上游真实模型名传入 provider，见 D）
  display_name TEXT NOT NULL,        -- 展示名（当前是路由首要身份，见 A.2）
  mapping_name TEXT DEFAULT '',      -- 用户自定义映射名（纯展示，不参与路由，见 D）
  type TEXT DEFAULT 'image',
  provider_id TEXT REFERENCES providers(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT TRUE,
  supported_resolutions TEXT[] DEFAULT '{}',
  capabilities JSONB DEFAULT '{}',
  endpoint JSONB DEFAULT '{}',
  param_template JSONB DEFAULT '{}'::jsonb,
  credit_cost INT DEFAULT 0,         -- 客户充值价（单次消耗积分）
  supports_reward_balance BOOLEAN NOT NULL DEFAULT TRUE,
  reward_credits_required INT NOT NULL DEFAULT 0,
  max_concurrent INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
> ❓ `rate_limits` 是否在 models 表（vs 仅在 providers）需再核实——`server.js:2992` 的 models INSERT 字段列表未含 `rate_limits`，说明模型级限速当前不存在，仅 provider 级有。

### B.3 `generation_tasks`（server.js:204-217 DDL + :273-275 ALTER）✅
```sql
CREATE TABLE generation_tasks (
  task_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',   -- running | done | failed
  model TEXT DEFAULT '',                     -- ⚠️ 遗留列：存 display_name 类展示值
  prompt TEXT DEFAULT '',
  count INT DEFAULT 1,
  content_type TEXT DEFAULT 'image',
  result JSONB, pending_ids TEXT[], client_meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
);
-- 后续迁移追加：
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS model_id TEXT;          -- :273
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS provider_task_id TEXT;  -- :275
```
> ⚠️ **迁移风险点**：`model`（遗留）与 `model_id`（新增）并存。`dispatcher.persistProviderTaskId`（dispatcher.cjs:782）写入 `provider_task_id/provider_id/model_id`，但 DDL 原始定义无 `model_id`，依赖 ALTER。❓ 是否存在**未走 persistProviderTaskId 的旧写入路径**仍只写 `model` 不写 `model_id`？需查 `generation_tasks` 全仓 INSERT/UPDATE 以确保 `model_id` 全覆盖（影响「task id 持久化」验收项）。

### B.4 `credit_transactions`（server.js:236-244）✅
```sql
CREATE TABLE credit_transactions (
  id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,        -- reserve | commit | release
  amount INT NOT NULL, ref TEXT, pool TEXT, balance_after INT, created_at TIMESTAMPTZ
);
```

### B.5 `model_cost_rates`（server.js:588-600）✅ — 上游成本（Provider 实际成本）
```sql
CREATE TABLE model_cost_rates (
  id TEXT PRIMARY KEY DEFAULT 'mcr-'||gen_random_uuid()::text,
  provider_id TEXT NOT NULL, model_id TEXT NOT NULL,   -- ⚠️ 此 model_id 即上游真实模型名（与 models.model_id 同值）
  model_type TEXT DEFAULT 'text',
  input_cost_per_1k NUMERIC DEFAULT 0, output_cost_per_1k NUMERIC DEFAULT 0,
  cost_per_unit NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'CNY', source TEXT DEFAULT 'manual',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider_id, model_id)
);
```

### B.6 `consumption_ledger`（server.js:604-622）✅ — 双侧账务（后台量 vs 客户量）
```sql
-- scope, actor_id, purpose, provider_id, model_id, model_type,
-- input_units, output_units, backend_cost_cents, customer_charge_credits, customer_charge_cents, margin_cents, ...
```

### B.7 `model_price_history`（server.js:627-634）✅ — 改价/下架归档
```sql
CREATE TABLE model_price_history (
  id TEXT PRIMARY KEY DEFAULT 'mph-'||gen_random_uuid()::text,
  model_id TEXT NOT NULL, display_name TEXT DEFAULT '', credit_cost INT DEFAULT 0, updated_at TIMESTAMPTZ
);
CREATE INDEX ix_mph_model ON model_price_history(model_id, updated_at DESC);
```

### B.8 结论
- ✅ 当前已具备：`providers`、`models`、`model_cost_rates`（provider 成本）、`model_price_history`（客户价历史）、`consumption_ledger`（双侧盈亏）。
- ❓ **缺失（V3 目标需新建）**：`provider_model_bindings`（逻辑 Model ↔ Provider Model Instance 解耦）、`pricing`（与 models.credit_cost 解耦的明确定价表）、`generation_attempts`（单次 provider 尝试，当前只在内存/provider_task_id 单字段）、`provider_health` / `routing_policy` / `circuit_breaker` 状态表、`audit_log`（已有 `audit_logs` 表 :369，但 ModelHub 操作未写入）。

---

## C. 当前 API

| 端点 | 方法 | 作用 | 权限 | 关键事实 |
|---|---|---|---|---|
| `/api/providers` | GET | 列出服务商（apiKey 脱敏 `***`） | 公开 | server.js:2292 |
| `/api/providers` | POST | **全量同步 upsert**；先 `DELETE FROM models WHERE provider_id <> ALL(keepIds)` 再 `DELETE FROM providers WHERE id <> ALL(keepIds)` | admin | server.js:2297-2350。⚠️ **破坏性全同步**：客户端必须发完整列表，否则误删 |
| `/api/providers/:id` | DELETE | 删服务商 | admin | server.js:2364 |
| `/api/providers/states` | GET | 调度器内存账号冷热快照 | admin | server.js:2352 |
| `/api/providers/:id/cooldown` | POST | 手动强切 hot/cold/cooldownMs | admin | server.js:2357（持久化到 rate_limits.manual_state / cooldown_ms） |
| `/api/models` | GET | 列出模型 | 公开 | server.js:2975 |
| `/api/models` | POST | upsert（**不删**列表外项，与 providers 不同） | admin | server.js:2979；外键容错 provider_id 无效置 NULL |
| `/api/models/:id` | PATCH | 字段白名单局部更新 | admin | server.js:3008；改 credit_cost 写 model_price_history；奖励校验 |
| `/api/models/:id` | DELETE | 删模型（先归档价格到 model_price_history） | admin | server.js:3078 |
| `/api/generate` | POST | 生成主入口（见 A.1） | 登录 | server.js:2374 |
| `/api/generate/cancel/:taskId` | POST | 取消在途 | 登录 | server.js:2506 |
| `/api/generate/status/:taskId` | GET | 查状态 | 登录 | server.js:2516 |
| `/api/generate/active` | GET | 在途任务列表（刷新恢复） | 登录 | server.js:2524 |
| `/api/generate/stream` | GET | SSE | 登录 | server.js:2532 |
| `/api/admin/model-price-history?modelId=` | GET | 历史价查询 | — | server.js:1691 |

**前端 API 契约**（src/services/api.ts）✅：
- `apiSaveProviders/Models` = 全量 POST；`apiPatchModel` = PATCH 子集；`useModelHub` 模块级 store 在 `setProviders/setModels` 时**同步整列写回后端**（useModelHub.ts:63-73），删除时 `apiDeleteProvider + apiSaveProviders(过滤后)` 双保险（useModelHub.ts:80-102）。

---

## D. modelId / displayName / mappingName 的真实用途

| 字段 | 定义位置 | 写入来源 | 路由是否使用 | 当前实际角色 | V3 目标角色 |
|---|---|---|---|---|---|
| `model_id` | models.model_id | seed: `cfg.id`（slug，如 `openai-gpt-image-1`） | ✅ 兜底路由（dispatcher:568-569）；✅ 传给 provider 作为上游模型名（dispatcher:148 `model: model.model_id`） | **兼任**「目录稳定 ID」+「上游真实模型名」→ 严重耦合 | `model_id` = 永久稳定机器标识（逻辑 Model）；新增 `upstream_model_name` 单独存真实模型名 |
| `display_name` | models.display_name | seed: `cfg.name`（如 `gpt-image-1`） | ✅ **首要路由身份**（dispatcher:565） | **承担核心运行身份**（致命耦合） | 降级为纯 UI 展示名，退出路由 |
| `mapping_name` | models.mapping_name | 后台可填，seed 默认 `''` | ❌ 不参与任何后端路由 | 纯展示（getEffectiveModelName 优先于 displayName） | 维持纯展示，或并入 display_name 体系 |

**核心问题（已确认）**：
1. 调度以 `display_name` 为首要 key（dispatcher:565），用户改 display_name 会**直接改变路由命中**，违背「稳定机器标识」原则。
2. `model_id` 同时是目录 ID 和上游模型名（dispatcher:148）。一旦某 provider 的真实模型名变更（如 `dall-e-3`→`gpt-image-1` 内部代号），无法在不破坏目录稳定的前提下更新。
3. `groupModelsByModelId`（groupModels.ts:51）按 `model_id` 聚合多 provider 行，但 UI 选择键仍是 `displayName`（见 G）——聚合与选择身份不一致。

---

## E. billing 查询逻辑

**时序（server.js:2374-2502 实证）**：
1. `resolvePayment`（billing.cjs:11）：查 `users.reward_credits/recharge_credits`，奖励优先、不足回退充值、都不够抛 `INSUFFICIENT`/`NEED_RECHARGE`。
2. 成本来源：`SELECT credit_cost, supports_reward_balance, reward_credits_required FROM models WHERE id=$1 OR model_id=$1 LIMIT 1`（server.js:2410）——**接受 id 或 model_id 查价**。
3. `reserveCredits`（billing.cjs:32）：`UPDATE users SET {col}={col}-$1 WHERE id=$2 AND {col}>=$1` 原子扣减 + 写 `credit_transactions(kind='reserve')`。**唯一扣费点**。
4. 终态回调：`commitCredits`（billing.cjs:58，幂等 `_hasPosted`）/ `releaseCredits`（billing.cjs:70，幂等）。
5. 对账兜底：`findDanglingReserves`（billing.cjs:84）捞 `running` 超 30min 未 commit 的任务释放 held。

**双侧记账（accounting.cjs）**：
- `recordConsumption`（:55）：按 `(provider_id, model_id)` 查 `model_cost_rates`（:75）算 `backend_cost_cents`；客户量由 `credit_cost` 分摊（按 units，dispatcher:694/926）；`margin = customer - backend`。
- `upsertCostRate`（:30）：写 provider 成本，UNIQUE(provider_id, model_id)。

**结论**：✅ 计费语义（双余额、reserve/commit/release 三段式、幂等、超时不退）已健壮；✅ 客户价（credit_cost）与 provider 成本（model_cost_rates）已**部分解耦**。❓ 但 `model_cost_rates.model_id` 存的是上游真实模型名（与 models.model_id 同值），V3 解耦 Provider Model Instance 后，该键需改为绑定实例 ID（见 J）。

---

## F. dispatcher 路由逻辑

**现状（已确认）**：
- 路由：display_name→model_id→收集全部启用行→组装 `(model×provider)` pairs（dispatcher:564-587）；过滤 `!pr.enabled`、`api_key.length<6`。
- 分配：`dispatchOne`（dispatcher:527-544）用 `RR_POINTER`（模块级全局游标）对 pairs 轮询；`MAX_RETRY` 内失败切下一 pair；`failed`/`timeout` 立即终态不再试（:538）。
- 并发闸门：`GLOBAL_ACTIVE >= GLOBAL_MAX` 则 sleep（:532）；阈值可被 `settings.app.maxThreads` 实时覆盖（dispatcher:558）。
- 限速/Bucket：provider 级 `rate_limits`（bucket_units_per_min / ops）+ `capacity_model` + `bucket_max` + `cooldown_ms` 已在 token-bucket 中生效（dispatcher:382 `ops[t]=Math.max(1,Math.round(B/cap))`、:1316 `tokens`）。
- 账号冷热：`getAccountStates` / `setManualState`（内存态，/api/providers/states、/cooldown）。

**V3 目标 vs 现状对照（缺失项）**：
| V3 目标能力 | 现状 | 缺口 |
|---|---|---|
| enabled | ✅ provider/model 各有 enabled | — |
| health | ❌ 仅内存冷热，无成功率/延迟采集 | 需 `provider_health` 表 + 指标采集 |
| cooldown | ✅ 手动 cooldownMs | 仅手动，无失败自动冷却 |
| rate limit | ✅ provider 级 bucket | 无模型实例级 |
| max concurrency | ✅ provider.max_concurrent + 全局 GLOBAL_MAX | 无按模型/绑定实例 |
| circuit breaker | ❌ | 完全缺失 |
| success/failure rate | ❌ | 缺失（attempts 不落库） |
| latency | ❌ | 缺失 |
| provider cost | ✅ model_cost_rates | 键需改为绑定实例 |
| manual weight | ❌ | 缺失（RR 无权重） |
| 自动降级 | ⚠️ 仅 RR 切下一 pair | 无基于健康/成本的智能降级 |
| 失败重试 | ✅ MAX_RETRY 切 pair | 非同 provider 重试，无退避策略表 |

> ❓ `RR_POINTER`/`GLOBAL_MAX`/`MAX_RETRY`/`WAITING_*` 等常量的**精确定义行**需在 dispatcher.cjs 顶部再定位（本阶段未逐行读常量区，仅确认其行为）。

---

## G. 前端模型选择逻辑

**生成时选择（GenerationBar.tsx，已确认）**：
- 当前模型：`models.find(m => m.displayName === settings.model)`（:661）——**用 displayName 匹配**。
- 选择器渲染：`getEffectiveModelName(g) || g.displayName`（:1913、:744）；搜索匹配 displayName/mappingName/modelId（:734-736）。
- 选中即 `onSettingsChange({...settings, model: g.displayName})`（:1904）→ 最终 `apiGenerate({ model: settings.model, ... })`（:1096）。
- ➡️ **`body.model` = displayName**，是 dispatcher 首要路由 key（闭环 A.2）。

**管理时（useModelHub.ts，已确认）**：
- 模块级 store 初始化：后端空则用 MOCK 写回（:22-45）。
- `setModels/setProviders` 整列 upsert（:63-73）；`patchModel` 乐观更新 + PATCH（:134-148）；`deleteProvider` 单删 + 全量保存兜底（:80-102）；`cleanupOrphanModels`（:118）。
- `getModelsByType` 过滤 `p.enabled && m.enabled && p.id!=='p0'`（:158-163）。

**聚合（groupModels.ts，已确认）**：`groupModelsByModelId` 按 `modelId` 聚合同名多 provider 行；`displayName` 取首个启用行；`creditCost` 取 max；`commercialUse` 任一 true 即 true。但 UI 选择身份仍是 displayName（不一致，见 D）。

**❓ 待补读**：`src/pages/ModelHubPage/**` 的 6 个组件（ModelHubPage / AddModelDialog / ProviderModelsPanel / PairingTab / EndpointsTab / AsyncAddDialog）管理模型时如何构造 `model_id` / `display_name` / `mapping_name`、是否已有「绑定多 provider」UI 雏形——影响 Phase 1 表单改造范围，需在 Phase 1 前细读。

---

## H. 数据迁移风险

1. **全同步删除风险** ⚠️：`/api/providers` POST 会 `DELETE` 列表外 models+providers（server.js:2309-2310）。若 Phase 1 引入新写路径而前端仍发旧完整列表，可能误删新表数据。**迁移原则**：新表采用 ADD COLUMN / CREATE TABLE，第一阶段**绝不删旧列**，双读兼容（见用户迁移原则）。
2. **`generation_tasks.model` 遗留列** ⚠️：与 `model_id` 并存；旧路径可能只写 `model`。迁移到「task 持久化用 model_id」前，需先确保全写入路径覆盖 `model_id`（❓ 待查全 INSERT/UPDATE）。
3. **`display_name` 路由耦合** ⚠️：直接改 schema 让 `model_id` 成为唯一路由 key 会破坏现有 `display_name` 路由命中。必须：先加 `upstream_model_name` + 兼容层（dispatcher 仍接受 display_name 查询，但内部归一为 model_id），观察期后再移除 display_name 路由分支。
4. **`model_cost_rates` 键耦合** ⚠️：键为 (provider_id, model_id=上游名)。解耦 Provider Model Instance 后该键需迁移到绑定实例 ID，需数据回填 + 验证 SQL。
5. **FK 级联**：`models.provider_id REFERENCES providers(id) ON DELETE CASCADE`（server.js:109）。删 provider 会级联删 model——Phase 1 建 `provider_model_bindings` 需注意 FK 方向与删除顺序。
6. **OSS / 积分数据** ✅：本次改动不触达 `media`/`users`/`credit_transactions` 主体，按「旧结构+新结构+兼容层+回填+双读+切换+观察+最后删旧」原则可保证不破坏已有图片/视频/文本生成链与积分。

---

## I. 测试覆盖情况

- ❌ **应用层零自动化测试**：全仓 `*.test.*` / `*.spec.*` / `__tests__` 仅存在于 `node_modules`，业务代码（dispatcher/billing/accounting/server 路由/前端 hooks）**无任何 unit/integration 测试**。
- ❌ 无 migration 验证 SQL 套件、无 API compatibility 测试、无生成链 smoke test 脚本。
- ➡️ **Phase 1 起必须补齐**（用户测试要求）：至少 `lint` + `tsc --noEmit` + dispatcher 路由单测 + billing 三段式单测 + 一次真实生成链 smoke（选模型→查价→预扣→dispatcher→provider mock→task id 持久化→成功/失败/重试退款）。当前不具备，是上线最大风险点之一。

---

## J. 推荐修改顺序（分阶段，满足用户「可逐阶段上线 / 可回滚 / 可 Git 精确恢复」）

> 以下为**顺序建议**，非实施方案。每个 Phase 独立提交、独立可回滚。

**Phase 1 — 稳定标识解耦（最小改造，不动计费语义）**
1. `models` 表 `ADD COLUMN upstream_model_name TEXT`（默认取现有 `model_id` 值回填）。
2. `dispatcher.generate`：路由优先用 `model_id`（传入值归一为 model_id）；保留 `display_name` 查询分支作为兼容层，但内部一律归一为 `model_id` 收集 rows（消除 display_name 决定路由的耦合）。
3. 前端 `GenerationBar`：选中键由 `displayName` 改为 `model_id`（仍用 `getEffectiveModelName` 展示）；`apiGenerate` 传 `model_id`。
4. `generation_tasks`：确保所有写入路径覆盖 `model_id`（❓ 先查全 INSERT）。
5. 补：`dispatcher` 路由单测 + `billing` 三段式单测 + 1 条生成链 smoke。
6. 观察期：双读兼容，旧 `display_name` 路由分支保留但不依赖。

**Phase 2 — Provider Model Binding（逻辑 Model ↔ Provider Instance 解耦）**
1. `CREATE TABLE provider_model_bindings (id, logical_model_id → models.model_id, provider_id, upstream_model_name, is_active, priority, cost_rate_ref...)`。
2. 数据回填：从现有 `models` 行（每行即一个 provider 实例）迁移为 `provider_model_bindings` 一行。
3. `dispatcher` 改为从 bindings 选实例；`models` 退化为「逻辑 Model 目录」。
4. `model_cost_rates` 键迁移到 binding id（回填 + 验证）。

**Phase 3 — Pricing 模块（客户售价 ↔ Provider 成本解耦）**
1. `CREATE TABLE pricing`（logical_model_id, user_price_credits, effective_from, ...）承接 `models.credit_cost`；provider 成本留 `model_cost_rates`/binding。
2. 双读：dispatcher/billing 先读 `pricing`，回退 `models.credit_cost`。

**Phase 4 — Routing Policy + Provider Health + Circuit Breaker + Adaptive Weighted Router**
1. `provider_health` / `routing_policy` / `generation_attempts` 表；采集 success/failure/latency。
2. `dispatcher` 路由从 RR 升级为加权（manual weight + health + cost + latency），失败自动冷却 + 熔断 + 退避重试。

**Phase 5 — Audit Log**
1. ModelHub 所有写操作（provider/model/binding/pricing/routing 变更）写入现有 `audit_logs` 表。

---

## 明确区分：已确认 vs 待核实

### ✅ 已确认事实
- 生成闭环「前端→API→PG→billing→dispatcher→provider→生成」成立（A.1）。
- dispatcher 路由首要身份是 `display_name`（dispatcher.cjs:565），`model_id` 兜底（:568）。
- `model_id` 同时作为上游真实模型名传入 provider（dispatcher.cjs:148）。
- `mapping_name` 纯展示，不参与路由（grep 全仓仅 UI 用）。
- 计费 reserve/commit/release 三段式 + 幂等 + 超时不退积分（billing.cjs + server.js:2431/2492）。
- 客户价 `credit_cost` 与 provider 成本 `model_cost_rates` 已部分解耦（accounting.cjs:75）。
- `/api/providers` POST 为破坏性全同步（会删列表外 models+providers）（server.js:2309-2310）。
- `models.provider_id` 级联删（server.js:109）。
- 前端选择键 = displayName（GenerationBar.tsx:661/1904/1096）。
- 应用层零自动化测试（I）。
- 6 个 ModelHubPage 组件存在但未逐行读（G）。

### ❓ 仍需继续核实
- `providers` 表 `max_concurrent`/`rate_limits` 的精确 ALTER 语句行号与默认值（B.1）。
- `models` 表是否含 `rate_limits` 列（B.2 推测仅 provider 级有）。
- `generation_tasks.model_id` 是否被**所有**写入路径覆盖（B.3/H.4）——需查全 INSERT/UPDATE。
- `dispatcher.cjs` 顶部常量（`RR_POINTER`/`GLOBAL_MAX`/`MAX_RETRY`/`WAITING_*`）精确定义行（F）。
- `ModelHubPage/**` 6 组件如何构造 model_id/display_name/mapping_name、是否已有绑定 UI 雏形（G）。
- 是否存在其他直接 `WHERE display_name=` 的路由（如 shop/agent 优化 prompt 等，已知 shop.cjs 用 `m.id`→`model.model_id`，与 generate 不一致，需全仓复核）。

---

## 最小 Phase 1 改造方案（仅规划，不实施）

**目标**：在不改计费语义、不破坏旧数据、可回滚前提下，让 `model_id` 成为稳定路由身份，`display_name` 退出路由核心。

**DB（幂等 migration，ADD COLUMN 优先）**
```sql
-- 仅新增，不删旧列
ALTER TABLE models ADD COLUMN IF NOT EXISTS upstream_model_name TEXT;
-- 回填：初始取现有 model_id（即当前上游真实模型名）
UPDATE models SET upstream_model_name = model_id WHERE upstream_model_name IS NULL OR upstream_model_name = '';
```
验证 SQL：`SELECT id, model_id, display_name, upstream_model_name FROM models LIMIT 5;`

**后端（兼容层）**
- `dispatcher.generate`（:564-577）：传入 `model` 先按 `model_id` 查；保留 `display_name` 分支但仅作兼容回退。内部收集 rows 统一用 `model_id`。
- `dispatcher.cjs:148` 改为 `model: mr.upstream_model_name || mr.model_id`（为 Phase 2 解耦铺路，本阶段值不变）。

**前端**
- `GenerationBar.tsx:661/1904/1096`：选中与传参键由 `displayName` 改为 `model_id`；展示仍 `getEffectiveModelName`。
- `groupModels.ts`：聚合 key 已是 `modelId`，无需改。

**测试（必须补）**
- `dispatcher` 路由单测：传入 model_id 命中；传入 display_name 仍兼容；多 provider 同 model_id 轮询。
- `billing` 三段式单测：reserve→commit / reserve→release / 幂等。
- 生成链 smoke：选模型→查价→预扣→dispatcher→（mock provider）→task id 持久化→成功/失败/重试退款。

**兼容性 / 回滚**
- 旧列 `display_name` 不删，dispatcher 兼容分支保留 → 回滚只需还原代码，DB 列无害残留。
- 每 Phase 独立 commit；Phase 1 提交前输出：修改文件、新增文件、DB 变化（仅 ADD COLUMN + 回填）、API 变化（无）、兼容性影响（旧 display_name 路由仍可用）、测试结果、已知风险、回滚方法（git revert + 无需回退列）。

**不实施**：本 Phase 0 仅审计。Phase 1 待你确认后从干净分支开始，独立提交。

---

*审计完成。未修改任何业务代码，未执行任何提交。下一步：等你确认 Phase 1 是否按上述最小方案启动。*
