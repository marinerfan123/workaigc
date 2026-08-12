# 墨灵AI · ModelHub 模块架构与全文件关系研究

> 研究目标：不局限于单文件片段，串联 `ModelHub`（模型/服务商配置管理中心）在整个项目中的前后端、数据库、种子、生成分发的全链路依赖关系。  
> 研究日期：2026-08-11 ｜ 代码基：E:/code（墨灵AI / 原漫创 AI）



---

## 1. 一句话定位

**ModelHub 是「后端配好模型 → 前端自动显示 → 用户生成时真实执行」这条闭环的配置中枢。**  
它把"接入哪些服务商、每个服务商有哪些模型、模型如何计费/限流/显隐"全部数据化到 Postgres 的 `providers` / `models` 两张表，前端通过唯一 API 客户端读写，后端生成分发（`dispatcher`）与市集（`shop`）直接读这两张表做模型选择与推理。

---

## 2. 分层架构与文件依赖图

```
                         ┌─────────────────────────────────────────────┐
   【Seed 种子层】         │  model-hub.config.json  (43 个真实厂商模型目录) │
                         └───────────────┬─────────────────────────────┘
                                         │ read
                                         ▼
                         ┌─────────────────────────────────────────────┐
                         │  scripts/seed-model-hub.cjs  (幂等直写 DB)      │
                         └───────────────┬─────────────────────────────┘
                                         │ INSERT/ON CONFLICT
                                         ▼
   【DB 层】  Postgres: providers ──< FK provider_id >── models
                         ▲                                    │
                         │ SELECT/INSERT/UPDATE/DELETE        │ SELECT (生成时)
            ┌────────────┴──────────────────┐                 │
            │                                │                 │
   【后端路由层】              【后端消费端】│                 │
   server.js                dispatcher.cjs ◄┘   shop.cjs ◄─────┘
   /api/providers/*         (按 model_id 选    (pickTextModel
   /api/models/*            启用行 round-      选 type=text 模型
   /api/providers/states    robin 分发)        跑 prompt_optimize)
   /api/generate            │
            │ (HTTP JSON)    │
            ▼                │
   【前端 API 层】  services/api.ts
   (ensureApi + apiGetProviders/
    apiSaveProviders/apiDeleteProvider/
    apiGetModels/apiSaveModels/
    apiPatchModel/apiDeleteModel/
    apiSyncProviderModels/
    apiPreviewProviderModels/...)   │
            │ import                    │
            ▼                          │
   【前端状态层】  hooks/useModelHub.ts
   (模块级 store + useSyncExternalStore
    + 乐观更新 + 失败回滚)               │
            │ import                    │ import
            ▼                           ▼
   【前端数据契约】  data/models.ts   【前端聚合】  utils/groupModels.ts
   (IModelProvider/IAiModel/           (groupModelsByModelId
    MOCK_*/PROVIDER_TEMPLATES/           → GroupedModel)
    类型/默认值)
            │                           │
            └───────────┬───────────────┘
                        ▼
   【前端页面/组件层】
   pages/ModelHubPage/ModelHubPage.tsx  (总编排：providers/models/endpoints/pairing/storage 标签页)
   pages/ModelHubPage/ProviderModelsPanel.tsx (单服务商模型抽屉)
   pages/ModelHubPage/*.tsx (EndpointsTab/PairingTab/AsyncAddDialog/AddModelDialog)
   components/ModelProtocolDrawer, ModelParamTemplateEditor, OssConfigPanel
                        │
                        │ useModelHub + getModel* 非 hook 查询
                        ▼
   components/GenerationBar.tsx  (生成 UI 消费 hub：选默认模型/列模型)
   pages/WorkspacePage, ImageEditorPage, DetailPanel, ImageViewer (取展示名/积分)
```

---

## 3. 各层职责与关键文件

### 3.1 数据契约层 — `src/data/models.ts`

- **项目最中心的 hub 文件**，被几乎所有前端 hub 文件 + 后端（经 DB 列名）共享。
- 定义类型：`ModelType`(image/video/text)、`ProviderType`、`ProtocolType`、`Resolution`、`IModelParamRule`、`IModelParamTemplate`、`IEndpoint`、`IModelEndpoint`、`IModelCapabilities`、`IModelProvider`、`IAiModel`。
- 导出常量/函数：`PROVIDER_TEMPLATES`、`MOCK_PROVIDERS`、`MOCK_MODELS`、`ALL_RESOLUTIONS`、`getEffectiveModelName(m)`、`defaultEstimatedSeconds/ defaultCategory/ defaultCommercialUse`。
- 仅依赖 `./settings` 的 `VideoMode`。无 API、无副作用。
- `IAiModel` 的核心字段：`id / modelId / displayName / mappingName / type / category / providerId / enabled / supportedResolutions / capabilities(JSONB) / endpoint(JSONB) / paramTemplate(JSONB) / creditCost / supportsRewardBalance / rewardCreditsRequired / maxConcurrent / estimatedSeconds / commercialUse / creator`。

### 3.2 前端状态层 — `src/hooks/useModelHub.ts`

- **模块级单例 store**（非 React context），用 `useSyncExternalStore` 订阅 `providersState` / `modelsState`。
- 启动时 `initData()` 调 `ensureApi()` → `apiGetProviders/apiGetModels`；后端为空则用 `MOCK_PROVIDERS/MOCK_MODELS` 写回后端，保证多端一致；后端不可用则降级为纯内存 MOCK。
- 所有写操作**乐观更新本地 + 同步后端**，失败回滚原始状态：
  - `setProviders/setModels` → `apiSaveProviders/apiSaveModels`（全量 upsert）。
  - `deleteProvider(id)` → 先本地过滤（含级联过滤该 provider 的模型），并行 `apiDeleteProvider` + 全量 `apiSaveProviders` + `apiSaveModels` 兜底（即使 DELETE 失败也能靠保存过滤后的列表落地）。
  - `deleteModel / cleanupOrphanModels`（清 providerId 指向已删 provider 的孤儿）。
  - `patchModel(id, patch)` → 乐观改本地 + `apiPatchModel`（后端仅写变更列），失败回滚单条。
- 导出非 hook 查询 `getModelDisplayNameByDisplayName` / `getModelCreditCostByDisplayName`，供 `DetailPanel/ImageViewer` 等不订阅组件直接取"展示名/单次积分"，避免重复订阅。
- 依赖边：`→ @/data/models`、`→ @/services/api`。

### 3.3 前端 API 客户端 — `src/services/api.ts`

- 全局唯一 API 客户端，`ensureApi()` 自动发现后端并取 token，其余函数包 `apiFetch`。
- hub 相关函数：`apiGetProviders/apiSaveProviders/apiDeleteProvider/apiGetProviderStates/apiSetProviderCooldown`、`apiGetModels/apiSaveModels/apiDeleteModel/apiPatchModel/apiGetModelPriceHistory`、`apiSyncProviderModels(id)/apiPreviewProviderModels(cfg)/apiTestProviderEndpoint/apiTestProviderDefault`。
- 被 `useModelHub`、`ModelHubPage`、`AddModelDialog`、`EndpointsTab` 导入。

### 3.4 前端页面/组件层

- `pages/ModelHubPage/ModelHubPage.tsx`：**总编排者**，5 个标签页（providers / models / endpoints / pairing / storage）。导入 `useModelHub`、`groupModelsByModelId`、`PROVIDER_TEMPLATES/...`、`apiSyncProviderModels/apiPreviewProviderModels/...`、`@/data/media`、同目录子组件及 `ModelProtocolDrawer/OssConfigPanel`。被 `app.tsx` / `index.tsx` 路由注册（`/model-hub` 一类入口）。
- `pages/ModelHubPage/ProviderModelsPanel.tsx`：单服务商模型管理抽屉（显隐/批量价格/字段级编辑），仅经 `useModelHub` 写库，无直连 API。
- `components/GenerationBar.tsx`：生成 UI 消费方，`useModelHub()` 取 `providers/models/getProviderName/getDefaultModel`，`getDefaultModel(settings.contentType)` 定默认模型。
- 其它消费方：`WorkspacePage`、`ImageEditorPage`、`DetailPanel`、`ImageViewer` 用 `getModel*` 非 hook 函数取展示名/积分。

### 3.5 前端聚合 — `src/utils/groupModels.ts`

- `groupModelsByModelId(models)` 把扁平 model 行按 `model_id` 聚合成 `GroupedModel`：
  - 同一 `model_id` 在多家服务商多行 → 一个入口，背后关联 N 个 `providerId`（负载均衡语义，与后端 dispatcher 一致）。
  - 合并分辨率（去重）、积分（取 max）、双余额（任一支持即支持/奖励价取 max）、耗时/分类/创作者/商用（取首个有定义的行）。
- 被 `ModelHubPage`、`GenerationBar`、`Admin/ModelPricePage` 导入。

### 3.6 后端路由层 — `server/server.js`

全部 `/api/providers`、`/api/models` 路由（已逐行核对实现）：

| 方法+路径                                                    | 行为                                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/providers`                                     | 查 `providers` 表，`fromSnake` 后 `maskKey`（apiKey 显 `***`）                                                                                                         |
| `POST /api/providers`                                    | **全量同步**（admin）：事务内先删"列表外 models + 列表外 providers"，再 upsert；apiKey 含 `*` 或 <6 字符视为占位，**沿用 DB 现有密钥**（防误覆盖）；`bucket_units_per_min > bucket_max` 拒绝                 |
| `GET /api/providers/states`                              | 返回 `dispatcher.getAccountStates()`（账号冷热内存快照）                                                                                                                    |
| `POST /api/providers/:id/cooldown`                       | 手动强切账号冷热，持久化到 `rate_limits.manual_state` / `cooldown_ms`                                                                                                        |
| `DELETE /api/providers/:id`                              | 级联删该 provider 的 models                                                                                                                                          |
| `POST /api/providers/preview-models`                     | 后端代拉服务商 `/models`（防 Key 直连/CORS）                                                                                                                                |
| `POST /api/providers/:id/sync`                           | 后端代拉并写回模型                                                                                                                                                       |
| `POST /api/providers/:id/test-endpoint` / `test-default` | 代理调用验证                                                                                                                                                          |
| `GET /api/models`                                        | 查 `models` 表 `fromSnake`                                                                                                                                        |
| `POST /api/models`                                       | upsert（**外键容错**：provider_id 不存在则置 NULL 避免整批失败）；双余额/奖励价按规则解析；`commercial_use` 三态                                                                                 |
| `PATCH /api/models/:id`                                  | **字段白名单局部更新**（enabled/creditCost/mappingName/type/category/commercialUse/creator/paramTemplate…），价格变更归档 `model_price_history`；改奖励余额相关字段时强制校验"支持奖励余额必须填奖励积分(>0)" |
| `DELETE /api/models/:id`                                 | 删前归档最后价格到 `model_price_history`                                                                                                                                 |

- **SNAKE_MAP 一致性**：`server.js` 的 `SNAKE_MAP`（行 780-807）已含 hub 全部新列（`base_url/api_key/supported_types/display_name/model_id/provider_id/mapping_name/credit_cost/supports_reward_balance/reward_credits_required/estimated_seconds/commercial_use/capacity_model/bucket_max/cooldown_ms/supported_resolutions/param_template/rate_limits` 等）。`fromSnake/toSnake` 双向转换保证前端 camel 字段 ↔ DB snake 列不乱。**新增 DB 列必须同步 SNAKE_MAP，否则前端字段 undefined 假死**（项目铁律）。
- 依赖：`import dispatcher from './dispatcher.cjs'`、`import shopMod from './shop.cjs'`。

### 3.7 DB 表 Schema（`server.js` `initDB`）

- `providers`：`id, name, type, base_url, api_key, supported_types[], enabled, protocol, remark, default_endpoint(JSONB), max_concurrent, rate_limits(JSONB), capacity_model, bucket_max, cooldown_ms, created_at`。
- `models`：核心列含 `id, model_id, display_name, mapping_name, type, category, provider_id(FK→providers), enabled, supported_resolutions[], capabilities(JSONB), endpoint(JSONB), param_template(JSONB), credit_cost, supports_reward_balance, reward_credits_required, max_concurrent, estimated_seconds, commercial_use, creator(JSONB)`。
- `model_price_history`：价格变更归档（再添加时提醒沿用原价格）。
- `agent_providers`：shop 的"专属文本模型"绑定。
- 迁移：新列均 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，幂等；`mig_models_reward_v1` 回填 `reward_credits_required`。

### 3.8 种子层 — `scripts/seed-model-hub.cjs` + `scripts/seed/model-hub.config.json`

- `model-hub.config.json`：43 个真实厂商模型权威目录（image 14 / video 14 / text 15，verified 39 / unverified 4），每项为 `{ id, name, vendor, category, region, access, base_url, auth, openai_compatible, async, async_flow, streaming, default_params, pricing, verified, official_doc, notes }`。
- `seed-model-hub.cjs`：幂等（`ON CONFLICT(id) DO UPDATE`）。
  - 按 `vendor + base_url` 聚合生成 provider 行（api_key 留空，后台填）。
  - 每个模型 → 一行：`capabilities`(能力标志) / `endpoint`(接线：协议/同步异步/region/auth) / `param_template`(默认参数+可渲染选项，并把 pricing/official_doc/verified 塞进 `param_template.meta`) 三大 JSONB。
  - PG 连接参数与 `server.js` 完全一致（库 `huabu`）。直写 `providers`/`models` 表——正是 `server.js` 与 `shop.cjs` 读取的同一批表，从而闭合闭环。

### 3.9 消费端（生成分发链）

- **`dispatcher.cjs`**（行 20 起）：按 `model_id` 找所有"已启用模型行 × 已启用服务商"组合，round-robin 分发。
  - `SELECT * FROM models WHERE display_name=$1 AND enabled=true`（兼容按 `model_id` 回退查询）；
  - `SELECT * FROM models WHERE model_id=ANY($1) AND enabled=true` + `JOIN providers` 过滤 `pr.enabled`；
  - 提交后 `onSubmitted` 持久化 `provider_task_id/provider_key/providerId/model_id`（配合崩溃恢复续轮询）。
- **`shop.cjs`** 的 `pickTextModel(agentKey)`：`SELECT ... FROM models m JOIN providers p WHERE m.enabled AND p.enabled AND p.api_key IS NOT NULL`，三层优先级（①`settings.app.promptOptimizeModel` ②`agent_providers` ③最便宜 `type='text'`）；用于技能市集的 `prompt_optimize`/`text_gen` 推理。错误文案指向"请到模型 Hub 添加 type=text 模型"。
- **`/api/generate`**（`server.js` 行 2374）：查 `models` 的 `credit_cost/supports_reward_balance/reward_credits_required` 解析扣费池 → `billing` → `dispatcher.generate/generateAsync`。

---

## 4. 端到端数据流闭环（核心结论）

```
[配置]  seed-model-hub.cjs ──写──> providers/models 表
                                          │
        ModelHubPage（管理员）── PATCH/POST /api/models ──┐
                                          │                │
[读取]  GET /api/models ──> api.ts ──> useModelHub(store) ─┘
                                          │
        GenerationBar 用 getDefaultModel(contentType) 取默认模型
                                          │ (displayName 即 dispatch key)
                                          ▼
[执行]  POST /api/generate { model: displayName }
                                          │
        dispatcher: models WHERE display_name=$1 AND enabled ──> 选 provider 行
                                          │
        provider.api_key ──> 真实服务商调用 ──> 结果落 OSS / 回写任务
```

**关键点**：前端 `displayName` 即后端 `dispatcher` 的查询键（`WHERE display_name=$1`），而同一 `model_id` 的多行（多服务商）由 `groupModelsByModelId` + `dispatcher` 共同实现"一个入口、多服务商负载均衡"。

---

## 5. 关键设计决策与易踩的坑（已核实）

1. **全量同步会删孤儿**：`POST /api/providers` 是"全量 upsert + 删列表外项"。这意味着若前端只提交了部分 providers，其余会被整批删除（连带其 models）。`useModelHub` 的 `setProviders` 因此总是传完整列表；`deleteProvider` 也用"DELETE + 全量保存兜底"双保险。
2. **apiKey 占位保护**：`POST /api/providers` 中 apiKey 含 `*` 或长度 <6 视为占位，沿用 DB 现有值，避免前端把 `***` 误写回覆盖真实密钥。
3. **乐观更新 + 回滚**：所有编辑/删除先改本地 module store 再同步后端，失败回滚，防止"前端改了、后端没改、刷新又还原"。
4. **SNAKE_MAP 铁律**：前端 camel 与 DB snake 双向转换集中在一处。新增/改名 DB 列必须同步 `SNAKE_MAP`，否则前端字段 `undefined` 假死（这是项目反复踩的雷）。
5. **双余额（充值 + 奖励）**：`supportsRewardBalance` / `rewardCreditsRequired` 双列；PATCH 仅当真正改动奖励余额字段时才强制"支持奖励必须填奖励积分>0"，避免纯改价被误拦截。
6. **账号冷热状态**：`providers/states` + `cooldown` 是内存态（`dispatcher.getAccountStates/setManualState`），持久化到 `rate_limits.manual_state` / `cooldown_ms`，供管理面板展示与手动强切。
7. **种子与运行环境一致性**：seed 脚本 PG 连接参数必须与 `server.js` 一致，否则写入的表后端读不到。
8. **遗留图片 API 已弃用**：`services/imageGeneration.ts` 的 `generateImageViaProvider` 已基本被 `genericClient` 取代，仅错误文案仍引用"ModelHub 配置"作为排查提示。

---

## 6. 关键文件到文件依赖边（速查）

- `useModelHub.ts` → 导入 `@/data/models`、`@/services/api`；被 `ModelHubPage/ProviderModelsPanel/GenerationBar/WorkspacePage/ImageEditorPage/DetailPanel/ImageViewer` 导入。
- `ModelHubPage.tsx` → 导入 `useModelHub`、`@/utils/groupModels`、`@/data/models`、`@/services/api`、同目录 `EndpointsTab/PairingTab/AsyncAddDialog/AddModelDialog/ProviderModelsPanel`、`@/components/ModelProtocolDrawer/OssConfigPanel`；被 `app.tsx/index.tsx` 路由导入。
- `api.ts` 的 hub 函数 → 被 `useModelHub/ModelHubPage/AddModelDialog/EndpointsTab` 导入；后端实现全在 `server.js`。
- `groupModels.ts` → 导入 `@/data/models`；被 `ModelHubPage/GenerationBar/Admin/ModelPricePage` 导入。
- `server.js` → 导入 `dispatcher.cjs`、`shop.cjs`；定义全部 hub HTTP 路由，读写 `providers/models` 表（经 `SNAKE_MAP`）。
- `seed-model-hub.cjs` → 读 `model-hub.config.json`，直写 `providers/models` 表（与 `server.js`/`shop.cjs` 同表）。
- `dispatcher.cjs` / `shop.cjs` → 运行时 `SELECT` `providers/models` 表，是 hub 配置的真正消费端。
