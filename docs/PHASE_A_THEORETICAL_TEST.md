# Phase A 垂直切片 · 理论测试报告（对照真实 E:\code 代码）

> **测试目的**：不动代码，仅把 `MASTER_DESIGN_v2.md` §2.3 的"注册→登录→生成→扣积分→进媒体列表"垂直切片，拿来和 E:\code 现有真实代码（`server/server.js`、`server/dispatcher.cjs`、前端 `GenerationBar.tsx`、现有表结构）逐条对照，找出逻辑空洞、race condition、与现实不符处。
> **测试时间**：2026-08-02
> **结论**：设计大方向 90% 成立，但存在 **4 个阻塞性架构空洞（G1/G2/G3/G4）+ 1 个必须拍板的单位歧义（G5）**，必须在开工前补进 §2.3，否则会写出"信用泄漏 / 多用户串号"的真实 bug。

---

## 1. 测试方法

- 读 `MASTER_DESIGN_v2.md` §2.3（蓝图书）+ §1.3（计费原语）
- 读真实 `server.js`：建表 DDL（`users`? `media`? `generation_tasks`?）、`/api/generate`、`/api/providers`、`/api/media`
- 读真实 `dispatcher.cjs`：`generateAsync` 的 INSERT/UPDATE、`getTaskStatus`/`listActiveTasks` 是否带 user 过滤
- 读前端 `GenerationBar.tsx`：确认走 `apiGenerate`（服务端）还是直连 provider
- 逐条核对设计书"现状事实表(§2.1)"与"验收清单(§2.3 A.5)"

---

## 2. 对照结果矩阵

| # | 设计书声称 | 真实代码 | 判定 |
|---|---|---|---|
| 1 | `/api/generate` 服务端分发真实可用 | `server.js:447` 确为 `dispatcher.generateAsync`，前端 `GenerationBar` 走 `apiGenerate` | ✅ PASS |
| 2 | 多供应商均衡逻辑已就位 | `dispatcher.cjs` round-robin + `max_concurrent` 已实现 | ✅ PASS |
| 3 | `models.credit_cost` 可作计费来源 | `server.js:49` 已 `ALTER TABLE models ADD COLUMN credit_cost INT` | ✅ PASS |
| 4 | `generation_tasks` 表支撑刷新恢复 | `server.js:55` 已建，含 `pending_ids`/`client_meta` | ✅ PASS |
| 5 | Provider 密钥不泄露前端 | `server.js:410` `maskKey` 把 `api_key` → `***` | ✅ PASS（安全已达标） |
| 6 | §2.1 现状表称"无 users/credit_transactions/sessions" | 属实，确无 | ✅ PASS |
| 7 | 垂直切片含"多用户隔离：A 不扣 B 余额" | `generation_tasks` **无 user_id** → 任务无法归属用户 | ❌ GAP（G1） |
| 8 | 垂直切片终点"进媒体列表" | `media` 表 **无 owner 列** → 全员共享列表 | ❌ GAP（G2） |
| 9 | A.2 "reserve → dispatcher → 成功 commit / 失败 release" | dispatcher 是**后台异步**完成（status 在回调里 UPDATE），HTTP handler 拿 taskId 即返回 | ❌ GAP（G3） |
| 10 | billing 幂等 | `/api/generate` 端点本身无幂等 → 前端重试会双 reserve | ❌ GAP（G4） |
| 11 | `users.balance` 单位"分"、免费送 20 | 与 `credit_cost INT` 单位未统一，20 分=¥0.2 无意义 | ⚠️ 歧义（G5） |

---

## 3. 阻塞性空洞详述（开工前必补）

### G1 · `generation_tasks` 缺 `user_id`（击穿"多用户隔离"）

**现实**：`dispatcher.cjs:332` 的 INSERT 是
```sql
INSERT INTO generation_tasks (task_id, status, model, prompt, count, content_type, pending_ids, client_meta) VALUES (...)
```
无 `user_id`；`getTaskStatus`/`listActiveTasks` 也不按用户过滤。

**后果**：
1. reserve/commit 无法关联用户 → 计费原语拿不到 `user_id`；
2. `GET /api/generate/active`（用于刷新恢复）会返回**全员**在途任务 → 隐私/隔离击穿；
3. 设计 §2.3 A.1 列了新表，却漏了 `ALTER generation_tasks ADD user_id`，但 A.2 路由（按用户列在途任务）和 A.5 隔离验收都**依赖**它。

**修正**：
- `ALTER TABLE generation_tasks ADD COLUMN user_id UUID REFERENCES users(id)`；
- `generateAsync(pgPool, opts)` 增加 `user_id` 参数并写入 INSERT；
- `listActiveTasks` 增加 `WHERE user_id=$1`（管理员可不过滤）；
- 服务端 `/api/generate/active` 按 `req.user.id` 过滤。

### G2 · `media` 缺 owner（击穿"进媒体列表"隔离）

**现实**：`server.js:42` 的 media 表无 `user_id`/owner 列；生成完成后由前端 `POST /api/media` 写行（dispatcher 不写 media）。

**后果**：多用户下，A 生成的图会出现在 B 的列表；A.5 仅验了 balance 隔离，**漏了 media 隔离**——这是设计的真实盲点。

**修正**：
- `ALTER TABLE media ADD COLUMN user_id UUID REFERENCES users(id)`；
- `POST /api/media` 强制 `user_id = req.user.id`（不可由前端伪造）；
- `GET /api/media` 默认按 `user_id` 过滤；素材库"公开"概念留到后续 Phase（加 `is_public` 标志）；
- 现有 mock/seed 行回填一个 `system` 用户或标 `source='seed'` 豁免过滤。

### G3 · reserve/commit 必须在**异步完成路径**，不在 HTTP handler（否则信用泄漏）

**现实**：`/api/generate` handler 调 `dispatcher.generateAsync` 后立即返回 `taskId`；真正成功/失败发生在 `dispatcher.cjs:345-350` 的后台 `UPDATE generation_tasks SET status` 回调里。

**后果**：若按 A.2 字面"handler 里 reserve 后 commit/release"，后台完成时**没人结算 held** → 用户余额被永久冻结在 `held` 列（信用泄漏，永远回不来）。

**修正（设计书必须写明）**：
```
handler:  reserve(user_id, cost, idempotency_key)   // 同步，失败即返 402
         → generateAsync(pgPool, {..., user_id, cost, idempotency_key})
         → 返回 taskId
后台回调(dispatcher.cjs:345):
         status==='done'  → billing.commit(user_id, cost, idempotency_key) + 写 outbox
         status==='failed'→ billing.release(user_id, cost, idempotency_key)
悬挂兜底: 对账任务扫 generation_tasks completed 但 credit_transactions 无对应 commit 的行
```

### G4 · `/api/generate` 端点本身需幂等（否则重试双扣）

**现实**：前端轮询/网络抖动可能重发 `POST /api/generate`；每次 `generateAsync` 生成新 `task_id` + 新 `reserve` → 重复预占/扣费。

**修正**：
- 前端传 `idempotency_key`（如由 `pendingIds` 派生）；
- handler 先查 `generation_tasks WHERE idempotency_key=$1 AND status<>'failed'` → 命中则复用原 taskId，不再 reserve；
- `credit_transactions.idempotency_key` 已是 `UNIQUE`，reserve 本身幂等兜底。

---

## 4. 必须拍板的单位歧义（G5）

**现实**：`users.balance BIGINT` 注释"分"；`credit_cost INT`；§5 D2"免费送 20（分？还是 20 次？）"。

- 若 balance 是"人民币分"，送 20 分 = ¥0.2，毫无意义；
- 更合理：这是**虚拟积分(credits)**，balance 是整数字，免费 20~50 credits，图耗 `credit_cost`（如 5）credits。

**修正**：§2.3 与 §5 D2 统一口径为**虚拟积分（整数，非人民币）**，DDL 注释把"分"改为"credits"。否则 reserve SQL 两边单位不一致会静默出错。

---

## 5. 非阻塞但需补进设计的范围项

- **G6 成本解析步骤**：handler 必须 `JOIN models` 用 `body.model` 解析到启用行取 `credit_cost`，乘 `count`。设计未写解析步骤（body.model 是 display_name 还是 model_id 需钉死）。
- **G7 OSS 代理 owner 校验**：若 `full_url` 是 OSS key，进 media 后取图走 `GET /api/oss/media/:key`，需校验 owner，否则越权看别人图。
- **G8 其它端点鉴权范围**：设计只锁 `/api/generate` + `/api/auth/*`；`/api/media`、`/api/providers`、`/api/models`、`/api/agent/*` 仍匿名可写。建议 Phase A 至少给**写操作**(POST/PUT/DELETE) 加鉴权，读可暂留。
- **G9 Cookie 跨域/dev 坑**：前端 vite(1173) 调后端(3001) 跨端口。Cookie `SameSite=None; Secure` 在 http dev 下发不出。必须明确：dev 用 vite proxy 同源代理 `/api`，或后端 CORS + 前端 `fetch credentials:'include'`。这是落地必踩坑，设计没写。
- **G10 `/api/generate` 是 breaking change**：现任何人可调用；加 Cookie auth 后非浏览器客户端失效。需定义 `ALLOW_DEV_TOKEN` 是否覆盖该端点。
- **G11 并发 reserve 吞吐**：`UPDATE ... WHERE (balance-held)>=cost` 是 PG 行锁，单实例 1000 并发会串行化在该用户行——正确但成瓶颈，符合 A.4"单实例限流用内存可接受"。✅ 逻辑 PASS，仅提示。
- **G12 计费 vs 写 media 是两事件**：commit 在后台 task 完成触发；media 行由前端 task 完成后 `POST /api/media` 写。设计把"扣积分→进列表"描述成一条原子流，实际解耦，需在文档澄清边界。

---

## 6. 开工判定

| 项 | 状态 |
|---|---|
| 设计大方向 / 演进式顺序 / 评审 21 点 | ✅ 可开工 |
| G1 `generation_tasks.user_id` | 🔴 阻塞，必补 |
| G2 `media.user_id` | 🔴 阻塞，必补 |
| G3 commit/release 落在异步回调 | 🔴 阻塞，必补 |
| G4 `/api/generate` 端点幂等 | 🔴 阻塞，必补 |
| G5 单位口径（分 vs credits） | 🟠 必拍板 |

**Verdict**：先把 G1–G5 补进 `MASTER_DESIGN_v2.md` §2.3（加一个 §2.3 A.6「schema 补丁与异步计费时序」），即可进入 Phase A 编码。其余 G6–G12 作为实现备注带进代码。

---

## 7. 顺手确认的"已安全"项（不用改）

- Provider 密钥前端打码 ✅
- 服务端分发已是真路径，前端不直连 provider ✅
- `credit_cost` 已在 DB ✅
- reserve 原子 SQL（`WHERE balance-held>=cost`）正确 ✅
