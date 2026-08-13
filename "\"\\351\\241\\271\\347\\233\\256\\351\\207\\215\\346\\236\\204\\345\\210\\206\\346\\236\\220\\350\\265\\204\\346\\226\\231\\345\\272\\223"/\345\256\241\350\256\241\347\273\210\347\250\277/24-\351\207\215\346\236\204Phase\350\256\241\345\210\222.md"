# 24 · 重构 Phase 计划（墨灵 AI）

> 与 `22-目标架构建议.md`、`23-迁移映射.md` 配套。本文给出 **Phase0–Phase5** 的分阶段执行计划，每阶段含：**目标 / 关键交付 / 退出标准 / 主要风险 / 依赖**，并标注证据等级与置信度。
> 只读依据：`审计终稿/02-15`、`项目重构分析资料库/00-06`、`07_PG_schema快照.sql`，及对 `server/server.js`、`server/billing.cjs`、`package.json` 的回查。
> **铁律遵守**：未修改 `E:\code` 任何文件。
> 证据等级/置信度体系同 `22` §0。

> ⚠️ **总体铁律（贯穿所有 Phase）**：PG17 唯一数据源、Redis7 仅缓存、OSS 零二进制、Node 原生 HTTP 中央分发、异步生成主流化、双余额、超时铁律——任何 Phase 不得违反（见 22 §1）。

---

## Phase0 · 冻结现状 + 字符化测试网 + Golden Master 基线

**目标**：在不动一行业务代码的前提下，建立「可回归、可比对」的安全网，使后续任何重构都可被自动验证「行为等价」。

**关键交付**：
1. **冻结现状**：对 `E:\code` 当前源码/配置/`db` 打快照（git tag 或只读副本），明确「旧系统基线」边界。【推断·HIGH】
2. **字符化测试网（对应 15/16/17）**：
   - 统一测试框架：当前 `package.json:13` `test: vitest run` 但 8 个测试文件全用 `node:test`、无 vitest 配置 → `npm test` 实际跑不到用例（**框架不匹配，P0 测试缺口**）。二选一统一（建议保留 `node:test` 并改 `test` 脚本为 `node --test`，或引入 vitest 配置）。【源码已证实·HIGH，15 §2】
   - 落地最小字符化测试集（锁资金/账务正确性 + 越权两条生命线）：
     - `billing.idempotency`：并发同 `ref` 的 commit/release 断言仅 1 行（暴露 P0-1 TOCTOU）【源码已证实·HIGH，15 §5.1】
     - `accounting.idempotency`：并发同 `idempotencyKey` 断言 `consumption_ledger` 仅 1 行（暴露 P0-2）【源码已证实·HIGH，15 §5.2】
     - `dispatcher.statemachine`：非法状态跃迁（success→success / failed→running）断言不重复 commit/release【源码已证实·HIGH，15 §5.3】
     - `payments.webhook`：重复回调断言仅入账一次（webhook_events UNIQUE 已建）【源码已证实·HIGH，15 §5.4】
     - `auth.jwt`：签发→篡改→验签失败；缺 `JWT_SECRET` 回退值不可用于生产断言【源码已证实·HIGH，15 §5.5】
     - `idor`：跨用户访问 `/api/credits/orders/:no`、`/api/media/:id` 断言 403/404【源码已证实·MEDIUM，15 §5.6】
     - `crypto.aes256gcm`：encrypt→decrypt 往返、错误主密钥失败、脱敏格式【源码已证实·HIGH，15 §5.7】
     - `redis.fallback`：Redis 断开降级内存行为一致【源码已证实·HIGH，15 §5.8】
3. **Golden Master 基线**：对核心 API（生成提交/状态/取消、充值下单/webhook、媒体 CRUD、账务总览）录制「请求→响应」黄金样本（含 SNAKE_MAP 后字段形状、错误 `code`、SSE `TaskUpdate` 形状），作为后续重构的等价比对基准。【推断·HIGH，衔接 03/12 契约】

**退出标准**：
- [ ] 测试框架统一，`npm test` 可实际执行全部字符化用例（0 误过）。
- [ ] 8 项最小字符化测试全部就绪（资金/账务/状态机/webhook/JWT/IDOR/加密/降级）。
- [ ] Golden Master 样本库建立，覆盖 §关键 API。
- [ ] 现状快照完成，回滚路径明确。

**主要风险**：
- 框架不匹配导致「以为有测试实则 0 覆盖」——必须在 Phase0 显式验证 `npm test` 真跑【源码已证实·HIGH，15 §2】。
- Golden Master 样本若包含 bug 行为（如 `canceled/cancelled` 不匹配），需标注「已知缺陷基线」而非「正确基线」【源码已证实·HIGH，11 §3.1】。

**依赖**：无（起点）。证据等级【源码已证实】HIGH / 【推断】HIGH。

---

## Phase1 · 资金安全（消除双退/双记/漏退 P0）

**目标**：在不改变对外行为的前提下，堵住资金域所有 P0 漏洞——并发双退、并发双记账、失败键复用漏退。

**关键交付**：
1. `credit_transactions` 加 `(ref, kind)` **唯一约束**；写入改 `INSERT ... ON CONFLICT (ref,kind) DO NOTHING`【数据库已证实·HIGH→推断·HIGH，07 §6.1 / 15 P0-1】。
2. `consumption_ledger` 加 `idempotency_key` **唯一约束**；`recordConsumption` 改 `ON CONFLICT DO NOTHING`【数据库已证实·HIGH→推断·HIGH，07 §6.3 / 15 P0-2】。
3. `reserve/commit/release` 与「余额变更 + 流水 + 账务」包进真实 `BEGIN/COMMIT`（至少 commit/release 与 ledger 同事务）【源码已证实·HIGH→推断·HIGH，07 §9】。
4. 失败键复用：复用同一 `idempotency_key` 经 `ON CONFLICT` 自然幂等，删除「删 `generation_tasks` 行不清理流水」的漏退路径（server.js:2415）【源码已证实·HIGH→推断·HIGH，07 §6.1】。
5. `webhook.cjs` 入账复用 `BillingEngine`（删裸 SQL 直写 `users.recharge_credits`），保证两套记账语义一致【源码已证实·HIGH→推断·HIGH，08 §7】。
6. 删除 `findDanglingReserves` 死代码，统一超时阈值语义（90min 安全线 `waiting` 不退积分）【源码已证实·HIGH→推断·HIGH，07 §6.4】。

**退出标准**：
- [ ] 唯一约束上线，迁移脚本幂等可回滚。
- [ ] 字符化测试 `billing.idempotency` / `accounting.idempotency` / `payments.webhook` 在并发下稳定通过。
- [ ] `webhook` 入账经 `BillingEngine`，无裸 SQL 直写余额。
- [ ] 生产库核对：无负余额、无孤儿 held（基于 dev 库已测 neg=0，生产需另核）【数据库已证实·HIGH】。

**主要风险**：
- 唯一约束加在热表可能锁表——需低峰 + `CONCURRENTLY` 或维护窗口【推断·MEDIUM】。
- 事务边界扩大可能引入死锁——需压测【推断·MEDIUM】。
- 缺口 A（expired 迟到入账）产品语义未决，本 Phase 仅统一路径、不擅自改语义【源码已证实·HIGH，08 §6】。

**依赖**：Phase0（字符化测试网必须先就位，否则无法验证资金正确性）。证据等级【源码已证实】HIGH + 【推断】HIGH。

---

## Phase2 · 安全加固（移除 /api/token 公开、JWT 强密钥、IDOR owner 校验）

**目标**：堵住 P0-A/P0-B 与 P1 越权/凭据泄露，使 RBAC 在任意部署下成立。

**关键交付**：
1. **移除 `/api/token` 公开返回**（server.js:3623）：system 令牌仅在启动时打印/环境变量注入，且不经由前端 `ensureApi()` 下发；`appGateway`（server.js:1276）Bearer `system` 分支仅限显式内部 channel【源码已证实·HIGH，10 P0-A / 03 §3.1】。
2. **JWT 强密钥 fail-closed**：生产必须注入强随机 `JWT_SECRET`，缺失即 `process.exit(1)`（替换当前仅 `console.warn` 的非 fail-closed 自检，server.js:3714）【源码已证实·HIGH，10 P0-B】。
3. **owner 校验**：`DELETE /api/characters/:id` 改 admin-only（或加归属字段）；`/providers/:id/sync|test-endpoint|test-default` 补 `requireAdmin`（server.js:2935/2966/2983）【源码已证实·HIGH，03 §3.3/§3.4 / 10 P1-C】。
4. **凭据保护**：`GET /api/oss` 永不返回 `accessKeySecret`；`providers.api_key` 与 OSS 密钥加密落库（与支付凭据同级）【源码已证实·HIGH，03 §3.2 / 09 §7 / 13 §3.4】。
5. **基础设施凭据**：`PG_PASSWORD` 改强随机 + 专用低权账号；`REDIS_PASSWORD` 设密码（`requirepass`）；`.env` 纳入备份/密钥库【源码已证实·HIGH，13 配置清单】。
6. **CORS 收敛**：`Access-Control-Allow-Origin` 由 `*` 收敛为受信源【源码已证实·HIGH，03 §3.6】。
7. **`appGateway` Bearer 优先修正**：`req.user` 反映真实 cookie 身份，恢复审计归属与「不能操作自己」自保护（10 P1-D）。

**退出标准**：
- [ ] 匿名 `GET /api/token` 不再返回令牌；前端仅依赖会话 cookie。
- [ ] 缺 `JWT_SECRET` 时进程拒绝启动（fail-closed）。
- [ ] IDOR 字符化测试（Phase0 的 `idor`）通过；`/api/oss` 响应无 `secret`。
- [ ] 凭据加密迁移完成，旧明文数据清理。

**主要风险**：
- `/api/token` 移除会破坏前端 `ensureApi()` 自动发现——需同步改前端鉴权方式（与 Phase3 联动）【源码已证实·HIGH，03 §1】。
- JWT 密钥轮换需保证旧会话平滑（或接受重新登录）【推断·MEDIUM】。
- 凭据加密迁移需双写/灰度，避免支付/Provider 不可用【源码已证实·HIGH，08 §9】。

**依赖**：Phase0（idor 测试）。建议与 Phase3 前端鉴权改造协同。证据等级【源码已证实】HIGH。

---

## Phase3 · 解耦前端隐藏契约（错误契约统一、SNAKE_MAP 替代、canceled/cancelled 修复）

**目标**：消除「字符串/状态码当协议」的脆弱耦合，使前后端字段/状态/错误可独立演进。

**关键交付**：
1. **`canceled` 拼写统一**（P0）：前后端收敛为单一常量（推荐后端改 `cancelled` 双 l 或前端对齐 `canceled`，加单测锁定）【源码已证实·HIGH，11 §3.1 / 12 C6】。
2. **统一错误契约**：后端返回 `{ok, code, message}`；前端 `api.ts` 改解析 `code` 枚举，移除 `/402|积分不足/`、`includes('409')` 文本嗅探；保留「402 + 含『积分不足』+ `NEED_RECHARGE|INSUFFICIENT`」等价语义（F1）【源码已证实·HIGH，12 C1/C2/C3】。
3. **SNAKE_MAP 替代**：引入 `@shared` 共享契约（字段别名表 + 状态枚举），由 DB 迁移脚本生成并在 CI 校验「每列都在契约中」；或动态构建映射，消除手工白名单【源码已证实·HIGH→推断·HIGH，03 §4 / 12 C4】。
4. **状态枚举常量化**：`TASK_STATUS` 共享枚举，前端 `data/*.ts` 与后端 `dispatcher` 共用【源码已证实·HIGH，12 C6】。
5. **前端结构清理**：拆分 `GenerationBar.tsx`（~122KB）；购物车/订单 API 迁 `services/`；统一 `Image` 组件替代裸 `<img>`【源码已证实·MEDIUM/HIGH，12 §4/C7】。

**退出标准**：
- [ ] 跨标签/远端取消在 UI 层即时生效（字符化 + 手动验证）。
- [ ] 余额不足弹窗经 `code` 枚举触发，不依赖文本嗅探。
- [ ] 新增 DB 列在 CI 被强制要求进契约，无 undefined 假死。
- [ ] `GenerationBar` 拆分完成，无 ParseError 累积。

**主要风险**：
- 错误契约改造若不同步前后端，余额弹窗/注册冲突提示静默失效【源码已证实·HIGH，12 C1/C3】。
- SNAKE_MAP 替代需 Golden Master 字段比对，避免字段丢失【推断·HIGH】。

**依赖**：Phase0（Golden Master）/ Phase2（前端鉴权改造已就，因 `/api/token` 移除影响 `ensureApi`）。证据等级【源码已证实】HIGH + 【推断】HIGH。

---

## Phase4 · 目标新架构落地（异步生成主流化、模块化、多实例实时）

**目标**：落地 22 目标架构——注册式 RouterTable、业务域 handler、核心引擎、后台 registerModule、Redis pub/sub 多实例实时。

**关键交付**：
1. **模块化 router**：单体 `handleAPI` 拆为 `RouterTable` + 业务域 handler 注册（保留中央入口与统一 `appGateway`/错误中间件）【源码已证实·HIGH→推断·HIGH，22 §4 / 23 §A】。
2. **AsyncGenerationEngine**：统一状态枚举；修复 T1（MiniMax/Volcano 返 `failed` 或显式 canonical failed，并补 characterization 测试）；等待区/令牌桶迁 Redis【源码已证实·HIGH，06 §10 / 09 §5】。
3. **RealtimeEngine**：SSE 状态变更经 Redis pub/sub 广播，多实例一致；保留回灌快照 + 3s 轮询兜底【源码已证实·HIGH，11 §4→推断·HIGH】。
4. **ConcurrencySemaphore 外置 Redis**：令牌桶/等待区状态多实例一致【源码已证实·HIGH，05 §6】。
5. **registerModule 后台（L0–L3）**：`admin.cjs` 巨型 switch 拆为模块注册表，权限声明内聚【源码已证实·HIGH→推断·HIGH，23 §F】。
6. **单一 schema 源**：收敛 `server.js`/`db.cjs` 双 initDB 为 `migrations/*.sql`；处理 `oss_config`/`oss_configs` 双表与 `coupons`/`shipments` 孤儿表决策【数据库已证实·HIGH，04 §2/§7】。
7. **Provider 适配层统一**：统一 submit/poll 接口；api_key 加密落库【源码已证实·HIGH，09 §7】。

**退出标准**：
- [ ] 路由经 RouterTable 注册，Golden Master 比对 100% 等价（字段/状态/错误 code）。
- [ ] T1 修复并锁定（ characterization 测试）。
- [ ] 多实例部署下 SSE 跨实例即时送达、跨实例取消即时清理（压测验证）。
- [ ] 后台模块经 `registerModule` 分发，功能无遗漏。
- [ ] 单一 schema 源上线，启动不再依赖双 initDB 漂移。

**主要风险**：
- T1 修复改变重试/计费行为，需 Golden Master + 字符化测试守住等价边界【源码已证实·HIGH】。
- 多实例实时引入 Redis 依赖，需保证 Redis 降级不丢关键状态（现状已证明关键数据在 PG）【源码已证实·HIGH，05 §5】。
- 路由拆分遗漏导致端点 404——必须 Golden Master 全量比对【推断·HIGH】。

**依赖**：Phase1（资金安全，引擎可事务化）/ Phase2（安全）/ Phase3（契约解耦）。证据等级【源码已证实】HIGH + 【推断】HIGH。

---

## Phase5 · 切换与下线旧系统

**目标**：灰度切流、验证、下线单体旧实现，完成孤儿表决策与长期技术债清理。

**关键交付**：
1. **灰度切流**：新旧 handler 并存期（RouterTable 支持按路由/用户比例切换），比对指标与 Golden Master。
2. **下线单体 `handleAPI` / `admin.cjs` 巨型 switch**：确认无引用后移除。
3. **孤儿表决策**：`coupons`/`shipments` 删除或正式纳管；`outbox`/`cron_marker` 启用或清理【数据库已证实·HIGH，04 §7】。
4. **技术债清理**：评估引入集中式 store（生成任务列表/OSS/购物车）；React19 `forwardRef` 未来升级改写【源码已证实·HIGH，12 §3/§4】。
5. **DR 增强**：PG 自动备份调度、WAL/副本/PITR、备份异地加密、部署回滚标签（当前仅手工备份、无副本、无回滚）【源码已证实·HIGH，14 DR】。

**退出标准**：
- [ ] 100% 流量切到新架构，旧实现无调用。
- [ ] 孤儿表决策落地且生产数据未误删（KEEP-AS-DESIGN 或显式删除已评审）。
- [ ] DR 自动备份 + 回滚机制就绪，演练通过。
- [ ] 监控/可观测性（OpenTelemetry）覆盖核心链路。

**主要风险**：
- 切流期双实现不一致导致数据分歧——需严格双写校验或短并存窗【推断·MEDIUM】。
- DR 缺失（单 PG 点、无 PITR）在切换期放大事故面——建议 Phase5 前先补备份【源码已证实·HIGH，14 §1】。

**依赖**：Phase4 全部完成且 Golden Master 等价。证据等级【推断】HIGH + 【数据库已证实】HIGH。

---

## 阶段依赖总图

```
Phase0(冻结+测试网+GM)
   │
   ├──────────────► Phase1(资金安全) ──┐
   │                                    │
   └── Phase2(安全加固) ──┐             │
           │              │             │
           └── Phase3(解耦契约) ─────────┤
                                         ▼
                              Phase4(目标架构落地)
                                         │
                                         ▼
                                    Phase5(切换下线)
```

> **说明**：Phase1/Phase2/Phase3 可部分并行（资金与安全互不阻塞），但都依赖 Phase0 的测试网；Phase4 必须等前三阶段完成；Phase5 最后。证据等级【推断】HIGH。

*（本文为只读审计产物，未改动 `E:\code` 任何文件。）*
