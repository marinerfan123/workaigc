# ModelHub V3 · Phase 3（续）：RESTful 化 + 乐观锁

> 交付日期：2026-08-11
> 关联前序：Phase 3.1 dispatcher 透传 binding_id（已交付，报告 `ModelHub_V3_Phase3_dispatcher_passthrough.md`）

## 一、需求

把 `POST /api/providers` 从「破坏性全量同步（列表外项可被删除）」改为标准 RESTful 风格，并新增乐观锁：

- `POST /providers`（创建）、`PATCH /providers/:id`（更新）、`DELETE /providers/:id`（删除）
- `POST /models`（创建）、`PATCH /models/:id`（更新）、`DELETE /models/:id`（删除）
- 新增列：`revision` / `updated_at` / `updated_by`
- 乐观锁语义（按用户示例）：
  - `revision = 12`，管理员 A 保存 → `WHERE revision = 12` 更新后 `revision = 13`
  - 管理员 B 仍拿 12 保存 → **409 Conflict**，而不是覆盖 A

> 路由前缀沿用现有 `/api/`（与全站 `apiGetProviders` 等一致性），即实际为 `POST /api/providers` 等。
> 经 AskUserQuestion 确认：**后端+前端一起做**；**仅 PATCH 加 revision 守卫，DELETE 按 id 直接删**（符合用户示例）。

## 二、后端改动（`server/server.js` + 新模块）

### 1. 新列（幂等 ADD COLUMN，旧库安全）
- `initDB` 的兼容块新增 6 条 `DO $$ ... ALTER TABLE ... ADD COLUMN`：
  - `providers` / `models` 各加 `revision INT NOT NULL DEFAULT 1`、`updated_at TIMESTAMPTZ DEFAULT NOW()`、`updated_by TEXT DEFAULT ''`
  - PG11+ 对旧行瞬时回填（无全表重写），绝不 DELETE 旧列（守铁律）。
- `SNAKE_MAP` 补 `revision:'revision'`、`updated_by:'updatedBy'`（`updated_at:'updatedAt'` 原有）。前端由此自动拿到三新列，无 `undefined` 假死。

### 2. 乐观锁助手 `server/modules/modelhub/revision.cjs`（新）
- `optimisticUpdate(pg, { table, id, expectedRevision, columns, values, actor })`
- SQL：`UPDATE <table> SET <cols>, revision=revision+1, updated_at=NOW(), updated_by=$actor WHERE id=$1 AND revision=$2`
- `rowCount===0` 时二次 `SELECT` 区分：**不存在 → `notFound`** vs **revision 不匹配 → `conflict`（带 `currentRevision`）**
- 表名 / 列名白名单校验（正则 + 受管表集合），杜绝 SQL 注入（pg 占位符只能绑值，不能绑标识符）。

### 3. `POST /api/providers` → 单条创建（去掉破坏性全同步）
- 单对象（`Array` 入参直接 400 拒绝）。`id` 已存在 → **409**。
- 保留：api_key 占位保护（含 `*`/短串落空）、容量上限校验。
- 写入 `revision=1, updated_at=NOW(), updated_by=操作人`。返回 `201 { ok, id, revision:1 }`。
- **新增 `PATCH /api/providers/:id`**：字段白名单（13 项）+ `optimisticUpdate`；`revision` 缺失/非整数 → 400；不匹配 → 409（带 `currentRevision`）；不存在 → 404。返回带新 `revision`。
- `DELETE /api/providers/:id` 保持按 id（级联删 models，因 `models.provider_id REFERENCES providers ON DELETE CASCADE`）。

### 4. `POST /api/models` → 单条创建（去掉数组 upsert）
- 单对象；`id` 已存在 → **409**。保留：provider_id 外键容错（无效置 NULL）、奖励校验（仅显式传奖励字段时强制 `supports_reward_balance` 须 `reward>0`）。
- 写入三新列，返回 `201 { ok, id, revision:1 }`。
- `PATCH /api/models/:id`：接入 `optimisticUpdate`（409/404 同 provider），保留价格历史归档 `model_price_history`、奖励校验、白名单 13 项，返回带新 `revision`。
- `DELETE /api/models/:id` 保持按 id。

## 三、前端改动

因改 POST 语义会破坏依赖「破坏性全同步」的前端，**前端一并重做保存流程**（≈30 处 `setProviders/setModels` 调用点保持不变，由底层 diff 对账自动映射）：

- `src/services/api.ts`
  - 删除 `apiSaveProviders` / `apiSaveModels`（原破坏性全同步）。
  - 新增 `apiAddProvider` / `apiPatchProvider` / `apiAddModel`（RESTful 单创建/局部更新）。`apiPatchModel` 沿用并增强错误信息。
- `src/hooks/useModelHub.ts`（核心重构）
  - `setProviders/setModels` 不再整表 POST，改为**以「旧内存态 → 新内存态」为基准的增量对账**：
    - 新增 id → `apiAddProvider/apiAddModel`
    - 既有且字段变化 → `apiPatchProvider/apiPatchModel`（带 `revision`）
    - 被移除 id → `apiDeleteProvider/apiDeleteModel`
  - `diffChanged` 浅比较、跳过服务端托管字段（`revision/updatedAt/updatedBy/createdAt/id`），对象/数组 JSON 深比较。
  - `patchModel` 自动注入 `revision`（来自当前内存态），409 时刷新后端为准。
  - `deleteProvider/deleteModel/cleanupOrphanModels` 改为直接 DELETE（不再依赖全量保存兜底）。
  - `initData` 首次种子改为逐条 `apiAddProvider/apiAddModel`。
  - 新增 `refreshProviders/refreshModels`（409 冲突时以服务端为准重置）。
- `src/data/models.ts`：`IModelProvider` / `IAiModel` 增补可选 `revision?` / `updatedAt?` / `updatedBy?`（类型安全）。
- `src/pages/Admin/ModelPricePage.tsx`：原 `apiSaveModels([{...}])` 改为「先 `apiAddModel`，遇 409 取最新 revision 再 `apiPatchModel`」（沿用旧 upsert 语义）。
- `src/pages/Admin/UsersPage.tsx`：删除**死代码**（重复的 provider/model API 副本，无任何调用点，且会打到已失效的数组端点）。

## 四、测试与验证

- 新增 `server/modules/modelhub/revision.test.cjs`（node:test + fake pool，**7/7 通过**）：
  - 正常更新 revision+1 / 冲突 409（带 currentRevision）/ 不存在 404 / 非法表名 / 非法列名（注入）/ 列值不等长 / models 表可用。
- `node --check server/server.js` + `revision.cjs`：**通过**。
- `tsc --noEmit`（整个前端工程）：**0 错误**。
- `vite build`：**0 报错**（esbuild 严格校验，含重复 import 检测）。
- 沙箱无 PG / 浏览器，**端到端需用户本机**跑：`npm run dev`（前端强刷）+ 后端 3001 重启。

## 五、注意 / 待办

1. **本机验证乐观锁**：用两个标签页同时编辑同一 provider/model 并保存，第二个应收到 409 提示「请刷新后重试」。
2. **后端未提交**：受 safe-git 约束，改动仅落工作树，提交需用户本机 plumbing（远程即权威）。
3. **DELETE 无乐观锁**：按用户示例仅 PATCH 守卫；如需 DELETE 也防并发，可后续补充。
4. **种子脚本**：`scripts/` 无调用旧 `POST /api/providers`，无额外风险点。
