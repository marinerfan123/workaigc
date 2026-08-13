# 05 · Redis 契约（墨灵AI 重构前体检）

> 证据等级：【源码已证实】（server/redis.cjs、ratelimit.cjs、server.js）+【运行时已证实】（本次只读连 Redis 7.4.10 自省：DBSIZE=8、KEYS 采样、TYPE/TTL）。
> 连接为只读 introspection（DBSIZE/INFO/SCAN/TYPE/TTL），**未执行任何 DEL/FLUSH/写命令**。

## 1. Redis 在系统中的真实定位
- **软依赖，非硬依赖【源码已证实】**：`server/redis.cjs` 设计为 `lazyConnect` + 失败自动降级到**进程内内存 Map**（`mem`，L17）。当 Redis 不可用（没装/挂了），`kvGet/kvSet/kvIncr/kvExpire` 自动走内存兜底，服务**不崩溃**（L27-45、L64-129）。
- 启动日志明确：`Redis:up` 或 `memory-fallback(仅缓存)`（`server.js:3696`）——Redis 被定位为**缓存/协调层**，不是数据源。
- **数据源铁律**：PG 为唯一数据源，Redis 不承载任何持久业务数据（任务状态在 PG + 进程内 WAITING_AREA，SSE 在进程内）。

## 2. 当前真实 Key 清单（DBSIZE=8，全部为遗留孤儿）
本次 SCAN 采样得到 **8 个 key**，前缀仅两类：

| Key 前缀 | 数量 | 结构 | 内容 | 写入方(当前源码) |
|---|---|---|---|---|
| `mr:health:<uuid>` | 2 | hash | 模型/路由健康检查 | **无**（grep 零命中） |
| `mr:logs` | 1 | list | 模型路由日志 | **无** |
| `mr:swrr:<model>` (如 `mr:swrr:agnes-2.5-flash`) | 1 | hash | SWRR 平滑加权轮询权重 | **无** |
| `toonflowApi:time:assetCleanup:*` | 4 | zset/string/hash | 基于 zset 的延迟清理队列(`repeat`/`delayed`/`id`/`time:...:repeat:<hash>:<ts>`) | **无** |

**关键结论【源码已证实 + 运行时已证实】**：`mr:`/`toonflowApi:` 这些 key **在当前源码中没有任何写入方**（grep 全仓仅命中 `dist/` 打包产物；`server/modules/modelhub/resolver.cjs` 明确注释"**不引入 Redis**"）。`toonflowApi` 命名源自项目曾用名（toonflow/漫创）→ 这些是当前版本**重构/改名后遗留的孤儿 key**，无读取方，纯属陈旧数据。

## 3. 当前源码真正使用 Redis 的位置
| 模块 | 用法 | Key 格式 | 结构 | TTL | 读/写 |
|---|---|---|---|---|---|
| `server/ratelimit.cjs` | 固定窗口限流 `kvIncr(key,windowSec)` | 调用方自定义（如 `ratelimit:...`） | string(INCR 计数) | `windowSec`（过期自动） | 写+读 |
| `server.js:3655/3728` | `getRedis()` 仅挂连接事件监听(.on error/ready/end) | — | — | — | 仅监听 |

> 注：当前无流量，限流计数 key 已自然过期，故 DBSIZE 中看不到 `ratelimit:*`，仅存遗留 key。

## 4. 各职责问答（按用户要求）
- **是否用于队列**：仅遗留 `toonflowApi:time:assetCleanup:*` 是 zset 延迟队列（来自旧版，当前未用）。**任务队列不在 Redis**（在 PG generation_tasks + 进程内 WAITING_AREA Map）。
- **是否用于锁**：无分布式锁。限流用 INCR 固定窗口，非锁。
- **是否用于限流**：✅ 是，`ratelimit.cjs` 经 `kvIncr`（Redis INCR 或内存兜底）。
- **是否用于 SSE**：❌ 否。SSE 在 `server/realtime.cjs` 进程内维护（见 11 报告）。
- **是否用于任务恢复**：❌ 否。崩溃恢复靠 PG `provider_task_id`+`resume_meta`（见 06 报告）。
- **是否持久业务数据**：❌ 否。无任何业务实体以 Redis 为权威存储。

## 5. Redis 清空后系统会怎样？【推断 + 源码已证实】
- **限流计数器丢失**：短时间窗口内允许请求数上升（固定窗口重置），随后自动重建 → **可丢、影响极低**。
- **遗留孤儿 key 消失**：无害（无读取方）。
- **任务状态 / 余额 / 订单 / 媒体**：完全不受影响（PG 为源）。
- **SSE / 实时状态**：不受影响（进程内）。
- **结论**：Redis 中**没有不可丢的数据**。清空 Redis = 仅失去瞬时限流窗口 + 清掉陈旧孤儿 key，系统照常运行（与"Redis 仅缓存"定位一致）。

## 6. 多实例部署风险【源码已证实】
- 部署基线为**单实例 fork**（`server.js:3702` 注释明确：dispatcher RPM 令牌桶为进程内态，多实例会重复计数导致厂商 429 风暴；ecosystem.config.cjs 单实例）。
- 若将来多实例：`ratelimit.cjs` 的 `kvIncr` 在 Redis up 时走 INCR（可共享），但 `redis.cjs` 降级路径走**进程内内存** → 限流/负载均衡在降级态下各实例独立计数，不一致。
- 当前 `mr:swrr`(SWRR 权重) 虽是负载均衡态，但由遗留代码写入且当前未被读取，不构成现网风险。

## 7. 待核验 / 未知
- 是否存在其他隐藏 Redis 写入（如某脚本/定时任务偶尔写 `mr:` 键）？当前源码与运行进程均未体现，倾向"纯遗留"。如需 100% 确认，可在测试环境清空后观察是否有新 key 写入。
- `ratelimit.cjs` 实际 key 命名规则（需读 ratelimit.cjs 完整实现确认前缀与窗口值）。
