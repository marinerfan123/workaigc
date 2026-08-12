# ModelHub 全链路调用链 + 状态传递 + 业务规则/技术实现分离分析

> 目标：打通「配置 → 持久化 → 生成消费」整条链路，逐文件追踪**函数调用关系**与**状态传递线路**，并在结尾清晰切分：
> - ① **业务规则（重构不可改动）**：决定平台正确性、账务安全、用户体验的硬约束
> - ② **旧技术实现（重构可替换）**：承载业务规则的手段，可换更现代/更稳的方案而不改语义

---

## 0. 一句话结论

ModelHub 不是孤立后台页面，而是**以 `providers` / `models` 两张 Postgres 表为唯一真相源、由「模块级单例 store + 同源 REST + 后端代理密钥 + 调度器 round-robin」串起来的配置中枢**。
前端只负责「展示 + 乐观修改」，后端负责「持久化 + 密钥隔离 + 生成时按 model_id 多服务商负载均衡」。重构只应替换②里的管道实现，不能动①里的规则语义。

---

## 1. 三条主调用链（逐跳函数名 + 文件）

### 链 A — 配置写入链（管理员保存服务商/模型）

```
ModelHubPage.tsx
  └─ setProviders(updater) / setModels(updater)            [src/hooks/useModelHub.ts:63/69]
       ├─ 1) 本地乐观更新模块变量 providersState/modelsState
       ├─ 2) apiSaveProviders(state) / apiSaveModels(state) [src/services/api.ts:104/123]
       │     └─ apiFetch('/api/providers'|'/api/models', {method:'POST'})
       │           └─ fetch → 同源后端
       └─ 3) notify() 唤醒所有 useSyncExternalStore 订阅者

后端 server.js：POST /api/providers  [server.js:2297]
  ├─ admin.requireAdmin(req)         // 鉴权，403 阻断
  ├─ BEGIN
  ├─ DELETE FROM models WHERE provider_id <> ALL(keepIds)   // 全量同步：删列表外孤儿
  ├─ DELETE FROM providers WHERE id <> ALL(keepIds)
  ├─ for each item:
  │    ├─ api_key 占位保护：含 '*' 或 <6 字符 → 沿用 DB 现有值 [server.js:2319]
  │    ├─ bucket_max 校验：B > bucket_max → ROLLBACK + 400
  │    └─ INSERT ... ON CONFLICT(id) DO UPDATE
  └─ COMMIT
```

**关键跨文件事实**：`useModelHub.setProviders` 永远传**完整列表**，因为后端是「全量同步删除列表外项」。这是链 A 的核心耦合点（见①规则 1）。

### 链 B — 生成消费链（用户生成 → 调度器选模型）

```
前端 GenerationBar.tsx:670
  └─ getDefaultModel(settings.contentType)   [useModelHub.ts:165]
       └─ 读模块变量 modelsState/providersState
            → 返回第一个 enabled && provider.enabled && providerId!='p0' 的同类型模型 displayName

用户点生成 → 后端 /api/generate（非 hub 路由，但读同一张 models 表）
  └─ dispatcher.generate(pgPool, opts)        [dispatcher.cjs:547]
       ├─ 按 display_name 找模型行（找不到再按 model_id 找）   [dispatcher.cjs:565-570]
       ├─ 取该 model_id 下「所有 enabled 模型行」              [dispatcher.cjs:576]
       ├─ JOIN providers → 组装 (model × provider) 对，过滤 enabled + 有效 api_key
       └─ dispatchOne(pairs, tier, input, contentType)         [dispatcher.cjs:527]
            ├─ RR_POINTER 轮询指针做 round-robin
            └─ attemptOnAccount → 真实调 provider（密钥只在后端）

并发/限流核心：
  attemptOnAccount [dispatcher.cjs:480-524]
    ├─ 生成端 success → 记 providerId/modelId/units（归因记账）
    ├─ 生成端 failed  → 立即终态，绝不再试下一个账号（防空转卡 running）
    ├─ 生成端 timeout → 任务保留待复核（绝不判失败、绝不释放积分）
    └─ 瞬时失败 → 切下一个账号（冗余容错）
```

**关键跨文件事实**：同一个 `model_id` 在 `models` 表里有 N 行（不同 `provider_id`），`dispatcher` 把它们当成「一个入口、N 个服务商」做负载均衡；前端 `groupModelsByModelId`（`src/utils/groupModels.ts`）与后端 `WHERE model_id=ANY(...)` 是**同一业务意图的两端实现**。

### 链 C — 初始化/兜底链（冷启动 + 无后端降级）

```
模块加载即执行 useModelHub.ts:48  initData()
  ├─ ensureApi()                                  [api.ts:41]
  │    └─ fetch('/api/token') → 拿 Bearer token（window.location 同源推导）
  ├─ Promise.all([apiGetProviders(), apiGetModels()])   [api.ts:101/120]
  │    └─ GET /api/providers | /api/models → 后端 SELECT * + mask apiKey('***')
  ├─ 后端为空 → 用 MOCK_PROVIDERS/MOCK_MODELS 写回后端（保证多端一致）
  └─ 后端不可用 → 仅内存 MOCK，不落盘
```

**关键跨文件事实**：`MOCK_PROVIDERS/MOCK_MODELS`（`src/data/models.ts`）既当「兜底数据」又当「首次种子」，是前端与后端都为空时的收敛点。

---

## 2. 状态传递线路图（状态在哪、怎么流）

```
                        ┌───────────────── 模块级单例（useModelHub.ts）─────────────────┐
                        │  providersState: IModelProvider[]                              │
                        │  modelsState:    IAiModel[]                                    │
                        │  listeners:      Set<()=>void>                                 │
                        │  initialized:    boolean（initData 只跑一次）                  │
                        └───────┬──────────────────────────────────┬───────────────────┘
              订阅（useSyncExternalStore）                          │ 非 hook 直接读
        ┌──────────────┬──────────────┬──────────────┐            │
  ModelHubPage   ProviderModelsPanel  GenerationBar   WorkspacePage/ImageEditorPage
  (providers,    (models,             (providers,     (getDefaultModel)
   models,        patchModel,          models,
   setProviders…) setModels)           getProviderName,
                                        getDefaultModel)
                                                                │
                                                  getModelDisplayNameByDisplayName   [useModelHub.ts:194]
                                                  getModelCreditCostByDisplayName     [useModelHub.ts:204]
                                                  → DetailPanel.tsx / ImageViewer.tsx（不订阅，按需读）
```

**状态流三条规则（已实现）**：
1. **写路径**：UI 调 `setProviders/setModels/patchModel` → 先改模块变量（乐观更新）→ `notify()` → 再 `api*` 落后端 → 失败回滚模块变量。
2. **读路径**：组件用 `useSyncExternalStore(subscribe, getSnapshot)` 拿快照，store 一变所有订阅者重渲染；不想要订阅的组件（DetailPanel/ImageViewer）直接用 `getModelDisplayNameByDisplayName` 等模块函数读当前值。
3. **密钥隔离态**：后端 GET 把 `apiKey` 掩成 `'***'`；前端 store 里存的就是 `'***'`，但 `setProviders` 保存时后端占位逻辑会把它还原成 DB 真值——**密钥从不在浏览器落真值**。

---

## 3. 文件依赖边清单（file → file，已核实）

**数据契约（被所有层共享）**
- `src/data/models.ts` → 导出 `IAiModel`/`IModelProvider`/类型/`MOCK_*`/`getEffectiveModelName`
  - 被：`useModelHub.ts`、`ModelHubPage.tsx`、`ProviderModelsPanel.tsx`、`groupModels.ts`、（间接）`server.js` 字段白名单

**前端状态层**
- `src/hooks/useModelHub.ts` → import `{...}` from `@/data/models`、import `api*` from `@/services/api`
  - 被：`ModelHubPage.tsx`、`ProviderModelsPanel.tsx`、`GenerationBar.tsx`、`WorkspacePage.tsx`、`ImageEditorPage.tsx`、`DetailPanel.tsx`、`ImageViewer.tsx`（后两个走非 hook 导出函数）

**前端 API 客户端（唯一出口）**
- `src/services/api.ts` → `ensureApi/apiFetch` 同源调用 `server.js` 的 `/api/providers|/api/models` 系列
  - 被：`useModelHub.ts`、`ModelHubPage.tsx`（还直接用 `apiSyncProviderModels/apiPreviewProviderModels/apiGetSettings` 等）

**前端页面/组件**
- `src/pages/ModelHubPage/ModelHubPage.tsx` → import `useModelHub`、`groupModelsByModelId`(`utils/groupModels`)、`ProviderModelsPanel`、`EndpointsTab`、`PairingTab`、`AddModelDialog`、`AsyncAddDialog`、`OssConfigPanel`、`ModelProtocolDrawer`
- `ProviderModelsPanel.tsx` → `useModelHub`（models/patchModel/setModels）
- `src/app.tsx:102` → `<Route path="model-hub" element={<RequireAdmin><ModelHubPage/></RequireAdmin>}>`
- `src/pages/WorkspacePage`、`ImageEditorPage`、`components/GenerationBar`、`components/DetailPanel`、`components/ImageViewer` → 消费 hub

**后端路由**
- `server.js` → `POST/GET/DELETE /api/providers`、`/api/models`、`PATCH /api/models/:id`、以及 `/sync|/test-endpoint|/test-default|/preview-models`（均为后端代理持密钥调用真实 provider，杜绝浏览器直连）
  - 依赖：`admin.requireAdmin`、`dispatcher.callEndpoint/getArrayByPath/getByPath`、`fromSnake/toSnake`（SNAKE_MAP）、`pg()`

**后端调度/消费**
- `server/dispatcher.cjs` → `generate()` 读 `models`/`providers` 表（按 model_id 聚合 + 按 provider 轮询）
- `server/shop.cjs` → `pickTextModel()` 读 `models JOIN providers`（市集推理文本模型选择）

**种子层（闭环回到同一张表）**
- `scripts/seed-model-hub.cjs` + `scripts/seed/model-hub.config.json`（43 个真实厂商模型）→ 幂等 upsert `providers`/`models`，正是 `server.js`/`shop.cjs`/`dispatcher.cjs` 运行时读取的同一批表

---

## 4. ① 业务规则（重构不可改动）

这些规则决定**平台正确性、账务安全、用户预期**，重构时只能保留语义，不能「顺手优化」掉：

1. **POST /api/providers 是全量同步删除**：提交列表外的 provider 及其 models 会被物理删除。因此前端必须始终提交完整列表（useModelHub 因此设计成「整表保存」）。改接口语义会丢数据。
2. **API Key 占位保护**：密钥含 `*` 或 <6 字符视为占位，沿用 DB 现有值，禁止覆盖真密钥。保护生产密钥不被误清。
3. **奖励余额强制校验（PATCH）**：仅当本次 patch 真正改动 `supportsRewardBalance`/`rewardCreditsRequired` 时，才要求「支持奖励 ⇒ rewardCreditsRequired > 0」；纯改价/改显隐不被误拦。规则意图是「开了奖励必须配积分」，不可弱化。
4. **前端模型库过滤语义**：`enabled && provider.enabled && providerId!=='p0'`（p0 为系统占位）。隐藏的模型任何前端入口都不应出现。
5. **积分语义**：`creditCost` 是「充值价」，所有模型都可用充值余额抵扣；`0` = 免费；`supportsRewardBalance=true` 时**赠送余额全局优先扣减**，不支持时回退充值余额。
6. **调度终态铁律**：成败**只听生成端终态**。`timeout`（超安全线）→ 任务保留待复核、**绝不判失败、绝不释放积分**；`failed`（provider 明确失败）→ 立即终态、**绝不再试下一个账号**（防止新建真实 provider 任务空转卡 running）。`success` 才归因记账。
7. **同一 model_id 多服务商负载均衡**：一个入口名对应 N 个 `provider_id` 行，调度按 round-robin 分摊 + 瞬时失败切下一个账号。这是「入口稳定、底层多供应商冗余」的核心体验。
8. **密钥永不在浏览器**：所有对真实 provider 的调用（sync/test/preview/生成）都经后端代理；浏览器只把 key 发给同源后端。前端任何「直连服务商」的改法都是安全事件。
9. **启用+有效密钥才可用**：`pickTextModel` 的 GUARD 与 dispatcher 的 pairs 过滤都要求 `p.enabled AND m.enabled AND api_key IS NOT NULL AND LENGTH(api_key)>=6`。禁用/无密钥的服务商不得参与生成。
10. **种子幂等**：`seed-model-hub.cjs` 重跑不得产生重复行（按 id upsert）。
11. **模型身份键**：以 `(model_id, provider_id)` 唯一标识一行；`display_name` 是**生成分发匹配键**；`mappingName` 只是对外展示名，**不影响分发**。

---

## 5. ② 旧技术实现（重构可替换，语义不变即可）

这些是实现手段，承载上面的规则但本身脆弱/陈旧，可整体替换：

| # | 旧实现 | 位置 | 可替换方案 | 替换时注意 |
|---|--------|------|-----------|-----------|
| 1 | 模块级单例 store + 手搓 `listeners` Set + `useSyncExternalStore` | `useModelHub.ts` | Zustand/Jotai/Redux 或 React Context | 不能丢「非 hook 直接读」能力（DetailPanel/ImageViewer 依赖 `getModelDisplayNameByDisplayName`），需保留等价同步读取 API |
| 2 | `ensureApi()` 靠 `window.location` 同源推导 + `/api/token` + 模块级 `discoverPromise` 缓存 | `api.ts:41` | 启动时统一注入 base/token（env 或引导接口） | 保留「后端不可用降级 MOCK」语义 |
| 3 | 手搓 `SNAKE_MAP`（`toSnake`/`fromSnake`）+ 原生 `pg` 裸 SQL 字符串 | `server.js` | Drizzle/Kysely/Prisma（自动字段映射 + 类型安全） | **新增列必须同步映射**这条铁律会变成「迁移文件」，更安全 |
| 4 | 中央 `if/else` 路由分发（按 `url + method` 匹配） | `server.js` | Express/Fastify 路由表 | 保持 `/api/providers|/api/models` 路径与 admin 中间件不变 |
| 5 | `readJSON/writeJSON` 无 PG 时的 JSON 兜底 | `server.js` | 直接删除（MEMORY 已定 PG 唯一真相源） | 删前确认所有环境都有 PG，否则是生产事故 |
| 6 | 进程内 token bucket + `RR_POINTER` + `markReject` 手写限流 | `dispatcher.cjs` | BullMQ 队列 / `rate-limiter-flexible` / Redis 限流 | **算法语义（round-robin、timeout 保留、failed 不重试）必须原样保留**；当前实现是单进程内存态，多实例不共享，换 Redis 才能横向扩展 |
| 7 | `MOCK_PROVIDERS/MOCK_MODELS` 既兜底又当首种子 | `models.ts` | 改为「首次启动由 seed 注入真实默认行」，前端不再内置大 MOCK | 保留「后端空时也能跑」的降级体验 |
| 8 | 手写 OSS/COS HMAC-SHA1 签名 | `server.js` | 官方 SDK（aliyun-oss-sdk / cos-nodejs-sdk-v5） | 签名语义（7 天过期预签名）不变 |
| 9 | 页面 `index.tsx` 用 `key={activeTab}` 重挂载实现「刷新回初始态」 | `index.tsx:18` | 路由 scrollRestoration / 显式状态管理 | 纯 UI hack，可安全替换 |
| 10 | `toast`(sonner) 错误/成功提示 | 各组件 | 任意 toast/notification 库 | 不影响业务 |

> 注：②里**第 6 项的算法意图属于①**，但**进程内内存态这个实现属于②**——重构时最容易踩的坑就是「为换成 Redis 限流而改了 round-robin 行为」，必须守住①规则 6/7。

---

## 6. 重构风险红线（一句话）

> **凡是动 `server.js` 的 `/api/providers|/api/models` 路由语义、dispatcher 的终态/负载均衡逻辑、或 apiKey 占位保护，都属触碰①，需视为生产事故级变更；其余②项可自由迭代，但替换后必须用回归测试覆盖①的全部 11 条规则。**

---

## 附：最小回归检查清单（验证①未被破坏）

- [ ] 保存部分 provider 列表 → 列表外 provider 被删（规则 1）
- [ ] 保存时 apiKey 填 `****` → DB 真密钥不变（规则 2）
- [ ] 开启 supportsRewardBalance 但不填积分 → PATCH 被拒（规则 3）
- [ ] 隐藏的模型不出现在 GenerationBar/WorkspacePage（规则 4）
- [ ] 支持奖励的模型生成时先扣赠送余额（规则 5）
- [ ] 生成端超时 → 任务 retained、积分不释放（规则 6）
- [ ] 同 model_id 多 provider → 多次生成命中不同 provider（规则 7）
- [ ] 浏览器 Network 中看不到真实 provider 域名/密钥（规则 8）
- [ ] 禁用/无密钥 provider 不参与生成（规则 9）
- [ ] seed 重跑无重复行（规则 10）
- [ ] 改名 mappingName 不影响实际分发（规则 11）
