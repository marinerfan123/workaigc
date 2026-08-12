# 03 · API 契约审计终稿 —— 墨灵 AI（图像/视频生成工作室）

> 审计性质：**只读源码审计**，未运行任何写入/变更命令，未修改 `E:\code` 下任何源码、配置、数据库。
> 审计基准：以源码为准，不采信既有文档。本稿所有结论均标注【证据等级】+ 置信度。
> 覆盖：`server/server.js` 中央 `handleAPI`（L1573–3607）+ `http.createServer` 入口（L3611–3635）、`server/modules/modelhub/*`（内部 resolver，无独立路由）、`server/{finance,shop,reference-styles,admin,me,payments}.cjs` 各模块 handler、`src/services/api.ts` 前端客户端。

---

## 0. 证据等级与置信度约定

| 标记 | 含义 |
|---|---|
| 【源码已证实】 | 直接对照源码可确认，结论确定 |
| 【运行时已证实】 | 需在运行实例验证（本次只读，未运行，故本章极少使用） |
| 【数据库已证实】 | 需查库确认（本次未查库，未使用） |
| 【测试已证实】 | 需测试覆盖确认（未使用） |
| 【文档记载但源码未证实】 | 文档/既有资料声称，但源码未找到对应实现 |
| 【推断】 | 基于代码逻辑推演，存在不确定性 |
| 【未知·待核验】 | 信息不足，需后续核验 |

置信度：**HIGH**（源码直证）/ **MEDIUM**（逻辑推演或存在分支）/ **LOW**（猜测）/ **UNKNOWN**。

---

## 1. 鉴权模型总览（理解全部端点的前提）

整个后端只有一个 HTTP 服务，所有 `/api/*` 请求经 `http.createServer`（L3611）统一分发：

1. `OPTIONS` 预检直接放行（L3619，CORS `Access-Control-Allow-Origin: *`）。
2. **`/api/token` 在 `handleAPI` 之前单独处理**（L3623），**无任何鉴权**，直接 `sendJSON(200, { token: API_TOKEN })`。
3. 其余 `/api/*` 进入 `handleAPI`（L1573），流程为：
   - **公开白名单**（网关前，L1592–1678）：注册/登录/刷新、公开套餐、支付方式、队列状态、支付 webhook、初始化向导、参考样式列表、市集商品、创作者主页等。
   - **`appGateway(req)` 全局鉴权门（L1681）**：不通过即 `401 {error:'Unauthorized'}`。
   - `appGateway`（L1274）逻辑：
     ```
     if (devTokenEnabled && Authorization === `Bearer ${API_TOKEN}`) { req.user = {id:'__system__', role:'system'}; return true; }
     const u = session.getUserFromCookie(req);
     if (u) { req.user = u; return true; }
     return false;
     ```

### ⚠ 鉴权模型的核心缺陷（贯穿全文）

- `devTokenEnabled = !isProduction || tokenFromEnv`（L31）。**非 production 环境下恒为 true**（本项目当前以 dev 模式运行，`NODE_ENV` 未设为 production）。
- 前端 `ensureApi()`（`src/services/api.ts:52-55`）**匿名** `GET /api/token` 拿到 token，并把它作为 `Authorization: Bearer <API_TOKEN>` 用于**所有后续请求**（`api.ts:20` 的 `headers()` 恒成立）。
- 由于 `appGateway` 中 **Bearer 分支先于 cookie 分支且命中即 `return true`**，因此在 dev 模式下**前端发出的每个请求都被解析为 `system` 角色，真实会话 cookie 被忽略**。
- 这导致：所有 `requireAdmin`（判定 `role==='admin' || 'system'`）的端点，对**任意浏览器访客（含未登录）实际全部可达**。整层 RBAC 在 dev 模式下形同虚设。
  - 证据：【源码已证实】HIGH —— `server.js:1276,1681`、`api.ts:20,52-55`、`server.js:31`。
  - 该缺陷**仅在 `devTokenEnabled===false`（即 production 且未显式给 `API_TOKEN` 环境变量）时不存在**；一旦生产环境通过 `API_TOKEN` 环境变量显式注入 dev token，`devTokenEnabled` 又变为 true，缺陷复现。

> 这意味着以下所有标注「管理员」的端点，在当前默认部署下**没有任何真实访问控制**，重构前务必修复该 token 信任链路。

---

## 2. 完整 API 端点清单

鉴权列取值：
- `公开`：网关前放行 / 显式公开，无需任何凭证
- `会话`：需 `appGateway` 通过（JWT cookie 或 Bearer system）
- `管理员`：需 `requireAdmin`（role=admin 或 system）
- `管理员*`：代码里判定为管理员，但受 §1 缺陷影响在 dev 下对任何人可达

> 注：`GET /api/providers`、`GET /api/models`、`GET /api/settings`、`GET /api/oss` 仅要求「会话」而非「管理员」，属越权暴露（见 §3.2）。

### 2.1 公开端点（无需登录）

| 方法 | 路径 | 用途 | 鉴权 | 关键请求 | 关键响应 | 错误返回 | 证据 |
|---|---|---|---|---|---|---|---|
| GET | `/api/healthz` | 健康检查（探针/压测） | 公开 | — | `{status:'ok',pg,redis,uptime,version,ts}` | — | 【源码已证实】HIGH L1580 |
| POST | `/api/auth/register` | 注册（赠积分） | 公开 | `{email,password,displayName}` | `{ok,user}` | 400/409/429 `{error}` | 【源码已证实】HIGH L1592 |
| POST | `/api/auth/login` | 登录 | 公开 | `{email,password}` | `{ok,user}` | 401/429 `{error}` | 【源码已证实】HIGH L1593 |
| POST | `/api/auth/refresh` | 刷新会话 | 公开 | cookie | `{ok}` | 401 | 【源码已证实】HIGH L1594 |
| GET | `/api/finance/topup-packages` | 公开充值套餐（弹窗预览） | 公开 | — | `{...packages}` | 503 | 【源码已证实】HIGH L1596→finance.handlePublic |
| GET | `/api/credits/payment-methods` | 公开支付方式列表 | 公开 | — | 支付方式并集 | — | 【源码已证实】HIGH L1598 |
| GET | `/api/generate/queue-status` | 等待区聚合状态 | 公开 | — | `{waitingAreaSize,allResourcesDown,threshold,triggered}` | — | 【源码已证实】HIGH L1601 |
| POST | `/api/credits/webhook/:provider` | 支付异步通知（真实入账） | 公开 | 平台回调体 | 由 payments 决定 | — | 【源码已证实】HIGH L1611-1614 |
| GET | `/api/setup/status` | 初始化向导状态 | 公开 | — | `{initialized,presetProviders,presetModels}` | — | 【源码已证实】HIGH L1617 |
| POST | `/api/setup/init` | 初始化（建首个管理员，fails-closed） | 公开 | `{adminEmail,adminPassword,provider,selectedModelIds}` | `{ok,initialized,...}` | 400/409/429/503 `{error,message}` | 【源码已证实】HIGH L1618 |
| GET | `/api/reference-styles` | 参考样式公开列表 | 公开 | `tag/q/promoted/limit/offset` | `{items,total}` | — | 【源码已证实】HIGH L1621 |
| GET | `/api/shop/products` | 市集商品列表 | 公开 | — | `{items}` | — | 【源码已证实】HIGH L1628 |
| GET | `/api/shop/products/:id` | 商品详情 | 公开 | — | 商品对象 | 404 `{error}` | 【源码已证实】HIGH L1628 |
| GET | `/api/skills` | 技能目录 | 公开 | — | `{items}` | — | 【源码已证实】HIGH L1628→shop |
| GET | `/api/users/:id` | 创作者公开主页 | 公开 | — | `{user,stats}` | 404 `{error}` | 【源码已证实】HIGH L1635 |
| GET | `/api/users/:id/media` | 创作者公开媒体 | 公开 | — | `{items}` | 500 `{error}` | 【源码已证实】HIGH L1635 |
| GET | `/api/token` | **返回全局 API_TOKEN** | 公开（无鉴权） | — | `{token: API_TOKEN}` | — | 【源码已证实】HIGH L3623（见 §3.1） |

### 2.2 会话端点（需登录；dev 下为 system）

| 方法 | 路径 | 用途 | 鉴权 | 关键请求 | 关键响应 | 错误返回 | 证据 |
|---|---|---|---|---|---|---|---|
| GET | `/api/auth/me` | 当前用户 | 会话 | cookie | `{user}` | 401 | 【源码已证实】HIGH L1684 |
| POST | `/api/auth/logout` | 登出 | 会话 | cookie | `{ok}` | — | 【源码已证实】HIGH L1685 |
| GET | `/api/me/summary` | 我的账务概览 | 会话 | — | 余额/累计 | 401/400 | 【源码已证实】HIGH me.cjs:92 |
| GET | `/api/me/transactions` | 我的积分流水 | 会话 | `limit/offset` | `{items,total}` | 401 | 【源码已证实】HIGH me.cjs:96 |
| GET | `/api/me/recharges` | 我的充值订单 | 会话 | — | `{items}` | 401 | 【源码已证实】HIGH me.cjs:99 |
| GET | `/api/media` | 媒体列表（owner 隔离） | 会话 | — | 数组(fromSnake) | 200/503 | 【源码已证实】HIGH L1939 |
| GET | `/api/media/counts` | 媒体计数 | 会话 | — | `{total,image,video,...}` | — | 【源码已证实】HIGH L1980 |
| POST | `/api/media` | 登记媒体（OSS 命名空间校验） | 会话 | 数组/对象 | `{ok,count}` | 400/403 | 【源码已证实】HIGH L2024 |
| DELETE | `/api/media/:id` | 删自己的媒体 | 会话 | — | `{ok,deleted}` | 200 | 【源码已证实】HIGH L2079 |
| PUT | `/api/media/:id` | 部分更新（字段白名单） | 会话 | `{...}` | `{ok}` | 400/401/403/404 | 【源码已证实】HIGH L2095 |
| GET | `/api/characters` | 角色库列表（全局共享） | 会话 | — | 数组 | 401 | 【源码已证实】HIGH L2160 |
| POST | `/api/characters` | 新建/upsert 角色 | 会话 | 数组/对象 | `{ok,count}` | 401 | 【源码已证实】HIGH L2170 |
| DELETE | `/api/characters/:id` | **删除角色（无 owner 校验）** | 会话 | — | `{ok}` | 401 | 【源码已证实】HIGH L2196（见 §3.3） |
| GET | `/api/characters/:id/stats` | 角色生成统计 | 会话 | — | `{totalGenerations,favorites}` | 401 | 【源码已证实】HIGH L2209 |
| GET | `/api/studio/projects` | 我的工作室项目 | 会话 | — | 数组 | 401 | 【源码已证实】HIGH L2228 |
| POST | `/api/studio/projects` | 创建项目 | 会话 | `{title,type,status,currentStage,...}` | `{ok,project}` | 401 | 【源码已证实】HIGH L2240 |
| GET | `/api/studio/projects/:id` | 项目详情（仅 owner） | 会话 | — | `{project}` | 401/404 | 【源码已证实】HIGH L2264 |
| PATCH | `/api/studio/projects/:id` | 更新（仅 owner） | 会话 | 子集字段 | `{ok,project}` | 401/404 | 【源码已证实】HIGH L2275 |
| DELETE | `/api/studio/projects/:id` | 删除（仅 owner） | 会话 | — | `{ok}` | 401 | 【源码已证实】HIGH L2309 |
| POST | `/api/generate` | 提交生成（异步/计费） | 会话 | `{model/modelId,prompt,idempotencyKey,...}` | `{status:'pending',taskId}` 或 sync 结果 | 400/401/402/429 | 【源码已证实】HIGH L2424 |
| POST | `/api/generate/cancel/:taskId` | 取消任务 | 会话 | — | `{ok,...}` | 400/401/403/404/409 | 【源码已证实】HIGH L2566 |
| GET | `/api/generate/status/:taskId` | 任务状态 | 会话 | — | 状态对象 | 200 | 【源码已证实】HIGH L2577 |
| GET | `/api/generate/active` | 在途任务列表 | 会话 | — | `{tasks}` | 401 | 【源码已证实】HIGH L2585 |
| GET | `/api/generate/stream` | SSE 实时通道 | 会话 | — | text/event-stream | 401 | 【源码已证实】HIGH L2595 |
| POST | `/api/agent/optimize-prompt` | 提示词优化 | 会话 | `{prompt,targetLang}` | `{success,positive,negative,...}` | 200(success:false) | 【源码已证实】HIGH L2617 |
| POST | `/api/agent/translate-prompt` | 提示词翻译 | 会话 | `{prompt,targetLang}` | `{success,text,...}` | 401/200 | 【源码已证实】HIGH L2793 |
| POST | `/api/feedback` | 用户反馈落库 | 会话 | `{content,type,...}` | `{ok,id}` | 400/401/500 | 【源码已证实】HIGH L1765 |
| POST | `/api/report` | 用户举报落库 | 会话 | `{content,type,...}` | `{ok,id}` | 400/401/500 | 【源码已证实】HIGH L1782 |
| GET | `/api/export/my-media` | 导出我的媒体 JSON | 会话 | — | `{ok,url,filename,count}` | 401/500 | 【源码已证实】HIGH L1799 |
| POST | `/api/proxy-fetch` | 代理下载图片（绕 CORS） | 会话 | `{imageUrl,headers}` | `{success,base64,contentType}` | 400/200 | 【源码已证实】HIGH L2320（见 §3.5） |
| POST | `/api/reference-styles` | 投稿参考样式（仅自己的 media） | 会话 | `{mediaId,name,...}` | `{id,status:'pending'}` | 400/401/403/404 | 【源码已证实】HIGH reference-styles.cjs:250 |
| DELETE | `/api/reference-styles/:id` | 删除样式（**有 owner 校验**✓） | 会话 | — | `{ok}` | 401/403/404 | 【源码已证实】HIGH reference-styles.cjs:255,139 |
| GET | `/api/skills/mine` | 我的技能 | 会话 | — | `{items}` | — | 【源码已证实】HIGH shop.cjs:330 |
| POST | `/api/skill/run` | 运行/试用技能 | 会话 | `{...}` | 结果 | 401 | 【源码已证实】HIGH shop.cjs:336 |
| POST | `/api/shop/products/:id/acquire` | 获取/安装商品 | 会话 | — | 结果 | 401 | 【源码已证实】HIGH shop.cjs:395 |
| POST | `/api/credits/orders` | 创建充值订单 | 会话 | `{method,amount,...}` | 订单 | 401 | 【源码已证实】HIGH payments.cjs:248,60 |
| GET | `/api/credits/orders` | 我的订单列表 | 会话 | — | `{items}` | 401 | 【源码已证实】HIGH payments.cjs:249 |
| GET | `/api/credits/orders/:id` | 订单详情 | 会话 | — | 订单 | 401 | 【源码已证实】HIGH payments.cjs:250 |

### 2.3 管理员端点（requireAdmin = admin｜system；dev 下对任何人可达）

| 方法 | 路径 | 用途 | 鉴权 | 关键响应/请求 | 错误返回 | 证据 |
|---|---|---|---|---|---|---|
| GET | `/api/providers` | 服务商列表（**仅会话，非管理员**） | 会话* | `apiKey` 掩码为 `***` | — | 【源码已证实】HIGH L2342（见 §3.2） |
| POST | `/api/providers` | 全量同步服务商+模型 | 管理员* | — | 403/400 | 【源码已证实】HIGH L2347 |
| GET | `/api/providers/states` | 账号冷热快照 | 管理员* | — | 403 | 【源码已证实】HIGH L2402 |
| POST | `/api/providers/:id/cooldown` | 手动强切冷热 | 管理员* | `{state,cooldownMs}` | 403/400 | 【源码已证实】HIGH L2407 |
| DELETE | `/api/providers/:id` | 删除服务商 | 管理员* | — | 403/400 | 【源码已证实】HIGH L2414 |
| POST | `/api/providers/:id/sync` | **同步模型列表（缺 admin 校验）** | 会话* | — | 200 | 【源码已证实】HIGH L2935（见 §3.4） |
| POST | `/api/providers/:id/test-endpoint` | **测试端点（缺 admin 校验）** | 会话* | `{endpoint,vars}` | 200 | 【源码已证实】HIGH L2966（见 §3.4） |
| POST | `/api/providers/:id/test-default` | **测试默认端点（缺 admin 校验）** | 会话* | `{testInput}` | 200 | 【源码已证实】HIGH L2983（见 §3.4） |
| GET | `/api/models` | 模型列表（**仅会话，非管理员**） | 会话* | 全部模型字段 | — | 【源码已证实】HIGH L3035（见 §3.2） |
| POST | `/api/models` | 批量 upsert 模型 | 管理员* | — | 403/400 | 【源码已证实】HIGH L3039 |
| PATCH | `/api/models/:id` | 单模型局部更新 | 管理员* | 字段白名单 | 403/400/404 | 【源码已证实】HIGH L3068 |
| DELETE | `/api/models/:id` | 删除模型 | 管理员* | — | 403/400 | 【源码已证实】HIGH L3138 |
| GET | `/api/settings` | 全局设置（**仅会话，非管理员**） | 会话* | settings.app | — | 【源码已证实】HIGH L3160（见 §3.2） |
| PUT | `/api/settings` | 合并写入设置 | 管理员* | 任意字段 | 403 | 【源码已证实】HIGH L3165 |
| GET | `/api/oss` | **OSS 总览（返回 accessKeySecret 明文，仅会话）** | 会话* | `accessKeyId/accessKeySecret` | — | 【源码已证实】HIGH L3329（见 §3.2/§3.6） |
| PUT | `/api/oss` | OSS 总开关 | 管理员* | `{enabled}` | 403 | 【源码已证实】HIGH L3354 |
| POST | `/api/oss/configs` | 新建 OSS 槽位 | 管理员* | 槽位字段 | 403 | 【源码已证实】HIGH L3423 |
| PUT | `/api/oss/configs/:id` | 更新槽位 | 管理员* | 槽位字段 | 403/200(ok:false) | 【源码已证实】HIGH L3370 |
| DELETE | `/api/oss/configs/:id` | 删除槽位 | 管理员* | — | 403 | 【源码已证实】HIGH L3410 |
| POST | `/api/oss/configs/:id/activate` | 设为 active | 管理员* | — | 403/200(ok:false) | 【源码已证实】HIGH L3445 |
| POST | `/api/oss/test` | 用前端传入凭据试连（仅会话） | 会话* | `{accessKeyId,accessKeySecret,bucket,...}` | 200(ok:false) | 【源码已证实】HIGH L3469（见 §3.5） |
| POST | `/api/oss/configs/:id/test` | 用存储凭据试连 | 管理员* | — | 403 | 【源码已证实】HIGH L3470 |
| POST | `/api/oss/sign-upload` | 预签名直传（锁 userId 前缀） | 会话* | `{fileName,contentType}` | 401/200(ok:false) | 【源码已证实】HIGH L3527 |
| GET | `/api/oss/logs/recent` | OSS 日志历史 | 管理员* | — | 403 | 【源码已证实】HIGH L3597 |
| GET | `/api/oss/logs/stream` | OSS 日志 SSE | 管理员* | — | 403 | 【源码已证实】HIGH L3602 |
| GET | `/api/admin/console/stream` | 总控台 SSE | 管理员* | — | 403 | 【源码已证实】HIGH L1701 |
| GET | `/api/admin/finance/overview` | 系统账务总览 | 管理员* | — | 403/503 | 【源码已证实】HIGH finance.cjs:404 |
| GET | `/api/admin/finance/recharges` | 充值订单 | 管理员* | — | 403 | 【源码已证实】HIGH finance.cjs:407 |
| GET | `/api/admin/finance/reconcile` | 对账 | 管理员* | — | 403 | 【源码已证实】HIGH finance.cjs:410 |
| GET | `/api/admin/finance/users/:id/ledger` | 用户账务明细 | 管理员* | — | 403/400 | 【源码已证实】HIGH finance.cjs:413 |
| GET/POST | `/api/admin/finance/topup-packages` | 套餐列表/创建 | 管理员* | — | 403/400 | 【源码已证实】HIGH finance.cjs:418,421 |
| PUT/DELETE | `/api/admin/finance/topup-packages/:id` | 套餐更新/删除 | 管理员* | — | 403/400 | 【源码已证实】HIGH finance.cjs:426 |
| GET/PUT | `/api/admin/finance/payment-settings` | 支付设置 | 管理员* | — | 403/400 | 【源码已证实】HIGH finance.cjs:438 |
| GET/POST | `/api/admin/finance/providers` | 支付服务商 | 管理员* | — | 403/400 | 【源码已证实】HIGH finance.cjs:446 |
| POST | `/api/admin/finance/providers/:id/toggle` | 支付商开关 | 管理员* | `{enabled}` | 403/400 | 【源码已证实】HIGH finance.cjs:454 |
| PUT/DELETE | `/api/admin/finance/providers/:id` | 支付商更新/删除 | 管理员* | — | 403/400 | 【源码已证实】HIGH finance.cjs:460 |
| GET/POST | `/api/admin/skills` | 技能后台 CRUD | 管理员* | — | 403 | 【源码已证实】HIGH shop.cjs:346,351 |
| PUT/DELETE | `/api/admin/skills/:id` | 技能更新/删除 | 管理员* | — | 403 | 【源码已证实】HIGH shop.cjs:362 |
| GET | `/api/admin/ledger/summary` | 双边账务看板汇总 | 管理员* | — | 403/500 | 【源码已证实】HIGH L1709 |
| GET | `/api/admin/ledger` | 消费台账 | 管理员* | `limit` | 403/500 | 【源码已证实】HIGH L1709 |
| GET | `/api/admin/reference-styles` | 样式审核列表 | 管理员* | — | 403 | 【源码已证实】HIGH reference-styles.cjs:263 |
| POST | `/api/admin/reference-styles/:id/review` | 审核（通过/拒绝） | 管理员* | `{decision,reason}` | 403/400/404 | 【源码已证实】HIGH reference-styles.cjs:267 |
| POST | `/api/admin/reference-styles/:id/promote` | 设置推行/分成 | 管理员* | `{isPromoted,commissionRate}` | 403/400 | 【源码已证实】HIGH reference-styles.cjs:272 |
| GET | `/api/admin/model-price-history` | 模型历史价 | 管理员* | `{modelId}` | 403/400 | 【源码已证实】HIGH L1739 |
| GET | `/api/admin/users` | 用户列表 | 管理员* | `q/role/limit/offset` | 403 | 【源码已证实】HIGH admin.cjs:597 |
| POST | `/api/admin/users/:id/credits` | 手动充值/扣减 | 管理员* | `{amount,note}` | 403 | 【源码已证实】HIGH admin.cjs:600 |
| POST | `/api/admin/users/:id/status` | 封禁/解封 | 管理员* | `{status}` | 403 | 【源码已证实】HIGH admin.cjs:606 |
| PUT | `/api/admin/users/:id/role` | 改角色 | 管理员* | `{role}` | 403 | 【源码已证实】HIGH admin.cjs:613 |
| DELETE | `/api/admin/users/:id` | 删除用户 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:620 |
| GET | `/api/admin/transactions` | 积分流水（全局） | 管理员* | `type/userId/limit/offset` | 403 | 【源码已证实】HIGH admin.cjs:626 |
| GET/POST | `/api/admin/agents` | 智能体 CRUD | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:629 |
| PUT | `/api/admin/agents/:key/toggle` | 智能体开关 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:634 |
| GET | `/api/admin/agents/:key/providers` | 智能体供应商 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:640 |
| GET/POST | `/api/admin/agent-providers` | 智能体供应商 CRUD | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:642 |
| GET/POST | `/api/admin/agent-rules` | 智能体规则 CRUD | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:647 |
| PUT | `/api/admin/agent-rules/:id/toggle` | 规则开关 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:652 |
| GET | `/api/admin/audit` | 审计日志 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:658 |
| GET/POST | `/api/admin/samples` | 公共示例素材 CRUD | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:669 |
| POST | `/api/admin/samples/push` | 推送示例给用户 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:677 |
| PUT/DELETE | `/api/admin/samples/:id` | 示例更新/删除 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:682 |
| GET | `/api/admin/generations` | 生成任务列表 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:695 |
| GET | `/api/admin/assets` | 资产统计 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:698 |
| GET | `/api/admin/issues` | 问题列表 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:701 |
| GET/DELETE | `/api/admin/errors` | 系统错误日志 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:708 |
| GET | `/api/admin/monitor/snapshot` | 监控快照 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:720 |
| GET | `/api/admin/monitor/stream` | 监控 SSE | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:723 |
| POST | `/api/admin/monitor/clear` | 清监控 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:726 |
| GET | `/api/admin/logs/snapshot` | 业务日志快照 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:734 |
| GET | `/api/admin/logs/stream` | 业务日志 SSE | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:737 |
| POST | `/api/admin/logs/clear` | 清业务日志 | 管理员* | — | 403 | 【源码已证实】HIGH admin.cjs:740 |

> 所有未命中上述路由的请求最终返回 `404 {error:'Not Found'}`（L3607）。

---

## 3. 重点安全标注

### 3.1 `/api/token` 公开返回 API_TOKEN —— 系统/管理员冒充（严重）

- **结论**：`/api/token`（`server.js:3623`）位于 `http.createServer` 入口、**在 `handleAPI` 与 `appGateway` 之前**单独处理，代码为：
  ```js
  if (req.url === '/api/token' && req.method === 'GET') return sendJSON(res, 200, { token: API_TOKEN });
  ```
  **没有任何鉴权判断**，任何人可匿名 `GET` 拿到全局 `API_TOKEN`。
- **冒充链路（确认）**：
  - `appGateway`（L1276）：当 `devTokenEnabled` 为真且请求头 `Authorization: Bearer <API_TOKEN>` 时，`req.user = {id:'__system__', role:'system'}` 并直接 `return true`。
  - `devTokenEnabled = !isProduction || tokenFromEnv`（L31）：**dev/非 production 恒为 true**，当前部署即为此状态。
  - 因此拿到 token 的攻击者构造 `Authorization: Bearer <API_TOKEN>` 即可**伪造成 system 角色**，绕过全部 `requireAdmin` 检查（admin 模块判定 `role==='admin' || 'system'`）。
- **二次放大（前端自动利用）**：前端 `ensureApi()`（`api.ts:52-55`）正是匿名拉取该 token 并作为 Bearer 用于所有请求，使 dev 模式下前端所有流量天然以 system 身份运行。
- **证据等级**：【源码已证实】HIGH（L3623、L1276、L31、api.ts:52-55）。
- **风险等级**：🔴 **严重 / CRITICAL**。
- **修复建议**：`/api/token` 不应公开返回全局 system token；system Bearer 信任链应移除或仅限服务端内部调用；前端鉴权应仅依赖会话 cookie，不应把 system token 下发浏览器。生产必须 `NODE_ENV=production` 且不得显式注入 `API_TOKEN` 环境变量（否则 `devTokenEnabled` 仍为真）。

### 3.2 多个「只读」端点仅需会话、暴露管理员级/敏感数据（高）

- **`GET /api/providers`（L2342）**：仅需登录，向任意登录用户返回全部服务商配置（`apiKey` 被掩码为 `***`，但 `base_url`、协议、容量、限流等内部结构全暴露）。
- **`GET /api/models`（L3035）**：仅需登录，返回全部模型（含 `credit_cost`、`capabilities`、`endpoint`、`param_template` 等内部字段）。
- **`GET /api/settings`（L3160）**：仅需登录，返回 `settings.app`（含 `signupBonusCredits`、`promptOptimizeModel`、`fallbackModel` 等后台配置）。
- **`GET /api/oss`（L3329–3351）**：仅需登录，**直接返回活跃 OSS 槽位的 `accessKeyId` 与 `accessKeySecret` 明文**（L3345-3346）。这是**凭据泄露**：任意登录用户（dev 下为任何人）可读取 OSS/AK 密钥，进而直接操作对象存储。
  - 证据：【源码已证实】HIGH（L3329、L3345-3346）。
  - 风险等级：🔴 **严重 / CRITICAL**（凭据泄露）。
- 证据等级：以上均【源码已证实】HIGH。
- 风险等级：🔴 高（组合 §1 缺陷在 dev 下全员可达）。
- 修复建议：这些只读端点应改为 `requireAdmin`；`/api/oss` 绝不可返回 `accessKeySecret`（应始终掩码或根本不下发）。

### 3.3 `DELETE /api/characters/:id` 缺 owner/角色校验（高，疑似 IDOR/越权删除）

- **结论**：`characters` 表为全局共享角色库（无 `user_id`，L2159 注释明确「全员共享的创作预设」），其删除端点（L2196-2207）：
  ```js
  if (url.startsWith('/api/characters/') && method === 'DELETE') {
    if (!realUser) return sendJSON(res, 401, { error: '未登录' });   // 仅校验登录
    const id = decodeURIComponent(url.split('/api/characters/')[1]);
    await pgPool.query('DELETE FROM characters WHERE id=$1', [id]);   // 无条件删除任意角色
    await pgPool.query('UPDATE media SET character_id=NULL WHERE character_id=$1', [id]);
  }
  ```
  **仅校验「已登录」，无任何 owner 或 admin 角色校验**。任意登录用户可删除全站任意角色（包括平台预置/管理员创建的角色）。
- 对比：同文件的 `DELETE /api/media/:id`（L2079）做了 `user_id=$2` owner 隔离；`reference-styles` 的 `remove`（reference-styles.cjs:139）做了 `user_id !== user.id && role!=='admin'` 校验。**characters 删除是明显的鉴权遗漏**。
- 是否 IDOR：因表无 `user_id`，经典 IDOR（改他人资源归属）不适用；但属于**未授权删除（Broken Access Control）**——任何登录用户可对全局资源执行破坏性删除。
- 证据等级：【源码已证实】HIGH（L2196-2207；对照 media/reference-styles 的同类型校验）。
- 风险等级：🟠 **高 / HIGH**。
- 修复建议：删除角色至少要求 `role==='admin'`（或显式 owner 概念）；并在删除前校验存在性，避免盲删。

### 3.4 `/api/providers/:id/sync` 等管理操作端点缺 admin 校验（高）

- **结论**：以下三个端点位于 `handleAPI` 内、全局 `appGateway`（仅登录）之后，但**未调用 `requireAdmin`**，也**未校验 `realUser`**：
  - `POST /api/providers/:id/sync`（L2935-2963）
  - `POST /api/providers/:id/test-endpoint`（L2966-2982）
  - `POST /api/providers/:id/test-default`（L2983-2999）
  - 三者仅做 `if (!pgPool) return ...`，随后直接用存储的 `api_key` 向服务商发起请求。
- 同文件相邻的 `POST /api/providers`（L2347）、`GET /api/providers/states`（L2402）、`/cooldown`（L2407）、`DELETE /api/providers/:id`（L2414）**均正确 `requireAdmin`**。因此 sync/test 是**不一致遗漏**，属于「管理端点却仅登录即可调用」。
- 影响：任何登录用户可对**任意**服务商触发模型同步/端点测试，泄露服务商模型清单，并可被滥用于探测/消耗服务商配额。
- 证据等级：【源码已证实】HIGH（L2935、L2966、L2983 均无 `requireAdmin`；对照 L2347 等）。
- 风险等级：🟠 **高 / HIGH**。
- 修复建议：为这三个端点补 `if (!admin.requireAdmin(req)) return 403`。

### 3.5 服务端代理类端点 SSRF 风险（中）

- **`POST /api/proxy-fetch`（L2320）**：登录后，服务端按 `body.imageUrl` 用 Node `fetch` 拉取任意 URL 并回传 `base64`。未做 URL 白名单/内网过滤，**存在 SSRF**（可探测内网/元数据端点）。虽需登录，但结合 §1 在 dev 下匿名可达。
- **`POST /api/oss/test`（L3469）**：登录后可用前端传入的 `accessKeyId/secret/bucket` 让服务端对 `https://{bucket}.{endpoint}/__probe_...` 发起 PUT。虽是「试连」语义，但服务端对外发请求且凭据由前端控，可被用于出站探测。
- 证据等级：【源码已证实】HIGH（请求转发逻辑确实存在）；SSRF 实际可利用性【推断】MEDIUM。
- 风险等级：🟡 **中 / MEDIUM**。
- 修复建议：对 `imageUrl` 做协议（仅 https/http）、域名/内网段黑名单、重定向限制；OSS 测试应仅用服务端已存凭据，不接受前端任意 AK。

### 3.6 其他需注意的越权/逻辑点（中/低，供重构参考）

- **`POST /api/setup/init`（L1618）fails-closed**：已有管理员即 `409`，设计正确；但创建首个管理员接口**完全公开**，若部署初期被抢建管理员则失控（建议部署后立即锁定或仅内网可达）。【源码已证实】HIGH，风险 🟡 中。
- **`/api/generate` 计费依赖 `realUser`**：L2435 `if (!realUser) return 401`。但 dev 下 `realUser` 来自 cookie，Bearer system 时不带 cookie → `realUser` 为 `null`，计费归属 `anon`，且 `actorId` 落到 `''`。属 dev 模式下的账务归属错乱，非直接安全漏洞。【推断】MEDIUM。
- **CORS 全开**：`Access-Control-Allow-Origin: *`（L3620、admin.cjs:283），配合匿名 `/api/token` 可被任意第三方站点脚本调用（CSRF/信息聚合）。【源码已证实】HIGH，风险 🟡 中。

---

## 4. SNAKE_MAP 白名单式 snake↔camel 转换的契约隐患

- **位置**：`server.js:830-874`，`SNAKE_MAP` + `fromSnake()`（DB→前端 camelCase）/ `toSnake()`（前端→DB snake_case）。
- **机制**：`fromSnake` 对对象每个 key 执行 `out[SNAKE_MAP[k] || k] = v`；`toSnake` 反向。即**只有列在 `SNAKE_MAP` 的 key 才会被转换**，未列出的 key 保持原样（snake_case）透传。
- **隐患（契约断裂）**：
  1. **新增 DB 列未同步进 `SNAKE_MAP`** → 该列从 DB 读出后 key 仍是 `snake_case`，而前端 TS 类型（`ICharacter`、`IMediaItem` 等）按 camelCase 取值 → 字段为 `undefined`，页面「假死」/静默丢失数据。这是**隐藏的强耦合契约**：DB schema 与 `SNAKE_MAP` 必须手动同步，无编译期保障。
  2. **`SNAKE_MAP` 存在重复键（复制粘贴漂移）**：`supports_reward_balance`/`reward_credits_required` 在 L834 与 L848 各出现一次；`display_name` 在 L832 与 L855 各出现一次。值虽相同（后覆盖前无害），但说明该表维护靠人工复制，极易在「新增一列」时只加一处或加错，放大第 1 点风险。
  3. **反向 `toSnake` 用运行期构造的 `rev` 映射**：`rev[value]=key`。若 `SNAKE_MAP` 有重复 value 或遗漏，前端 camelCase 字段写回 DB 时会落错列或丢失。
- **证据等级**：【源码已证实】HIGH（L830-874、L848 重复键）。
- **风险等级**：🟡 **中 / MEDIUM**（不直接导致安全事件，但会引发难查的数据「假死」，重构期高危）。
- **重构建议**：
  - 将 `SNAKE_MAP` 作为**唯一契约源**，DB 迁移脚本生成时校验每个 `snake_case` 列都在表中；
  - 或改为基于 `information_schema.columns` 动态构建映射，消除手工维护；
  - 前端对「期望字段为 undefined」增加告警/兜底，避免静默假死。

---

## 5. 前后端错误约定（重构期不可破坏的「隐藏契约」）

### 5.1 错误字符串格式

- 前端统一客户端 `apiFetch`（`src/services/api.ts:24-34`）：
  ```ts
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);   // 统一错误格式
  }
  ```
- 即**所有非 2xx 响应**在前端会被包成 JS Error，消息形如 `API <status>: <响应体前200字>`。
- 证据：【源码已证实】HIGH（api.ts:31）。

### 5.2 前端对「状态码 / 错误码 / 错误串」的多重匹配（隐藏契约）

前端不止看状态码，还解析响应体字段与错误串：

1. **HTTP 状态码匹配**：
   - `402` → 余额不足（`/api/generate` 在 `billing.resolvePayment` 抛 `NEED_RECHARGE` 时返回 402，L2479、L2491）。
   - `401/403/404/429/500` 在各处被用作语义分支。
2. **响应体 `code` 字段匹配**（`GenerationBar.tsx` 多处）：
   - `NEED_RECHARGE`（不支持赠送且充值不足）、`INSUFFICIENT`（双池皆不足）、`NO_REASONING_MODEL`（无推理模型）、`NO_LOGIN`。
   - 解析方式：`extractGenerateCode` 从错误串 JSON 中提取 `b.code`（`GenerationBar.tsx:166-170`）。
3. **错误串正则匹配**：
   - `GenerationBar.tsx:1127`：`/402|积分不足/.test(err)` 触发余额弹窗；L1193 同样用 `/402|积分不足/` 匹配 `errMsg`。
   - 即**响应体文本必须包含「积分不足」字样**，否则前端余额弹窗不触发。
4. **响应体 `error` 字段**：后端绝大多数错误返回 `{error:'...'}`（少数用 `{ok:false, error:'...'}` 如 feedback/report）。

### 5.3 不可破坏约束（重构等价基线）

- 必须保留的契约：
  - 余额不足场景返回 **HTTP 402** 且响应体含 **`积分不足`** 字样，并带 `code: 'NEED_RECHARGE' | 'INSUFFICIENT'`；
  - 无推理模型返回 `code: 'NO_REASONING_MODEL'`；
  - 统一错误串前缀格式 **`API <status>: `**（`api.ts:31` 依赖此格式做 slice/正则）；
  - 现有所有公开端点路径、方法、关键响应字段形状（尤其经 `fromSnake` 后的 camelCase 字段名）保持不变，否则前端静默失败。
- 证据等级：【源码已证实】HIGH（api.ts:31；GenerationBar.tsx:166-170,1127,1193；server.js:2479）。
- 风险等级：🟡 **中 / MEDIUM**（破坏任一即导致前端行为错乱，但非安全事件）。

---

## 6. 审计发现摘要（最关键风险 5 条）

1. 🔴 **`/api/token` 公开泄露全局 system token + 前端无条件携带 → dev 下整层 RBAC 失效**（§3.1、§1）。任何人均可以 `system` 身份调用全部 `/api/admin/*`。**最危急，必须优先修复 token 信任链与前端鉴权方式**。【源码已证实】HIGH。

2. 🔴 **`GET /api/oss` 仅需登录即明文返回 `accessKeySecret`**（§3.2）。OSS/AK 凭据泄露，攻击者可直控对象存储。**严重凭据泄露**。【源码已证实】HIGH。

3. 🟠 **`DELETE /api/characters/:id` 仅校验登录、无 owner/admin 校验**（§3.3）。任意登录用户可删除全站角色库任意角色，属未授权删除。对照 media/reference-styles 同类端点均有校验，此处明显遗漏。【源码已证实】HIGH。

4. 🟠 **`/api/providers/:id/sync`、`/test-endpoint`、`/test-default` 三个管理操作端点缺 `requireAdmin`**（§3.4）。仅登录即可对任意服务商发起同步/测试，泄露模型清单并可被滥用。与同文件其他 providers 端点鉴权不一致。【源码已证实】HIGH。

5. 🟡 **SNAKE_MAP 白名单式 snake↔camel 转换是隐藏强耦合契约**（§4）+ **前后端错误约定（402/`积分不足`/`code`/`API <status>:`）不可破坏**（§5）。二者非安全漏洞，但重构期若改动 DB 列未同步 `SNAKE_MAP` 或改动错误格式，将导致前端字段 `undefined` 假死、余额弹窗失效等难查故障。【源码已证实】HIGH。

> 附：次要风险（§3.5/§3.6）——`/api/proxy-fetch` 与 `/api/oss/test` 服务端代理 SSRF（中）、`/api/setup/init` 公开可建管理员（中）、CORS `*` 配合匿名 token 可被第三方站点调用（中）。建议在重构安全基线中一并处理。

---

*（本稿为只读审计产物，未对 `E:\code` 任何文件做写入/修改，所有端点与缺陷均以源码行号标注，便于复核。）*
