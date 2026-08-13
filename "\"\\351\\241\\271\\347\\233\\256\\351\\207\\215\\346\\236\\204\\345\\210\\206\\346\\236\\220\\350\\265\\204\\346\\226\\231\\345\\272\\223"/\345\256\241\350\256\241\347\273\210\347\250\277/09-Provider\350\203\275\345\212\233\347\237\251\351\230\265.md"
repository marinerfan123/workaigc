# 09 · Provider 能力矩阵（墨灵AI 重构前体检）

> 证据等级：【源码已证实】——`server/providers/video/{index,shared,minimax,volcano,agnes}.cjs` + `dispatcher.cjs` 内联 generic 路径实读。
> 本文件为只读取证，未调用任何付费模型。

## 1. 架构总览
- `index.cjs:11` `const adapters = { agnes, minimax, volcano };` —— **仅 3 个专用适配器**，导出 `{adapters, resolveKey, submit, poll, submitAndPoll}`（**无 cancel 导出**）。
- 路由判定（index.cjs:19-22）：base_url 含 `agnes-ai.cn`→agnes；`minimax`→minimax；`volces|ark.cn-beijing|volcano`→volcano；其余→落入 **generic 内联**（dispatcher.cjs:214-303 + genericVideoPoll:309-333）。
- **所有适配器均无 provider 端取消 API**（见 06 报告 cancel 分析）。

## 2. 各 Provider 取证
### 2.1 agnes（Agnes Video V2.0）
- **是什么/何时**：由 dispatcher 原 `isAgnesVideo` 分支抽离（agnes.cjs:1-2）；引入时间【未知·待核验】（mtime 2026-08-11，无版本注释）。
- **配置来源**：DB `providers.base_url`(默认 `https://api.agnes-ai.cn/v1`,agnes.cjs:27) + 可被 `model.endpoint.generate/poll` 覆盖(30-46)。
- **credential**：DB `providers.api_key`(agnes.cjs:85)，**明文无加密**（视频 provider 不进 crypto.cjs 加密）。
- **submit**：POST `{base}/videos`(32/94)；num_frames/frame_rate 控时长(55-59)；图生(ti2vid)/关键帧(keyframes)。
- **返回任务 ID**：`video_id`（默认 taskIdPath,33）。
- **poll**：GET `{origin}/agnesapi?video_id=`(39)；success=`completed`(44)；url 优先级 taskResultPath→metadata.url→根(121-123)。
- **生成端 failed 返回 `status:'failed'`**（agnes.cjs:131）✅ **与 dispatcher 设计意图一致**。

### 2.2 minimax（Hailuo-03）
- **配置来源**：DB `providers`(seed-defaults.cjs:27-39, base_url=`https://api.minimaxi.com/v2`)；协议 custom。
- **credential**：DB `provider.api_key`(minimax.cjs:23) 明文。
- **submit**：POST `{base}/video_generation`(50)；resolution 经 `toMiniMaxResolution`(16-20)。
- **返回任务 ID**：`task_id`(62)→providerTaskId(65)。
- **poll**：GET `{base}/query/video_generation/{id}`(73)；`intervalMs:10000,adaptive`(75)；success 取 `task.content.url`(82)。
- **生成端 failed 返回 `status:'error'`**（minimax.cjs:85）⚠️ **T1 bug**（见 §5）。

### 2.3 volcano（火山方舟 Seedance）— T4 核验
- **适配对象**：Seedance 2.5/2.0/1.5/1.0（volcano.cjs:1-2 注释"火山方舟 Seedance 视频适配器"；含 DURATION_RULES/resolveSeedanceFamily 26-39）→ **即 Seedance，无独立 volcano.ts**（T4 成立）。
- **配置来源**：DB `providers`(seed-defaults.cjs:40-54, base_url=`https://ark.cn-beijing.volces.com/api/v3`)。
- **credential**：DB `provider.api_key`(volcano.cjs:54) 明文。
- **submit**：POST `{base}/contents/generations/tasks`(86)。
- **返回任务 ID**：`id`/`data.id`(95)→providerTaskId(101)。
- **poll**：GET `{base}/contents/generations/tasks/{id}`(109)；`intervalMs:5000,adaptive`(111)。
- **生成端 failed 返回 `status:'error'`**（volcano.cjs:121）⚠️ **T1 bug**。

### 2.4 generic（openai-compatible / custom bodyTemplate）
- **实现位置**：dispatcher.cjs 内联（videoGenerate 214-303 异步分支 253-295、genericVideoPoll 309-333）。
- **配置来源**：`provider.default_endpoint` / `model.endpoint` 的 `generate/poll/async`（248-250,264-267）；支持 custom bodyTemplate（shared.cjs:14 fillTemplate，占位符 `{{var}}`）。
- **submit**：callEndpoint(254)；taskId 取 `endpoint.taskIdPath` 或 `data.task_id`(256)。
- **poll**：callEndpoint 自轮询(283)；success 取 taskResultPath/data.video_url(287)。
- **生成端 failed 返回 `status:'failed'`**（dispatcher.cjs:291）✅ 与设计意图一致。

## 3. 成本与计费对接【源码已证实】
- 适配器**不参与 cost 计算**；cost 来自 DB `models.credit_cost`（server.js:2437-2440）→ `billing.resolvePayment`(2446) → reserve(2459)。
- 成功→commit(dispatcher.cjs:691)；失败→release(734)。
- 双边记账：`accounting.recordConsumption`，记录 `providerId/modelId/outputUnits(资产数)` 与 `customerChargeCredits(按产出比例分摊)`(698-703)。
- **provider 侧"成本"度量**：`units`(dispatcher.cjs:518)=图片张数或视频 1 个，仅用于 rate-limit 桶(DEFAULT_OP_COST video=20,42) 与双边记账。**【推断】系统不追踪 provider 真实 $ 成本**（无 provider $-cost 字段）。

## 4. 能力矩阵汇总
| Provider | 配置源 | 凭据源 | submit | poll 间隔 | cancel | 失败返回 | 能力 |
|---|---|---|---|---|---|---|---|
| agnes | DB providers(+endpoint覆盖) | DB api_key(明文) | POST /videos | 8000 adaptive | ❌ | **failed** ✅ | 文生/图生(ti2vid)/关键帧 |
| minimax | DB providers | DB api_key(明文) | POST /video_generation | 10000 adaptive | ❌ | **error** ⚠️ | 文生/图生首末帧/参考图 |
| volcano(Seedance) | DB providers | DB api_key(明文) | POST /contents/generations/tasks | 5000 adaptive | ❌ | **error** ⚠️ | 文生/图生首末帧/参考图/480p-4k |
| generic | provider.default_endpoint / model.endpoint | DB api_key | callEndpoint | 自适应 | ❌ | **failed** ✅ | 由 endpoint 配置决定(文/图/参考图) |

## 5. ★ T1 关联：MiniMax/Volcano failed→error 导致 failover 空转【源码已证实】
- 上游 `attemptOnAccount`(dispatcher.cjs): `res.status==='failed'`→立即终态不切账号(499)；其余非 success→`markReject+return null`(509)。
- minimax/volcano 返 `'error'` → 命中 509 → **被当瞬时错误 markReject + 切下一账号新建真实 provider 任务**。
- 后果：provider 已明确失败却被当"临时不可用"→ 浪费 quota、不即时终态；若所有 provider 失败 → 多轮 null → throttled → 入 waiting(1285) → **积分永不释放、任务永不标 failed**（看门狗不碰 waiting）。
- 根因：`shared.cjs:218` `pollLoop` 把 `status==='error'` 也当终态返回，未隔离"definitive failed"。
- **与 agnes/generic 不一致**（二者返 failed 则立即终态）。修复：改 minimax.cjs:85 / volcano.cjs:121 返 `'failed'`（与 agnes/generic 对齐），并补 characterization 测试。重构决策：修复（推荐）或显式记 INTENTIONAL_BREAKING_CHANGE。

## 6. ★ T6 核验：modelConfigs 不被运行时 import【源码已证实】
- grep 全仓 `modelConfigs`：匹配行**全部位于 `src/data/modelConfigs/*.ts` 自身注释首行**，无任何外部 .cjs/.ts import。
- 运行时模型配置来自 DB：`dispatcher` 经 resolveModelIdentity + `SELECT * FROM models/providers`(dispatcher.cjs:568-576)；`agent-model-resolver.cjs:10-11` 直接 JOIN models/providers 取 credit_cost/api_key；`/api/models` GET 直接 `SELECT * FROM models`(server.js:3006)。
- `schema.ts:6` 自述"本类型仅用于草稿模块，不依赖任何运行时逻辑"；`seedance.ts:5` 自述"草稿模块，尚未并入生产"。
- **结论**：`src/data/modelConfigs/`（含 seedance.ts，无 volcano.ts）是 video-model-config-agent 的**草稿模块，未被运行时 import**；runtime 模型配置（base_url/api_key/credit_cost/supported_params）来自 DB。T6 成立。

## 7. 其他发现
- **credential 安全**：视频 provider `api_key` **明文存 DB `providers.api_key`，无加密**；finance.cjs 的 encrypt 仅用于 PAYMENT 收款商(pid/pkey/webhookSecret)，与视频 provider 无关。重构应考虑是否对 provider api_key 加密（与支付凭据同级保护）。
- **429 处理**：`makeError` 标 `rateLimited`(shared.cjs:111)→dispatcher 冷却整账号(477-481)+退还桶单位。
- **重试**：图片瞬时错误有界重试 2 次(468-476)；视频异步长任务不在 attemptOnAccount 重试，failover 仅切换账号。
- **超时安全线**：统一 90min(shared.cjs:187)，超时返 timeout 非 error，绝不判失败/不释放积分。

## 8. 待核验 / 未知
- agnes 精确引入时间（无版本注释）。
- seedance.ts 草稿与 DB 配置的同步责任人/流程（谁保证草稿与运行时一致？）。
- payments/providers/ 子目录是否含其他支付 provider（待读）。
- 是否还有其他视频/图片 provider 适配器未在 providers/video 下（图片路径在 dispatcher 内 inline，待核）。
