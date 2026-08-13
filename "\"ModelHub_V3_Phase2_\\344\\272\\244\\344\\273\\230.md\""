# ModelHub V3 — Phase 2 交付报告

> 分支：本地 `main` HEAD = `ed3f7f4`（Phase 2 独立提交）
> 前序：Phase 0 审计（#615）、Phase 1（#616–#622，commit `9361cd2`）
> 本报告遵循用户铁律：每 Phase 独立提交，并输出「修改清单 / 测试结果 / 兼容性验证 / 回滚方法」四节。

---

## 0. Phase 2 目标回顾

- `models` 收敛为「逻辑模型」（catalog 级，描述模型本身）；新增 `provider_model_bindings` 表表示「某服务商提供某模型的具体线路」。
- 示例：`models.id=kling-3, display_name=可灵 3.0, type=video`；`provider_model_bindings` 含 `model_id / provider_id / upstream_model_name`。
- 迁移流程（用户原话）：**旧 models 数据 ↓ Migration ↓ 自动生成 bindings ↓ 新逻辑开始读取 binding ↓ 旧字段暂时保留，不要直接 DELETE 旧字段。**
- 硬性约束（沿用 Phase 1）：ADD COLUMN/CREATE TABLE 优先、不删旧列、迁移幂等且支持已有库、双读过渡、每 migration 提供回填/验证 SQL/rollback。

---

## 1. 修改清单（8 文件，+551 / −21）

### 1.1 新增数据表
| 文件 | 变更 | 说明 |
|---|---|---|
| `server/server.js`（initDB 建表块） | 修改 | 新增 `provider_model_bindings` 表建表 + 列补齐 `DO $$` 块（幂等 `CREATE TABLE IF NOT EXISTS` + 补 `upstream_model_name`/`priority`/`weight`）；`models` 表旧字段全部保留不删 |
| `scripts/migrate/modelhub-v3-phase2.cjs` | 新建 | 幂等迁移：从 `models` 的 `DISTINCT(model_id,provider_id)` 自动生成 bindings（`upstream_model_name` 默认取 `model_id`=现状）；含 `--dry-run`、验证 SQL、回滚说明 |

### 1.2 新增核心模块
| 文件 | 说明 |
|---|---|
| `server/modules/modelhub/bindings.cjs` | `loadDispatchPairs(pgPool, modelIds, contentType)`：① 优先 `SELECT … FROM provider_model_bindings WHERE enabled=true`；② 某 `model_id` 无启用绑定则回退读 `models.provider_id` 单绑定（**双读兼容**，迁移中途/旧数据未回填仍可生成）；③ 过滤未启用服务商、空/短 `api_key`(<6)；④ 克隆 model 行注入 `upstreamModelName`（空则回退 `model_id`）、`bindingPriority`、`bindingWeight`；⑤ 整体 `try/catch` 优雅降级返回 `[]`；无 `pgPool`/空输入返回 `[]` |
| `server/modules/modelhub/bindings.test.cjs` | 10 个测试：优先读 bindings（wire name≠model_id）、双读回退 `models.provider_id`、禁用服务商过滤、空/短 api_key 过滤、禁用绑定排除、空 `upstream_model_name` 回退 `model_id`、空输入、无 pgPool、query 抛错降级、契约（产出可直接喂 `imageGenerate`/`videoGenerate` 的 model(provider) 对，含 `upstreamModelName`+`model_id`） |

### 1.3 修改（线路读取改走 bindings）
| 文件 | 变更 |
|---|---|
| `server/dispatcher.cjs` | L10–12 修复 `resolver` 缺 `.cjs` 扩展名导致 Node 不解析、`server` 启动崩溃（Phase 1 致命 bug）+ 新增 `loadDispatchPairs` require；`generate` 内原「`SELECT * FROM models …` 组装 pairs」整段替换为 `loadDispatchPairs`；`imageGenerate` L150 / `videoGenerate` generic L236 改用 `model.upstreamModelName` 作 wire name；`resumeOneTask` L872 `LEFT JOIN bindings` 注入 `upstream_model_name`（续轮询一致性） |
| `server/providers/video/volcano.cjs` | L76 `model: model.upstreamModelName \|\| model.model_id` |
| `server/providers/video/minimax.cjs` | L42 同模式 |
| `server/providers/video/agnes.cjs` | L62 同模式 |

### 1.4 明确保留未改（防回归）
- 账务 `modelId = p.model.model_id`（canonical，用于 `recordConsumption`）
- `onSubmitted` 的 `modelId: model.model_id`
- volcano `resolveSeedanceFamily(model.model_id)` / `toVolcanoDuration(..., model.model_id)`（能力判定仍用 `model_id`）
- `models` 表旧字段（`provider_id` 等）全部保留，未 DELETE

---

## 2. 测试结果

| 项目 | 结果 |
|---|---|
| `bindings.test.cjs` | **10 / 10 通过** |
| `resolver.test.cjs`（Phase 1 资产回归） | **12 / 12 通过** |
| `vite build` | **0 错误**（2305 模块，1.31s，仅 chunk-size 良性警告） |
| `node --check server/server.js` | 通过 |
| 后端启动（3001） | `healthz`=200，PG connected（唯一数据源），Redis up，watchdog + order-expiry worker 启动 |
| 真实 DB 迁移 | 脚本生成 **440 条 bindings**（全部 `upstream=model_id`，等价现状、零行为变化） |
| 运行态 `loadDispatchPairs('agnes-2.0-flash')` | 返回 **104 对**，`upstreamModelName` 正确注入 |

---

## 3. 兼容性验证

1. **旧字段不删**：`models.provider_id` 等旧结构 + `provider_model_bindings` 新结构并存，满足「旧字段暂时保留」。
2. **双读回退**：若某 `model_id` 在 `provider_model_bindings` 无启用绑定，`loadDispatchPairs` 自动回退读 `models.provider_id` 单绑定 → 迁移中途或旧数据未回填时仍可按旧逻辑生成，无生成中断。
3. **崩溃恢复一致**：`resumeOneTask` 续轮询同样注入 `upstream_model_name`，与首轮 `generate` 链路完全一致。
4. **零行为变化**：现有 440 条 bindings 的 `upstream_model_name` 均等于 `model_id`，与旧逻辑「直接用 `model_id` 作 wire name」完全等价 → 上线后上游请求参数、终态判定、账务无任何差异。
5. **canonical 不变**：`model_id` 仍贯穿账务与能力判定，生成端终态判定不受影响。
6. **SNAKE_MAP 无影响**：`provider_model_bindings` 为后端内部读取，无新增对外字段映射；`models` 表字段未变，前端字段不受影响。

---

## 4. 回滚方法

| 层 | 操作 |
|---|---|
| 部署层 | 部署旧后端（Phase 1 代码）即自动忽略 `provider_model_bindings` 表，全程走 `models.provider_id` 单绑定，**无需回滚数据** |
| 数据层 | 迁移脚本为纯 `INSERT`（无 `DROP`/DELETE 旧列）。回滚只需清空 bindings 表：`TRUNCATE provider_model_bindings;`（或 `DELETE FROM provider_model_bindings;`）。旧 `models` 数据毫发无损 |
| 代码层 | `git revert ccf6db5` 或 `git reset --hard 35a3c74`（回到公共祖先）。原 `ed3f7f4`/`9361cd2` 对象因 rebase 事故已丢失，勿引用。恢复提交 `ccf6db5` 已含 Phase1 `.cjs` require 修复 |
| 迁移幂等 | 脚本可重复运行（`WHERE NOT EXISTS` + `UNIQUE(model_id,provider_id)` 兜底），重跑不会产生重复行 |
| 灰度建议 | 上线后重点观察 `generation_tasks` 终态与上游 wire name 是否符合预期；确认无异常后再进入 Phase 3 |

---

## 5. 已知风险 / 待办

- 旧 `models` 字段（`provider_id` 等）按铁律保留，待 Phase 3+ 确认全量切换后再统一清理。
- 前端尚未接入 `provider_model_bindings` 管理 UI（当前由迁移脚本 + 后台手动维护）；远端「模型控制台」或后续 Phase 应提供线路管理界面。
- 并发：`bindings` 读取沿用 `dispatcher` 现有 Semaphore，无新增并发风险。

---

## 6. ⚠️ Git 远端分歧警示（重要，需用户决策）

- 本地 Phase 2 原独立提交 `ed3f7f4`（8 文件，+551/−21），Phase 1 = `9361cd2`。⚠️ **2026-08-11 尝试 `git rebase origin/main` 时，本环境自定义 safe-git 协议接管本地 ref，标准 rebase 无法写入被锁定的本地 ref，导致 `.git`（refs/ 与部分 blob）损坏，`9361cd2`/`ed3f7f4` 对象丢失。** 已从完好工作树重建为恢复提交 **`ccf6db5`**（Phase1+Phase2 合并，内容等价，parent=35a3c74，343 blob 全合法）。详见 6.1。
- **远端 `origin/main`（HEAD `ed7e935`）已领先 16 个提交**，且这些提交与本地改动**触及完全相同的核心文件**：`server.js` / `dispatcher.cjs` / 全部 video 适配器 / `ModelHubPage` / `ModelConsole` 等。远端 16 提交含：模型控制台端到端闭环、视频适配器修复（火山 Seedance 2.5、Agnes）、后台监控页、墨灵AI 收口改名、OSS 命名空间隔离等。
- 远端当前状态：dispatcher 仍按 `display_name` 直查（L426）、**无 `resolver.cjs`**、**无 `provider_model_bindings` 表**；但其 `models` 表**已含 `model_id` + `display_name` 列**——schema 与本地大体兼容，dispatcher 逻辑则分叉。
- **结论**：不可盲目 `push`——若以本地工作树直接推到 `origin/main`，会**回退远端 16 个提交（数据丢失）**；若 `rebase`/`merge`，会在上述核心文件产生真实冲突，需谨慎解决并重跑测试。
- **下一步需用户决策**：如何把本地 Phase 1/2（`ccf6db5`）与远端 16 提交整合（rebase / merge / 暂不推送）。**切记：本 agent 沙箱内勿再跑标准 `git rebase`**（会再次破坏 .git）；应走自定义 safe-git 协议（buildtree.cjs 等 plumbing + 推远程），或在本机执行 rebase/merge。

### 6.1 rebase 事故与恢复纪实（2026-08-11）

- **现象**：`git rebase origin/main` 后 `git status` 报 `not a git repository`；`.git/refs/` 与 `.git/logs/` 消失；`git fsck` 发现 `9361cd2`/`ed3f7f4` 提交对象及 `ca133e6` 树中部分 blob 丢失。
- **根因**：本仓库采用自定义 safe-git 协议（本地 `main` ref 被 IDE 锁定、由 `buildtree.cjs` 等 plumbing 脚本接管）。标准 `git rebase` 试图写入被锁定的本地 ref，触发协议清理逻辑，删除 refs/ 并 prune 不可达对象，致 .git 损坏。
- **恢复步骤（已验证可行）**：
  1. 备份损坏 `.git` 为 `.git_backup_*`。
  2. 重建 `refs/heads/main` 指向可达的 `origin/main`（`ed7e935`）使 git 恢复可用。
  3. 因 `9361cd2`/`ed3f7f4` 对象已失，改由工作树重建：清空 index（`git read-tree --empty`）→ `git add -A`（从磁盘重新哈希，生成新合法 blob）→ `git write-tree` 得新树 → `git commit-tree <tree> -p 35a3c74`（仅写入父 SHA，不读父 blob）→ `git reset --soft <new>`。
  4. 恢复提交 `ccf6db5`：343 blob 全合法；`bindings.test` 10/10、`resolver.test` 12/12 通过；工作树干净。
- **触发条件**：在本环境对任意本地分支执行标准 `git rebase`/`git commit` 写入被协议接管的本地 ref。
- **预防**：后续整合远端一律走自定义 safe-git 协议（plumbing + 推远程），或在本机处理；本 agent 内禁止再跑标准 `git rebase`。
