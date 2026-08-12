# ModelHub V3 — 智能路由尝试数据落地（generation_jobs / generation_attempts）

> 日期：2026-08-11（续 Phase 3.2 之后）
> 范围：建表 + 写模块 + 单测 + 接入 dispatcher 双写 + 后台只读查询端点
> 交付物：`server/modules/modelhub/jobs.cjs`、`server/modules/modelhub/jobs.test.cjs`、`server/dispatcher.cjs`（双写）、`server/server.js`（建表 + SNAKE_MAP + 只读端点）

---

## 1. 用户原始诉求

> 建立 `generation_jobs` 和 `generation_attempts`，记录智能路由的所有尝试数据：
>
> ```
> job_1001
> │
> ├─ attempt_1 → Provider A → timeout
> ├─ attempt_2 → Provider B → 429
> └─ attempt_3 → Provider C → success
> ```
>
> 以后所有智能路由的数据，都从这里来。

必需字段：`job_id / attempt_no / model_id / binding_id / provider_id / started_at / finished_at / latency_ms / status / http_status / provider_error_code / cost / task_id / retry_reason`。

## 2. 关键设计决策（经 AskUserQuestion 确认）

- **范围**：建表 + 写模块 + 单测 + 接入 dispatcher 双写（推荐）。
- **与旧表关系**：**共存**——`generation_jobs.task_id` 外键指向现有 `generation_tasks`（1:1），**绝不删旧表**（守「PG 铁律 / 双读兼容」）。`attempts` 表额外冗余 `task_id` 列，便于免 join 直查。
- **job 与 attempt 的语义**：
  - 一个**生成请求**（`generation_tasks` 一行，`task_id`）可能并行产出多张图/多段视频，每个子任务（子图/子视频）独立一个 **job**，`job_id = ${task_id}__${i}`。
  - 一个 job 内部的**每一次「真正向某 provider 发起生成」** = 一条 **attempt**（含 timeout / 429 / failed / error / success）。`dispatchOne` 串行轮询各账号，attempt_no 在单 job 内串行自增，无并发竞态。
  - **skip（忙/冷/桶空）不计 attempt**——只有真正打到 provider 的节点才记，避免噪声。

## 3. 数据模型

### generation_jobs（一次分发单元 = 一个子任务整轮路由）
| 列 | 含义 |
|---|---|
| job_id (PK) | `${task_id}__${i}` |
| task_id (FK→generation_tasks) | 父任务 |
| model_id / provider_id / binding_id | 路由目标（provider_id 为终态成功方，否则空） |
| status | running｜success｜failed｜timeout｜throttled｜canceled |
| cost | 客户侧积分（来自 opts.cost，整单预估） |
| attempt_count | 该 job 实际尝试次数 |
| created_at / finished_at | 时间戳 |

### generation_attempts（每次实际尝试）
| 列 | 含义 |
|---|---|
| attempt_id (PK) | BIGSERIAL |
| job_id (FK) + UNIQUE(job_id, attempt_no) | 幂等键 |
| task_id | 冗余，免 join 直查 |
| attempt_no | 同 job 内自增 |
| model_id / binding_id / provider_id | 本次尝试目标 |
| started_at / finished_at / latency_ms | 耗时归因 |
| status | success｜timeout｜failed｜rate_limited｜error |
| http_status | 已知则记（429 / 200），未知为 null |
| provider_error_code | 归一码：RATE_LIMITED / TIMEOUT / PROVIDER_FAILED / PROVIDER_ERROR / EXCEPTION |
| cost | 本次尝试的调度单位成本（costFor） |
| retry_reason | 首条为 null；后续说明「为什么重试」（如「provider pA 生成端超时，切换下一账号」） |

## 4. 写入位置（双写，best-effort 不阻断生成）

- **主链路（异步生产路径）**：`dispatcher.generate()` 为每个子任务 `makeJobRecorder(pg, {jobId, taskId, modelId, cost})` → `begin()`（建 job 行）→ `dispatchOne` 内每次实际尝试经 `attemptOnAccount` 的 `mark()` 调用 `record()` → 终态 `finish(status, providerId)`（更新 job 状态/attempt_count/provider_id）。
  - 仅当 `opts.taskId` 存在时激活（异步 `generateAsync` 路径）；`/api/generate` 的 `sync=1` 测试路径无 `taskId` → 走 `NULL_RECORDER` 空操作，零开销。
- **崩溃恢复路径**：`resumeOneTask()` 续轮询视频任务后，调 `recordResumeJob()` 补记一条 `task_id__resume` 的 job + 单次 attempt（幂等，重复 resume 不重复插）。
- **健壮性**：`jobs.cjs` 所有写操作内部吞错，绝不影响生成主链路；`createJob` 未成功（rowCount 0 / 异常）则跳过后续 attempt 写入，避免外键刷屏；`(job_id, attempt_no)` 唯一 + `ON CONFLICT DO NOTHING` 使 resume 重放幂等。

## 5. 后台只读查询端点

`GET /api/admin/routing/jobs?limit=&taskId=&status=`（管理员鉴权）：
- 返回最近 jobs（按 created_at 倒序）+ 其全部 attempts，经 `SNAKE_MAP` 转驼峰。
- 供未来「智能路由分析 / 成本归因 / 失败诊断」页面消费——**以后所有智能路由数据，都从这里来**。

## 6. 验证结果

| 项 | 结果 |
|---|---|
| `node --check` server.js / dispatcher.cjs / jobs.cjs | 全 OK |
| `jobs.test.cjs` | **5/5**（建 job / 记 attempt 串行自增 + 首条 retryReason 空 / 收尾 / job 未建不写 attempt / resume 幂等） |
| `revision.test.cjs`（回归） | 7/7 |
| `dispatcher.cjs` 模块加载（含 jobs.cjs require 路径解析） | OK |
| `tsc --noEmit` / `vite build` | 未改前端，无需；前端零改动 |

**踩坑修复（本轮）**：`initDB` 建表 SQL 写在 JS 模板字符串内，我在 SQL 注释里误用了反引号（`` `${task_id}__${subIndex}` ``）——JS 模板字符串内**没有注释语法**，反引号会提前闭合外层模板，导致全文解析错位、`node --check` 在 `pgPool.query(` 处报 "missing ) after argument list"。已改为纯文本描述。教训：在巨型 SQL 模板字面量里写注释，绝不能用反引号（含 `${}`），只用 `--`。

## 7. 交付纪律 / 待办

- 改动**未提交**（safe-git 锁本地 main），需用户本机 plumbing 提。
- **用户本机须重启后端 3001**（加载新 `initDB` 建表 + 双写代码）；沙箱无 PG，未跑真实迁移/启动。端到端：重启后真实出图 → `GET /api/admin/routing/jobs` 应能看到 job + 多条 attempt（含 429/timeout 等真实尝试）。
- 前端暂无消费页（超出本轮确认范围）；未来建「智能路由分析」页直接读上述端点即可。
