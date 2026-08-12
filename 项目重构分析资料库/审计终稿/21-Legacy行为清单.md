# 21 · Legacy 行为清单（重构前必须保留 / 必须显式处理的隐藏契约与隐式假设）

> 审计对象：墨灵 AI（`E:\code`，图像/视频生成工作室应用）
> 文档性质：**只读体检产物**。本稿**未修改** `E:\code` 下任何源码/配置/数据库，仅汇总既有事实文档（02/03/06/07/08/10/11/12/15）已证实的 legacy 行为、隐藏契约与隐式假设。
> 用途：作为重构"等价性基线"与"字符化测试（见 16）/Golden Master（见 17）"的输入清单。
> 读者：重构负责人、测试架构师、TL。
> 证据等级图例：【源码已证实】/【配置文件已证实】/【文档记载但源码未证实】/【推断】/【未知·待核验】
> 置信度图例：HIGH / MEDIUM / LOW / UNKNOWN
> 风险等级图例：P0（资金/越权生命线）/ P1（功能/数据完整性）/ P2（正确性或运维）/ P3（代码健康度）

---

## 0. 阅读说明

- 每条 Legacy 行为（编号 `L-xx`）独立成节，含：**现象描述 / 根因（源码位置）/ 为何必须保留或显式处理（破坏后果）/ 关联风险等级 / 证据等级 + 置信度**。
- "**必须保留**"指该行为是系统当前真实运行且被前端/下游依赖的契约，重构若改变其外部可观察行为将引入静默回归；"**必须显式处理**"指该行为本身是缺陷/隐患，重构时不能"顺手改掉"而不知会，必须作为**有意为之的破坏性变更（INTENTIONAL_BREAKING_CHANGE）**记录在案并配等价替换。
- 末尾 §1 给出"行为 → 字符化测试（16）"与"行为 → Golden Master（17）"的映射索引。

---

## 1. 资金 / 计费域（最高危，P0）

### L-01 · `canceled`（单 l，后端）与 `cancelled`（双 l，前端）拼写不一致 → 取消语义失效
- **现象描述**：后端在 `dispatcher.cjs` 的落库、SSE 推送、轮询返回、状态接口中**一律使用 `canceled`（美式单 l）**；前端在 `useGenerationStream.ts`、`GenerationBar.tsx`、`data/media.ts` 类型中**一律使用 `cancelled`（英式双 l）**。
- **根因（源码位置）**：
  - 后端权威值：`dispatcher.cjs:674/720/921/953/1252/1254`（`updateTaskStatus(...,'canceled',...)` + `emitTaskUpdate(...,{status:'canceled'})`）；`getTaskStatus` 直返 DB 原值 `row.status`（`dispatcher.cjs:1031`）。
  - 前端消费值：`useGenerationStream.ts:11/84/92`（`status === 'cancelled'`）；`GenerationBar.tsx:570`（`final.status === 'cancelled'`）；`data/media.ts:20`（`IMediaItem.status` 含 `'cancelled'`）。
- **为何必须保留或显式处理（破坏后果）**：
  - 取消链路已端到端串证：`'canceled' !== 'cancelled'` 导致 `waitForTask` 的 SSE 与 3s 轮询两条路径**均不结算**；任务只能等 95 分钟超时（`useGenerationStream.ts:61`）才 `settle(last)`，期间卡片永久显示"生成中"。
  - **同一标签取消**：`WorkspacePage.handleCancel` 乐观移除卡片，用户无感，但 Promise 挂起至超时（资源占用）。
  - **跨标签 / 远端取消（P0）**：被取消方标签的 pending 卡片永不移除，`onRemoteCancel`（负责移除幽灵卡片）永不被调用（仅在 `cancelled` 分支内，`GenerationBar.tsx:575`）。
  - 重构若"顺手统一拼写"但未锁定常量，可能再次回归。必须**显式收敛为单一常量**（建议后端 `canceled` 单 l 作为权威，或前端对齐）并加单测锁定，否则取消功能在 UI 层近乎失效。
- **关联风险等级**：P0（功能失效 + 疑似积分不释放观感）。
- **证据等级 + 置信度**：【源码已证实】HIGH（双向取证，11 号文档 §3.1、12 号文档 C6）。

### L-02 · 三阶段计费（reserve / commit / release）无事务、无 DB 唯一约束
- **现象描述**：计费按 `reserveCredits`（预扣 held）→ `commitCredits`（成功结算）→ `releaseCredits`（失败/取消/异常/超时退）三段式推进；**整个过程无 `BEGIN/COMMIT`，仅靠应用层 `SELECT→INSERT` 去重**。
- **根因（源码位置）**：`billing.cjs:32/58/70`；全仓 grep billing/accounting **零命中 `BEGIN/COMMIT/FOR UPDATE`**（仅 db.cjs:184、payments/webhook.cjs、server.js 注册登录有事务）；`reserve` 靠 `UPDATE ... SET col=col-$1 WHERE id=$2 AND col>=$1` 行级原子条件更新（`billing.cjs:35-38`），`commit/release` 是 `SELECT→INSERT` 两步非原子。
- **为何必须保留或显式处理（破坏后果）**：
  - 当前"正确性"依赖应用层顺序执行 + 看门狗兜底，但**无任何跨语句原子性保证**。重构若把 `reserve/commit/release` 拆到不同服务/进程，或引入并发，会立即暴露双扣/双退。
  - 必须**显式保留**其"非事务 + SELECT-then-INSERT 去重"的当前行为作为基线，或**显式改为带 `ON CONFLICT` 的真实事务**并记入破坏性变更。不能"看似更优雅"地改掉而引入新竞态。
- **关联风险等级**：P0（资金正确性）。
- **证据等级 + 置信度**：【源码已证实】HIGH（07 号文档 §4）。

### L-03 · `credit_transactions` 缺 `(ref,kind)` 唯一约束、并发 release 双退
- **现象描述**：`credit_transactions` 仅建非唯一索引 `ix_ct_ref`（`server.js:248`），**无 `(ref,kind)` 唯一约束**；`billing.cjs:_hasPosted(ref,kind)` 用 `SELECT 1 ... WHERE ref=$1 AND kind=$2 LIMIT 1`（48-55）先查后插。
- **根因（源码位置）**：`server.js:248`（约束定义）、`billing.cjs:48-55/60/72`（SELECT-then-INSERT）。
- **为何必须保留或显式处理（破坏后果）**：TOCTOU 窗口下，并发两次 `release` 可双双通过 `_hasPosted` 检查 → 余额**被多退一次**。这是当前最高危资金隐患之一。重构前必须用字符化测试把"双退"行为**显式录制**（当前确实会双退），再补 `UNIQUE(ref,kind)` + `ON CONFLICT DO NOTHING`。
- **关联风险等级**：P0（资金双退）。
- **证据等级 + 置信度**：【源码已证实】HIGH（15 号文档 P0-1、07 号文档 §4 风险点 2）。

### L-04 · `consumption_ledger` 幂等键非唯一 → 并发双记账
- **现象描述**：`consumption_ledger.idempotency_key` 仅非唯一索引 `ix_cl_idem`（`server.js:656`）；`accounting.recordConsumption` 同样 `SELECT→INSERT` 去重（`accounting.cjs:62-68`）。
- **根因（源码位置）**：`server.js:656`、`accounting.cjs:62-68`。
- **为何必须保留或显式处理（破坏后果）**：并发同键可双插 → 经营看板 `margin` 虚高、成本统计失真。重构前录制现状，再补唯一约束。
- **关联风险等级**：P0（账务双记账）。
- **证据等级 + 置信度**：【源码已证实】HIGH（15 号文档 P0-2、07 号文档 §4 风险点 3）。

### L-05 · 失败键复用不清理 `credit_transactions` → 用户永久损失积分
- **现象描述**：重试 `failed` 任务时（`server.js:2415-2418`）只 `releaseCredits` + 删 `generation_tasks` 行，**不清理 `credit_transactions`**；第二次若再失败，`releaseCredits._hasPosted` 命中第一次残留 release 行 → 返回 true → **跳过释放**。
- **根因（源码位置）**：`server.js:2415-2418`、`billing.cjs:70-72`。
- **为何必须保留或显式处理（破坏后果）**：当前用户**永久损失 `cost` 积分**。重构若把"删除任务行"语义改掉（如改为软删/保留），会触发不同的漏退路径；必须**显式录制并决策**是否清理旧流水或改 `ON CONFLICT`。
- **关联风险等级**：P0（资金漏退）。
- **证据等级 + 置信度**：【源码已证实】HIGH（07 号文档 §6 风险点 1）。

### L-06 · 余额三池与 `users.credits` 为 STORED 派生列（不可写）
- **现象描述**：`users.credits = GENERATED ALWAYS AS (reward_credits + recharge_credits) STORED`（`server.js:233`）；真实可扣池仅 `reward_credits` + `recharge_credits` 两个，`credits` 仅展示。
- **根因（源码位置）**：`server.js:233`（生成列定义）；`billing.cjs:11-29`（`resolvePayment` 双池顺序：奖励池优先 → 充值池回退 → 不足报错）。
- **为何必须保留或显式处理（破坏后果）**：任何直接 `UPDATE users SET credits=...` 都会因 `GENERATED ALWAYS` 报错或被忽略。重构若假设"存在独立第三余额池"会撞生成列约束。必须**显式保留**双池模型；`recordConsumption`/`commitCredits` 的 `balance_after` 取 `credits` 列（总计）而非分池，属已知口径瑕疵（见 L-07）。
- **关联风险等级**：P1（计费模型前提）。
- **证据等级 + 置信度**：【源码已证实】+【数据库已证实】HIGH（07 号文档 §1-2）。

### L-07 · `balance_after` 取总计列而非分池 → 账务口径与余额不一致
- **现象描述**：`commitCredits` 写 `credit_transactions.balance_after` 取 `users.credits`（STORED 总计，`billing.cjs:63`）；支付 webhook 入账流水 `balance_after` 同样取 `credits` 列（`webhook.cjs:141-145`）而非 `recharge_credits` 列。
- **根因（源码位置）**：`billing.cjs:63`、`webhook.cjs:141-145`。
- **为何必须保留或显式处理（破坏后果）**：流水中 `balance_after` 不反映"从哪个池扣/充"，分池对账时口径对不上。重构若想精确到分池，必须**显式记为破坏性变更**并补字符化测试锁定旧口径。
- **关联风险等级**：P2（账务准确性）。
- **证据等级 + 置信度**：【源码已证实】HIGH（07 号文档 §6 风险点 7、08 号文档 §7）。

### L-08 · 计费 `scope='system'` 在仓库内从未被调用
- **现象描述**：`accounting.recordConsumption` 的 `scope` 参数含 `'user'|'system'`，设计铁律称"系统自身调用传 `scope='system'`、客户收费传 0"；但**实测全部调用方均传 `scope:'user'`**，`scope='system'` 无任何调用方触发。系统成本以 `customerChargeCredits:0` 实现，非 `scope`。
- **根因（源码位置）**：`accounting.cjs:55-58`（scope 定义）；调用方 `dispatcher.cjs:699/932`、`shop.cjs:179`、`server.js:2733/2878`、`reference-style-audit.cjs:191` 均传 `'user'`。
- **为何必须保留或显式处理（破坏后果）**：若重构者据"资料库 A11"误以为存在 `scope='system'` 分支而为其写逻辑/测试，会引入**死代码**或**错误假设**。必须**显式记录**：当前 `scope='system'` 是未触发的死分支，重构无需保留其语义（属"必须显式处理——删或标注为无调用"）。
- **关联风险等级**：P2（代码假设失真）。
- **证据等级 + 置信度**：【源码已证实】HIGH（07 号文档 §7，推翻资料库 A11）。

### L-09 · 支付 webhook 绕过 `billing` 直接裸 SQL 记账
- **现象描述**：`webhook.cjs:128-168` 入账时直接 `UPDATE users SET recharge_credits=...` + 写 `credit_transactions(kind='grant')`，**完全未引用 `billing`**；与生成侧 `reserve/commit/release` 是两套独立记账语义。
- **根因（源码位置）**：`webhook.cjs:128-168`；Grep 证实 webhook 不 import billing。
- **为何必须保留或显式处理（破坏后果）**：两条记账路径幂等语义不同（webhook 靠 `webhook_events` 唯一索引 + paid 短路；billing 靠 `_hasPosted`）。重构若想"统一记账层"，必须**显式录制两套行为的差异**，否则合并会破坏其中一方的幂等保证。
- **关联风险等级**：P1（账务一致性）。
- **证据等级 + 置信度**：【源码已证实】HIGH（08 号文档 §7）。

### L-10 · 过期订单 `expired` 仍可被迟到真实回调入账
- **现象描述**：`order-expiry` 把 `pending→expired`，但 `webhook.cjs:110` 仅短路 `status==='paid'`，**不处理 `expired`**；迟到回调金额校验通过即置 `paid` + 加余额（幂等保证不双入账，但"过期≠终态"与直觉相悖）。
- **根因（源码位置）**：`webhook.cjs:110-126`、`order-expiry.cjs:41-51`。
- **为何必须保留或显式处理（破坏后果）**：产品语义需确认"过期订单迟到支付是否应到账"。重构若默认"expired=已死拒收"会**改变当前真实行为**（当前是到账的）。必须**显式决策**并配字符化测试锁定现状或新语义。
- **关联风险等级**：P2（业务语义待确认）。
- **证据等级 + 置信度**：【源码已证实】HIGH（08 号文档 §6 缺口 A）。

### L-11 · 账 / 余额分离：billing 不写 ledger、accounting 不动余额
- **现象描述**：`recordConsumption` 不碰用户余额（`accounting.cjs:98-108`），`billing` 不写 `consumption_ledger`；双边仅靠 `idempotencyKey` 命名约定对齐（`dispatcher.cjs:702`）。
- **根因（源码位置）**：`accounting.cjs:98-108`、`billing.cjs`、`dispatcher.cjs:702`。
- **为何必须保留或显式处理（破坏后果）**：任一侧 bug 不被另一侧发现，是"余额"与"成本"两套账可能漂移的根源。重构若引入"单边保证"，必须**显式录制**两侧独立写入的现状，避免误以为有交叉校验。
- **关联风险等级**：P1（账务完整性）。
- **证据等级 + 置信度**：【源码已证实】HIGH（07 号文档 §6 风险点 6）。

---

## 2. 任务调度 / Provider 域

### L-12 · T1 Bug：MiniMax / Volcano 失败返回 `'error'` 被误判 failover 空转、积分不释放
- **现象描述**：视频适配器 `minimax.cjs:85`、`volcano.cjs:121` 在生成端明确失败时返回 `status:'error'`；而 `agnes.cjs:131`、`generic`（dispatcher.cjs:291）返回 `status:'failed'`。`attemptOnAccount`（dispatcher.cjs:450-509）只对 `res.status==='failed'` 立即终态不切账号，其余非 success 一律 `markReject + return null` → **被当瞬时错误切下一账号新建真实 provider 任务**。
- **根因（源码位置）**：`minimax.cjs:85`、`volcano.cjs:121`、`dispatcher.cjs:450-509/218`（`pollLoop` 把 `error` 也当终态返回，上游无法区分"明确失败"与"瞬态"）。
- **为何必须保留或显式处理（破坏后果）**：
  - 后果链：provider 已明确失败却被当"临时不可用" → 浪费 quota、不即时终态；若所有 provider 失败 → 多轮 null → `throttled` → 入 `waiting`（`dispatcher.cjs:1285`）→ **积分永不释放、任务永不标 failed**（看门狗明确不碰 `waiting`，见 L-13）。
  - 这是"积分疑似不释放"类线上问题的真实根因之一。重构**必须显式决策**：修复（改适配器返 `failed`）并补字符化测试；若选择"精确复刻旧行为"须记为 `INTENTIONAL_BREAKING_CHANGE`。
- **关联风险等级**：P0（积分泄漏 + 资源浪费）。
- **证据等级 + 置信度**：【源码已证实】HIGH（06 号文档 §10，T1 复核）。

### L-13 · 超时铁律：失败只看生成端终态，固定时间仅防僵尸
- **现象描述**：`timeout` 与 `failed` 是不同状态（`dispatcher.cjs:490 vs 503`）；超时（90min 安全线）后仅 `updateTaskStatus('waiting')`，**绝不判失败、绝不释放积分**（`dispatcher.cjs:728-731/946-949/1283-1287`）；看门狗 `scanStuckTasks` 只回收 `running>3h`，**明确不碰 `waiting`**（`dispatcher.cjs:982-1001`）。
- **根因（源码位置）**：`dispatcher.cjs:490/503/728-731/946-949/982-1001/1283-1287`。
- **为何必须保留或显式处理（破坏后果）**：该"超时返 `waiting`、永不退积分"是**设计铁律**（超时可能只是 provider 慢，真实成功后会补 commit）。重构若"超时即退款"会**错误释放已成功任务的积分**；若"看门狗也回收 waiting"会破坏"待人工复核"语义。必须**显式保留**此行为，字符化测试锁定"超时→waiting 且余额不变"。
- **关联风险等级**：P0（资金铁律）。
- **证据等级 + 置信度**：【源码已证实】HIGH（06 号文档 §6、07 号文档 §5）。

### L-14 · `waiting` 任务积分永久 held 直至人工复核（无自动释放）
- **现象描述**：由 L-13 延伸：`waiting` 状态任务占用的 `cost` 积分**永久 held**，无自动释放路径（看门狗不碰 `waiting`）。
- **根因（源码位置）**：`dispatcher.cjs:982-1001`、`findDanglingReserves`（`billing.cjs:84`）定义"running>30min 释放 held"但**全仓零调用**（死代码），且与 90min/3h 阈值冲突。
- **为何必须保留或显式处理（破坏后果）**：删/接 `findDanglingReserves` 会改变"超时不退积分"铁律（90min 安全线）。必须**显式处理**：保留死代码现状或正确接入并统一阈值，禁止"顺手接上"引发 30/90/180min 三套阈值混乱。
- **关联风险等级**：P1（资金/阈值一致性）。
- **证据等级 + 置信度**：【源码已证实】HIGH（07 号文档 §6 风险点 4、06 号文档 §6）。

### L-15 · 任务状态枚举仅 5 个，`pending/queued/processing` 不存在
- **现象描述**：DB `generation_tasks.status` 实际仅 `running/done/failed/canceled/waiting` 五个（`queued`/`processing` 零出现）；"排队/等待区"是进程内 Map（`WAITING_AREA`）非 DB 枚举。
- **根因（源码位置）**：`dispatcher.cjs`（全文件 grep）；`WAITING_AREA` Map（`dispatcher.cjs:1111`）；`resume_meta` JSONB 持久化（`dispatcher.cjs:1159`）。
- **为何必须保留或显式处理（破坏后果）**：前端/外部若假设存在 `queued`/`processing` 状态会误判。当前前端类型 `TaskUpdate.status` 含 `waiting/not_found/unknown`（`useGenerationStream.ts:11`），与后端基本对齐（仅 `canceled/cancelled` 不一致，见 L-01）。重构必须**显式保留** 5 态模型 + `waiting` 进程内语义。
- **关联风险等级**：P1（状态机契约）。
- **证据等级 + 置信度**：【源码已证实】HIGH（06 号文档 §2）。

### L-16 · `pending_ids` 仅存储回传，服务端取消不回滚已建媒体
- **现象描述**：`generation_tasks.pending_ids` 仅 `INSERT`（`dispatcher.cjs:661`）+ 前端读取回传（`dispatcher.cjs:1032/1070`、`realtime.cjs:70`）；全文无任何"取消时回滚已创建子任务/媒体"逻辑。
- **根因（源码位置）**：`dispatcher.cjs:661/1032/1070`、`realtime.cjs:70`。
- **为何必须保留或显式处理（破坏后果）**：推翻资料库"pending_ids 用于取消回滚"的声称。重构若据错误假设实现"取消级联回滚"，会引入与现状不符的行为。必须**显式记录**：当前取消**不**回滚媒体，仅释放积分 + 标 `canceled`。
- **关联风险等级**：P2（行为假设）。
- **证据等级 + 置信度**：【源码已证实】HIGH（06 号文档 §9）。

### L-17 · 取消不调用 provider 端取消 API
- **现象描述**：`cancelTask`（`dispatcher.cjs:1221-1252`）只写内存信号 `cancelledTasks.add` + 移出等待区 + 释放积分 + 标 `canceled` + 推 SSE；**全文无任何 provider 端取消端点调用**。
- **根因（源码位置）**：`dispatcher.cjs:1221-1252`、`shared.cjs:193`（仅停自身轮询）。
- **为何必须保留或显式处理（破坏后果）**：provider 端任务不予撤销，可能继续计费/占用 quota。重构若新增"provider 端取消"，是**新能力**而非等价替换，须记为增强并评估计费影响。
- **关联风险等级**：P2（功能边界）。
- **证据等级 + 置信度**：【源码已证实】HIGH（06 号文档 §5）。

---

## 3. 实时通信域

### L-18 · 进程内 `EventEmitter` 实时总线不可多实例
- **现象描述**：`realtime.cjs` 用纯进程内 `EventEmitter`（`realtime.cjs:11-13`），`setMaxListeners(0)`；事件键 `u:${userId}`（`realtime.cjs:23/32`）；**无任何跨进程/跨重启持久化**，完全未用 Redis pub/sub（虽 Redis 已启用，仅用于限流/缓存/日志）。
- **根因（源码位置）**：`realtime.cjs`（通读无跨进程代码）；`redis.cjs`、`db.cjs:23`；`dispatcher.cjs:41` 注释记"多实例需迁 Redis"（已知待办）。
- **为何必须保留或显式处理（破坏后果）**：多副本部署下，SSE 推送只在"处理该任务的进程"内有效，其它进程连接收不到 → 实时性退化为 3s 轮询级（完成判定不依赖 SSE，故最终收敛）；跨实例取消推送丢失（叠加 L-01 后，跨实例取消几乎必然表现为"幽灵 pending 直到刷新"）。重构若改部署为多实例，**必须显式引入跨进程事件总线**，否则实时性硬降级。当前单实例行为是基线。
- **关联风险等级**：P1（水平扩展硬限制）。
- **证据等级 + 置信度**：【源码已证实】HIGH（11 号文档 §4，+ 文档记载 deployment-plan.md §6）。

### L-19 · SSE 为无名（默认 `message`）事件 + `TaskUpdate` 字段形状契约
- **现象描述**：推送格式 `res.write(\`data: ${JSON.stringify(payload)}\n\n\`)`（`realtime.cjs:38`），**无 `event:` 字段** → 前端用 `es.onmessage`（而非 `addEventListener('task-update')`）；payload 形状 = `TaskUpdate`：`{taskId,status,result?,error?,pendingIds?,...}`。
- **根因（源码位置）**：`realtime.cjs:38`、`useGenerationStream.ts:9-22`、`dispatcher.cjs:674/704/713/720/733/757`。
- **为何必须保留或显式处理（破坏后果）**：改为命名事件或改变 `data:` 包裹结构，前端 `es.onmessage = JSON.parse(ev.data)` 整段失效（且 `useGenerationStream` 对非法帧 `catch{}` 静默忽略 → 完成通知丢失，仅剩轮询兜底）。必须**显式保留**无名 SSE + 字段形状；若重构 SSE 协议须做破坏性变更记录。
- **关联风险等级**：P1（SSE 契约）。
- **证据等级 + 置信度**：【源码已证实】HIGH（12 号文档 C5、11 号文档 §1.2）。

### L-20 · 前端 SSE 失败后置 `esDisabled` 可能触发重复连接 + 本页会话失活
- **现象描述**：`es.onerror` 把 `es=null` 且 `esDisabled=true`（`useGenerationStream.ts:29-53`），但原生 `EventSource` 自动重连触发 `onopen` 会复位 `esDisabled=false` 而 `es` 仍为 null → 后续 `ensureConnection()` 新建第二个 `EventSource`（重复连接/重复投递）；一旦 `esDisabled=true`，本页后续 `waitForTask` 不再建连，实时推送永久降级直至刷新。
- **根因（源码位置）**：`useGenerationStream.ts:29-53`。
- **为何必须保留或显式处理（破坏后果）**：属前端状态机与 `EventSource` 原语的交互细节缺陷，功能不崩（settle 幂等）但有冗余连接。重构前端实时层时**必须显式保留**"SSE 零信任 + 3s 轮询兜底双保险"设计（见 L-21），不可移除轮询。
- **关联风险等级**：P2（前端健壮性）。
- **证据等级 + 置信度**：【源码已证实】HIGH + 重复连接【未知·待核验】MEDIUM（11 号文档 §1.5/§3.3）。

### L-21 · 完成判定"零信任 SSE"：3s 轮询兜底不可移除
- **现象描述**：`waitForTask` 同时监听 SSE + 每 3s `apiGetGenerationStatus` 轮询，任一命中终态即 `resolve`（`useGenerationStream.ts:60-100`）；超时仅 `settle(last)` 保留 pending，绝不误判失败（95min 视频 / 3.5min 图片）。
- **根因（源码位置）**：`useGenerationStream.ts:60-100`、`GenerationBar.tsx:519-582`、`server.js:2576-2582`（`getTaskStatus` 直读 `status`）。
- **为何必须保留或显式处理（破坏后果）**：这是"对 SSE 故障零信任"的工程取舍。**移除轮询兜底**会让 SSE 一抖就丢完成通知。重构必须**显式保留**双保险；且 `getTaskStatus` 直返 DB 原值（含 `canceled` 单 l，见 L-01）是轮询路径的契约。
- **关联风险等级**：P1（完成判定的关键路径）。
- **证据等级 + 置信度**：【源码已证实】HIGH（11 号文档 §2、12 号文档 C5）。

---

## 4. 认证 / 权限域

### L-22 · `/api/token` 公开返回 system token；`devTokenEnabled` 默认真 → RBAC 失效
- **现象描述**：`server.js:3623` 在 `handleAPI` 与 `appGateway` **之前**单独处理 `/api/token`，**无任何鉴权**直接 `sendJSON(200,{token: API_TOKEN})`；`devTokenEnabled = !isProduction || tokenFromEnv`（`server.js:31`），当前 `.env` 无 `NODE_ENV` → `isProduction=false` → `devTokenEnabled=true`。`appGateway`（`server.js:1276-1278`）只要 `Authorization: Bearer API_TOKEN` 即置 `req.user={id:'__system__',role:'system'}` 并 `return true`（**Bearer 优先于 cookie**）。
- **根因（源码位置）**：`server.js:3623/31/1276-1278`、`auth.cjs`、`api.ts:41-66`（前端 `ensureApi` 匿名拉 token 并作为 Bearer 注入每个请求）。
- **为何必须保留或显式处理（破坏后果）**：
  - 当前 dev 模式下，**任意浏览器访客（含未登录）借 system token 通过全部 `requireAdmin`**（`role==='admin'||'system'`，`admin.cjs:19-20`）→ 等同管理员接管（读全量用户/积分、改角色、手动充值、删用户、看账务、清日志）。
  - 这是**严重安全缺陷**，但同时它是**当前系统真实运行行为**（前端每个请求都以 system 身份跑，真实 cookie 会话被忽略 → 审计 `actorId` 恒为 `__system__`，见 L-23）。
  - 重构**必须显式处理**（修复 token 信任链 + 前端仅用 cookie 鉴权），但字符化测试/Golden Master 的**基线必须录制"当前 dev 下 system 身份"这一事实**，否则重构后对比会"看起来全变了"而实为安全修复（属预期破坏性变更）。
- **关联风险等级**：P0（远程未授权提权，安全）。
- **证据等级 + 置信度**：【源码已证实】+【配置文件已证实】HIGH（10 号文档 P0-A、03 号文档 §1/§3.1）。

### L-23 · `appGateway` Bearer 优先于 cookie → system 遮蔽真实会话、审计失真 + 自保护失效
- **现象描述**：见 L-22 根因。`req.user` 恒为 `system` → 后台审计 `actorId = req.user.id = '__system__'`（`admin.cjs:594`），真实管理员操作记为"系统"；管理员自保护 `if (actorId === decodeURIComponent(m[1])) return 400`（admin.cjs:608/615/622）因 `actorId==='__system__'` 而**失效**（可删/禁用自己）。
- **根因（源码位置）**：`server.js:1276-1278`、`admin.cjs:594/608/615/622`、`reference-styles.cjs:19`（唯独此处显式排除 `__system__`，更严谨）。
- **为何必须保留或显式处理（破坏后果）**：当前审计溯源失真、管理员可自锁。重构必须**显式修复**（让 `req.user` 反映真实 cookie 身份，system 令牌仅限内部通道），但基线需录制"当前所有操作记为 system"这一事实。
- **关联风险等级**：P1（审计失真 + 自保护失效）。
- **证据等级 + 置信度**：【源码已证实】HIGH（10 号文档 P1-D）。

### L-24 · 会话 JWT 密钥回退为公开常量 `'dev-only-change-me'`
- **现象描述**：`auth.cjs:9` `SECRET = process.env.JWT_SECRET || 'dev-only-change-me'`；当前 `.env` 仅含 `PG_*`/`REDIS_*`/`PAYMENT_MASTER_KEY`，**无 `JWT_SECRET`**；生产自检仅 `console.warn`（`server.js:3714-3716`），不 fail-closed。
- **根因（源码位置）**：`auth.cjs:9`、`server.js:3714-3716`、`.env`（已读）。
- **为何必须保留或显式处理（破坏后果）**：可离线伪造任意 `sub`/`role:'admin'` 会话。重构**必须显式修复**（注入强随机 `JWT_SECRET` 且缺失即拒绝启动），但基线需知"当前会话可被任意伪造"，字符化测试不应把"安全"当现状。
- **关联风险等级**：P0（会话伪造，安全）。
- **证据等级 + 置信度**：【源码已证实】+【配置文件已证实】HIGH（逻辑）/ MEDIUM（线上是否经启动参数注入未知）（10 号文档 P0-B）。

### L-25 · `DELETE /api/characters/:id` 缺 owner/role 校验（越权删全局共享资源）
- **现象描述**：`server.js:2196-2207` 仅 `if (!realUser) return 401` 后 `DELETE FROM characters WHERE id=$1`；`characters` 表无 `user_id`（全局角色库），**任意登录用户可删全站任意角色**。`POST /api/characters` 同理可写全局预设。
- **根因（源码位置）**：`server.js:2196-2207/2170`、`server.js:2159`（注释"全员共享的创作预设"）；对照 `DELETE /api/media/:id`（`server.js:2085` owner 隔离）、`reference-styles.cjs:139`（owner 校验）均更严谨。
- **为何必须保留或显式处理（破坏后果）**：当前属未授权删除（Broken Access Control）。重构**必须显式修复**（限制 admin-only 或加归属），但基线需录制"当前任意登录用户可删任意角色"这一现状，作为字符化测试的"实然"基线（仅用于回归对照，不等于认可）。
- **关联风险等级**：P1（越权写，安全）。
- **证据等级 + 置信度**：【源码已证实】HIGH（10 号文档 P1-C、03 号文档 §3.3）。

### L-26 · 多个管理操作端点缺 `requireAdmin`（`/providers/:id/sync`、`/test-endpoint`、`/test-default`）
- **现象描述**：`server.js:2935/2966/2983` 三个端点位于 `appGateway` 之后但**未调 `requireAdmin`、未校验 `realUser`**，仅做 `if(!pgPool) return`，随后用存储 `api_key` 向服务商发请求；同文件相邻 endpoints（L2347/2402/2407/2414）均正确 `requireAdmin`。
- **根因（源码位置）**：`server.js:2935/2966/2983`（对照 L2347 等）。
- **为何必须保留或显式处理（破坏后果）**：任何登录用户可对任意服务商触发同步/测试，泄露模型清单 + 可被滥用消耗 quota。重构**必须显式补 `requireAdmin`**，基线录制"当前仅登录即可调用"现状。
- **关联风险等级**：P1（越权，安全）。
- **证据等级 + 置信度**：【源码已证实】HIGH（03 号文档 §3.4）。

### L-27 · `GET /api/oss` 仅需登录即明文返回 `accessKeySecret`
- **现象描述**：`server.js:3329-3346` 仅需会话（非 admin）即返回活跃 OSS 槽位 `accessKeyId` 与 `accessKeySecret` 明文；dev 下因 L-22 对任何人可达。
- **根因（源码位置）**：`server.js:3329-3346`。
- **为何必须保留或显式处理（破坏后果）**：OSS/AK 凭据泄露。重构**必须显式修复**（始终掩码或根本不下发 secret），基线录制"当前明文返回 secret"这一严重现状。
- **关联风险等级**：P0（凭据泄露，安全）。
- **证据等级 + 置信度**：【源码已证实】HIGH（03 号文档 §3.2）。

---

## 5. 前后端契约 / 前端域

### L-28 · 错误以"字符串 + 状态码"当协议：`API <status>: <text>`
- **现象描述**：前端 `apiFetch` 非 2xx 时抛 `new Error(\`API ${res.status}: ${text.slice(0,200)}\`)`（`api.ts:29-33`）；多处**按此字符串反解**业务信息：`apiGenerate` 用正则 `/^API \d+:\s*(\{[\s\S]*\})\s*$/` 抠 JSON `code`（`api.ts:466`）；`apiCancelGeneration` 用 `msg.indexOf('{')` 再 `JSON.parse` 抠 `{error,code}`（`api.ts:501-509`）。
- **根因（源码位置）**：`api.ts:29-33/466/501-509`、`GenerationBar.tsx:181/188/1029/1127/1131/1193/1198`。
- **为何必须保留或显式处理（破坏后果）**：这是"用异常消息文本当协议"的硬耦合。后端改错误文案格式、或在 `API 4xx:` 前后加字符（换行/前缀），`code` 抽取会**静默失败** → 余额不足/取消失败等业务分支全失效。重构若统一错误体（结构化 Exception），**必须同步改这两处字符串解析**，否则核心流程静默断链。基线须录制"错误串格式契约"。
- **关联风险等级**：P1（前端核心流程依赖）。
- **证据等级 + 置信度**：【源码已证实】HIGH（12 号文档 C1、03 号文档 §5）。

### L-29 · 业务 `code` 字段 + HTTP 状态码双重分支（按字面量反解）
- **现象描述**：前端按响应体 `code` 字面量分支：`NEED_RECHARGE`/`INSUFFICIENT`（`api.ts:463-467`、`GenerationBar` 多处）、`NO_REASONING_MODEL`（`GenerationBar.tsx:1339/1378`）、`already_initialized`（`SetupWizardPage.tsx:85`）；按状态码分支：`AuthModal.tsx:49` `msg.includes('409')` → "该邮箱已注册"；`/402|积分不足/.test(err)`（`api.ts:463`、`GenerationBar:1127/1193`）。
- **根因（源码位置）**：`GenerationBar.tsx:181/188/1127/1193/1339/1378`、`api.ts:463/466`、`AuthModal.tsx:49`、`SetupWizardPage.tsx:85`、`server.js:2479/2491`（后端 402 + `积分不足` 文案）。
- **为何必须保留或显式处理（破坏后果）**：
  - `code` 是前后端**隐式约定**，无类型/枚举收敛（后端运行期字符串、前端字面量散落）；重命名任一 `code` 会让对应弹窗/拦截逻辑失效且无编译报错。
  - `includes('409')` 是典型"文本嗅探"反模式，后端消息里出现数字 409（哪怕别的语境）即误判；`/402|积分不足/` 对"积分不足"中文文案敏感。
  - 重构必须**显式保留**这些 `code`/`402`/`积分不足`/`409` 字面量契约（或统一为结构体并同步改前端），基线录制现状。
- **关联风险等级**：P1（前端业务分支依赖）。
- **证据等级 + 置信度**：【源码已证实】HIGH（12 号文档 C2/C3、03 号文档 §5）。

### L-30 · `SNAKE_MAP` 白名单式 snake↔camel 转换缺口 → 字段 `undefined` 假死
- **现象描述**：后端 `SNAKE_MAP`（`server.js:830-845`）+ `fromSnake/toSnake` 仅转换列在表中的 key；**新增 DB 列未同步进表 → 该列读出后仍是 snake_case，而前端 TS 类型按 camelCase 取值 → 字段 `undefined` → 渲染崩/假死/无限 loading**。表内已有重复键漂移（`supports_reward_balance`/`reward_credits_required` 在 L834/L848 各出现一次、`display_name` 在 L832/L855 各一次）。
- **根因（源码位置）**：`server.js:830-874`，前端 `data/media.ts`/`ICharacter` 等全 camelCase 取值；前端已两处防御性 normalize 暴露风险曾发生（`normalizeCharacters` `api.ts:280-297` 强制 `referenceImages` 为数组；`IMediaItem.status` 默认 `'success'`）。
- **为何必须保留或显式处理（破坏后果）**：这是**隐藏强耦合契约**：DB schema 与 `SNAKE_MAP` 必须手动同步，无编译期保障。重构若做"前后端共用类型"（提升 `IMediaItem` 为 `@shared` 契约），**必须让 `SNAKE_MAP` 与前端类型单一真相对齐**，否则新增字段再次踩 undefined。基线录制"当前 SNAKE_MAP 字段集合"。
- **关联风险等级**：P1（数据假死，难查）。
- **证据等级 + 置信度**：【源码已证实】HIGH（12 号文档 C4、03 号文档 §4）。

### L-31 · 前端裸 `<img>` 绕过 `Image` 空 src/破图兜底（含 #576 整页重载风险）
- **现象描述**：`components/ui/image.tsx` 是图片渲染唯一兜底组件：空/非字符串 src → `return null`（防 `<img src="">` 触发浏览器加载当前页、React 子树卸载的 #576 整页重载）；`onError` → `return null`。但 `SamplesPage.tsx:181` 等多处裸 `<img src={s.thumbnail}>` 绕过约定（`UserPage.tsx:124`、`MonitoringPage.tsx:348`、`ModelConsole.tsx:582`、`CheckoutPage.tsx:85`、`SellerPage.tsx:85`、`CartPage.tsx:74` 等）。
- **根因（源码位置）**：`image.tsx:137-151`（防线）、`SamplesPage.tsx:181` 等裸 img 调用、`image.tsx` 注释所述 #576。
- **为何必须保留或显式处理（破坏后果）**：一旦 `thumbnail`/`coverUrl` 为空，即重演 #576 整页重载 bug（图片瞬间消失）。重构须**显式统一**用 `Image` 替换裸 `<img>`（尤其后端字段可能为空处），基线录制"当前裸 img 仍存、特定空值会整页重载"。
- **关联风险等级**：P2（前端健壮性，可触发整页重载）。
- **证据等级 + 置信度**：【源码已证实】HIGH（12 号文档 C7）。

### L-32 · `vite.config.ts` `copyPublicDir:false` → 生产构建缺失 `public/` 静态资源
- **现象描述**：构建配置 `build: { outDir:'dist/build2', emptyOutDir:false, copyPublicDir:false, sourcemap:true }`（`vite.config.ts`）；`public/favicon.svg`、`public/icons.svg`、`public/samples/` 不会被复制到产物，而 `index.html` 与代码按绝对路径 `/favicon.svg`、`/icons.svg`、`/samples/...` 引用 → 生产环境 favicon 缺失、samples 静态 404。dev 模式因 Vite 仍服务 `public/` 而掩盖。
- **根因（源码位置）**：`vite.config.ts`、`index.html`、`public/` 目录存在。
- **为何必须保留或显式处理（破坏后果）**：重构部署流水线若不改此配置（或迁移资源到 `src`），生产将静默缺静态。基线录制"当前产物不含 public 静态（dev 看似正常）"。
- **关联风险等级**：P2（部署陷阱）。
- **证据等级 + 置信度**：【源码已证实】HIGH（12 号文档 §1.5/C9）。

### L-33 · 前端状态字符串散落字面量、无共享枚举（隐藏契约脆弱）
- **现象描述**：生成/媒体状态字符串（`canceled/cancelled`、`done/failed/waiting/not_found/unknown`）在前端 `useGenerationStream.ts:11`、`data/media.ts:20`、`GenerationBar.tsx` 等处散落为字面量，无 `@shared` 枚举；仅 `canceled/cancelled` 一项 casing 已暴露不一致（L-01），任何状态新增/改名都易静默失效。
- **根因（源码位置）**：`useGenerationStream.ts:11`、`data/media.ts:20`、`GenerationBar.tsx:570`。
- **为何必须保留或显式处理（破坏后果）**：重构须**显式收敛**为 `@shared` 共享枚举/常量，并加单测锁定 `canceled` 等字符串常量。基线录制"当前各状态字面量集合"。
- **关联风险等级**：P1（隐藏契约，耦合 L-01）。
- **证据等级 + 置信度**：【源码已证实】HIGH（11 号文档 §3.2、12 号文档 C6）。

### L-34 · 前端 `ensureApi` 隐式依赖"后端必在 3001" + `/api/token` 自动发现
- **现象描述**：`ensureApi()`（`api.ts:41-66`）默认 `http://<hostname>:3001` + `GET /api/token` 自动发现后端；发现失败则降级到"内置默认数据（不持久化）"（静默兜底）。dev proxy `/api → localhost:3001`（`vite.config.ts`）。
- **根因（源码位置）**：`api.ts:41-66`、`vite.config.ts` dev proxy。
- **为何必须保留或显式处理（破坏后果）**：若部署改端口/路径，前端自动发现失败 → 全站降级到"内置默认数据" → 表现成"登录/生成/素材全部失效但不报错"。重构须**显式保留或显式改造**发现机制，基线录制"当前 3001 + /api/token 依赖"。
- **关联风险等级**：P2（部署耦合）。
- **证据等级 + 置信度**：【源码已证实】HIGH（12 号文档 C8.4）。

### L-35 · 前端静默 catch 兜底普遍（业务失败被吞）
- **现象描述**：`api.ts` 绝大多数函数 `catch { return [] / {} / null / {ok:false} }`，失败静默兜底（`api.ts` 全文）。
- **根因（源码位置）**：`api.ts`（通读）。
- **为何必须保留或显式处理（破坏后果）**：重构若引入更严格错误边界/可观测性，需先决定"哪些失败必须上抛"（生成失败、扣费失败）而非一律静默。基线录制"当前失败被吞、UI 不报错"这一现状，否则重构后改动会被误判为回归。
- **关联风险等级**：P2（可观测性）。
- **证据等级 + 置信度**：【源码已证实】HIGH（12 号文档 §4）。

### L-36 · 充值订单状态枚举 `pending/paid/failed/expired` + 前端按 `paid` 切成功
- **现象描述**：`RechargeOrder.status` 取值 `'pending'|'paid'|'failed'|'expired'`（`api.ts:747`）；前端 `RechargePage` 轮询 `apiGetRechargeOrderStatus` 按 `paid` 切成功态。
- **根因（源码位置）**：`api.ts:747`、`server.js`（订单状态机）、`RechargePage` 轮询。
- **为何必须保留或显式处理（破坏后果）**：后端状态字面值改动即破前端成功判定。基线录制"当前 4 态枚举 + paid 切成功"。
- **关联风险等级**：P2（支付 UI 契约）。
- **证据等级 + 置信度**：【源码已证实】MEDIUM（12 号文档 C8.5）。

### L-37 · 测试框架与脚本不匹配（`package.json` `test=vitest` 但代码 `node:test`）
- **现象描述**：`package.json:13` `"test": "vitest run"`，但全部 8 个测试文件用 `node:test`（`require('node:test')` / `import ... from 'node:test'`），**无 vitest 配置**（`vite.config.ts` 无 `test` 块，无 `vitest.config.*`）；`vitest` 不识别 node:test 注册器 → `npm test` 实际跑不到这 8 个用例（或 0 通过）。
- **根因（源码位置）**：`package.json:13`、`vite.config.ts`（无 test 块）、8 个 `*.test.*` 文件头 `import {describe,it} from 'node:test'`，文件注释明确要求 `node --test` 运行。
- **为何必须保留或显式处理（破坏后果）**：当前 `npm test` 是**虚假绿/空跑**，重构安全网实际不存在。重构前必须**二选一统一**（建议统一 vitest 并补 `test` 配置，见 16 号文档 §4）。基线须录制"当前测试框架错配、npm test 不覆盖真实用例"这一事实。
- **关联风险等级**：P0（无有效安全网）。
- **证据等级 + 置信度**：【源码已证实】HIGH（15 号文档 §2）。

---

## 6. 行为 → 测试/基线 映射索引

| Legacy ID | 主题 | 关联风险 | → 字符化测试（16） | → Golden Master（17） |
|---|---|---|---|---|
| L-01 | canceled/cancelled 拼写 | P0 | CT-01 | GM-任务状态快照 |
| L-02 | 三阶段计费无事务 | P0 | CT-02 | GM-计费账目 |
| L-03 | credit_transactions 无唯一约束 | P0 | CT-03 | GM-计费账目 |
| L-04 | consumption_ledger 非唯一 | P0 | CT-04 | GM-计费账目 |
| L-05 | 失败键复用漏退 | P0 | CT-05 | GM-计费账目 |
| L-06 | 三池/STORED 派生列 | P1 | CT-06 | GM-余额快照 |
| L-07 | balance_after 总计列 | P2 | CT-07 | GM-计费账目 |
| L-08 | scope='system' 无调用 | P2 | CT-08 | — |
| L-09 | webhook 绕过 billing | P1 | CT-09 | GM-计费账目 |
| L-10 | expired 迟到入账 | P2 | CT-10 | GM-支付 webhook |
| L-11 | 账/余额分离 | P1 | CT-11 | GM-计费账目 |
| L-12 | T1 failover 空转 | P0 | CT-12 | GM-生成管线 |
| L-13 | 超时铁律 | P0 | CT-13 | GM-任务状态快照 |
| L-14 | waiting 永久 held | P1 | CT-14 | GM-计费账目 |
| L-15 | 5 态枚举 | P1 | CT-15 | GM-任务状态快照 |
| L-16 | pending_ids 不回滚 | P2 | CT-16 | — |
| L-17 | 取消不调 provider | P2 | — | — |
| L-18 | EventEmitter 单实例 | P1 | CT-17 | GM-SSE 字段契约 |
| L-19 | SSE 无名事件 | P1 | CT-18 | GM-SSE 字段契约 |
| L-20 | 重复连接/失活 | P2 | CT-19 | — |
| L-21 | 3s 轮询兜底 | P1 | CT-20 | GM-API 响应 |
| L-22 | /api/token 泄露 | P0 | CT-21 | GM-API 响应 |
| L-23 | Bearer 优先遮蔽 | P1 | CT-22 | GM-API 响应 |
| L-24 | JWT 默认密钥 | P0 | CT-23 | GM-API 响应 |
| L-25 | characters 缺校验 | P1 | CT-24 | GM-API 响应 |
| L-26 | providers sync 缺 admin | P1 | CT-25 | GM-API 响应 |
| L-27 | oss 明文 secret | P0 | CT-26 | GM-API 响应 |
| L-28 | 错误串协议 | P1 | CT-27 | GM-错误路径 |
| L-29 | code/状态码分支 | P1 | CT-28 | GM-错误路径 |
| L-30 | SNAKE_MAP 缺口 | P1 | CT-29 | GM-API 响应 |
| L-31 | 裸 img #576 | P2 | — | — |
| L-32 | copyPublicDir:false | P2 | — | — |
| L-33 | 状态字面量散落 | P1 | CT-01 | GM-任务状态快照 |
| L-34 | 3001 自动发现 | P2 | — | — |
| L-35 | 静默 catch | P2 | — | — |
| L-36 | 充值订单 4 态 | P2 | CT-36 | GM-支付 webhook |
| L-37 | 测试框架错配 | P0 | —（脚手架前提） | — |

---

## 7. 审计发现摘要（最关键 legacy 行为 8 条）

1. **[P0] canceled/cancelled 拼写不一致（L-01）**：后端单 l、前端双 l，取消 UI 层近乎失效，跨标签/远端取消卡片永久"生成中"。
2. **[P0] 计费无事务 + 无唯一约束（L-02/03/04/05）**：三阶段计费 SELECT-then-INSERT 去重，双退/双记账/漏退三重资金隐患，当前无有效原子保证。
3. **[P0] T1 failover 空转（L-12）**：MiniMax/Volcano 返 `'error'` 被当瞬态切账号，致积分永不释放、任务永标 failed。
4. **[P0] 超时铁律（L-13/14）**：超时返 `waiting` 且永不退积分、看门狗不碰 waiting —— 任何"超时即退款"的重构假设都会错释放已成功积分。
5. **[P0] 认证三连击（L-22/24/27）**：`/api/token` 公开 + 默认 JWT 弱密钥 + oss 明文 secret，dev 下 RBAC 全失效、可接管全站。
6. **[P1] 前后端文本契约（L-28/29/30/33）**：错误串 `API <status>:`、`code` 字面量、`SNAKE_MAP` 字段映射、状态字符串散落 —— 任一改动即静默断链/假死。
7. **[P1] 越权写（L-25/26）**：`DELETE /api/characters/:id` 与 3 个 providers 管理端点缺校验，任意登录用户可破坏性操作。
8. **[P0] 无有效安全网（L-37）**：`npm test`=vitest 但代码 node:test，当前 8 个用例不被运行 —— 重构前必须先统一框架。

> 本稿为只读审计产物，未对 `E:\code` 任何文件做写入/修改；所有行为均以既有事实文档的行号标注为证。
