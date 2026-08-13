# 06 · API 契约清单（重构对照基准）

> 来源：`src/services/api.ts` 全量实读（含泛型调用补扫）+ `server/server.js` 路由实读 + 模块核验报告（2026-08-11，基线 ca133e6/c98280a）。
> 用途：重构后新旧 API 逐条对照。🟥 = 契约语义不可改；🟩 = 实现可换。
> 鉴权凡例：**公开**=无需登录；**登录**=cookie 会话；**admin**=role∈{admin,system}。

---

## 1. 生成核心（🟥 最高优先）

| 端点 | 方法 | 鉴权 | 前端调用点 | 后端处理点 | 契约要点 |
|---|---|---|---|---|---|
| /api/generate | POST | 登录 | api.ts:442 apiGenerate | server.js:2374 | 限流 30/60s(429)→登录(401)→idempotencyKey 必需(400)→同键查重(running/done 返原 taskId；failed 释放重试)→resolvePayment(402 INSUFFICIENT/NEED_RECHARGE)→reserve→generateAsync。返 `{status:'pending', taskId}`；`body.sync=1` 走同步等价（A13） |
| /api/generate/cancel/:taskId | POST | 登录+owner | api.ts:495 apiCancelGeneration | server.js:2506→dispatcher.cancelTask:1216 | 终态码 200/404/403/409/500/503；done/failed/canceled→409；越权 403；释放 held+标 canceled+SSE |
| /api/generate/status/:taskId | GET | 登录 | api.ts:472 | server.js:2517→getTaskStatus:1012 | 轮询兜底用；字段形状=SSE payload |
| /api/generate/active | GET | 登录 | api.ts:530 apiListActiveGenerations | server.js:2525→listActiveTasks:1043 | 按 user_id 过滤；刷新恢复用；返 tasks[]{taskId,status,result,error,pendingIds,model,prompt,count,contentType,clientMeta,createdAt,completedAt} |
| /api/generate/queue-status | GET | 公开 | api.ts:515 apiGetQueueStatus | dispatcher.getWaitingAreaStatus:1179 | 仅聚合数：{waitingAreaSize,memberWaiting,allResourcesDown,threshold,triggered} |
| /api/generate/stream | GET(SSE) | 登录 | EventSource（useGenerationStream.ts） | server.js:2535→realtime.subscribe:30 | 按 userId 隔离；连接即 snapshotActive 回灌在途快照；data: JSON 形状对齐 getTaskStatus |
| /api/agent/optimize-prompt | POST | 登录 | api.ts:585 | server.js（agent 路由） | 402 code='NO_REASONING_MODEL' 语义前端依赖 |
| /api/agent/translate-prompt | POST | 登录 | api.ts:618 | 同上 | 纯翻译智能体 |

## 2. 媒体 / 角色 / Studio / 设置

| 端点 | 方法 | 鉴权 | 前端调用点 |
|---|---|---|---|
| /api/media · /api/media/counts | GET/POST · GET | 登录 | api.ts:70/73/97 |
| /api/media/:id | DELETE/PUT | 登录+owner | api.ts:76/83 |
| /api/characters · /api/characters/:id · /:id/stats | GET/POST · DELETE · GET | 登录 | api.ts:299/302/305/308 |
| /api/studio/projects · /:id | GET/POST · GET/PATCH/DELETE | 登录 | api.ts:316-339 |
| /api/settings | GET/PUT | 登录（PUT 限 admin 维度待核验） | api.ts:171/174 |
| /api/proxy-fetch | POST | 登录 | api.ts:160（跨域资源代理） |
| /api/export/my-media | GET | 登录 | api.ts:1154 |
| /api/feedback · /api/report | POST | 登录 | api.ts:1146/1150 |

## 3. ModelHub（🟥 全量同步语义）

| 端点 | 方法 | 鉴权 | 契约要点 |
|---|---|---|---|
| /api/providers | GET/POST | GET 登录 / POST admin | **POST 为全量同步**：删列表外 providers+models（server.js:2297 事务）；api_key 含 `*` 或 <6 字符→沿用 DB 现值（:2319）；B>bucket_max→400 回滚 |
| /api/providers/:id | DELETE | admin | api.ts:108 |
| /api/providers/:id/cooldown | POST | admin | manual_state 热改（api.ts:116） |
| /api/providers/:id/sync · /preview-models · /:id/test-endpoint · /:id/test-default | POST | admin | api.ts:630/645/658/669 |
| /api/models | GET/POST | GET 登录 / POST admin | 同全量同步语义（api.ts:121/124） |
| /api/models/:id | DELETE/PATCH | admin | api.ts:127/131 |
| /api/admin/model-price-history?modelId= | GET | admin | api.ts:144 |

## 4. OSS（🟥 零二进制 + 多槽位）

| 端点 | 方法 | 鉴权 | 契约要点 |
|---|---|---|---|
| /api/oss | GET/PUT | admin | 多槽位总览 + 总开关（api.ts:188/196） |
| /api/oss/configs · /:id · /:id/activate · /:id/test | POST · PUT/DELETE · POST · POST | admin | api.ts:201-226 |
| /api/oss/test | POST | admin | 未保存配置直连测试（api.ts:241） |
| /api/oss/sign-upload | POST | 登录 | 预签名直传（api.ts:265）；业务服务器零二进制 |

## 5. 认证 / 用户 / 我的

| 端点 | 方法 | 鉴权 | 契约要点 |
|---|---|---|---|
| /api/auth/register | POST | 公开（限流 5/60s/IP） | server.js:1306；注册赠送进 reward 池 + credit_transactions 留痕；触发 ensureUserDefaults 示例分发（admin 除外） |
| /api/auth/login · /logout · /me | POST·POST·GET | 公开/公开/登录 | api.ts:703/708/714；登录触发 ensureUserDefaults（role!=='admin'） |
| /api/auth/profile · /change-password | PUT · POST | 登录 | api.ts:722/727 |
| /api/users/:id · /:id/media | GET | 登录 | api.ts:732/737 |
| /api/me/summary · /me/transactions · /me/recharges | GET | 登录 | api.ts:967/976/982 |

## 6. 充值 / 支付（🟥 fail-closed）

| 端点 | 方法 | 鉴权 | 契约要点 |
|---|---|---|---|
| /api/credits/orders | POST/GET | 登录 | 下单：无 provider→503（fail-closed）；api.ts:757/764 |
| /api/credits/orders/:payOrderNo | GET | 登录 | 查单（api.ts:769） |
| /api/credits/payment-methods | GET | 登录 | api.ts:1091 |
| /api/credits/webhook/:type | POST | **provider 回调**（非前端） | 四道闸门 fails-closed；异常即拒，绝不静默成功 |
| /api/finance/topup-packages | GET | 公开 | finance.handlePublic（server.js:1546） |

## 7. 参考样式（🟥 分成真实转账，已核验）

| 端点 | 方法 | 鉴权 | 前端调用点 |
|---|---|---|---|
| /api/reference-styles | GET/POST | 登录 | api.ts:393/398；投稿仅本人 media；触发 AI 预审不阻塞 |
| /api/reference-styles/:id | DELETE | 本人或 admin | api.ts:403 |
| /api/admin/reference-styles | GET | admin | api.ts:413 |
| /api/admin/reference-styles/:id/review · /:id/promote | POST | admin | api.ts:418/424；approve 可设 isPromoted/commissionRate(0-100) |

## 8. 技能 / 市集（已核验：仅 handleShop 单出口）

| 端点 | 方法 | 鉴权 | 契约要点 |
|---|---|---|---|
| /api/skills · /api/shop/products · /api/shop/products/:id | GET | 公开 | shop.cjs:325/382/387；仅 enabled/published |
| /api/skills/mine | GET | 登录 | shop.cjs:330 |
| /api/skill/run | POST | 登录 | shop.cjs:336→runSkill:124；双池 reserve(赠送优先)→chat/completions 直连→commit/release；ref=`skill-run:{key}:{userId}:{idemKey}`；recordConsumption 埋点 |
| /api/shop/products/:id/acquire | POST | 登录 | shop.cjs:394→acquireProduct:227；已拥有幂等短路；price_cents>0→402 cash_required；price_credits 走 billing 三段式 ref=`acquire:{id}:{userId}` |
| /api/admin/skills · /:key | GET/POST · PUT/DELETE | admin | shop.cjs:346-379 |
| ⚠️ /api/cart · /api/orders · /api/products/ | * | — | server.js:1705 有前缀分发但 shop.cjs **无对应路由**（死分发，重构时可删） |

## 9. 管理后台（admin/finance/监控）

| 端点 | 方法 | 鉴权 | 契约要点 |
|---|---|---|---|
| /api/admin/users · /:id/credits · /:id/status · /:id/role · /:id | GET · POST · POST · PUT · DELETE | admin | admin.cjs handleAdmin:591；credits 只动 recharge 池+双写审计（recharge:45）；status/role/delete 禁自操作、**无审计**（已知缺口） |
| /api/admin/transactions · /admin/audit | GET | admin | admin.cjs:96/658 |
| /api/admin/agents · /:key/toggle · /agent-providers · /agent-rules · /:id/toggle | 多 | admin | admin.cjs:629-657 |
| /api/admin/samples · /:id · /push | 多 | admin | 示例库 CRUD+一键推送；幂等键 (user_id, default_key) |
| /api/admin/generations · /assets · /issues | GET | admin | admin.cjs:695-703 监控查询 |
| /api/admin/errors | GET/DELETE | admin | api.ts:1187/1197（依赖 syslog 注入） |
| /api/admin/console/stream | GET(SSE) | admin | admin.streamConsole:276；五事件 metrics/traffic/flow/log/agent；1s tick + 15s 心跳 |
| /api/admin/finance/overview · /recharges · /reconcile · /users/:id/ledger | GET | admin | finance.cjs handleFinance:398（server.js:1653 优先分发）；reconcile 快照对账（commit/grant/adjust 以 balance_after 权威，reserve/release 增减 sim，余额≠50 才告警） |
| /api/admin/finance/topup-packages · /:id | GET/POST · PUT/DELETE | admin | finance.cjs:195-250 |
| /api/admin/finance/payment-settings | GET/PUT | admin | 单行 id=1；限额钳制 ≥1 |
| /api/admin/finance/providers · /:id · /:id/toggle | 多 | admin | 密钥 AES-256-GCM 加密入库，API 只返 has_* 布尔；留空保留原值；全变更写 payment_audit |
| /api/admin/ledger/summary | GET | admin | server.js:1658-1660（盈亏看板，非 finance.cjs） |

---

## 10. SNAKE_MAP 全量（server.js:780-807，🟥 双向契约）

```
full_url→fullUrl · oss_url→ossUrl · oss_object_key→ossObjectKey · oss_uploaded→ossUploaded
avatar_url→avatar · reference_images→referenceImages · base_model→baseModel
is_favorite→isFavorite · is_deleted→isDeleted · created_at→createdAt · updated_at→updatedAt
base_url→baseUrl · api_key→apiKey · supported_types→supportedTypes · default_endpoint→defaultEndpoint
display_name→displayName · model_id→modelId · provider_id→providerId · mapping_name→mappingName
max_concurrent→maxConcurrent · rate_limits→rateLimits · credit_cost→creditCost
supports_reward_balance→supportsRewardBalance · reward_credits_required→rewardCreditsRequired
estimated_seconds→estimatedSeconds · commercial_use→commercialUse
capacity_model→capacityModel · bucket_max→bucketMax · cooldown_ms→cooldownMs
supported_resolutions→supportedResolutions · param_template→paramTemplate
access_point_name→accessPointName · endpoint_external→endpointExternal · endpoint_internal→endpointInternal
access_key_id→accessKeyId · access_key_secret→accessKeySecret · path_prefix→pathPrefix
custom_domain→customDomain · region_label→regionLabel
error_message→errorMessage · failed_at→failedAt · file_size→fileSize · character_id→characterId
is_default→isDefault · default_key→defaultKey · tags→tags
owner_id→ownerId · current_stage→currentStage · cover_url→coverUrl · target_url→targetUrl
reward_credits→rewardCredits · recharge_credits→rechargeCredits
preview_url→previewUrl · negative_prompt→negativePrompt · source_media_id→sourceMediaId
ai_reason→aiReason · reject_reason→rejectReason · reviewed_by→reviewedBy · reviewed_at→reviewedAt
user_display_name→userDisplayName · user_email→userEmail
is_promoted→isPromoted · commission_rate→commissionRate · reference_style_id→referenceStyleId
provider_type→providerType · app_id→appId · active_id→activeId
```

⚠️ **已核验瑕疵**：`supports_reward_balance`/`reward_credits_required`（L785 与 L798）、`display_name`（L785 与 L805）在对象字面量中**重复声明**（后者覆盖前者，映射值相同故无害，但重构换 ORM 时须去重）。

## 11. 错误码语义（🟥 前端依赖）

| HTTP | code/场景 | 前端行为 |
|---|---|---|
| 400 | 缺参/idempotencyKey 缺失 | 即时提示 |
| 401 | 未登录 | 弹登录窗 |
| 402 | code=INSUFFICIENT / NEED_RECHARGE / NO_REASONING_MODEL / cash_required | 弹充值窗 / 引导模型 Hub / 收银台提示；**绝不误判为生成失败** |
| 403 | 越权（非 owner / 非 admin） | 提示 |
| 409 | 取消终态任务 / 注册冲突 | 提示 |
| 429 | 限流（生成 30/60s、注册 5/60s） | Retry-After |
| 503 | 数据库不可用 / 支付无 provider（fail-closed） | 提示 |

> 下一步：07（如需）补 PG schema 快照；本清单与 04 文档 F1–F18 验收口径配套使用。
