# Phase A 骨架 — 逻辑自检报告（LOGIC_CHECK）

> 范围：`docs/phase-a/` 下 4 个骨架文件，对照现有 `server.js` / `dispatcher.cjs` 真实代码做纸面跑查。
> 结论：**主干逻辑可开工；发现 3 处已在骨架内修正的并发/时序坑 + 6 处落地时必须硬化的伴生项。**
> 全部为「设计/文档级」问题，未改动 `src/` 或 `server/` 任何源码。

---

## 🟢 已在骨架内修正的坑（写代码时直接照此即可）

### L1 · 计费并发用「原子 UPDATE」而非「SELECT FOR UPDATE」
- 位置：`billing.js` `reserveCredits`
- 坑：单条 `pg.query` 是 autocommit，`SELECT ... FOR UPDATE` 的锁在 SELECT 结束即释放，后面的 `UPDATE` 不再受保护。两条语句不构成原子事务，反而制造"加了锁就很安全"的错觉 → 并发下可能双重扣减/漏扣。
- 修正：`UPDATE users SET credits = credits - $1 WHERE id=$2 AND credits >= $1`，用 `rowCount===0` 判余额不足。一行原子搞定，无需事务。

### L2 · 结算点必须在后台完成回调（G3 信用泄漏）
- 位置：`generate_integration.js` ② dispatcher 回调
- 坑：原设计若"handler 里 reserve 后立刻 commit/release"，但 `/api/generate` 调 `generateAsync` 后立即返回 taskId，**真实成败在后台回调**(`dispatcher.cjs:345`)。若 handler 就结算，回调完成时无人释放 `held` → 用户余额被永久冻结。
- 修正：reserve 仅在 handler；commit/release 唯一落在生成完成/失败回调。并配 `findDanglingReserves` 作为进程崩溃的兜底对账。

### L3 · 幂等键防止网络重试双扣（G4）
- 位置：`generate_integration.js` ① POST /api/generate
- 坑：前端轮询/抖动重发 POST，每次新 taskId + 新 reserve → 双扣。
- 修正：`idempotencyKey` 唯一索引；已存在 running/done 直接返回原 taskId 不重扣；failed 才释放旧 held + 删行复用。

---

## 🟠 落地时必须硬化的伴生项（代码审阅清单）

### L4 · 完成回调 commit/release 必须幂等（防崩溃重试双结算）
- 严重度：高。并发重试同一 failed 键时，两个请求都读到 `failed` → 都 `releaseCredits` → 用户积分被退还两次；且第二个 INSERT 因唯一约束失败。
- 修复：`commitCredits`/`releaseCredits` 执行前先查 `credit_transactions` 该 ref 是否已有同 kind，有则跳过。`billing.js` 可加 `ensureOnce(pg, ref, kind, fn)` 包装。

### L5 · 成本解析标识符必须对齐 dispatcher（否则静默免费）
- 严重度：高。`SELECT credit_cost FROM models WHERE id=$1 OR model_id=$1` 依赖 `body.model` 与 dispatcher 选 provider 用的是同一标识。若前端发的是 `display_name`，两列都不命中 → `cost=0` → **免费生成后门**。
- 修复：落地时断言 `cost>0` 对已知模型成立；并在前端 `GenerationBar` 明确发送 `models.id`（与 dispatcher 一致），加单测。

### L6 · `result.images` 形状需归一化（否则写库类型错）
- 严重度：中。`dispatcher.cjs:307` `images.push(r.images[0])` —— `r.images[0]` 可能是字符串也可能是 `{url}` 对象。直接 `INSERT full_url=$4` 若传入对象会报错/存脏数据。
- 修复：写 media 前 `const imgUrl = typeof url === 'string' ? url : url?.url;`。

### L7 · 前端必须停止自写 media（否则与 G2 服务端写重复）
- 严重度：中（破坏性前端改动）。完成回调已服务端写 media(owner)，若 `MediaPicker` 仍在 on-done 本地 append，会出现重复行。
- 修复：`GenerationBar` on `status==='done'` 改为调用现有 `apiGetMedia` 刷新列表（已有 `/api/media`），移除本地 insert；`GET /api/media` 加 `user_id` 过滤（历史 `user_id IS NULL` 行全员可见）。

### L8 · dev(http) 下 Secure cookie 会让登录死循环
- 严重度：中（仅开发环境）。`SameSite=Lax; Secure` 在 `http://localhost` 下浏览器拒绝存储 → 每次请求都无 cookie → 401 循环。
- 修复：`auth.js` 已用 `isProd = NODE_ENV==='production'` 门控，dev 省略 `Secure`。**落地时务必确认 dev 启动设 `NODE_ENV=development`**。

### L9 · sync 分支若保留必须同样走计费（否则免费后门）
- 严重度：中。现有 `POST /api/generate` 有 `body.sync` 同步分支（`server.js:452`）。重写若只给异步分支加 reserve，sync 分支就绕过计费。
- 修复：同步分支也要 `requireAuth` + reserve → `generate` → commit/release；或 Phase A 直接废弃 sync 分支（推荐，统一异步）。

### L10 · dispatcher.cjs 需 `require('crypto')`
- 严重度：低。完成回调用了 `crypto.randomUUID()`，但 `dispatcher.cjs` 当前可能未引入 crypto。
- 修复：落地时在 `dispatcher.cjs` 顶部加 `const crypto = require('crypto');`。

### L11 · `users.credits` 缺省 50 + FK 删除策略
- 严重度：低。`media.user_id` / `generation_tasks.user_id` 建了 FK 但未设 `ON DELETE`，删用户会被外键挡住。
- 修复（建议）：`media.user_id` 改 `REFERENCES users(id) ON DELETE SET NULL`（用户删后历史图全员可见，符合 G2 的 `IS NULL` 规则）；`generation_tasks.user_id` 保留级联或保留。

---

## ✅ 核对通过项（无需改动）

| 项 | 结论 |
|---|---|
| `GET /api/providers` 是否泄露 `api_key` | 已打码 `***`（`server.js:410`），安全 PASS |
| 前端是否直连 provider 泄 key | `GenerationBar` 走 `apiGenerate`(服务端)，PASS |
| `models.credit_cost` 列已存在 | 是，cost 解析可直接用，PASS |
| `generation_tasks.completed_at` 列存在 | 是，回调 UPDATE 引用有效，PASS |
| `sendJSON`/`parseBody` 可复用 | `server.js:134/123`，PASS |
| 表名无冲突 | `users/credit_transactions/refresh_tokens/outbox/requireAuth/jwt/scrypt` 在 `server/` 均无，PASS |
| 密码哈希防时序 | `crypto.timingSafeEqual` + try/catch 长度不匹配，PASS |
| CSRF | `HttpOnly` + `SameSite=Lax` 阻断跨站 POST，PASS |
| 幂等唯一约束 | `ux_gt_idem` partial unique，PASS |

---

## 落地执行顺序建议（下一步开工时）
1. 跑 `001_auth_credits_schema.sql`（或并入 server.js bootstrap）
2. `auth.js` 落地为 `server/auth.js`，`JWT_SECRET` 进环境变量
3. `billing.js` 落地为 `server/billing.js`，**加 L4 的 `ensureOnce` 幂等包装**
4. `POST /api/generate` 改造（含 L5/L9 修正）+ dispatcher 回调（含 L6/L10）
5. 前端 `GenerationBar` 改 refresh-on-done（L7）+ `GET /api/media` 加 user_id 过滤
6. 单测：并发 reserve 不超扣、failed 重试不双退、cost 命中已知模型
