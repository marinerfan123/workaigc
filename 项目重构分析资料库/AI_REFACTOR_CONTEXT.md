# AI_REFACTOR_CONTEXT · 墨灵 AI 重构交接上下文（给未来执行重构的 Agent）

> **用途**：本文件是「重构前系统体检」的唯一自包含交接文件。未来任何 Agent/工程师接手墨灵 AI 正式重构时，**只需读取本文件 + 引用的 22/23/24/00** 即可获得全部必要上下文，无需重新通读 02-15 底稿。
> **铁律遵守声明**：本文件创建于只读体检收尾阶段，未修改 `E:\code` 任何源码/配置/数据库。
> **生成日期**：2026-08-11。**配套文件**：`审计终稿/00-总审计报告.md`、`22-目标架构建议.md`、`23-迁移映射.md`、`24-重构Phase计划.md`。

---

## 1. 系统一句话定位 + 技术栈速查

**一句话**：墨灵 AI 是一套 **Node 原生 HTTP 后端 + React 19 前端**的 AI 图像/视频生成工作室应用——用户提交生成请求，后端异步调度多供应商（Agnes/MiniMax/Volcano/Generic）生成、双余额计费、PG 持久化崩溃可捞回、SSE 实时推送、成功资产存阿里云 OSS。

**技术栈速查表**：

| 层 | 技术 | 约束/现状 |
|---|---|---|
| 后端运行时 | Node.js，原生 `http.createServer` + `node:http`（**无 Express**） | 中央 handler 分发为硬约束 |
| 后端语言 | CommonJS（`.cjs`）；前端 ESM（`.ts`） | 混用 |
| 前端 | React 19.2 + Vite 8 + TypeScript ~5.9 + react-router ^7 + Tailwind ^4 | `forwardRef` 已废弃（React19 ref 即 prop） |
| 数据库 | **PostgreSQL 17.4**（唯一数据源，41 表） | 扩展仅 plpgsql；0 触发器/函数 |
| 缓存/协调 | **Redis 7.4**（仅缓存/限流，可降级内存） | 当前 8 个孤儿 key，无关键数据 |
| 对象存储 | **阿里云 OSS**（零二进制，成功即存） | 预签名直传 |
| 支付 | easypay 通道，AES-256-GCM 加密凭据，webhook 四关 fails-closed | 真实通道，无 DEV 模拟回退 |
| 测试 | `node:test`（8 文件）vs `package.json` `test: vitest run`（**框架不匹配**） | `npm test` 实际跑不到用例 |
| 进程管理 | PM2 `ecosystem.config.cjs` `instances:1`（单实例） | 多实例硬限制见 §4 |

---

## 2. 架构铁律与不可违反项（重构红线）

> 以下为产品/技术负责人已定调 + 源码证实正确的业务规则，**任何重构阶段不得违反**：

1. **异步生成全量主流化**：轮询/成败判定/链接落地全收归后端；前端只「提交 + 拿三态」（参照 Replicate/fal.ai/Stability）。
2. **成败只看生成端终态**：90min 固定时间仅作防僵尸安全线；**超时绝不判失败、绝不退积分**（标 `waiting` 保留）。
3. **浏览器永不持有 `provider.apiKey`**：凭据仅服务端使用。
4. **任务必须 PG 持久化 + 幂等键**：崩溃可捞回（`provider_task_id` + `resume_meta`）。
5. **成功即存 OSS**：业务服务器零二进制。
6. **并发 Semaphore**：生成并发信号量（GLOBAL_MAX 可配）。
7. **前端 SSE + 乐观 UI + 语义状态**。
8. **后台自建生态 · 模块注册表驱动**（L0 平台基座 / L1 供给侧 / L2 需求侧 / L3 人与钱，`registerModule` 分发）。
9. **技术栈硬约束**：PG17 唯一数据源 / Redis7 仅缓存 / OSS 零二进制 / **Node 原生 HTTP 中央 handler 分发**。
10. **双余额**：`reward_credits` + `recharge_credits` 两真实池；`users.credits` 为 `GENERATED ALWAYS` 总计列（不可写、不可扣，无第三余额）。
11. **支付 fail-closed**：无 provider→503；webhook 四关；AES-256-GCM；密钥缺失即拒。
12. **保留等价行为**（详见 `04_重构等价需求基线.md`）：参考样式分成真实转账（30% 进设计者 reward）、SNAKE_MAP 字段映射、OSS 零二进制。

---

## 3. 证据等级约定（直接复制体系）

| 标记 | 含义 |
|---|---|
| 【源码已证实】 | 直接对照源码可确认 |
| 【数据库已证实】 | PG 自省/快照确认 |
| 【运行时已证实】 | 运行实例/Redis 自省确认 |
| 【测试已证实】 | 存在对应测试覆盖 |
| 【文档记载但源码未证实】 | 文档提及、源码未落实 |
| 【推断】 | 基于代码逻辑推演 |
| 【未知·待核验】 | 需运行时/DB 实测 |

置信度：**HIGH / MEDIUM / LOW / UNKNOWN**。

---

## 4. 已确认的 P0 风险清单（精炼，附源码位置）

| # | 风险 | 源码位置 | 爆炸半径 | 修复 Phase |
|---|---|---|---|---|
| P0-1 | `/api/token` 公开返回系统令牌，dev 下可冒充管理员 | `server.js:3623`（无鉴权）、`:31`（`devTokenEnabled`）、`:1276`（Bearer 优先） | 全站管理员接管 | P2 |
| P0-2 | `JWT_SECRET` 缺失回退 `'dev-only-change-me'`，会话可伪造 | `auth.cjs:9`；`.env` 未设；`server.js:3714` 仅 warn | 认证绕过 | P2 |
| P0-3 | 资金幂等缺失：双退/双记/漏退 | `credit_transactions` 无 `(ref,kind)` 唯一约束；`consumption_ledger.idempotency_key` 仅 `ix_cl_idem`；`billing.cjs:48-55` SELECT→INSERT 非原子；`server.js:2415` 漏清流水 | 用户资产损失/账务失真 | P1 |
| P0-4 | webhook 绕过 billing 裸 SQL 入账，两套语义漂移 | `webhook.cjs:128-168` 直写 `users.recharge_credits` | 账务不一致 | P1 |
| P0-5 | `/api/oss` 明文返回 `accessKeySecret` | `server.js:3329-3351`（仅会话鉴权即返回 secret） | 凭据泄露→OSS 被直控 | P2 |
| P0-6 | `canceled`(后端,单l) vs `cancelled`(前端,双l) 拼写不一致 | 后端 `dispatcher.cjs:1252/1254`；前端 `useGenerationStream.ts:84/92`、`GenerationBar.tsx:570` | 跨标签取消失效 | P3 |

**附 P1（非 P0，同源）**：`DELETE /api/characters/:id` 缺 owner/admin 校验（`server.js:2196`）；`/providers/:id/sync|test-*` 缺 `requireAdmin`（`server.js:2935/2966/2983`）；多实例实时硬限制（`realtime.cjs` 纯进程内）；`appGateway` Bearer 优先致审计失真（`server.js:1276`）。

> 完整 P0 表与现象/根因见 `00-总审计报告.md §4`。

---

## 5. 字符化测试入口（对应 15/16/17）

> 说明：`15-测试覆盖缺口.md` 已存在（位于 `审计终稿/`）。`16/17` 为规划中的「字符化测试网 / Golden Master 基线」交付物，**当前 `项目重构分析资料库` 下尚未生成**——它们是 Phase0 的**待产出物**，不是已存在证据。请勿误认为已有文件。

**当前测试现状（必须先修）**：
- `package.json:13` `"test": "vitest run"`，但 8 个测试文件全用 `node:test`、无 vitest 配置 → `npm test` 实际跑不到用例（框架不匹配，P0 测试缺口）【源码已证实·HIGH，15 §2】。
- 现有 8 文件：`server/modules/modelhub/{resolver,bindings}.test.cjs` + `src/__tests__/{data/characters,media,models,oss,settings}.test.ts` + `src/__tests__/lib/utils.test.ts`（多为静态数据/工具，核心资金/调度/支付零覆盖）【源码已证实·HIGH，15 §1】。

**Phase0 必须落地的 8 项最小字符化测试集**（详见 `24 Phase0` / `15 §5`）：
1. `billing.idempotency` — 并发同 `ref` commit/release 断言仅 1 行（P0-3）
2. `accounting.idempotency` — 并发同 `idempotencyKey` 断言 `consumption_ledger` 仅 1 行（P0-3）
3. `dispatcher.statemachine` — 非法状态跃迁不重复 commit/release
4. `payments.webhook` — 重复回调仅入账一次（webhook_events UNIQUE 已建）
5. `auth.jwt` — 篡改即验签失败；缺 `JWT_SECRET` 回退值不可用于生产
6. `idor` — 跨用户访问断言 403/404
7. `crypto.aes256gcm` — encrypt→decrypt 往返、错密钥失败
8. `redis.fallback` — Redis 断开降级内存行为一致

**Golden Master 基线**：对核心 API（生成提交/状态/取消、充值下单/webhook、媒体 CRUD、账务总览）录制「请求→响应」黄金样本，含 SNAKE_MAP 后字段形状、`code` 错误体、`TaskUpdate` SSE 形状，作为重构等价比对基准。

---

## 6. 禁止操作清单（重构 Agent 必读）

> 以下操作在重构执行期仍属**高危/禁止**，除非走受控流程：

1. ❌ **勿动旧系统生产数据**：勿对运行 PG 做未走迁移脚本的 `ALTER`/`DROP`/`UPDATE`；孤儿表 `coupons`/`shipments` 默认 **KEEP-AS-DESIGN**，删除须产品评审。
2. ❌ **勿升依赖破坏等价**：升级 Node/React/Vite/PG 前须确认行为等价；`forwardRef` 非阻断，勿盲目大改。
3. ❌ **勿改 DB schema 未走 initDB/迁移脚本**：所有 schema 变更必须经单一迁移源（`migrations/*.sql` 或 `server.js initDB`），禁止手写散落 SQL；新增列必须同步 SNAKE_MAP 与前端 `data/*.ts`（或改 `@shared` 契约）。
4. ❌ **勿破坏隐藏契约（重构等价基线）**：HTTP 402 + 响应体含「积分不足」+ `code: NEED_RECHARGE|INSUFFICIENT`；错误串前缀 `API <status>: `；SSE 无名事件 + `TaskUpdate` 字段；所有公开端点路径/方法/字段形状。破坏即前端静默失效。
5. ❌ **勿移除 SSE 的 3s 轮询兜底**：前端对 SSE 零信任，轮询是终态兜底，移除即丢完成通知。
6. ❌ **勿让浏览器持有 `provider.apiKey`**：凭据仅服务端。
7. ❌ **勿在超时（90min）时判失败或退积分**：标 `waiting` 保留。
8. ❌ **勿跳过字符化测试网直接重构**：Phase0 是后续所有 Phase 的闸门。
9. ❌ **勿在未关闭 P0-1/P0-2/P0-3/P0-4/P0-5 前进入生产切换**（Phase4/Phase5）。
10. ❌ **勿在 dev 模式（`NODE_ENV` 未设 / `API_TOKEN` 环境变量注入）下暴露 `/api/token` 与弱 JWT 密钥**——这是当前 P0 根因。

---

## 7. 目标架构方向（指向 22）与迁移/Phase 索引（指向 23/24）

| 你想做的事 | 读哪个文件 |
|---|---|
| 目标分层架构 / 模块边界 / API 原则 / 去耦合 / 账户计费目标态 / 安全目标态 / 实时目标态 | `审计终稿/22-目标架构建议.md` |
| 旧→新逐模块/表/API/前端路由迁移映射 + 难度/风险/顺序 | `审计终稿/23-迁移映射.md` |
| Phase0–Phase5 分阶段计划（目标/交付/退出标准/风险/依赖） | `审计终稿/24-重构Phase计划.md` |
| 总审计结论 / 健康评分 / P0 汇总 / T1-T6 完成标准核对 / READY 判定 | `审计终稿/00-总审计报告.md` |
| 重构等价验收清单（F1–F18 + T1–T6） | `项目重构分析资料库/04_重构等价需求基线.md` |
| PG schema 权威快照 | `项目重构分析资料库/07_PG_schema快照.sql` |
| 各子系统事实文档（功能/API/DB/Redis/调度/计费/支付/Provider/权限/实时/前端/配置/DR/测试） | `项目重构分析资料库/审计终稿/02-15` |

**目标架构一句话**：保留「Node 原生 HTTP 中央分发 + PG 唯一源 + OSS 零二进制 + 异步生成主流化 + 双余额 + 后台注册表」硬方向，通过**四化**解决 P0/P1——模块化（单体 handler→RouterTable）、事务化/约束化（资金唯一约束+事务）、契约显式化（`@shared` 枚举+code）、多实例化（Redis pub/sub+令牌桶外置）。详见 `22`。

---

## 8. 关键文件路径索引

| 关注点 | 路径 |
|---|---|
| 中央 HTTP handler / 鉴权 / 路由分发 | `server/server.js`（`handleAPI` L1573+；`/api/token` L3623；`appGateway` L1274/1276；initDB L78） |
| 生成调度状态机 | `server/dispatcher.cjs`（76KB；`cancelTask` L1216；T1 相关 `attemptOnAccount` L450；`resumeRunningTasks` L798） |
| 计费 | `server/billing.cjs`（`_hasPosted` L48；reserve/commit/release L32/58/70） |
| 双边记账 | `server/accounting.cjs`（`recordConsumption` L55） |
| 支付 | `server/payments.cjs` + `server/payments/{crypto,loader,webhook,order-expiry}.cjs` |
| 实时 SSE | `server/realtime.cjs`（纯进程内 EventEmitter） |
| Redis/限流 | `server/redis.cjs`、`server/ratelimit.cjs` |
| Provider 适配器 | `server/providers/video/{index,shared,minimax,volcano,agnes}.cjs`（T1：minimax.cjs:85 / volcano.cjs:121） |
| 鉴权/JWT | `server/auth.cjs`（`SECRET` L9；signSession/verifySession） |
| 后台 | `server/admin.cjs`（巨型 handleAdmin）、`server/finance.cjs`、`server/shop.cjs`、`server/reference-styles.cjs` |
| 前端唯一 API 出口 | `src/services/api.ts`（错误串 `API <status>:` L29；`ensureApi` L41） |
| 前端生成流/SSE | `src/hooks/useGenerationStream.ts`（canceled/cancelled L84/92）、`src/components/GenerationBar.tsx`（L570） |
| 前端路由 | `src/app.tsx` |
| 前端类型/契约 | `src/data/{media,models,characters,oss,settings}.ts` |
| 配置/Secrets | `E:/code/.env`（PG/REDIS/PAYMENT_MASTER_KEY，缺 JWT_SECRET/NODE_ENV）、`.env.example` |
| 测试 | `server/modules/modelhub/*.test.cjs`、`src/__tests__/**`、`package.json:13` |
| 部署/DR | `deploy/ecosystem.config.cjs`（instances:1）、`docker-compose.yml`、`scripts/{backup,restore}-db.cjs` |
| 前端构建陷阱 | `vite.config.ts`（`copyPublicDir:false` → 生产缺 public 资源） |

---

## 9. 给重构 Agent 的开场白建议

> 当未来 Agent 被指派「开始墨灵 AI 正式重构」时，建议以此开场白切入，确保上下文完整、红线清晰：

```
我是接手墨灵 AI 重构的 Agent。在我动任何代码前，我已读完交接文件 AI_REFACTOR_CONTEXT.md
及其指向的 22/23/24/00。关键认知：

1. 旧系统调查已完成（T1-T6 全表征、六大核心模块已验证），判定为 READY TO PLAN。
2. 不可违反的红线：PG 唯一源、OSS 零二进制、双余额、90min 超时绝不退积分、
   浏览器不持 apiKey、Node 原生 HTTP 中央分发、异步生成主流化。
3. 当前 6 项 P0（/api/token 公开、JWT 默认密钥、资金幂等缺失、webhook 裸 SQL、
   /api/oss secret 泄露、canceled/cancelled 拼写）是重构必处置项，已编排进 Phase1/2/3。
4. 我的第一步不是写业务代码，而是 Phase0：统一测试框架 + 建 8 项字符化测试
   + Golden Master 基线（注意 15 指出 npm test 框架不匹配，须先修）。
5. 我绝不破坏隐藏契约（402+积分不足+code、API <status>:、SSE TaskUpdate、
   SNAKE_MAP 字段），所有 schema 变更走单一迁移源。
6. 我不会动旧系统生产数据、不会升破坏等价的依赖、不会在 P0-1~5 关闭前进入生产切换。

请确认：是否从 Phase0（字符化测试网）开始？还是先复核 T2/T3/T5 对运行库的只读 SQL？
```

*（本文件为只读体检收尾的自包含交付，未改动 `E:\code` 任何文件。重构 Agent 执行期须另行遵守各 Phase 的退出标准与禁止操作清单。）*
