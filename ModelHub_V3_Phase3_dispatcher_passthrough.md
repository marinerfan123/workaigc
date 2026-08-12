# ModelHub V3 Phase 3.1 — dispatcher 透传 binding_id（逐线路利润归因）

> 收口 Phase 3 已就绪的 `recordConsumption(bindingId)` 参数：让生产流量中 `consumption_ledger.binding_id` 真正非空，账单走 `provider_model_costs` 逐线路成本（`source:'binding'`），而非回退 `(provider,model)` 率。
> 日期：2026-08-11｜状态：代码+测试已落地，**未提交**（safe-git 锁 main）、**未跑真实迁移/未重启 3001**（沙箱无 PG）。

---

## 1. 修改清单

### 1.1 `server/modules/modelhub/bindings.cjs`（绑定读取层）
| 位置 | 改动 |
|---|---|
| `SELECT`（行 33） | 绑定查询补选 `id`（=「线路」主键） |
| `targets` map（行 46） | 每项加 `bindingId: b.id \|\| ''` |
| legacy fallback push（行 65） | 加 `bindingId: ''`（无绑定行 → 旧 `(provider,model)` 率路径） |
| `pairs.push`（行 114） | `{ model, provider, bindingId: t.bindingId \|\| '' }` |
| JSDoc（行 26） | 返回类型补 `bindingId:string` |

### 1.2 `server/dispatcher.cjs`（调度主链路）
| 位置 | 改动 |
|---|---|
| `attemptOnAccount` timeout 返回（行 496） | 补 `bindingId: p.bindingId \|\| ''` |
| `attemptOnAccount` failed 返回（行 510） | 补 `bindingId: p.bindingId \|\| ''` |
| `attemptOnAccount` success 返回（行 523） | 补 `bindingId: p.bindingId \|\| ''` |
| 消费组组装（行 607） | `consumption.push(...)` 补 `bindingId: r.bindingId \|\| ''` |
| 正常结算 `recordConsumption`（行 697） | 补 `bindingId: g.bindingId \|\| ''` |
| resume 续轮询查询（行 866） | `SELECT` 补 `COALESCE(b.id,'') AS binding_id` |
| resumed 结算 `recordConsumption`（行 942） | 补 `bindingId: g.bindingId \|\| ''` |
| resumed 消费组（行 907） | 补 `bindingId: (mdl && mdl.binding_id) \|\| ''` |

### 1.3 `server/modules/modelhub/bindings.test.cjs`（新增）
- 3 项单测：`loadDispatchPairs` 绑定 id 透传 / legacy fallback 为空串 / 服务商不可用返回空。

### 1.4 未改（范围边界，明确留待后续）
- `server.js:2573 / 2802 / 2947` 三处 skill / agent 路径的 `recordConsumption` 仍走默认 `bindingId:''`（按 `(provider,model)` 率）。那条链路的 binding 解析属更大改动，本轮不碰。
- `accounting.cjs` 与 `server.js` schema / SNAKE_MAP 在 Phase 3 已就绪，本轮零改。

---

## 2. 测试结果

| 套件 | 项 | 结果 |
|---|---|---|
| `bindings.test.cjs`（新增） | 3 | ✅ 全绿 |
| `pricing.test.cjs`（Phase 3 既有） | 19 | ✅ 全绿 |
| **合计** | **22** | **✅ 22/22** |

- `node --check`：`bindings.cjs` + `dispatcher.cjs` 均语法通过。
- **未跑**：真实 PG 迁移、启动 3001、dispatcher 端到端出图（沙箱网络隔离连不上宿主机 PG，且本环境无可用 providers）。

---

## 3. 兼容性验证

- **旧路径不变**：无 `provider_model_bindings` 行（legacy fallback）的模型 → `bindingId:''` → `recordConsumption` 走 `(provider,model)` 率 → 默认率，与改造前完全一致。
- **幂等无碍**：`binding_id` 列 Phase 3 已 `DEFAULT ''` 且为普通列，新增非空值不破坏任何旧记录或旧调用（其它 `recordConsumption` 调用方仍默认 `''`）。
- **回退链仍生效**：`getProviderCostCents` 双读顺序 `binding → rate → default` 未变；即使某 `binding_id` 在 `provider_model_costs` 无行，也自动回退到 `(provider,model)` 率，绝不报错中断记账。
- **resume 路径**：续轮询查询 `LEFT JOIN` + `COALESCE(b.id,'')` 保证 `mdl.binding_id` 恒存在（有绑定取 id，无则 `''`），不会因缺列抛错。

---

## 4. 回滚方法

本次为**纯增量透传**（只往既有参数/列里填值，未 DDL、未改表结构、未删列）：

1. 撤销代码：`git checkout`（或人工还原）`server/modules/modelhub/bindings.cjs`、`server/dispatcher.cjs`、`server/modules/modelhub/bindings.test.cjs` 三个文件即可。
2. 数据层：无需回滚 DDL（`binding_id` 列由 Phase 3 负责，本增量不新建/不删除任何列或表）。历史已写入的非空 `binding_id` 行在回滚后仍可被 `getProviderCostCents` 正常消费，无副作用。
3. 若想清空已写入的 `binding_id`：`UPDATE consumption_ledger SET binding_id='' WHERE binding_id<>'';`（可选，非必须）。

---

## 5. 后续建议

1. **宿主机验证（必须，你本机做）**：
   - 先跑 Phase 3 迁移：`node scripts/migrate/modelhub-v3-phase3.cjs --dry-run` → 确认无误 → 执行（生成 `provider_model_costs` 行，含各 `binding_id`）。
   - 重启后端 3001 加载新 `bindings.cjs`/`dispatcher.cjs`。
   - 跑一次真实出图，然后核对：
     ```sql
     SELECT binding_id, COUNT(*) FROM consumption_ledger WHERE binding_id<>'' GROUP BY binding_id;
     -- 期望：出现非空 binding_id 分组（旧数据应仍为 ''）
     SELECT source, COUNT(*) FROM (
       SELECT (get_provider_cost_cents_debug...) -- 或查 ledger 行确认成本来源
     ) ...
     ```
   - 简易确认：取一条新出图 `consumption_ledger` 行，`binding_id` 非空即透传成功。
2. **safe-git 提交**：main 被 safe-git 锁死，禁标准 git。本增量与 Phase 3 一起待你在**本机** plumbing 提交（建议独立 commit：`ModelHub V3 Phase3.1: dispatcher 透传 binding_id 逐线路归因`）。
3. **可选增强**：把 `server.js` 三处 skill/agent 路径也解析并透传 `binding_id`（需先确定那几条链路如何选 binding），让全平台统一逐线路成本。

---

## 6. 铁律对齐

- ✅ 未 DROP / 未改旧列；旧 `models.provider_id` / `model_cost_rates` 路径保留。
- ✅ 双读兼容：binding → rate → default 回退链未被破坏。
- ✅ 异常兜底：`recordConsumption` 成本查询失败仍按默认率记账，不阻断出图结算。
- ✅ 未触碰 `server.js` 中央路由 / 未改计费 reserve/commit/release 终态语义。
