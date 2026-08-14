# ModelHub V3 — Phase 3 定价层 · 交付报告

> 日期：2026-08-11 ｜ 范围：定价层数据模型（用户价 vs 每线路成本）+ 双读账务 + 幂等迁移 + 单测
> 铁律承袭：双读兼容、零 DELETE、幂等迁移、可回滚、独立提交、四节报告、safe-git 禁令
> 设计分叉（已确认）：成本粒度按**线路 `binding_id`**（非 `(provider_id, model_id)`），以满足「线路 A/B/C 各 ¥」

---

## 一、修改清单（本次改动）

### 1. `server/server.js` — `initDB()` 新增 Phase 3 结构（幂等、零 DELETE）
- 紧跟 `model_price_history` 之后新增两张表（CREATE TABLE IF NOT EXISTS）：
  - **`model_pricing`**（用户侧价，单逻辑模型一行）
    - `model_id TEXT PRIMARY KEY`、`credit_price INT`（用户积分售价）、`reward_price INT`（奖励余额售价）、`currency TEXT DEFAULT 'CNY'`、`updated_at`
  - **`provider_model_costs`**（每线路成本，复合主键）
    - `binding_id TEXT REFERENCES provider_model_bindings(id) ON DELETE CASCADE`、`provider_id TEXT`、`model_id TEXT`（冗余）、`cost NUMERIC`（分）、`currency TEXT`、`unit TEXT`（per_1k_input_token / per_1k_output_token / per_asset）、`effective_at`、`updated_at`
    - `PRIMARY KEY (binding_id, unit)` —— 同一线路按单位拆多行，使智能路由能逐线路算利润
    - 索引 `ix_pmc_pm(provider_id, model_id)`、`ix_pmc_binding(binding_id)`
- `consumption_ledger` 前向兼容补列：`DO $$ ... ADD COLUMN binding_id TEXT DEFAULT ''`（缺列才补，幂等）
- **`SNAKE_MAP`** 同步新列：`binding_id→bindingId`、`credit_price→creditPrice`、`reward_price→rewardPrice`、`effective_at→effectiveAt`（cost/unit/currency 已是同名，自动透传）。遵守「SNAKE_MAP 铁律」，防前端字段 undefined 假死。
- **未改动**：`model_price_history`、`models.credit_cost`、`model_cost_rates` 一律保留不删（双读回退 + 回滚安全网）。

### 2. `server/accounting.cjs` — 双读定价/成本函数（新增 + recordConsumption 增强）
新增纯函数（均带 try/catch 兜底，异常不阻断记账）：
- `getModelPrice(pg, modelId)` — 双读链：`model_pricing → model_price_history(最新) → models.credit_cost → 0`
- `upsertModelPrice(pg, {...})` / `upsertProviderCost(pg, {...})` — 幂等 upsert（供未来后台价格 API 用）
- `getProviderCostRate(pg, {bindingId, providerId, modelId})` — 取成本率明细，返回 `source: binding|rate|default`
- `getProviderCostCents(pg, {bindingId, providerId, modelId, modelType, inputUnits, outputUnits})` — 算某次消耗上游成本（分）：
  - 优先 `provider_model_costs(binding_id)` 逐线路精确成本
  - 回退 `model_cost_rates(provider, model)`
  - 回退 `settings.app.defaultBackendCost[type]` 默认率
- **`recordConsumption` 增强**：新增可选 `bindingId` 参数；成本计算统一改走 `getProviderCostCents`（单点真相，旧路径 `(provider,model)` 率与默认率仍保留为回退）；INSERT 列由 15 → 16，写入 `binding_id`。`bindingId` 默认 `''`，**旧调用方零改动**。

### 3. `scripts/migrate/modelhub-v3-phase3.cjs` — Phase 3 迁移脚本（新建）
- 幂等建表 + 前向兼容 ADD COLUMN（同 initDB）。
- **回填 `model_pricing`**：优先 `model_price_history` 最新快照，回退 `models.credit_cost`；`reward_price` 无历史来源默认 0。`WHERE NOT EXISTS` 幂等。
- **回填 `provider_model_costs`**：从 `model_cost_rates` 按 `(provider_id, model_id)` 取率，经 `CROSS JOIN LATERAL` 拆成 3 单位行（per_1k_input_token←input_cost_per_1k、per_1k_output_token←output_cost_per_1k、per_asset←cost_per_unit），**仅 `cost > 0` 才写**（零成本单位不污染逐线路利润）。`binding_id` 冗余存 `provider_id/model_id`。
- 支持 `--dry-run`（仅统计不写）与 `--rollback`（DROP 新表 + 删列，旧数据不动）。
- 尾部打印验证 SQL 与回滚说明。

### 4. `server/modules/modelhub/pricing.test.cjs` — Phase 3 单测（新建，19 项）
内存 fake pool 模拟 PG，覆盖：
- `getModelPrice` 双读链全 4 档（model_pricing / price_history / models / none）
- `getProviderCostCents` 逐线路成本（text / image）+ **同模型不同线路成本不同（A=0.45 vs B=0.32）**
- 回退链（rate → default）
- `getProviderCostRate` 来源判定（binding / rate / default）
- `recordConsumption` 写 `binding_id` + 用逐线路成本 + 幂等 + **成本查询异常不阻断记账（兜底默认率）** + 缺 purpose 抛错

---

## 二、测试结果

```
node --test server/modules/modelhub/pricing.test.cjs server/modules/modelhub/bindings.test.cjs
# tests 29  |  pass 29  |  fail 0
```
- Phase 3 定价：19 项全绿
- Phase 2 bindings：10 项全绿（确认 accounting 改动未破坏既有模块）
- 语法门禁：`node --check server/server.js` ✅、`node --check server/accounting.cjs` ✅、`node --check scripts/migrate/modelhub-v3-phase3.cjs` ✅

> ⚠️ **本沙箱为网络隔离环境，无法连接宿主机 PG，故未在此运行真实迁移 / 启动 3001。** 真实库验证（建表 + 回填 + 服务加载新 initDB）须在**用户宿主机**执行（见第三节「宿主机验证步骤」）。

---

## 三、兼容性验证（双读 / 零 DELETE / 不破旧）

### 双读兼容链（核心，已单测覆盖）
| 方向 | 新表（权威） | 回退 1 | 回退 2 | 兜底 |
|---|---|---|---|---|
| 用户价 | `model_pricing` | `model_price_history` | `models.credit_cost` | 0 |
| 每线路成本 | `provider_model_costs(binding_id)` | `model_cost_rates(provider,model)` | — | `settings` 默认率 |

- 旧表/旧列**全部保留未删**；新代码读不到新表时自动回退旧表，等价未升级。
- `recordConsumption` 的 `bindingId` 默认 `''`，所有现有调用方（dispatcher / shop / 审计）行为不变。

### 静态/结构校验
- `consumption_ledger` 仍为唯一写入点，且 INSERT 用显式列清单 + 新列有 `DEFAULT ''`，**不影响任何现有调用**（已 grep 确认无其他写方）。
- `SNAKE_MAP` 已同步新列，未来价格 API 返回这些字段时前端不会 undefined 假死。
- FK `provider_model_costs.binding_id → provider_model_bindings(id) ON DELETE CASCADE`：删除某线路绑定会级联清成本，符合「线路即成本」语义。

### 宿主机验证步骤（用户在本地执行）
```bash
# 1) 干跑，仅看统计
node scripts/migrate/modelhub-v3-phase3.cjs --dry-run
# 2) 执行建表 + 回填
node scripts/migrate/modelhub-v3-phase3.cjs
# 3) 重启后端（加载新 initDB）
#    Windows: 在运行 3001 的终端 Ctrl+C 后重新 `node server/server.js`
#    或 PM2: `pm2 restart <app>`
# 4) 冒烟：确认 3001 返回 200 且日志含 "model_pricing / provider_model_costs 表已确保存在"
curl -s localhost:3001/healthz   # 或对应健康检查端点
# 5) 复核：SELECT COUNT(*) FROM model_pricing; SELECT COUNT(*) FROM provider_model_costs;
```

---

## 四、回滚方法

### 代码回滚
- 反向 checkout 本次涉及的 4 个文件（server.js / accounting.cjs / 迁移脚本 / 测试）。旧 dispatcher 读 `models.provider_id` 与 `model_cost_rates`，**完全不依赖新表**，部署旧版即等价未升级。

### 数据回滚（清空本 Phase 写入，旧数据不动）
```bash
node scripts/migrate/modelhub-v3-phase3.cjs --rollback
# 等价于：
#   DROP TABLE IF EXISTS provider_model_costs;
#   DROP TABLE IF EXISTS model_pricing;
#   ALTER TABLE consumption_ledger DROP COLUMN IF EXISTS binding_id;
```
- `model_price_history` / `models.credit_cost` / `model_cost_rates` **完全未动**，可作双读回退与回滚安全网。
- 迁移脚本本身可重复跑（INSERT ... WHERE NOT EXISTS 幂等），无 DROP，正向执行永远安全。

---

## 五、后续建议（非本 Phase 范围，待用户确认）

> 用户原始规格：「以后智能路由才真正可以计算利润」——逐任务的线路利润归因被明确推迟到「以后」。本 Phase 已完成「数据模型 + 双读成本检索（后台可见线路 A/B/C 各 ¥）」。

若要让 `consumption_ledger.binding_id` **真正被填充**（从而能从台账算每条线路的盈亏），需下一步把选中线路的 `binding_id` 透传到记账：
1. `bindings.cjs`：pair 的 `model` 对象增加 `bindingId`（来自 `provider_model_bindings.id`；legacy 回退路径置 `''`）。
2. 视频适配器（agnes/minimax/volcano）与图片路径构造 `consumption` 组时带上 `bindingId`。
3. `dispatcher.cjs:691` 与 `:903` 的 `recordConsumption` 调用补 `bindingId: g.bindingId || ''`。
- 改动均为**增量、向后兼容**，且本 Phase 的 `recordConsumption` 已支持该参数，落地风险低。确认后即作为独立小步提交。

### safe-git 提交约束（重要）
- **本沙箱 `main` 由 safe-git 协议锁死，禁止运行标准 `git commit/rebase` 触碰本地 `main`**（曾触发 `.git` 清理事故）。
- 提交须走 plumbing 或用户本机集成；建议用户本机执行：
  ```bash
  git add server/server.js server/accounting.cjs scripts/migrate/modelhub-v3-phase3.cjs server/modules/modelhub/pricing.test.cjs
  git commit -m "ModelHub V3 Phase3: 定价层（用户价 vs 每线路成本）双读 + 幂等迁移"
  ```
- 前置未决项（仍挂起）：Phase 1/2 的 `ccf6db5` 与 `origin/main`(ed7e935) 远程集成方式未定（自定义 safe-git / 本机 rebase / 留 local 三选一），本次改动基于本地工作树，未做远程推送。
