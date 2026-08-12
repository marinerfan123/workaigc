# ModelHub V3 Phase 3.4 — 确定性智能路由算法

> 前序：Phase 3.3 已落地 `generation_jobs` / `generation_attempts`（智能路由尝试数据模型 + dispatcher 双写 + 后台只读端点）。
> 本轮目标：**在已有数据之上，实现确定性智能路由算法**——可解释、可测试、确定性。

---

## 一、算法总览（门控管线 + 加权评分 + 加权选择）

候选来源 = `loadDispatchPairs` 的 pairs（已预过滤 enabled 绑定 + enabled 服务商 + 有效 api_key）。
历史指标 = `generation_attempts`（Phase 3.3 落地）。实时门控态 = `dispatcher` 内存 `ACCT` 的快照。

```
候选线路
  ↓ enabled?              （绑定/模型启用；live 路径已预过滤）
  ↓ providerEnabled?      （服务商启用；live 路径已预过滤）
  ↓ cooldown?             （cooldownUntil 未到 → 冷却中，拒）
  ↓ circuit open?         （连续拒单 ≥ 3 或 manualState='open' → 熔断，拒）
  ↓ rate limit?           （限流桶令牌 < 本次成本 → 拒）
  ↓ concurrency 满?       （conc ≥ concCap → 拒）
  ↓ capability 满足?      （model.type/contentType 或 capabilities 匹配 → 否则拒）
  ↓ 计算 score（加权评分）
  ↓ Weighted Selection（种子化确定性选择）
```

被任一门挡住的候选进入 `rejected[]`，带 `rejectedAt`（卡在第几道门）+ `rejectReason`（人话）。
通过全部门的候选进入 `eligible[]`，带完整 `score` / `components` / `gate` / `reasons`。

---

## 二、评分公式（权重可配置）

```
score = successRate*0.30 + health*0.20 + idleCapacity*0.15 + manualWeight*0.15
        - p95Latency*0.10 - cost*0.10
```

各分量来源与归一化：

| 分量 | 来源 | 归一化 |
|---|---|---|
| `successRate` | `generation_attempts` 聚合（成功/总） | 已是 [0,1] |
| `health` | 实时 ACCT：`1 - 连续拒单/3`（cold=0, hot=1, 全新=1） | [0,1] |
| `idleCapacity` | 实时 ACCT：`1 - conc/concCap`（unlimited=1） | [0,1] |
| `manualWeight` | `binding.weight`（人工置顶/降权） | clamp [0,1] |
| `negP95Latency` | `generation_attempts` 聚合 P95（成功时延） | `-(p95/60000s)`，夹 [0,−1] |
| `negCost` | `generation_attempts` 聚合平均成本（桶单位） | `-(cost/4)`，夹 [0,−1] |

- **无历史数据** → 成功率取中性 `0.5`，时延/成本无惩罚（不奖不罚，让评分由实时态驱动）。
- **权重包** `DEFAULT_WEIGHTS` 作为第一版默认值；运行时可用 `dispatcher.setRoutingWeights({...})` 覆盖（仅覆盖存在的键，且须为有限数）——满足"权重以后可以配置"。

---

## 三、可解释性（三铁律之一）

每个候选返回：

```jsonc
{
  "bindingId": "b_hi",
  "score": 0.695,
  "components": { "successRate": 0.9, "health": 1, "idleCapacity": 1,
                 "manualWeight": 0.5, "negP95Latency": 0, "negCost": 0 },
  "gate": { "enabled": true, "providerEnabled": true, "cooldownOk": true,
            "circuitOk": true, "rateLimitOk": true, "concurrencyOk": true, "capabilityOk": true },
  "reasons": [
    "成功率 0.90 × 0.30 = +0.270",
    "健康度 1.00 × 0.20 = +0.200",
    "空闲容量 1.00 × 0.15 = +0.150",
    "人工权重 0.50 × 0.15 = +0.075",
    "P95时延 0ms → 负项 0.00 × 0.10 = 0.000",
    "成本 0.00u → 负项 0.00 × 0.10 = 0.000"
  ]
}
```

- `rejected` 候选：`rejectedAt`（哪道门）+ `rejectReason`（如"熔断开启（连续拒单 ≥ 3）"）。
- 后台 `GET /api/admin/routing/decide` 直接消费这份完整决策，做"决策解释"面板。

---

## 四、确定性（三铁律之二）

- 排序 `sortByScore`：分数降序，**同分按 `bindingId` 字典序** tie-break —— 纯函数、无随机。
- 加权选择 `weightedSelect`：种子化 LCG（`s = (s*1664525 + 1013904223) >>> 0`），相同 `seed` + 相同输入 → 相同 `chosen`。
- **生产路径用确定性排序**（`routeDispatchOrder` 返回 best-first 顺序），随机加权选择仅用于 `decide` 端点的"演示性选择"，避免生产流量被随机扰动。

---

## 五、可测试性（三铁律之三）

所有核心函数为**纯函数**（显式入参，不依赖模块级可变状态），可用内存假数据单测：
`aggregateMetrics` / `buildGateContext` / `capabilitySatisfies` / `scoreCandidate` / `routeBindings` / `sortByScore` / `weightedSelect` / `buildReasons`。

---

## 六、非阻断集成（绝不干扰生成主链路）

`router.cjs` 是纯算法库；`dispatcher.cjs` 以**非阻断**方式接入：

1. **门控 + 评分接管排序**：`dispatchOne` 内候选顺序由 `router.routeDispatchOrder(pairs, {acctMap, metrics, weights, seed})` 接管（best-first）。
   - 每轮重试**重新路由**（seed 随 attempt 变化），实时态由 `attemptOnAccount` 兜底 admission（限流/冷却/并发满时返回 null → 切下一个）。
   - 路由异常？`routeDispatchOrder` 失败即退化成"按 pairs 原顺序"——不抛错、不阻断。
2. **指标缓存**：`loadRoutingMetricsCached`（TTL 30s，一次查询覆盖所有 binding），非阻断（失败退化为空 map → 仅按实时态排序）。
3. **ACCT 快照**：`snapshotAcct(pair)` 把内存态映射成 plain object 供 gate 读取，**绝不改动** dispatcher 状态。
4. **权重热改**：`setRoutingWeights` / `getRoutingWeights`，默认 `DEFAULT_WEIGHTS`；后续可接 `settings.app.routingWeights`。
5. **解释端点**：`explainRouting(pairs, {pgPool, contentType, tier, seed})` 导出，供后台消费。

### 新增/改动文件
- **新增** `server/modules/modelhub/router.cjs`（确定性路由算法，纯函数）
- **新增** `server/modules/modelhub/router.test.cjs`（**36/36**）
- **新增** `server/dispatcher.routing.test.cjs`（**4/4**，验证 explainRouting/snapshotAcct/setRoutingWeights 非阻断接入）
- **改** `server/dispatcher.cjs`：require router；新增 `snapshotAcct`/`setRoutingWeights`/`getRoutingWeights`/`loadRoutingMetricsCached`/`explainRouting`；`dispatchOne` 用 `routeDispatchOrder` 替代 RR 轮询（RR_POINTER 退役）；`module.exports` 补 4 个路由 API
- **改** `server/server.js`：新增 `GET /api/admin/routing/decide?model=&contentType=&seed=`（管理员鉴权，返回完整决策）

### 测试总览（Phase 3.4 基线）
```
modelhub 全量 + dispatcher 路由集成（Phase 3.4 基线）：86 tests / 86 pass / 0 fail
  - jobs.test.cjs        5/5   （Phase 3.3 回归）
  - router.test.cjs     36/36  （Phase 3.4 算法：门控顺序/评分明细/排序tie-break/种子选择/聚合/权重覆盖/端到端）
  - dispatcher.routing.test.cjs 4/4 （非阻断接入）
  - 其余 modelhub 模块（bindings/pricing/resolver/revision）回归全绿
node --check：router.cjs / dispatcher.cjs / server.js 全 OK
```
> Phase 3.5 接入后全量回归升至 **110/110**（见文末「Phase 3.5 — Circuit Breaker 熔断状态机」章节）。

---

## Phase 3.5 — Circuit Breaker 熔断状态机

> 在 Phase 3.4 的门控基础上，把 dispatcher 里"连续拒单 ≥ 3 → 短冷却"的朴素双路径冷却，升级为**显式四态状态机**：CLOSED → OPEN → HALF_OPEN → CLOSED。目标：第三方 API 挂掉后，系统不再"一直打、一直失败、一直扣资源"，而是**自动隔离**：OPEN 期间绝不发请求、不扣令牌、不占并发、不记 attempt；冷却后 HALF_OPEN 发少量探测，达标自动回 CLOSED，未达标重 OPEN。

### 状态机定义

```
CLOSED ──(连续失败 ≥ failureThreshold)──▶ OPEN
  ▲                                          │
  │              (HALF_OPEN 成功探测 ≥ halfOpenSuccessToClose)
  │                                          │  cooldown 到期
  │                                    HALF_OPEN
  │                                          │
  └────────(HALF_OPEN 成功达标)──────────────┘
           (HALF_OPEN 任一探测失败 / 探测额度耗尽未达标) ──▶ 重 OPEN
```

四态语义：

- **CLOSED**：正常放行。累计失败达 `failureThreshold`（默认 3）→ 转 OPEN，`cooldownUntil = now + cooldownMs`。
- **OPEN**：冷却中。冷却未到 → 拒单隔离（**不发请求、不扣令牌、不占并发、不记 attempt**）；冷却到期 → 惰性转 HALF_OPEN 并发首个探测（`probeCount=1`）。
- **HALF_OPEN**：发 ≤ `halfOpenMaxProbes`（默认 3）个探测。成功探测累计达 `halfOpenSuccessToClose`（默认 2）→ 回 CLOSED；任一探测失败 → 立即重 OPEN 冷却；探测额度耗尽仍不达标 → 重 OPEN 冷却。

### 与 Phase 3.4 门控的关系

- `buildGateContext` 的 `circuitOk` 门**改读 `cbState`**（而非旧的 `consecutiveRejects >= CIRCUIT_OPEN_THRESHOLD` 退化判断）。
- 被熔断候选带 `rejectedAt='circuitOk'` + 动态 `rejectReason`（如"熔断开启（OPEN，冷却至 …）"）。
- gate 额外暴露 `cbState` / `cbProbe`，后台 `decide` 面板可直接展示当前熔断态与探测进度。
- **最终 admission 仍由 `dispatcher.attemptOnAccount` 裁决**：路由层只是预筛；即使路由放进 CLOSED，dispatcher 内的 `cbAdmit` 仍会在 OPEN/HALF_OPEN 额度耗尽时隔离，确保"绝不发请求"。

### 配置（可覆盖）

```js
const CB_CONFIG = {
  failureThreshold: 3,        // CLOSED 态连续失败达到该值 → 转 OPEN
  cooldownMs: 60000,          // OPEN 冷却时长（与 dispatcher cooldownMs 对齐）
  halfOpenMaxProbes: 3,       // HALF_OPEN 最多发几个探测
  halfOpenSuccessToClose: 2,  // HALF_OPEN 成功探测达到该值 → 回 CLOSED
};
```

运行时可用 `router.setCircuitBreakerConfig({...})` 覆盖（仅接受有限正数），`getCircuitBreakerConfig()` 读取。

### 关键设计铁律

- **纯函数 + 不可变**：`cbInitState` / `cbAdmit` / `cbRecordOutcome` 显式入参、返回全新对象，**不改动入参**，可单测、确定性。
- **非阻断**：dispatcher 调用 `cbAdmit` / `cbRecordOutcome` 全包 try/catch，熔断逻辑异常**绝不阻断生成主链路**。
- **向后兼容**：旧快照无 `cbState` 时，`cbAllows` 退化为 `consecutiveRejects >= CIRCUIT_OPEN_THRESHOLD`。
- **状态机权威**：`attemptOnAccount` 在真正发请求前用 `cbAdmit` 准入；OPEN/HALF_OPEN 额度耗尽 → `return null`（隔离），从根上解决"一直打/一直失败/一直扣资源"。

### 文件改动

- **改** `server/modules/modelhub/router.cjs`：新增 `CB_CONFIG`/`_CB_CONFIG` + 7 个熔断函数（`cbInitState`/`cbAdmit`/`cbRecordOutcome`/`setCircuitBreakerConfig`/`getCircuitBreakerConfig`/`cbAllows`/`circuitRejectReason`）；`buildGateContext` 改读 `cbState` 并暴露 `cbState`/`cbProbe`；`routeBindings` 动态熔断拒绝原因；全部导出。
- **改** `server/dispatcher.cjs`：四处接入 — `getAcct` 初始化 `cbState`；`markReject` 调 `cbRecordOutcome('failure')`；`attemptOnAccount` 用 `cbAdmit` **权威准入**（隔离时不扣令牌/不占并发/不记 attempt）；成功路径 `cbRecordOutcome('success')`；`snapshotAcct` 透传 `cbState`。
- **改** `server/modules/modelhub/router.test.cjs`：新增 22 个熔断单测（cbInitState / cbAdmit 各分支 / cbRecordOutcome 各分支 / 不可变 / buildGateContext / routeBindings / setCircuitBreakerConfig / 端到端自愈）。
- **改** `server/dispatcher.routing.test.cjs`：新增 2 个集成测试（snapshotAcct 含 cbState、dispatcher 共享 router 模块接入熔断）。

### 测试总览（更新至 Phase 3.5）

```
modelhub + dispatcher 路由集成：110 tests / 110 pass / 0 fail
  - jobs.test.cjs               5/5   （Phase 3.3 回归）
  - resolver.test.cjs           ✓     （Phase 1 回归）
  - pricing.test.cjs            ✓     （Phase 3 回归）
  - bindings.test.cjs           ✓     （Phase 2 回归）
  - revision.test.cjs           ✓     （Phase 3.2 回归）
  - router.test.cjs            58/58  （含 Phase 3.4 算法 36 + Phase 3.5 熔断 22）
  - dispatcher.routing.test.cjs 6/6   （含熔断接入 2）
node --check：router.cjs / dispatcher.cjs / server.js 全 OK
```

---

## Phase A — 切换调用（kill-switch + 非阻断兜底）

> 在 Phase 3.4（确定性路由算法）与 Phase 3.5（熔断状态机）已落地的基础上，本 Phase 完成"接入生产调用"最后一环：把 `dispatchOne` 的候选序列**唯一权威**收归 `buildDispatchSequence` → `router.routeBindings`（门控+评分+排序），并加装**非阻断 kill-switch**，确保任何路由层异常或一键关停都不会阻断生成主链路，且可秒级回退到原始顺序（兼容旧 RR/列表顺序）。

### 改动要点（单维度：路由算法，符合 §5 / §17）

- **抽纯函数 `buildDispatchSequence(pairs, opts)`**：将 `dispatchOne` 内原 `router.routeDispatchOrder` 调用整段抽出为可单测纯函数。
  - `ROUTING_V3_ENABLED === false` → 直接返回 `pairs.slice()`（原始顺序，kill-switch 回退路径）。
  - 否则调 `router.routeBindings` 取 `ranking`，按 `bindingId` 重映射回 `pairs` 顺序；未被 ranking 覆盖的候选补到尾部（**绝不丢候选**）。
  - try/catch 包住路由调用：**路由异常即退化原始顺序**，非阻断、兼容层兜底。
- **进程级 kill-switch**：
  - `let ROUTING_V3_ENABLED = process.env.ROUTING_V3_ENABLED !== 'false'`（默认开；`ROUTING_V3_ENABLED=false` 可关）。
  - `setRoutingV3Enabled(v)` / `getRoutingV3Enabled()` 读写。
  - `generate()` 内热切换：`typeof v.routingV3Enabled === 'boolean'` → 覆盖进程态（来自 `settings.app.routingV3Enabled`），**无需重启即切**。
- **`dispatchOne` seed**：每轮重试 `seed = (attempt + 1) * 2654435761`，保证重试时重新路由（与 Phase 3.4 设计一致）。
- **导出** `buildDispatchSequence, setRoutingV3Enabled, getRoutingV3Enabled`。

### 关键设计铁律

- **非阻断（与 §10 / §17 一致）**：路由层异常绝不阻断生成；kill-switch 关 → 原始顺序；路由抛错 → 原始顺序。主链路始终有事可做。
- **单维度**：本 Phase 只动"路由算法接入"一维，未触碰 DB 结构 / API 语义 / 计费语义（符合 §5）。
- **可回退**：kill-switch 提供秒级回退；热切换不重启；兼容层保证路由代码缺失/异常时退化。

### 文件改动

- **改** `server/dispatcher.cjs`：新增 kill-switch 态 + `set/getRoutingV3Enabled`；抽出 `buildDispatchSequence`；`dispatchOne` 改用 `buildDispatchSequence`；`generate()` 热切换；`module.exports` 补 3 个符号。
- **改** `server/dispatcher.routing.test.cjs`：新增 5 个测试（事实锁定 `buildDispatchSequence` 顺序 == `routeBindings` ranking / 开启 best-first / 关闭 kill-switch 回退 / 路由异常退化为原始顺序 / kill-switch 读写）。

### 测试总览（更新至 Phase A）

```
modelhub + dispatcher 路由集成：115 tests / 115 pass / 0 fail
  - jobs.test.cjs               5/5   （Phase 3.3 回归）
  - resolver.test.cjs           ✓     （Phase 1 回归）
  - pricing.test.cjs            ✓     （Phase 3 回归）
  - bindings.test.cjs           ✓     （Phase 2 回归）
  - revision.test.cjs           ✓     （Phase 3.2 回归）
  - router.test.cjs            58/58  （Phase 3.4 算法 36 + Phase 3.5 熔断 22）
  - dispatcher.routing.test.cjs 11/11 （Phase 3.4 接入 4 + Phase 3.5 熔断接入 2 + Phase A 切换调用 5）
node --check：router.cjs / dispatcher.cjs / server.js 全 OK
```

### 完成定义核对（§17）

- 代码：✅ `buildDispatchSequence` + kill-switch + 热切换落地。
- 测试：✅ 115/115 全绿，含失败场景（路由异常退化）。
- 兼容：✅ 关闭/异常均退化为原始顺序，旧行为可恢复。
- 风险：✅ 非阻断，路由层异常/关停不影响生成主链路。
- 回滚：✅ kill-switch 秒级回退；或删 `buildDispatchSequence` 改回收 `routeDispatchOrder`（一行回退点）。
- 提交：⏸ **未提交**（R1 缺口延续，用户 2026-08-12 01:01「先不」）；改动落工作树，待授权后走 safe-git plumbing 推远端。

---

## 七、如何端到端验证（需用户本机，沙箱无 PG）

1. **重启后端 3001**（启动即加载新表/双写 + 新路由代码）：`node server/server.js`（或 `npm run dev`）。
2. 跑几次真实生成，让 `generation_attempts` 积累数据。
3. 调解释端点（管理员 token）：
   ```
   GET /api/admin/routing/decide?model=<model_id>&contentType=image
   ```
   返回 `chosen` / `ranking[]` / `rejected[]` / `weights` / `gateOrder` / `metricsBindings`。
4. 比对：高成功率线路应排前；冷却/熔断/满并发的服务商应出现在 `rejected[]` 并标 `rejectedAt`。

---

## 八、已知边界 / 后续

- **成本分量**当前用 `generation_attempts.cost`（桶单位 1~4）作代理；未来可切换为 `model_cost_rates` 的真实货币成本（需 binding→provider+model 映射）。
- **权重配置**目前用 `setRoutingWeights` 运行时覆盖；尚未接 `settings.app.routingWeights`（留待后台「调度设置」面板，低风险）。
- **per-model 并发覆盖**在 `snapshotAcct` 中已按 `(model.max_concurrent ?? provider.max_concurrent ?? 2)` 与硬上限取小，与 `attemptOnAccount` 一致；路由的并发门为近似预筛，最终 admission 仍由 `attemptOnAccount` 精确判定。
- **未来 Redis 统一状态（用户 2026-08-12 指令）**：单实例下 dispatcher 进程内 `ACCT` 持有实时运行态（健康/熔断/并发/限流/冷却）已够用，**最后才加 Redis**；多实例（Server A/B/C）时该运行态须迁 Redis 做跨实例统一，key 命名空间 `modelhub:provider:{id}:{health|circuit|concurrency|rate|cooldown}`，Postgres 仅存长期事实。详见 `MEMORY.md` 第九节。
- **未提交**（safe-git 锁 main）：Phase 3.3/3.4/3.5/Phase A 全部改动落工作树（R1 缺口延续，用户 2026-08-12 01:01「先不」），需用户本机走 safe-git plumbing 分 Phase 推远端。
