# 17 · Golden Master 设计（基线录制与回归比对）

> 审计对象：墨灵 AI（`E:\code`）
> 文档性质：**只读体检产物**。本设计**禁止任何对生产数据的写入/变更**；所有基线均通过**只读**方式录制。证据以既有事实文档（21 + 02/03/06/07/08/10/11/12/15）为基准。
> 用途：在字符化测试（16）锁定"行为"之外，用 Golden Master 锁定"输出快照"——生成管线产物、计费账目、API 响应、错误处理路径。二者互补：**字符化锁行为，Golden Master 锁输出**。
> 证据等级图例：【源码已证实】/【配置文件已证实】/【推断】/【未知·待核验】
> 置信度图例：HIGH / MEDIUM / LOW / UNKNOWN

---

## 1. Golden Master 适用对象

Golden Master（GM）测试的核心：对"给定输入，系统产出什么输出"做**完整快照**，重构后重跑比对。墨灵 AI 适用对象如下（与 21 / 16 对齐）：

| GM 对象 | 说明 | 来源 Legacy | 关联用例（16） |
|---|---|---|---|
| **GM-1 生成管线输出** | 某模型+prompt 经 dispatcher→provider→finalize 后的 `media`/`result` 结构（images/videoUrl/source/usedProviders）、`generation_tasks.status` 终态 | L-12/13/15 | CT-12,13,15 |
| **GM-2 计费账目** | `reserve/commit/release` 全链路后 `users` 余额（reward+recharge）、`credit_transactions` 行集合、`consumption_ledger` 行集合、`balance_after` | L-02/03/04/05/07/11/14 | CT-02~07,11,14 |
| **GM-3 API 响应快照** | 关键端点（`/api/generate`、`/api/media`、`/api/characters`、`/api/oss`、`/api/token`、`/api/providers`、`/api/models`、`/api/settings`）的请求→响应（含 camelCase 字段，经 `SNAKE_MAP`） | L-22/25/26/27/29/30/33 | CT-21~26,29 |
| **GM-4 错误处理路径** | 余额不足（402+`积分不足`+`code`）、注册冲突（409）、取消失败、无推理模型（`NO_REASONING_MODEL`）、IDOR（403/404）、支付失败——错误响应体/错误串 `API <status>:` | L-28/29/25 | CT-27,28,24 |
| **GM-5 支付 webhook 入账** | 真实回调 → `recharge_orders`/`users`/`credit_transactions(grant)`/`webhook_events` 全量快照；重复回调幂等；expired 迟到入账 | L-09/10/36 | CT-09,10,36 |
| **GM-6 SSE 字段契约** | `emitTaskUpdate` 写出帧（无名 `data:` JSON，`TaskUpdate` 形状） | L-18/19 | CT-17,18 |
| **GM-7 余额三池模型** | `users` 三列（credits STORED / reward / recharge）+ `resolvePayment` 双池顺序结果 | L-06 | CT-06 |

> 说明：GM-1（生成管线）因涉及真实 provider，**默认仅录制 mock provider 下的输出结构**（不消耗真实 quota）；若确需真实产出快照，须走"只读录制 + 隔离账号 + 不持久化到生产库"的受控流程（见 §2.3）。

---

## 2. 采集方式（只读录制，明确禁止写生产数据）

### 2.1 总原则
- **录制 = 只读导出 / 重放 mock 路径**；**绝不**对 `E:\code` 生产库执行 INSERT/UPDATE/DELETE，绝不发起真实支付/真实 provider 调用。
- 所有基线落盘到 `tests/snapshots/`（git 纳入版本控制），与源码同仓但不触碰业务数据。
- 录制脚本自身须通过"生产连接串 guard"：若检测到 `DATABASE_URL` 指向生产，立即中止。

### 2.2 各类对象的录制手段

| GM 对象 | 只读录制手段 | 是否触生产写 | 证据 |
|---|---|---|---|
| GM-2 计费账目 | 在 **pg-mem**（内存 PG，建与生产同构 schema）重放 `reserve→commit/release` 调用，导出最终 `users`/`credit_transactions`/`consumption_ledger` 行集为 JSON | 否 | 【源码已证实】HIGH（07/15） |
| GM-3 API 响应 | 对**本地临时实例**（用生产 schema dump 的只读副本或 pg-mem 装载）发请求，录制响应体；或对生产库做**只读 SELECT** 导出典型响应样本 | 否（只读 SELECT） | 【源码已证实】HIGH（03） |
| GM-4 错误路径 | 在本地实例触发各错误分支（mock 余额不足/冲突），录制错误响应串 | 否 | 【源码已证实】HIGH（03 §5） |
| GM-5 支付 webhook | 本地重放 webhook 验签（用测试商户密钥，**非生产密钥**），导出入账快照 | 否 | 【源码已证实】HIGH（08 §4） |
| GM-6 SSE 帧 | 捕获 `res.write` 输出（mock res），录制 `data:` JSON 帧 | 否 | 【源码已证实】HIGH（11 §1.2） |
| GM-7 余额模型 | pg-mem 装载生成列定义，录制 `resolvePayment` 结果 | 否 | 【源码已证实】+【数据库已证实】HIGH（07 §1） |
| GM-1 生成管线 | **推荐**：mock provider 录制输出**结构**快照；**可选**：受控真实录制（见 §2.3） | 否（mock）/ 受控 | 【源码已证实】HIGH（06） |

### 2.3 受控真实录制（仅 GM-1 可选，强约束）
若确需真实 provider 产出快照（如验证图像后处理/字段形状），须满足：
1. 使用**隔离测试账号**（非生产用户），测试完即清理（清理动作属测试数据，非生产业务数据，且须在录制脚本内显式隔离）。
2. 录制仅 `SELECT` 产出结果 + 保存输出**结构元数据**（URL 占位、字段名、尺寸），**不下载/不持久化真实媒体二进制**到生产库（避免污染 `media` 表）。
3. 绝对禁止带生产 `PAYMENT_MASTER_KEY` / 真实商户密钥运行；用独立测试密钥。
4. 录制脚本头注明"本脚本仅用于基线采集，禁止在 production 环境执行"。

> 默认**不启用**真实录制；mock 录制已足够锁结构契约。真实录制列为"可选、需 TL 审批"。

### 2.4 录制工具建议
- **pg-mem**：纯 JS 内存 PG，支持 `GENERATED ALWAYS`、`UNIQUE`、事务，零外部依赖（GM-2/5/7 首选）。
- **supertest / light-my-request**：对本地实例发 HTTP 请求录制响应（GM-3/4）。
- **捕获 `res.write`**：GM-6 SSE 帧录制。
- **JSON 序列化 + 规范化（sorted keys）**：保证快照可 diff。
- **录制元数据文件**：每份基线附 `.meta.json`（录制时间、schema 版本、provider mock 版本、git commit），便于溯源。

---

## 3. 比对策略

### 3.1 字段级 diff（默认）
- 重构后重跑，将实际输出与基线做**深度字段级 diff**（如 `jest-snapshot` / `vitest` 内置 `toMatchSnapshot` / `fast-json-stable-stringify` + `diff`）。
- 对 GM-2/3/5/7：逐行/逐字段比对 `users` 余额、`credit_transactions` 行、`consumption_ledger` 行、API 响应字段。

### 3.2 容忍字段（必须排除，否则必红）
以下字段**每runs 变化或无业务意义**，比对时须**忽略或归一化**：
| 容忍字段 | 对象 | 归一化方式 | 证据 |
|---|---|---|---|
| 时间戳（`created_at`/`completed_at`/`expired_at`） | GM-2/3/5/7 | 替换为固定占位或仅比"存在性/单调性" | 【源码已证实】HIGH |
| 主键 ID（`id`/`task_id`/`order_no`/`pay_order_no`） | 全部 | 替换为 `{{ID}}` 占位或按索引重映射 | 【源码已证实】HIGH |
| `provider_task_id` / `idempotency_key` 中随机数 | GM-1/2 | 正则替换为占位 | 【源码已证实】MED |
| `balance_after`（受生成列/并发影响） | GM-2 | 比"相对变化量"而非绝对值 | 【源码已证实】HIGH（L-07） |
| `sign` / `webhook` 签名 | GM-5 | 排除（每次重算） | 【源码已证实】HIGH（08 §3） |
| 媒体 URL / OSS 路径 | GM-1/3 | 比"字段名+非空"不比具体值 | 【源码已证实】MED |
| `retry`/`heartbeat` 等 SSE 控制帧 | GM-6 | 仅比业务 `data:` 帧 | 【源码已证实】HIGH（11 §1.4） |

### 3.3 阈值（数值容差）
- 金额/积分：默认**精确相等**（资金域零容差）；若引入舍入分摊（L-07 `price` 分摊 `alloc=round(cost*units/totalUnits)`），允许 `±1` 分容差并标注（07 §6-8）。
- `margin_cents`：账务层允许因舍入导致的 `±1` 分漂移（非余额）。
- 计时类（轮询 3s / 心跳 20s / 超时 90min）：比"常量存在且量级正确"，不比精确毫秒。

### 3.4 比对失败分级
- **红（阻断）**：资金余额/账目出现非容忍差异（双退、漏退、金额错）→ 必须查因。
- **黄（待审）**：字段新增/顺序变化（如新增 camelCase 字段、SNAKE_MAP 扩展）→ 可能是预期演进，需人工确认后更新基线。
- **绿（通过）**：完全匹配（容忍字段归一化后）。

---

## 4. 基线管理与演进

### 4.1 基线存储
- 路径：`tests/snapshots/<domain>/<case>.snap` + `<case>.meta.json`。
- 版本控制：基线随代码入库（git），与字符化测试（16）同仓。
- 命名：`GM-<对象>-<场景>.snap`，如 `GM-2-billing-release-double.snap`、`GM-3-get-media.snap`、`GM-4-insufficient-402.snap`。

### 4.2 重构后回归比对流程
```
1. 重构前：录制基线（§2）→ 入库。
2. 重构中/后：跑 GM 比对（§3）。
   - 全绿 → 行为等价，安全。
   - 红 → 资金/契约回归，阻断合并。
   - 黄 → 人工评审：若属预期演进（如统一 canceled 拼写 L-01）→ 更新基线并记 CHANGELOG；若属无意回归 → 修复。
3. 与字符化测试（16）联动：GM 红通常对应某 CT 用例红，二者交叉定位。
```

### 4.3 何时更新基线（红线约束）
基线**只能**在以下情形更新，且须留痕：
1. **已决策的破坏性变更**：如修复 L-01（统一 `canceled`）、L-22（移除 token 泄露）、L-12（T1 修复）——更新基线 + 在 CHANGELOG/PR 标注 `INTENTIONAL_BREAKING_CHANGE`，并对应更新 16 号文档中该用例的 `KNOWN_DEFECT` 标记。
2. **预期演进**：新增字段（SNAKE_MAP 扩展）、新增状态——更新基线 + 评审记录。
3. **环境/工具变化**：pg-mem 版本升级导致序列化差异——重录并说明。
- **禁止**：为让测试"变绿"而无理由更新基线（掩盖回归）。CI 应要求基线更新须附 PR 说明。

### 4.4 基线保鲜
- 每次重构 PR 触发 GM 比对（CI gate）。
- 定期（如每月）复核容忍字段列表是否仍合理（如新增长整数字段须加入归一化）。
- 字符化测试（16）与 GM 共享同一 `tests/snapshots` 与 mock 基础设施，避免重复。

---

## 5. 与字符化测试（16）的关系

| 维度 | 字符化测试（16） | Golden Master（17） |
|---|---|---|
| 锁定对象 | **行为/控制流**（状态跃迁、分支、重试、去重逻辑） | **输出快照**（账目行集、API 响应、错误串、SSE 帧） |
| 断言形式 | 针对具体输入断言具体输出（精确、可读） | 整段快照比对（全面、易漏微小变化） |
| 维护成本 | 低（针对性用例） | 中（快照需管理/演进） |
| 擅长 | 捕获"逻辑被改坏"（如 T1 空转、双退） | 捕获"输出被改坏"（如字段改名、错误格式变） |
| 盲区 | 难覆盖未预见的输出细节 | 易掩盖非关键差异（靠容忍字段缓解） |
| 互补点 | CT-12 锁"failover 空转逻辑" → GM-1 锁"最终 waiting 状态 + held 余额快照" | GM-3 锁"API 响应字段" → CT-29 锁"SNAKE_MAP 映射函数" |

**结论**：
- **先字符化（16），后 Golden Master（17）**：字符化用例是"可读的契约"，Golden Master 是"无遗漏的兜底"。二者针对同一 Legacy 行为（见 21 §6 映射表）双保险。
- **冲突处理**：若 GM 比对红但对应 CT 用例绿（或反之），说明一处捕获了另一处未覆盖的维度，须补另一侧。
- **统一基建**：建议 `tests/` 下字符化与 GM 共用 `pg-mem`/`mock-provider`/`snapshots` 目录，减少重复（见 16 §4.2）。

---

## 6. 证据等级 + 置信度汇总

| GM 对象 | 来源 Legacy | 录制可行性证据 | 置信度 |
|---|---|---|---|
| GM-1 生成管线 | L-12/13/15 | 【源码已证实】mock 录制可行 | HIGH（mock）/ MED（真实受控） |
| GM-2 计费账目 | L-02/03/04/05/07/11/14 | 【源码已证实】pg-mem 重放 | HIGH |
| GM-3 API 响应 | L-22/25/26/27/29/30/33 | 【源码已证实】本地只读 | HIGH |
| GM-4 错误路径 | L-28/29/25 | 【源码已证实】本地触发 | HIGH |
| GM-5 支付 webhook | L-09/10/36 | 【源码已证实】测试密钥重放 | HIGH（10 语义待确认 MED） |
| GM-6 SSE 帧 | L-18/19 | 【源码已证实】捕获 res.write | HIGH |
| GM-7 余额模型 | L-06 | 【源码已证实】+【数据库已证实】pg-mem 生成列 | HIGH |

---

## 7. 审计发现摘要（关键设计结论）

1. **[P0] 基线必须只读录制**：所有 GM 基线通过 pg-mem 重放 / 本地只读 SELECT / mock 重放获得，严禁写生产数据；录制脚本须带生产连接 guard。
2. **[P0] 资金域零容差**：GM-2/5/7 比对金额/余额精确相等（舍入 ±1 分除外），任何双退/漏退差异即阻断合并。
3. **[P1] 容忍字段须显式归一化**：时间戳/ID/签名/URL 必须排除，否则 GM 必然误红；归一化列表随演进维护。
4. **[P1] GM 与字符化互补**：GM 锁"输出"、16 锁"行为"，针对 21 的同一 Legacy ID 双保险；冲突即补盲。
5. **[P1] 基线更新须留痕**：仅在"已决策破坏性变更 / 预期演进 / 工具变化"三种情形更新，禁止为变绿而掩盖回归。

> 本稿为只读审计产物，未对 `E:\code` 任何文件做写入/修改；所有基线采集方案均设计为零生产副作用。
