# 注册登录 + 账务积分 + 生产部署 详细设计文档

> 状态：设计稿 v1（待评审）
> 目标：把当前「单共享令牌、无用户、积分仅展示」的应用，改造为「多用户认证 + 每用户积分账务 + 可生产部署（~100 并发）」

---

## 0. 设计原则

1. **零额外原生依赖**：密码哈希用 Node 内置 `crypto.scrypt`，JWT 用内置 `crypto` HMAC 签名，不引入 bcrypt/jsonwebtoken，避免 Windows/Linux 编译与版本坑。
2. **无状态认证**：JWT（access 2h + refresh 30d），PM2 多进程无需 sticky session。
3. **并发安全账务**：余额扣减用原子 SQL `UPDATE ... WHERE balance >= cost RETURNING`，避免 100 并发下的超扣。
4. **向后兼容**：保留旧全局 `API_TOKEN` 作为「超级管理员服务令牌」，认证中间件里作为 fallback，老内部调用不中断。
5. **可插拔支付**：微信/支付宝作为适配器接口，dev 模式可模拟回调跑通流程，真实收款需你提供商户号 + 公网 HTTPS 回调。

---

## 1. 数据表设计（PG，`server.js` 内 `CREATE TABLE IF NOT EXISTS` 自动建）

### 1.1 `users`
```sql
CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,                 -- uuid / nanoid
  email            TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,                    -- 格式: "salt:hash" (hex, scrypt)
  display_name     TEXT NOT NULL DEFAULT '',
  role             TEXT NOT NULL DEFAULT 'user',     -- 'user' | 'admin'
  credits_balance  INT  NOT NULL DEFAULT 20,         -- 新用户默认送 20（来自 settings.free_credits）
  status           TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'disabled'
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  last_login_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
```

### 1.2 `credit_transactions`（只追加流水账，对账基准）
```sql
CREATE TABLE IF NOT EXISTS credit_transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,        -- 'consume' | 'recharge' | 'grant' | 'refund' | 'adjust'
  amount        INT  NOT NULL,        -- 正=入账, 负=出账
  balance_after INT  NOT NULL,        -- 该笔后的余额快照（关键，天然对账）
  ref_type      TEXT DEFAULT '',      -- 'generation' | 'order' | 'admin'
  ref_id        TEXT DEFAULT '',
  remark        TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_user      ON credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_ref       ON credit_transactions(ref_type, ref_id);
```

### 1.3 `recharge_orders`（支付订单）
```sql
CREATE TABLE IF NOT EXISTS recharge_orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credits       INT  NOT NULL,                       -- 购买的积分数
  amount_cny    NUMERIC(10,2) DEFAULT 0,             -- 对应人民币（admin 充值可为 0）
  pay_channel   TEXT NOT NULL,                       -- 'wechat' | 'alipay' | 'admin'
  pay_status    TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'paid' | 'failed' | 'closed'
  pay_order_no  TEXT DEFAULT '',                     -- 第三方支付单号
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  paid_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON recharge_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_no   ON recharge_orders(pay_order_no);
```

### 1.4 `settings` 扩展
- `key='app'` 增加 `free_credits INT DEFAULT 20`（新用户赠送）、`credit_enabled BOOLEAN DEFAULT TRUE`。

---

## 2. 认证流程

### 2.1 注册 `POST /api/auth/register`
```
请求: { email, password, displayName }
校验: email 格式; password ≥ 8 位; displayName 1–32 字
处理:
  - 若 email 已存在 → 400 { error:'EMAIL_EXISTS' }
  - password_hash = scrypt(password, randomSalt16)
  - INSERT users(id, email, password_hash, display_name, credits_balance=free_credits, role='user')
  - 发 access+refresh JWT
响应: 200 { accessToken, refreshToken, user:{id,email,displayName,role,creditsBalance} }
```

### 2.2 登录 `POST /api/auth/login`
```
请求: { email, password }
校验: 邮箱密码格式
处理:
  - 查 users; 用户不存在 / status='disabled' → 401 { error:'INVALID_CREDENTIALS' }（不区分，防枚举）
  - scrypt 验证 timingSafeEqual → 失败 401
  - 更新 last_login_at
  - 限流: 同一 email/IP 15 分钟内失败 >5 次 → 429（Redis 计数器）
响应: 200 { accessToken, refreshToken, user }
```

### 2.3 刷新 `POST /api/auth/refresh`
```
请求: { refreshToken }
处理: 验签 + 类型='refresh' + 未进 Redis 黑名单 → 签发新 accessToken（可选轮换 refresh）
响应: 200 { accessToken }  | 401 { error:'REFRESH_INVALID' }
```

### 2.4 登出 `POST /api/auth/logout`
```
请求: Authorization: Bearer <accessToken>  + body { refreshToken }
处理: 把 refreshToken 的 jti 写入 Redis 黑名单（TTL = 剩余有效期）→ 实现服务端吊销
响应: 200 { ok:true }
```

### 2.5 当前用户 `GET /api/auth/me`
```
响应: 200 { user:{id,email,displayName,role,creditsBalance,status,createdAt,lastLoginAt} }
```

---

## 3. 后端 API 契约（全部经 JWT 中间件，除 `/api/auth/*`）

> 通用错误体: `{ error: 'CODE', message: '可读信息' }`
> 错误码: `UNAUTHORIZED`(401) / `FORBIDDEN`(403) / `INVALID_CREDENTIALS` / `EMAIL_EXISTS` /
> `INSUFFICIENT_CREDITS`(余额不足) / `NOT_FOUND` / `RATE_LIMITED`(429) / `VALIDATION`

### 3.1 认证（无需登录）
| Method | Path | Body | 说明 |
|---|---|---|---|
| POST | `/api/auth/register` | {email,password,displayName} | 注册+送免费额度 |
| POST | `/api/auth/login` | {email,password} | 登录（限流） |
| POST | `/api/auth/refresh` | {refreshToken} | 换 access |
| POST | `/api/auth/logout` | {refreshToken} | 吊销 refresh |
| GET  | `/api/auth/me` | — | 当前用户 |

### 3.2 用户侧账务
| Method | Path | Body / Query | 权限 | 说明 |
|---|---|---|---|---|
| GET | `/api/credits/transactions` | `?page=&pageSize=&type=` | user | 本人流水（分页） |
| POST | `/api/credits/orders` | {credits, payChannel} | user | 创建充值订单 → 返回支付参数 |
| POST | `/api/credits/orders/callback/:channel` | 第三方回调体 | 公开(验签) | 支付成功→到账 |

### 3.3 管理侧（role='admin'）
| Method | Path | Body / Query | 说明 |
|---|---|---|---|
| GET | `/api/admin/users` | `?q=&status=&page=` | 用户列表+搜索 |
| GET | `/api/admin/users/:id` | — | 用户详情+余额 |
| POST | `/api/admin/users/:id/credits` | {delta, remark} | 手动充值(delta>0)/扣减(delta<0)，写 `grant`/`adjust` 流水 |
| GET | `/api/admin/transactions` | `?userId=&type=&page=` | 全站流水 |
| GET | `/api/admin/stats` | `?range=7d` | 仪表盘：注册数/活跃/今日生成/今日消耗/余额总量 |

### 3.4 改造现有接口
- `POST /api/generate`：解析 JWT → `userId`；**生成前**原子校验并预扣：
  ```sql
  UPDATE users SET credits_balance = credits_balance - $cost
  WHERE id=$uid AND credits_balance >= $cost RETURNING credits_balance;
  ```
  无行返回 → `INSUFFICIENT_CREDITS`（不生成）。
  生成**成功** → 写 `credit_transactions` type='consume', amount=-cost, balance_after=当前。
  生成**失败** → 回退：`UPDATE users SET credits_balance = credits_balance + $cost` + 写 `refund` 流水。
- 现有所有 `/api/*`（media / providers / models / optimize-prompt 等）统一加 `requireAuth` 中间件；旧 `API_TOKEN` 作为 admin 服务令牌 fallback 保留。

---

## 4. 积分流转时序

### 4.1 生成扣减（核心账务）
```
前端点生成 → POST /api/generate {prompt, model, referenceImages}
  server: 取 creditCost(来自 models.credit_cost)
          原子预扣 UPDATE users ... WHERE balance>=cost
          若失败 → 401 INSUFFICIENT_CREDITS（前端弹「余额不足，去充值」）
          成功 → 入队 dispatcher.generateAsync(taskId, userId)
  dispatcher 完成:
          成功 → INSERT credit_transactions(consume, -cost, balance_after)
          失败 → 回退余额 + INSERT credit_transactions(refund, +cost)
  前端轮询 status → 成功后刷新用户余额徽章
```

### 4.2 充值订单 + 支付回调
```
POST /api/credits/orders {credits, payChannel='wechat'}
  → INSERT recharge_orders(pending) + 调 PaymentAdapter.createOrder()
  → 返回 { orderId, payParams }（微信 code_url / 支付宝 orderStr）
用户扫码支付 → 第三方异步回调 /api/credits/orders/callback/wechat
  → 验签(Adapter.verifyCallback) → 幂等检查 pay_status
  → UPDATE order SET paid + UPDATE users SET balance += credits
  → INSERT credit_transactions(recharge, +credits, balance_after, ref=order)
DEV 模式: 提供「模拟支付成功」按钮直接触发回调逻辑（无需真实商户号即可联调）
```

---

## 5. 前端改造

### 5.1 认证层（替换 ApiTokenContext）
新建 `src/contexts/AuthContext.tsx`：
```ts
interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  status: 'idle' | 'loading' | 'authed' | 'anon';
  login(email, password): Promise<void>;
  register(email, password, displayName): Promise<void>;
  logout(): Promise<void>;
  refreshBalance(): Promise<void>;   // 生成后刷新积分
}
```
- token/refresh 存 `localStorage`（key: `auth_access` / `auth_refresh`）。
- `apiFetch` 改造：自动带 `Authorization: Bearer <access>`；遇 401 调 `/api/auth/refresh` 一次并重试；refresh 失败 → 清空并跳转 `/login`。
- 向后兼容：旧 `ApiTokenContext` 保留导出但内部指向 AuthContext，避免其他文件大面积改动（后续清理）。

### 5.2 路由与守卫（`src/app.tsx`）
```
<Routes>
  <Route path="/login"  element={<LoginPage/>} />
  <Route path="/register" element={<RegisterPage/>} />
  <Route element={<RequireAuth><Layout/></RequireAuth>}>
      ... 现有 library/characters/model-hub/edit/workspace ...
      <Route path="/admin/*" element={<RequireAdmin><AdminLayout/></RequireAdmin>}>
          users | transactions | dashboard
      </Route>
  </Route>
</Routes>
```
- `RequireAuth`：无 token → `<Navigate to="/login"/>`；token 过期无法 refresh → 同。
- `RequireAdmin`：`user.role !== 'admin'` → 404/无权限提示。

### 5.3 顶栏用户菜单（Layout 内）
- 右侧：头像(首字母) + 昵称 + **积分徽章**（`{balance} 积分`，生成后实时刷新）。
- 下拉：个人中心 / 充值中心 / 登出。

### 5.4 GenerationBar 改动
- 显示当前 `user.creditsBalance`；生成按钮：余额 < creditCost 时禁用 + 提示「积分不足，去充值」。
- 生成成功后 `refreshBalance()` 更新徽章。

### 5.5 Admin 模块页面
| 页面 | 内容 |
|---|---|
| `AdminUsersPage` | 表格：邮箱/昵称/角色/余额/状态/注册时间；搜索框；行操作：手动充值弹窗(delta+remark)、启用/禁用 |
| `AdminTransactionsPage` | 流水表：用户/类型/增减/结余/来源/时间；筛选(type, userId) + 分页 |
| `AdminDashboardPage` | 统计卡：今日注册/活跃用户/今日生成数/今日消耗积分/总余额；近 7 日趋势（轻量柱状，纯 CSS/SVG，不引图表库） |

---

## 6. 页面原型（布局描述）

### 6.1 Login / Register（共用一套外壳）
```
┌───────────────────────────────────────────┐
│            [Logo] AI Image Studio          │
│                                             │
│   ┌─────────────────────────────────────┐  │
│   │  邮箱        [__________________]    │  │
│   │  密码        [__________________]    │  │
│   │  (昵称 仅注册) [______________]      │  │
│   │                                      │  │
│   │   [   登录 / 注册  ]  (emerald 主按钮)│  │
│   │   错误提示（红，INVALID_CREDENTIALS） │  │
│   └─────────────────────────────────────┘  │
│   切换：已有账号？去登录 / 还没有？注册     │
│   [🌗 主题切换]                            │
└───────────────────────────────────────────┘
```
沿用现有深色玻璃拟态 + 主题切换，与 Workspace 视觉一致。

### 6.2 Admin Dashboard
```
┌──────────────────────────────────────────────┐
│ 运营看板                          [近7日 ▼]    │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │
│ │今日注册 │ │活跃用户 │ │今日生成 │ │今日消耗 │  │
│ │   12    │ │   47   │ │  230   │ │ 1840积分│  │
│ └────────┘ └────────┘ └────────┘ └────────┘  │
│  近7日生成趋势（SVG 柱状，无第三方库）         │
│  [用户管理] [消费流水] 入口                    │
└──────────────────────────────────────────────┘
```

---

## 7. 安全设计

| 项 | 方案 |
|---|---|
| 密码哈希 | `crypto.scrypt(password, salt16, 64)`，`salt:hash` 存储；验证用 `timingSafeEqual` |
| JWT | HS256，secret 取自 `JWT_SECRET`（生产必填，缺失则启动告警）；access 2h / refresh 30d；payload 含 `jti` 用于黑名单 |
| 传输 | 全站 HTTPS（nginx 终止 TLS，HSTS） |
| 限流 | 登录/注册：Redis 计数 15min/5 次；生成：每用户并发上限（复用现有 max_threads）+ 额度闸门 |
| 防枚举 | 登录统一返回 `INVALID_CREDENTIALS`，不区分邮箱是否存在 |
| 安全头 | 手动中间件加 `X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Content-Security-Policy`（限同源） |
| 越权 | 所有写操作服务端二次校验 `req.user.id` / `role` |
| 密钥 | `.env` 不入库；`JWT_SECRET` / 支付密钥走环境变量 |

---

## 8. 部署规格（Phase 3）

### 8.1 PostgreSQL
- 连接池 `pg.Pool`：`max: 25`（现 max:10），`idleTimeoutMillis: 30000`，`connectionTimeoutMillis: 5000`。
- 已存在 PG17（huabu 库），无需新建实例。

### 8.2 Node（PM2 集群）
`ecosystem.config.js`：
```js
module.exports = {
  apps: [{
    name: 'ai-image-studio',
    script: 'server/server.js',
    instances: 'max',        // = CPU 核数，多进程无状态(JWT)无需 sticky
    exec_mode: 'cluster',
    env: { NODE_ENV: 'production', PORT: 3001 },
    max_memory_restart: '512M'
  }]
};
```
- 启动：`pm2 start ecosystem.config.js && pm2 save`（开机：`pm2 startup`）。

### 8.3 Nginx（TLS + 限流 + 静态）
```
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
server {
  listen 443 ssl; server_name your.domain;
  ssl_certificate     /etc/letsencrypt/live/your.domain/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your.domain/privkey.pem;
  client_max_body_size 50m;                     # 上传媒体
  location /api/auth/login  { limit_req zone=login burst=5 nodelay; proxy_pass http://127.0.0.1:3001; }
  location /api/           { proxy_pass http://127.0.0.1:3001; proxy_set_header X-Forwarded-For $remote_addr; }
  location /              { root /path/dist/build2; try_files $uri /index.html; }
  gzip on;
}
```

### 8.4 环境变量（`.env.example`）
```
PG_HOST PG_PORT PG_DATABASE PG_USER PG_PASSWORD
REDIS_HOST REDIS_PORT REDIS_PASSWORD
JWT_SECRET                  # 生产必填，>=32 位随机
PORT=3001
FREE_CREDITS=20
FRONTEND_URL=https://your.domain
PAY_WECHAT_MCHID= PAY_WECHAT_APIKEY= PAY_WECHAT_CERT=
PAY_ALIPAY_APPID= PAY_ALIPAY_PRIVATE_KEY= PAY_ALIPAY_PUBLIC_KEY=
PAY_DEV_MODE=true           # true=模拟支付回调，无需真实商户号联调
NODE_ENV=production
```

---

## 9. 分阶段任务清单

### Phase 1 — 核心（多用户 + 账务可用）✅ 建议先开工
- [ ] `users` / `credit_transactions` / `recharge_orders` 建表 + 索引
- [ ] 密码哈希工具（`lib/crypto.js`：scrypt hash/verify）
- [ ] JWT 工具（`lib/jwt.js`：sign/verify HS256，access/refresh）
- [ ] Redis 客户端初始化（`server.js`，失败降级为内存 Map）
- [ ] 认证中间件 `requireAuth` + admin fallback（`API_TOKEN`）
- [ ] `POST /api/auth/register|login|refresh|logout`、`GET /api/auth/me`
- [ ] 登录限流（Redis）
- [ ] `POST /api/generate` 接 JWT + 原子预扣 + 成功扣减/失败回退
- [ ] `GET /api/credits/transactions`（本人）
- [ ] `POST /api/admin/users/:id/credits`（手动充值/扣减）
- [ ] 前端 AuthContext + apiFetch 改造 + 路由守卫
- [ ] Login / Register 页面
- [ ] 顶栏用户菜单 + 积分徽章 + GenerationBar 余额闸门
- [ ] 构建验证 + 本地 3001/5173 实测

### Phase 2 — 账务闭环 + 仪表盘
- [ ] `AdminUsersPage`（列表/搜索/启用禁用）
- [ ] `AdminTransactionsPage`（流水筛选/分页）
- [ ] `AdminDashboardPage`（统计卡 + 7 日趋势）
- [ ] `GET /api/admin/users|transactions|stats`
- [ ] `POST /api/credits/orders` + 支付适配器接口
- [ ] 微信/支付宝适配器（签名 + 回调验签，DEV 模拟）
- [ ] 充值中心前端页面（下单 + 扫码 + 模拟支付）

### Phase 3 — 生产部署
- [ ] `ecosystem.config.js`（PM2 集群）
- [ ] `nginx.conf`（TLS + 限流 + 静态）
- [ ] PG 连接池调优（max:25）
- [ ] `.env.example` + README 部署章节
- [ ] 安全头中间件
- [ ] 灰度验证：100 并发压测（生成接口）

---

## 10. 风险与待确认
1. **真实支付**：微信/支付宝需你提供商户号、API 密钥、应用证书 + 公网 HTTPS 回调域名；Phase 2 先用 `PAY_DEV_MODE=true` 模拟联调。
2. **现有数据归属**：目前 91 条 media 是无主（source=user 但无 user_id）。Phase 1 是否给它们挂到首个 admin 或保留「未归属」？建议保留，新增字段 `owner_id` 可空，新生成绑定当前用户。
3. **JWT 黑名单存储**：用 Redis；若 Redis 不可用降级为进程内存（多进程不共享，登出仅在当前进程生效）——生产必须保证 Redis 可用。
4. **密码重置/找回**：本期不含邮件找回，若需要再加（需 SMTP 配置）。

## 11. 运营总控台（全局监控中心）

> 补齐「全局的流水 / 流量 / 动向 / 日志」合一监控。区别于 Phase 2 的 Admin 管理页（用户/充值/流水列表，偏**操作**），总控台是**实时态势感知**。admin 专属路由 `/admin/console`。

### 11.1 页面布局（对应图 console_layout）
- **顶部实时状态栏**：标题 + 实时心跳点 + 时间范围切换（实时 / 24h / 7d / 30d）
- **KPI 卡片 ×6**：在线用户 · 今日生成数 · 今日消耗积分 · 生成成功率 · 平均延迟(p95) · 实时 QPS
- **实时流量面板**：QPS / 并发 / 错误率 滚动曲线（近 60s，SSE 推送）
- **动向趋势面板**：注册 / 生成 / 消耗 多线趋势（7 / 30 日）
- **全局流水面板**：所有用户积分变动实时滚动（类型筛选 + 搜索 + 分页），接 `GET /api/admin/transactions`
- **日志流面板**：系统 / 认证 / 生成 / 支付 / 后台 分级实时日志（ERROR/WARN/INFO 配色），接 `GET /api/admin/logs/stream`
- **告警中心**：余额不足用户 · 错误率飙升 · 异常 IP 爆破 · 待处理工单 四类告警卡 + 跳转

### 11.2 数据模型新增
- `request_logs`：每次 API 请求一行（`user_id, path, method, status, latency_ms, ts`）——流量 / 延迟 / 成功率来源
- `audit_logs`：关键操作（登录 / 登出 / 充值 / 后台改动 / 封禁），只追加不可删——日志流来源
- `metrics_snapshots`（可选）：每分钟聚合快照，减轻实时聚合压力
- 复用已有 `credit_transactions`（全局流水）

### 11.3 实时推送机制（对应图 console_data_pipeline）
1. **采集中间件**：每个请求结束钩子里写 `request_logs` / `audit_logs`，并 `redis.incr` 计数器 + `redis.publish` 事件到频道 `console:events`
2. **Redis**：实时计数器（在线人数、QPS 滑窗）+ pub/sub 频道
3. **SSE 端点** `GET /api/admin/stream`：admin 长连，订阅 Redis 频道，把事件实时推前端（替代轮询；100 用户只有 1 个 admin 连接，零压力）
4. **前端总控台**：SSE 接流更新曲线 / 流水 / 日志；大范围历史明细（如全量流水查询）按需调 REST 拉 PG

### 11.4 后端端点
- `GET /api/admin/stream`（SSE，admin）— 实时事件
- `GET /api/admin/metrics/realtime` — 当前快照（在线 / QPS / 成功率 / 延迟）
- `GET /api/admin/metrics/trends?range=7d` — 注册 / 生成 / 消耗趋势
- `GET /api/admin/logs?level=&limit=` — 历史日志分页
- `GET /api/admin/alerts` — 四类告警聚合

### 11.5 安全
- 仅 `role='admin'` 可访问；SSE 也校验 JWT
- 日志含 IP / UA 但脱敏用户邮箱；审计日志不可删（只追加）
- 异常 IP 爆破：nginx `limit_req` + 后端失败计数，触发自动封禁写入 `banned_ips`

### 11.6 排期
归入 **Phase 2（账务闭环 + 仪表盘）** 增强，与 Admin 页面同批实现。

---

## 12. 全局智能体层（Global Agent Layer）

### 12.1 定位与目标
现有设计把 AI 能力（图像生成 dispatcher、提示词优化推理）当成底层函数零散调用，没有作为**全局一等公民**来建模、监控、管理与自动化。本层将其抽象为统一的「全局智能体」，分三块能力（用户确认 1+2+3+4 全做）：
1. **监控看板**（并入总控台 Section 11）：实时看见智能体被调了多少、花了多少积分、哪家供应商健康。
2. **管理页**（独立 Admin 页 `/admin/agents`）：配置可用模型、路由权重、全局开关、单模型成本上限、供应商增删。
3. **自动化运营智能体**（ops_bot）：自动跑规则——异常 IP 封禁、错误率飙升告警、智能客服应答草稿。

### 12.2 数据模型（PG，自动建）
- `agents`（智能体定义）：`id, key('image_gen'|'prompt_optim'|'ops_bot'), name, description, enabled(bool 默认 true), created_at`
- `agent_providers`（供应商/模型路由配置）：`id, agent_key, provider_id(FK providers), model_id(FK models), weight(int 路由权重), cost_cap_per_day(numeric 默认 NULL), enabled(bool), priority(int)`，唯一 `(agent_key, provider_id, model_id)`
- `agent_calls`（每次调用明细，只追加）：`id, user_id(int nullable 后台任务), agent_key, provider_id, model_id, tokens_in, tokens_out, cost_credits, duration_ms, status('ok'|'fail'), error_msg, ip, created_at`；索引 `(agent_key, created_at)`、`(created_at)`
- `agent_rules`（自动化运营规则）：`id, type('ban_ip'|'alert_error_rate'|'auto_reply'), enabled(bool), params(json), created_at`
- `agent_rule_logs`（规则触发记录）：`id, rule_id, triggered_at, detail(json)`

> 复用现有 `providers` / `models` 表（已在 server.js 建表），本层只叠加路由与成本配置，不重复定义模型。`banned_ips` 已在 Section 11.5 提及，本层写入。

### 12.3 总控台 · 智能体监控看板（并入 Section 11 布局）
在总控台新增「智能体」分区（独立 Tab 或新增面板），含：
- **KPI**：今日智能体调用次数 / 今日智能体成本(积分) / 平均成功率 / 平均延迟 / 实时 QPS / 供应商在线数
- **图表**：
  - 实时 QPS 曲线（按 `agent_key` 分线：image_gen / prompt_optim / ops_bot）
  - 供应商路由分布（各 provider 占比，饼/堆叠）
  - 成本消耗趋势（按 `credit_transactions.ref_type='agent'`）
  - 延迟 P50/P95 时序
  - 供应商健康矩阵（provider × 成功率 / 延迟 / 错误率，红黄绿）
- **实时调用流**：最近 N 条 `agent_calls` 滚动（用户 / 智能体 / 模型 / 成本 / 状态）
- 数据来源：复用 Section 11 的 SSE 通道，服务端从 `agent_calls` + Redis 计数器聚合推送

### 12.4 智能体管理页（`/admin/agents`）
- 智能体列表：image_gen / prompt_optim / ops_bot，每个可全局启停
- 路由配置：为某智能体添加「供应商 + 模型」，设权重、优先级、每日成本上限、启停
- 供应商健康手动查看 + 一键禁用异常供应商
- 成本护栏：全局每日智能体预算，超预算自动降级 / 停用（可选开关）

### 12.5 自动化运营智能体（ops_bot）
后台常驻轻量调度（Node `setInterval` 或 PG 定时任务），按 `agent_rules` 执行：
- `ban_ip`：读失败计数 / `request_logs`，单 IP 在窗口内失败次数超阈值（如 5 分钟 > 50 次）自动写入 `banned_ips` 并拒绝（nginx + 后端双层）。
- `alert_error_rate`：全局错误率 > X% 持续 Y 秒，推送到总控台告警中心 + （可选）外部 webhook。
- `auto_reply`：对简单用户咨询（如「怎么充值」）用 prompt_optim 推理模型生成应答草稿，本期建议「人工确认」模式再发出。

### 12.6 后端端点（均 `role='admin'`）
- `GET /api/admin/agents` — 智能体列表 + 健康
- `PUT /api/admin/agents/:key` — 启停
- `GET /api/admin/agents/:key/providers` — 路由配置列表
- `POST /api/admin/agents/:key/providers` / `PUT /api/admin/agents/providers/:id` / `DELETE /api/admin/agents/providers/:id` — 增改删路由
- `GET /api/admin/agent-calls?range=&agent=&status=` — 调用明细分页
- `GET /api/admin/agent-metrics/realtime` — 监控看板快照
- `GET /api/admin/agent-rules` / `PUT /api/admin/agent-rules/:id` — 自动化规则启停 / 参数

### 12.7 排期
并入 **Phase 2**，与总控台（Section 11）、Admin 页面同批实现；自动化运营智能体（ops_bot）可作为 Phase 2 收尾增强。

---

## 13. 创意生产流水线（Idea → Script → Storyboard → Video）

### 13.1 定位与目标
在现有系统（Auth 多用户 / Credits 计费 / Global Agent Layer / Console 监控 / OSS 存储）之上，新增一条**从「一个点到成片剧集」的一站式创作流水线**。它不是孤立模块，而是把 Page 层、Skill/Agent 接入层、共享服务、PG/Redis 串成一条可回退迭代的主线（见两张图解）。

目标产物：
- **点子孵化**（Idea Hub）：把一句话点子扩写成世界观 / 角色 / 剧情骨架。
- **小说转剧本工坊**（Script Studio）：导入小说或长文，AI 拆分场景、生成标准剧本格式、人物小传、分镜提示。
- **无限画布分镜**（Infinite Canvas）：把剧本每场变成可自由摆放的面板，逐格生成漫画风视觉，加对白、连戏。
- **视频生成**（Video Gen）：把分镜面板 + 脚本驱动视频供应商生成片段。
- **剧集管理**（Episodes）：按季 / 集编排片段、合成、发布。

### 13.2 五阶段流水线（可回退迭代）
线性主链：`点子 → 剧本 → 分镜 → 视频 → 剧集`，任一阶段可回退到上游重新产出（例：剧本不满意回到点子重新孵化）。每个阶段底部挂一个可插拔的 skill / agent（见 13.5），全阶段共享计费与监控。

### 13.3 数据模型（PG，自动建）
- `projects`（顶层创作项目）：`id, owner_id(FK users), title, type('novel'|'comic'|'video'|'mixed'), status('draft'|'active'|'done'), current_stage('idea'|'script'|'storyboard'|'video'|'episode'), cover_url, created_at, updated_at`
- `ideas`（点子草稿）：`id, project_id, content(text), ai_worldbuilding(json nullable), ai_characters(json nullable), created_at`
- `scripts`（剧本）：`id, project_id, title, format('screenplay'|'novel'), raw_text, scenes(jsonb 场景数组), characters(jsonb 人物小传), created_at`
- `scenes`（分镜场景，scripts.scenes 归一化便于查询）：`id, script_id, order_idx, heading, action, dialogue(jsonb), panel_layout(jsonb nullable)`
- `canvas_nodes`（无限画布节点）：`id, project_id, type('panel'|'character'|'note'|'image'|'text'), x(numeric), y(numeric), w(numeric), h(numeric), z(int), data(jsonb), parent_id(nullable), created_at`；索引 `(project_id)`
- `storyboards`（漫画分镜组合，可选）：`id, project_id, canvas_id, panels(jsonb), created_at`
- `video_jobs`（视频生成任务）：`id, project_id, scene_id(nullable), panel_node_id(nullable), provider_id, model_id, prompt, status('pending'|'running'|'done'|'failed'), result_url, duration_sec, cost_credits, owner_id, created_at`
- `episodes`（剧集）：`id, project_id, season(int), episode_no(int), title, video_job_ids(jsonb), published(bool), created_at`
- `skill_registry`（可插拔 skill 注册）：`id, key, name, stage('idea'|'script'|'storyboard'|'video'|'episode'|'global'), enabled(bool), config(jsonb), created_at` —— 复用 Global Agent Layer 的 `agents` 表做 agent 侧编排，本表管「本地函数型 skill」。

> 计费 / 流水 / 审计 / 请求日志 / 智能体调用 全部复用 Section 10–12 的表（`credit_transactions` / `request_logs` / `audit_logs` / `agent_calls`），不重复定义。

### 13.4 各页面规划（前端，复用 AuthContext + 主题切换 + 高级风）
- **`/studio` 项目列表**：我的创作项目（卡片网格 + 新建 + 继续创作 + 阶段进度条）。
- **`/studio/:id/idea` 点子孵化**：点子输入框 + AI 扩写（头脑风暴 agent）→ 世界观 / 角色 / 剧情骨架预览 → 一键进入剧本。
- **`/studio/:id/script` 小说转剧本**：粘贴 / 上传小说 → 拆分场景（编剧 agent）→ 剧本编辑器（场景卡 + 对白 + 人物小传侧栏）→ 导出。
- **`/studio/:id/canvas` 无限画布**（预留）：缩放 / 平移无限画布，剧本场景拖入成面板，逐格「生成漫画」调用 image_gen agent，对白贴图，连线连戏；支持 AI 自动布局。
- **`/studio/:id/video` 视频生成**：选分镜面板 / 脚本 → 配置视频供应商与模型 → 批量生成片段（video agent）→ 片段时间轴预览。
- **`/studio/:id/episodes` 剧集管理**：按季 / 集编排片段、合成、发布开关。
- 顶栏 / 侧栏集成进现有导航；每个页面顶显示**项目剩余积分**与阶段进度。

### 13.5 Skill / Agent 接入设计（可插拔，呼应「可以添加各种 skill 和使用 agent」）
每阶段通过 `skill_registry` + Global Agent Layer 挂载能力，admin 在 `/admin/skills`（新增）统一管理（启停 / 参数 / 绑定阶段）：
- **点子**：头脑风暴 agent、世界观构建 skill、角色生成 skill。
- **剧本**：编剧 agent（拆场景 / 写对白）、格式转换 skill（小说→剧本）、人物小传 skill。
- **分镜**：漫画风格 skill、自动布局 agent（生成后自动排布到画布）、image_gen agent（逐格出图）。
- **视频**：video agent（文 / 图生视频）、配音 / TTS skill、配乐 skill。
- **剧集**：发布编排 skill、封面生成 skill。
- 设计原则：**skill 是本地可替换函数（插拔），agent 走 Section 12 的统一路由与成本护栏**；新增一种能力只需注册一条 `skill_registry` 或 `agents/agent_providers` 记录，不开新接口。

### 13.6 积分计费矩阵（每阶段差异化）
- 点子扩写：低（推理 token 计费）
- 剧本拆分 / 写作：中（长文本推理）
- 分镜出图：按张（image_gen，复用 `models.credit_cost`）
- 视频生成：高（video 供应商单价，新增 `models.credit_cost` 视频档）
- 剧集合成：按片段数计；全部走 Section 10 的原子预扣 + 失败回退。

### 13.7 监控接入（复用 S11 / S12，零新增链路）
- Console（S11）实时看板新增「创作」维度：各阶段调用量 / 视频生成 QPS / 成功率 / 延迟 / 成本；视频是重算力，重点监控供应商健康与超时。
- Agent Layer（S12）的 `agent_calls` 已覆盖每个阶段对 agent 的调用；`request_logs` 覆盖画布操作等交互；`audit_logs` 覆盖关键动作（新建项目 / 发布）。
- 告警中心（S11.3）增加：视频生成积压、单项目成本超阈值、画布节点数异常。

### 13.8 无限画布技术设计（预留，本期先定接口不深做）
- **前端**：无限平移缩放画布（react-flow / 自研 canvas 均可），节点 CRUD + 拖拽 + 连线 + 缩略图导航；大项目分块懒加载 `canvas_nodes`。
- **后端**：`canvas_nodes` 存坐标 + `data(jsonb)`；保存 / 加载走 `/api/projects/:id/canvas`。
- **AI 自动布局**：编剧 agent 产出场景后，自动布局 agent 把场景摆成网格 / 时间线，用户再微调。
- 本期定位：先把数据模型与页面骨架落下，**深度交互（多人协同、版本树）留作后续增强**，不阻塞主线。

### 13.9 排期
建议作为 **Phase 4**（在 Phase 1 认证、Phase 2 后台 / 总控台 / 智能体、Phase 3 部署稳定之后），与 Phase 2 的 Agent Layer 强耦合。若想尽早验证，可**先落地 13.3 数据模型 + 13.4 `/studio` 项目列表 + 点子孵化页（Phase 1 之后即可）**，其余阶段按优先级滚动实现。

---

## 14. 千人在线基线 + 模块化可组合（融合总纲）

### 14.1 定位与目标
把前面 Section 1–13 全部融合成一个**可水平扩展、模块化、可组合**的系统，基线要求从「~100 人」提升到 **1000 并发在线**。两个硬性要求：
1. **千人在线**：架构必须支持水平扩展，单实例故障不影响整体，关键中间件（Redis / 连接池 / 队列）不可降级为内存版。
2. **模块化可组合**：每个重要节点（Auth / Credits / Agent Layer / Skills / 点子 / 剧本 / 分镜 / 视频 / 剧集）既能**单独使用**，也能被**编排层整体联动**成「点子 → 剧本 → 分镜 → 视频 → 剧集」流水线——两套用法共用同一套接口。

> 本节为总纲，**取代 Section 3 / Phase 3 里的「100 人」容量数字**；其余章节（数据模型、端点、页面）保持有效。

### 14.2 千人在线架构要点（对应拓扑图）
- **负载均衡（nginx / 云 CLB）**：TLS 终结、HTTP/2、keepalive、`limit_req` 对 `/api/auth/*` 与 `/api/generate` 限速（如 20 r/s·IP，burst 40）；`/healthz` 供 LB 探活。
- **无状态 Node 集群**：PM2 cluster 模式，实例数 = vCPU 数（4–8 核即 4–8 实例）。JWT 无状态 → 无需 sticky session，任意实例可服务任意请求，扩容即加分片。
- **Redis（必需，禁止内存降级）**：集中存放 JWT 黑名单、限流计数器、实时计数（总控台）、Pub/Sub（事件推送）、异步队列。生产用单机 + AOF 持久化，关键业务加 Sentinel。
- **PostgreSQL + PgBouncer**：前置事务级连接池（`max_client_conn 2000`，`pool_size` 按实例数分配），避免 1000 连接打爆主库；主库 `max_connections≈500`，重读场景（总控台聚合）挂**只读副本**。
- **OSS + CDN**：媒体（图片 / 视频）走 OSS，前端经 CDN 回源；视频生成结果直接落 OSS 并下发 CDN 签名 URL，1000 人拉流不压后端。
- **视频异步队列（零新依赖）**：视频生成重算力，**必须异步**。用 PG 表 `jobs` + `SELECT … FOR UPDATE SKIP LOCKED` 轮询取任务，Worker 池并发消费；任务幂等（`task_id` 去重），失败自动重试 / 进死信。
- **容量估算（基线 1000 并发）**：PG 活跃连接 ≈ 实例数 × 单实例池(20–30) ≈ 160–240，经 PgBouncer 收敛；Redis 单实例可扛数万 ops；Node 单实例保守 ~300 并发长连，8 实例 ≈ 2400 余量充足。

### 14.3 模块化与可组合设计原则（对应地图图）
- **每个节点 = 独立三件套**：独立 REST 前缀（`/api/idea`、`/api/script` …）+ 独立页面（`/studio/:id/idea` …）+ 独立数据表（`ideas`、`scripts` …）。用户可直接打开任一节点单独用（如只做图像生成、只做账密登录）。
- **横切模块被所有节点复用**：Auth（JWT 校验中间件）、Credits（原子预扣）、Agent Layer（S12）、Skills 注册表——它们不是某个节点的私有能力，而是底座，任何节点调用都走同一中间件。
- **编排层（Workflow 引擎）**：新增轻量 `workflows` 表 + Runner，把节点按序串联。关键设计——**编排层不重写逻辑，只顺序调用各节点的独立 API 并传递产物**（点子的世界观 JSON → 剧本 agent → 分镜 canvas → 视频 job）。支持断点续跑、回退迭代、人工介入。
- **同一套接口，两种用法**：单独用 = 前端直接调节点 API；整体联动 = 编排 Runner 调同样的 API。新增一种能力只需注册 `skill_registry` 或 `agents/agent_providers`，**不开新接口、不改编排**。
- **总控台横切监控**（S11）：所有节点的流水 / 流量 / 动向 / 日志统一入总控台，不因为模块化而分散。

### 14.4 一致性 / 限流 / 实时 设计
- **计费原子性**：Credits 预扣在 PG 事务内用 `UPDATE users SET balance=balance-cost WHERE id=? AND balance>=cost RETURNING` 行锁，超并发不会超扣；失败回滚写退款流水。
- **限流双层**：nginx `limit_req`（网络层）+ Redis 滑动窗口（应用层，按用户 / IP / 接口维度），保护登录与生成。
- **实时计数**：请求日志聚合进 Redis 计数器，事件经 Pub/Sub 推 SSE 到总控台（仅 admin 连接，不占千人在线带宽）。
- **任务幂等**：所有异步任务带 `task_id`，Worker 取任务前先查去重，防重复生成与重复扣费。

### 14.5 排期修订（新增 Phase 0 基础设施底座）
- **Phase 0（新增 · 先于一切）**：负载均衡配置、PgBouncer、Redis 落地（含 Sentinel 选项）、健康检查 `/healthz`、PG 连接池与只读副本脚本、视频异步队列骨架、容量压测基线。→ 这是「千人在线」的硬前提。
- Phase 1–4 不变，但**每个 Phase 都按千人在线标准落地**（连接池参数、Redis 共享、异步化重任务），不再是 100 人口径。
- 推荐落地顺序：Phase 0 → Phase 1（认证 / 计费地基）→ Phase 2（总控台 / 智能体）→ Phase 3（部署脚本定稿）→ Phase 4（创作流水线）。

### 14.6 风险与对策
- **单点 Redis 故障**：启用 Sentinel / 主从；应用对 Redis 不可用做降级（限流放开、黑名单失效但 JWT 短期仍有效），保可用性。
- **视频队列积压**：Worker 池弹性扩容 + 任务优先级（付费用户优先）+ 超时转异步通知，不阻塞同步接口。

## 15. 电商模块（每个节点引入智能体协助）

### 15.1 定位与目标
新增一个**电商垂直应用模块**，复用前面所有横切底座（Auth / Credits / Agent Layer / Skills / 总控台 / 创作流水线），按千人在线（Section 14）口径落地。核心要求：
1. 覆盖电商全链路：店铺 / 商品 / 详情页 / 购物车 / 下单 / 支付 / 物流 / 评价 / 营销 / 客服 / 推荐 / 搜索。
2. **每个核心节点都接入智能体协助**（见 15.3 映射表）——上架有文案 agent、详情页有排版 agent、营销有多平台文案 agent、客服有自动应答 agent 等。
3. 电商详情页是重点设计对象（见 15.4 原型），详情页内嵌「智能体协助」面板，用户一键调用 agent 改写卖点 / 写种草文案 / 配图建议 / 问答预测。
4. 与创作流水线联动：商品主图、场景图、种草短视频直接复用 Section 13 的图片 / 视频生成能力（agent 调创作流水线节点 API）。

### 15.2 数据模型（PG，复用现有表）
新增表：
- `shops`：id, owner_id(fk users), name, logo_oss_key, description, status, created_at
- `products`：id, shop_id, title, subtitle, description, price_cny, original_price_cny, cover_oss_key, category_id, tags[], status, created_at, updated_at
- `product_skus`：id, product_id, spec_json, price_cny, stock, oss_key
- `cart_items`：id, user_id, product_id, sku_id, qty
- `orders`：id, user_id, shop_id, total_cny, credit_deduction, pay_channel, pay_status(pending/paid/closed/refunded), address_json, created_at, paid_at
- `order_items`：id, order_id, product_id, sku_id, qty, price_cny, snapshot_json
- `coupons`：id, shop_id|null, type(discount/full_reduce), rule_json, code, status
- `reviews`：id, user_id, product_id, order_id, rating(1-5), content, images[], created_at
- `shipments`：id, order_id, carrier, tracking_no, status, created_at
复用：`users`、`credit_transactions`（积分抵现走流水）、`agent_calls`（电商 agent 调用明细，只追加）、`request_logs`、`audit_logs`、创作流水线 `media`（商品图即 media 记录）。

### 15.3 八个核心节点 × 智能体协助映射
| 节点 | 页面/API | 接入的智能体（skill 类型） | 做什么 |
|---|---|---|---|
| 商品上架 | /seller/products · /api/products | product_writer | 按图/关键词生成标题、卖点、SEO 描述、标签；调创作流水线生成主图/场景图 |
| 详情设计 | /product/:id · /api/product/design | product_designer | 推荐详情页排版/配色/模块顺序；生成结构化图文（功效对比/成分图谱/场景卡） |
| 营销文案 | /seller/marketing · /api/marketing/copy | copywriter | 一键生成小红书/抖音/朋友圈/邮件多平台种草文案 |
| 智能客服 | /api/cs/*（嵌入详情页/订单页） | smart_cs（复用 ops_bot） | 自动应答商品咨询、退换货话术、FAQ；人工可介入 |
| 个性推荐 | /api/recommend · 首页信息流 | recommender | 基于行为与内容做个性化推荐，冷启动用热门兜底 |
| 语义搜索 | /api/search | search_agent | Query 改写、同义词扩展、语义召回，提升长尾转化 |
| 交易下单 | /api/orders · /checkout | deal_agent | 优惠自动测算、风控拦截、库存校验、积分抵现建议 |
| 售后退换 | /api/aftersale | aftersale_agent | 退换货原因分类、话术生成、退款时效预估 |

> 每个节点本身仍是「独立 REST + 独立页面 + 独立表」（Section 14.3 模块化原则），agent 只是挂在其上的可选增强，不耦合主流程——这是「单独用也能跑、整体联动也能跑」的体现。

### 15.4 电商详情页设计（重点）
对应 mockup 原型，详情页分四区：
- **顶部导航**：搜索框（接语义搜索 agent）+ 购物车角标（实时数量）。
- **左侧媒体区**：主图 + 缩略图（接 OSS/CDN）；「AI 生成场景图 / 短视频」按钮 → 调创作流水线视频节点。
- **右侧信息区**：标题 / 价格（现价 + 划线价 + 积分抵现提示）/ SKU 选择 chip / 数量；**「智能体协助」面板**（改写卖点、写种草文案、配图建议、问答预测 四个一键按钮，调用 15.3 的 agent）/ 加入购物车 + 立即购买。
- **下方 Tab**：图文详情（其中「AI 结构化图文」模块由 product_designer 生成：功效对比 · 成分图谱 · 使用场景卡）/ 规格参数 / 用户评价。
高级风延续：玻璃拟态卡片、主题切换（亮/暗/系统）、磁性 hover、60fps 过渡。

### 15.5 页面路由规划
- `/shop` 商城首页（分类 + 信息流推荐 + 搜索入口）
- `/product/:id` 商品详情页（15.4）
- `/cart` 购物车
- `/checkout` 结算（地址 + 支付 + 积分抵现）
- `/orders` 我的订单
- `/seller` 商家中心（商品/订单/营销/数据）
- `/admin/ecommerce` 电商管理后台（类目/商品审核/佣金/智能体配置）

### 15.6 智能体接入（复用 S12 + S13）
电商专属 skill 注册进 `skill_registry`（S13.3），绑定阶段=电商节点；agent 定义进 `agents` / `agent_providers`（S12）。**新增一种电商智能体只需注册一条记录**，不开新接口。所有电商 agent 调用经 Agent Layer 统一计费（扣 Credits）、落 `agent_calls`、进总控台「智能体」维度。

### 15.7 积分 × 真实支付融合
- 真实支付：下单走微信/支付宝（复用 Section 10 充值订单思路，扩展 `orders.pay_channel`），需商户号 + HTTPS 回调（Phase 2 先模拟）。
- 积分抵现：结算页选积分抵扣现金（`orders.credit_deduction`），走 Credits 原子预扣 + 消费流水；退款回退积分。
- 营销：优惠券 `coupons` 与积分可叠加，deal_agent 自动测算最优组合。

### 15.8 监控接入（复用 S11 / S12）
总控台新增「电商」维度 KPI：GMV、订单量、支付转化率、退款率、客单价、积分抵现占比；Agent Layer 已覆盖电商 agent 调用；告警加：支付失败率飙升、退款激增、详情页错误率。电商操作（上架/下架/改价）全部入审计日志。

### 15.9 千人在线注意点（Section 14 口径）
- 详情页是典型**高并发读**：商品信息经 Redis 缓存（TTL 60s，写时失效），媒体走 CDN，重读聚合查 PG 只读副本；详情页静态骨架 + 客户端水合。
- 下单是**写高峰**：削峰用异步队列（SKIP LOCKED，S14.2），库存用 `UPDATE ... WHERE stock>=qty` 行锁防超卖。
- 缓存一致性：商品改价/库存变更触发缓存失效事件（Redis Pub/Sub → 各实例），避免千人读到旧价。

### 15.10 排期
并入 **Phase 4 之后（新增 Phase 5 电商模块）**，依赖 Phase 1（Auth/Credits）、Phase 2（Agent Layer/Skills/总控台）、Phase 3（部署）。若想尽早验证，可**先落地 15.2 数据模型 + 15.4 详情页 + 15.3 的商品上架/详情设计两个 agent**（Phase 2 之后即可），其余节点按优先级滚动。
- **PgBouncer 事务池与 `pg_cancel` 冲突**：统一用事务池模式，长事务改为分批；监控 `cl_waiting`。
- **CDN 回源击穿**：热点媒体设 CDN 缓存策略 + OSS 防盗链 + 签名 URL 时效。
<arg_key:6124c78e>replace_all</arg_key:6124c78e>
<arg_value:6124c78e>false
