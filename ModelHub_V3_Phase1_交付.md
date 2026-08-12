# ModelHub V3 — Phase 1 交付报告

**目标**：彻底解耦 `modelId`（机器运行标识）与 `displayName`（UI 展示字段）。
**状态**：✅ 已完成并独立提交（commit `9361cd2`，9 文件，+413 / −34）。Phase 1 已停止，未进入 Phase 2。

---

## 一、修改清单

### 新增文件
| 文件 | 作用 |
|---|---|
| `server/modules/modelhub/resolver.cjs` | **唯一模型身份 resolver**。收敛"display_name / model_id / 遗留 model 字符串"三态归一为 canonical `model_id` 数组。 |
| `server/modules/modelhub/resolver.test.cjs` | resolver 单元测试 + 生成链路契约测试（12 项）。 |
| `scripts/migrate/modelhub-v3-phase1.cjs` | 幂等迁移：ADD COLUMN + 回填 `generation_tasks.model_id` 历史空值 + 验证 SQL + 回滚说明。支持 `--dry-run`。 |

### 修改文件
| 文件 | 改动 |
|---|---|
| `server/dispatcher.cjs` | ① 顶部 `require('./modules/modelhub/resolver')`；② `generate()` 路由移除唯一 `display_name` 分支（原 L565），改走 `resolveModelIdentity()`；③ `generateAsync()` INSERT 新增 `model_id` 列；④ `resumeOneTask()` 对空 `model_id` 孤儿用 `display_name` 兜底。 |
| `server/server.js` | ① `import modelHubResolver`；② `/api/generate` 新增 `modelId` 输入（优先）+ 兼容 `model`（displayName）；按 canonical `model_id` 计费与路由；`genOpts` 携带 `model`/`modelId`/`displayModelName`；③ `initDB` 幂等回填历史 `model_id` 空值。 |
| `src/services/api.ts` | `apiGenerate` 入参新增可选 `modelId`。 |
| `src/hooks/useModelHub.ts` | `getDefaultModel` 返回 `modelId`；`getModelDisplayNameByDisplayName` / `getModelCreditCostByDisplayName` 兼容按 `modelId` 或 `displayName` 查询。 |
| `src/components/GenerationBar.tsx` | 选中/当前模型匹配/传参/校准改按 `modelId`（兼容旧 localStorage 残留 `displayName`）；调用 `apiGenerate` 同时传 `modelId` + `model`（展示名）。 |
| `src/pages/WorkspacePage/WorkspacePage.tsx` | 模型有效性校验兼容 `modelId` 或 `displayName`。 |

### 数据库变更
- **无 DROP、无删列。** `generation_tasks.model_id` 列在 `initDB` 早已 ADD（server.js:273）；本 Phase 仅保证**写入路径覆盖该列** + **回填历史 NULL 行**。
- `models.display_name` 列**原样保留**，仅退出路由身份。

### API 变化
- `POST /api/generate` 新增可选字段 `modelId`（canonical 机器标识）。优先级：`modelId` > `model`。
- 旧客户端仅传 `model`（=displayName）完全兼容，经 resolver 归一。

---

## 二、测试结果

| 验证项 | 命令 / 范围 | 结果 |
|---|---|---|
| resolver 单元测试 + 契约测试 | `node --test server/modules/modelhub/resolver.test.cjs` | **12/12 通过** |
| 后端语法检查 | `node --check` resolver / dispatcher / server / migrate / test | **全绿** |
| 前端类型检查 | `tsc --noEmit` | **0 错误** |
| 前端构建 | `vite build` | **0 错误**（仅历史 chunk 体积警告） |
| ESM↔CJS 互操作 | `import modelHubResolver from './modules/modelhub/resolver.cjs'` | resolveModelIdentity / getDisplayNameForModelId 均为 function |

> 测试覆盖：model_id 优先匹配、display_name 回退（展示名≠model_id）、数组输入去重、同 model_id 多行去重、disabled 不返回 canonical 但兜底不抛错、完全未命中原样返回、空输入、无 pgPool 兜底、DB 抛错兜底、resolver 输出驱动 `model_id=ANY` 查询契约、旧客户端 display_name 归一契约。

---

## 三、兼容性验证

1. **旧客户端（仅传 displayName）**：`/api/generate` 取 `rawModel = body.modelId || body.model` → resolver 按 `display_name` 回退解析 → 路由/计费正常。
2. **generation_tasks.model 列保留展示名**：新任务写 `displayModelName`（= 前端传的 displayName），旧任务/遗留孤儿沿用原 `display_name`；admin 任务列表、DetailPanel/ImageViewer 展示均正常。
3. **provider_task_id 恢复链**：`persistProviderTaskId` 仍写 `model_id`（视频提交后）；`resumeOneTask` 对空 `model_id` 孤儿新增 `display_name` 兜底，旧视频任务恢复不受影响。
4. **等待区恢复**：`resumeWaitingArea` 遗留孤儿用 `row.model`（displayName）重建 opts → `generate()` 经 resolver 归一，恢复链路完整。
5. **旧任务数据库恢复**：迁移脚本回填所有 `model_id IS NULL` 行（display_name→model_id→自身），崩溃重启后续轮询/等待区恢复均可定位模型。
6. **display_name 列未删除**：任何依赖它的报表（admin 用户/OSS/价格历史）不受影响。

---

## 四、回滚方法

本 Phase 为**纯增量**（ADD COLUMN + UPDATE + 新增文件），无破坏性行为：

1. **代码回滚**：`git revert 9361cd2`（或部署上一版后端）。`model_id` 列对旧代码为"被忽略的额外列"，不影响旧逻辑；`display_name` 列从未删除。
2. **数据回滚**：无需回滚数据。迁移脚本只写 `model_id`，未删任何行/列；再次运行安全（幂等）。
3. **前端回滚**：部署上一版前端即可；新旧前端均向后兼容后端（后端同时接受 `modelId` 与 `model`）。
4. **注意**：回滚后端后，必须**重启 3001** 加载旧代码才生效（改动未重启等于没改）。

---

## 五、后续（未启动，按用户"完成 Phase 1 后停止"）

- Phase 2：Provider Model Binding（provider × model 绑定表）
- Phase 3：Pricing 模块
- Phase 4：Routing Policy / Provider Health / Circuit Breaker / Adaptive Weighted Router
- Phase 5：Audit Log

> 部署前请在本机执行：`node scripts/migrate/modelhub-v3-phase1.cjs`（或依赖 `initDB` 开机自填），并重启后端 3001。
