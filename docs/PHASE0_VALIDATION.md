# Phase 0 生产底座 — 压测验证报告

> 日期：2026-08-02　|　环境：单 Node 进程（server/server.js @ :3001），PG17 + Redis 7.2 均在线
> 工具：`deploy/loadtest.mjs`（零依赖 Node fetch 压测）

## TEST 1 — 健康探针吞吐（/api/healthz，不限流）

| 指标 | 值 |
|------|-----|
| 并发 | 100 |
| 总请求 | 2000 |
| 成功 / 失败 | 2000 / 0 |
| 错误率 | 0.00% |
| 耗时 | 0.58s |
| **RPS** | **3442.3** |
| 延迟 p50 | 22.3ms |
| 延迟 p95 | 79.6ms |
| 延迟 p99 | 93.0ms |
| 延迟 max | 97.0ms |
| 状态码 | 200=2000 |

**解读**：单进程即可支撑 ~3.4k RPS，p99 < 100ms。healthz 仅做 `pg:!!pgPool` 布尔探测（无实际 SQL），代表纯框架/事件循环上限；真实业务接口（带 PG 查询）会低一些，但余量充足。

## TEST 2 — 登录限流生效（/api/auth/login，10 次/60s/IP）

| 指标 | 值 |
|------|-----|
| 并发 | 30（同 IP 突发） |
| 总请求 | 30 |
| 401（放行，密码错） | 10 |
| 429（被限流拦截） | 20 |
| 超发（over-admission） | 0 |

**解读**：固定窗口限流 `server/ratelimit.cjs` 在 30 并发突发下精确卡在 10 次，第 11 起全部 429，**无竞态超发**。限流逻辑正确。

## 结论

Phase 0 基础设施（Redis 优雅降级层 + 固定窗口限流 + /api/healthz 探针）在真实并发下表现符合预期：
- 吞吐达标（p99 < 100ms，RPS 千级）。
- 限流精准（10/60s 严格生效，零超发）。
- 降级链路上轮（PG/Redis 在线时 healthz 报 `redis:true`）。

## 未覆盖（后续可补）

- **nginx 层 `limit_req`**：本压测直连 :3001，未走 nginx 反代。若要验证 `auth_limit 10r/s burst20` / `api_limit 50r/s burst100`，需起 nginx 反代后重新压 `/api/auth/*` 与 `/api/*`。
- **Redis 降级路径**：本压测 Redis 在线。若要验证「Redis 挂了自动降级内存 Map 且不崩」，需临时停 Redis 后重跑 healthz（应仍 `status:ok` 但 `redis:false`）并确认接口不 5xx。
- **生成接口并发**：`/api/generate` 需登录态 + 配额，未纳入本轮压测。
