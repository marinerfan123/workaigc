# 实现级详细设计规范（DETAILED_SPEC）

> 本文档是 `DESIGN_AUTH_CREDITS.md` 的**配套实现规范**，负责把"架构意图"翻译成"可照做的细节"。
> 阅读顺序：先看 DESIGN_AUTH_CREDITS.md 的 Section 14（融合总纲）建立全局视图，再回本文档查具体字段、SQL、接口、配置。
>
> 标注约定：
> - `【必填】` = 数据库 NOT NULL / 接口必传
> - `【选填】` = 允许 NULL / 可省略
> - `ERR_xxxx` = 全局错误码（见 §I）
> - 所有时间字段均为 `TIMESTAMPTZ`（PostgreSQL，带时区），存储 UTC。
>
> ⚠️ **规模口径修订**：本文档 §A 的基础设施与"千人在线"数值，已被 **`docs/TECH_STACK.md`** 修订为 **5K–10K 并发在线**基线（新增 Fastify、PgBouncer 读写分离、Redis Sentinel、BullMQ、OTel/Prometheus/Loki、K8s HPA 等）。以 `TECH_STACK.md` 为准；§B–§J 的表结构/接口/安全细则仍直接可用。

---

## 目录

- [§A 部署与基础设施详细配置（Phase 0）](#a)
- [§B 数据模型主清单（全表 DDL）](#b)
- [§C 认证与账务 API 契约](#c)
- [§D 计费一致性实现（原子预扣 / 幂等 / 回退）](#d)
- [§E 模块化与编排（节点 API 约定 / Workflow 状态机）](#e)
- [§F 创作流水线节点契约](#f)
- [§G 电商模块契约](#g)
- [§H 总控台与智能体层监控](#h)
- [§I 安全细则](#i)
- [§J 配置参数总表](#j)

---

<a id="a"></a>
## §A 部署与基础设施详细配置（Phase 0）

目标：**1000 并发在线**基线。所有组件均"必需"，无内存降级兜底（详见 DESIGN §14）。

### A.1 拓扑与机器规格建议

| 角色 | 最低规格 | 说明 |
|---|---|---|
| LB (Nginx) | 2 vCPU / 2GB / 独立机 | TLS 终止 + 限流 + 静态缓存；可和 Node 同机但建议分离 |
| Node 集群 | 4 vCPU / 8GB × 2 台 | PM2 cluster，实例数 = vCPU；无状态，可水平扩 |
| PostgreSQL | 4 vCPU / 8GB | 主库；只读副本 2 vCPU / 4GB（读流量分流） |
| PgBouncer | 与 PG 同机或独立 | 连接池事务模式，pool_size=20，max_client_conn=2000 |
| Redis 7 | 2 vCPU / 4GB | 必需：黑名单 / 限流 / 计数 / PubSub / 队列；开持久化 AOF |
| OSS + CDN | 阿里云 | 图片/视频对象存储 + 全站加速 |

### A.2 Nginx 配置（`/etc/nginx/conf.d/app.conf` 全文模板）

```nginx
# 上游 Node 集群（多机多端口）
upstream app_nodes {
    least_conn;
    server 10.0.0.11:3001 max_fails=3 fail_timeout=15s;
    server 10.0.0.12:3001 max_fails=3 fail_timeout=15s;
    keepalive 64;
}

# 限流区（放在 http 块或此处）
limit_req_zone $binary_remote_addr zone=login_zone:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=api_zone:20m   rate=30r/s;

# 真实 IP（若 LB 在前面再加一层）
# set_real_ip_from 10.0.0.0/8; real_ip_header X-Forwarded-For;

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate     /etc/ssl/app/fullchain.pem;
    ssl_certificate_key /etc/ssl/app/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    # 安全头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # 上传大文件（视频生成素材可能较大）
    client_max_body_size 50m;

    # 静态资源（由 Node 托管 dist/build2，此处可加 CDN/缓存）
    location ~* \.(js|css|png|jpg|jpeg|webp|svg|woff2)$ {
        proxy_pass http://app_nodes;
        proxy_cache_valid 200 7d;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # 登录接口单独严格限流（防爆破）
    location /api/auth/login {
        limit_req zone=login_zone burst=10 nodelay;
        proxy_pass http://app_nodes;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 通用 API 限流
    location /api/ {
        limit_req zone=api_zone burst=60 nodelay;
        proxy_pass http://app_nodes;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # 视频生成可能慢
    }

    # 健康检查（LB 探活，绕过限流）
    location /healthz {
        access_log off;
        proxy_pass http://app_nodes;
    }

    # OSS 媒体走 CDN（可选，视部署而定）
    # location /media/ { return 302 https://cdn.example.com/$request_uri; }
}
```

### A.3 PM2 集群配置（`ecosystem.config.js`）

```javascript
module.exports = {
  apps: [{
    name: 'workaigc',
    script: 'server/server.js',
    instances: 'max',          // = vCPU 数
    exec_mode: 'cluster',
    max_memory_restart: '1.5G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      // 关键：无状态，Redis 共享会话/限流
    },
    // 优雅重启，避免 1000 人在线时全量断连
    kill_timeout: 8000,
    wait_ready: true,
    listen_timeout: 10000,
  }],
};
```

### A.4 PgBouncer 配置要点（`pgbouncer.ini`）

```ini
[databases]
huabu = host=127.0.0.1 port=5432 dbname=huabu

[pgbouncer]
pool_mode = transaction        # 事务级复用，适配短事务
max_client_conn = 2000
default_pool_size = 20         # 每 Node 进程 ≈ 20；多实例共享
min_pool_size = 5
reserve_pool_size = 5
server_idle_timeout = 60
```

> Node 侧 `pg.Pool` 的 `max` 必须 ≤ PgBouncer 单库可用连接。若 2 台 × 4 实例 = 8 进程，每进程 max=20 则总需求 160，需 PgBouncer 池或调小。折中：每 Node 进程 `pg.Pool max=10`，PgBouncer `default_pool_size=20`。

### A.5 Redis 配置要点

```ini
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
appendonly yes                 # AOF 持久化，重启不丢黑名单/限流计数
appendfsync everysec
```

### A.6 `.env.example`（全字段，敏感值留空）

```bash
# ---- 服务 ----
NODE_ENV=production
PORT=3001
PUBLIC_BASE_URL=https://app.example.com

# ---- 数据库（走 PgBouncer）----
DATABASE_URL=postgresql://appuser:CHANGE_ME@127.0.0.1:6432/huabu
PG_POOL_MAX=10

# ---- Redis（必需）----
REDIS_URL=redis://127.0.0.1:6379
REDIS_PASSWORD=CHANGE_ME

# ---- 认证 ----
JWT_SECRET=CHANGE_ME_32BYTES_MIN
JWT_ACCESS_TTL=7200            # access token 秒（2h）
JWT_REFRESH_TTL=2592000        # refresh token 秒（30d）
LEGACY_API_TOKEN=CHANGE_ME     # 老全局令牌，作 admin 服务令牌 fallback

# ---- 积分默认值 ----
SIGNUP_FREE_CREDITS=20
GENERATION_DEFAULT_COST=1

# ---- 限流 ----
RATE_LOGIN_RPS=5
RATE_API_RPS=30
RATE_BAN_THRESHOLD=20          # 登录失败 N 次封 IP

# ---- OSS（私有桶，后端代理）----
OSS_BUCKET=oss-pai-xxxx
OSS_ENDPOINT=oss-cn-shanghai.aliyuncs.com
OSS_ACCESS_KEY=CHANGE_ME
OSS_SECRET_KEY=CHANGE_ME
OSS_REGION=cn-shanghai

# ---- 支付（Phase 2 真实收款时填）----
WECHAT_MCH_ID=
WECHAT_API_KEY=
WECHAT_NOTIFY_URL=https://app.example.com/api/credits/orders/callback/wechat
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY=
ALIPAY_NOTIFY_URL=https://app.example.com/api/credits/orders/callback/alipay

# ---- 邮件（密码找回 Phase 2+）----
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

### A.7 压测验收命令（Phase 0 收尾）

```bash
# 安装
npm i -g autocannon

# 健康检查（目标 p99 < 50ms）
autocannon -c 1000 -d 30 -p 10 https://app.example.com/healthz

# 登录接口（目标 1000 并发下错误率 0、p99 < 300ms）
autocannon -c 1000 -d 30 -p 20 -m POST \
  -H 'Content-Type: application/json' \
  -b '{"email":"test@example.com","password":"x"}' \
  https://app.example.com/api/auth/login

# 生成接口（需有效 token，目标吞吐 > 200 rps）
autocannon -c 1000 -d 30 -p 20 -H "Authorization: Bearer $TOKEN" \
  https://app.example.com/api/generate
```

---

<a id="b"></a>
## §B 数据模型主清单（全表 DDL）

> 命名：表名小写下划线；主键 `id` 用 `BIGSERIAL`（防止千人在线下 INT 溢出）；时间 `TIMESTAMPTZ DEFAULT now()`；
> 金额/积分为 `INTEGER`（积分单位，避免浮点误差）；金额人民币用 `NUMERIC(10,2)`。
> 字符集统一 `UTF8`，所有表 `PARTITION` 不适用（先单表 + 索引，流水表超过 5 千万行再按月分区）。

### B.1 认证与用户（`users`）

```sql
CREATE TABLE IF NOT EXISTS users (
  id                  BIGSERIAL PRIMARY KEY,
  email               VARCHAR(255) NOT NULL UNIQUE,
  password_hash       VARCHAR(255) NOT NULL,          -- scrypt: "scrypt$N$r$p$salt$hash"
  display_name        VARCHAR(64)  NOT NULL DEFAULT '新用户',
  avatar_url          VARCHAR(512) 【选填】,
  role                VARCHAR(16)  NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  credits_balance     INTEGER      NOT NULL DEFAULT 20,       -- 当前可用积分（免费送 20）
  status              VARCHAR(16)  NOT NULL DEFAULT 'active', -- 'active' | 'disabled' | 'banned'
  email_verified      BOOLEAN      NOT NULL DEFAULT false,
  last_login_at       TIMESTAMPTZ 【选填】,
  last_login_ip       VARCHAR(45)  【选填】,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
```

### B.2 积分流水（`credit_transactions`）—— 只追加，天然对账

```sql
CREATE TABLE IF NOT EXISTS credit_transactions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT       NOT NULL REFERENCES users(id),
  type          VARCHAR(16)  NOT NULL,   -- consume|recharge|grant|refund|adjust
  amount        INTEGER      NOT NULL,   -- 正负：consume/refund 为负，recharge/grant 为正
  balance_after INTEGER      NOT NULL,   -- 该笔后的余额（对账锚点）
  ref_type      VARCHAR(32)  【选填】,   -- generation|order|admin|signup|refund
  ref_id        VARCHAR(64)  【选填】,   -- 关联业务 ID（如 generation task_id / order_no）
  remark        VARCHAR(255) 【选填】,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ct_user_time ON credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ct_ref ON credit_transactions(ref_type, ref_id);
```

### B.3 充值订单（`recharge_orders`）

```sql
CREATE TABLE IF NOT EXISTS recharge_orders (
  id            BIGSERIAL PRIMARY KEY,
  order_no      VARCHAR(40)  NOT NULL UNIQUE,  -- 业务单号（对外）
  user_id       BIGINT       NOT NULL REFERENCES users(id),
  credits       INTEGER      NOT NULL,         -- 购买积分量
  amount_cny    NUMERIC(10,2) NOT NULL,        -- 人民币金额
  pay_channel   VARCHAR(16)  NOT NULL,         -- wechat|alipay|admin
  pay_status    VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending|paid|failed|closed
  pay_trade_no  VARCHAR(64)  【选填】,         -- 第三方交易号
  gateway_raw   JSONB        【选填】,         -- 回调原始报文（审计）
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  paid_at       TIMESTAMPTZ  【选填】
);
CREATE INDEX IF NOT EXISTS idx_ro_user ON recharge_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ro_status ON recharge_orders(pay_status);
```

### B.4 刷新令牌黑名单（`token_blacklist`，Redis 为主，PG 作持久兜底）

```sql
CREATE TABLE IF NOT EXISTS token_blacklist (
  jti         VARCHAR(64) PRIMARY KEY,   -- refresh token 唯一 ID
  user_id     BIGINT     NOT NULL,
  expire_at   TIMESTAMPTZ NOT NULL,      -- 过期时间，到点可物理删除
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tbl_expire ON token_blacklist(expire_at);
```

### B.5 请求日志（`request_logs`，总控台流量来源）

```sql
CREATE TABLE IF NOT EXISTS request_logs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT      【选填】,
  method        VARCHAR(8)  NOT NULL,
  path          VARCHAR(255) NOT NULL,
  status        INTEGER     NOT NULL,
  latency_ms    INTEGER     NOT NULL,
  ip            VARCHAR(45) NOT NULL,
  ua            VARCHAR(512)【选填】,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 按月分区候选；先建时间索引
CREATE INDEX IF NOT EXISTS idx_rl_time ON request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rl_path ON request_logs(path, created_at DESC);
```

### B.6 审计日志（`audit_logs`，只追加不可删，日志流来源）

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  level         VARCHAR(8)   NOT NULL,   -- ERROR|WARN|INFO
  user_id       BIGINT       【选填】,
  action        VARCHAR(64)  NOT NULL,   -- 如 user.recharge / agent.call / admin.ban
  target        VARCHAR(64)  【选填】,
  message       TEXT         NOT NULL,
  meta          JSONB        【选填】,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_al_level_time ON audit_logs(level, created_at DESC);
```

### B.7 创作流水线（Phase 4）

```sql
CREATE TABLE IF NOT EXISTS projects (
  id            BIGSERIAL PRIMARY KEY,
  owner_id      BIGINT      NOT NULL REFERENCES users(id),
  title         VARCHAR(255) NOT NULL,
  type          VARCHAR(16)  NOT NULL DEFAULT 'story', -- story|commerce|custom
  status        VARCHAR(16)  NOT NULL DEFAULT 'draft',
  current_stage VARCHAR(16)  NOT NULL DEFAULT 'idea',  -- idea|script|storyboard|video|episode
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proj_owner ON projects(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ideas (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT      NOT NULL REFERENCES projects(id),
  content       TEXT        NOT NULL,
  expanded      TEXT        【选填】,     -- 智能体扩写结果
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scripts (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT      NOT NULL REFERENCES projects(id),
  title         VARCHAR(255) NOT NULL,
  body          TEXT        NOT NULL,    -- 剧本正文（含场景标记）
  source_idea_id BIGINT     【选填】,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenes (
  id            BIGSERIAL PRIMARY KEY,
  script_id     BIGINT      NOT NULL REFERENCES scripts(id),
  seq           INTEGER     NOT NULL,    -- 场景序号
  description   TEXT        NOT NULL,
  panel_count   INTEGER     NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canvas_nodes (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT      NOT NULL REFERENCES projects(id),
  node_type     VARCHAR(32) NOT NULL,    -- idea|scene|panel|asset|note
  x             DOUBLE PRECISION NOT NULL DEFAULT 0,
  y             DOUBLE PRECISION NOT NULL DEFAULT 0,
  w             DOUBLE PRECISION NOT NULL DEFAULT 200,
  h             DOUBLE PRECISION NOT NULL DEFAULT 120,
  data          JSONB       NOT NULL DEFAULT '{}',  -- 节点业务数据
  parent_id     BIGINT      【选填】,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cn_proj ON canvas_nodes(project_id);

CREATE TABLE IF NOT EXISTS storyboards (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT      NOT NULL REFERENCES projects(id),
  scene_id      BIGINT      NOT NULL REFERENCES scenes(id),
  panels        JSONB       NOT NULL DEFAULT '[]', -- [{img,caption}]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_jobs (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT      NOT NULL REFERENCES projects(id),
  status        VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|running|done|failed
  input_ref     VARCHAR(64) 【选填】,    -- 来源（storyboard/scene）
  output_url    VARCHAR(512)【选填】,
  credits_cost  INTEGER     NOT NULL DEFAULT 10,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ 【选填】,
  finished_at   TIMESTAMPTZ 【选填】
);
CREATE INDEX IF NOT EXISTS idx_vj_status ON video_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS episodes (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT      NOT NULL REFERENCES projects(id),
  seq           INTEGER     NOT NULL,
  title         VARCHAR(255) NOT NULL,
  video_ids     JSONB       NOT NULL DEFAULT '[]',
  status        VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_registry (
  id            BIGSERIAL PRIMARY KEY,
  key           VARCHAR(64)  NOT NULL UNIQUE,  -- 如 "product_writer"
  name          VARCHAR(128) NOT NULL,
  stage         VARCHAR(32)  NOT NULL,         -- 绑定阶段
  adapter       VARCHAR(64)  NOT NULL,         -- 实现标识
  params        JSONB        NOT NULL DEFAULT '{}',
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  cost_credits  INTEGER      NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### B.8 电商（Phase 5）

```sql
CREATE TABLE IF NOT EXISTS shops (
  id            BIGSERIAL PRIMARY KEY,
  owner_id      BIGINT      NOT NULL REFERENCES users(id),
  name          VARCHAR(255) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id            BIGSERIAL PRIMARY KEY,
  shop_id       BIGINT      NOT NULL REFERENCES shops(id),
  title         VARCHAR(255) NOT NULL,
  subtitle      VARCHAR(255) 【选填】,
  description   TEXT        NOT NULL,
  cover_url     VARCHAR(512)【选填】,
  price_cents   INTEGER     NOT NULL,            -- 分，避免浮点
  credit_price  INTEGER     【选填】,            -- 积分价（可与人民币并存）
  stock         INTEGER     NOT NULL DEFAULT 0,  -- 库存（行锁防超卖）
  ai_fields     JSONB       NOT NULL DEFAULT '{}', -- 智能体生成的结构化图文
  status        VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prod_shop ON products(shop_id, status);

CREATE TABLE IF NOT EXISTS product_skus (
  id            BIGSERIAL PRIMARY KEY,
  product_id    BIGINT      NOT NULL REFERENCES products(id),
  specs         JSONB       NOT NULL DEFAULT '{}', -- 颜色/尺码等
  price_cents   INTEGER     NOT NULL,
  stock         INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id),
  product_id    BIGINT      NOT NULL REFERENCES products(id),
  sku_id        BIGINT      【选填】,
  qty           INTEGER     NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);

CREATE TABLE IF NOT EXISTS orders (
  id            BIGSERIAL PRIMARY KEY,
  order_no      VARCHAR(40)  NOT NULL UNIQUE,
  user_id       BIGINT       NOT NULL REFERENCES users(id),
  total_cents   INTEGER      NOT NULL,
  credit_used   INTEGER      NOT NULL DEFAULT 0,  -- 积分抵现额（按汇率折算）
  pay_channel   VARCHAR(16)  【选填】,
  pay_status    VARCHAR(16)  NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at       TIMESTAMPTZ  【选填】
);
CREATE INDEX IF NOT EXISTS idx_ord_user ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT      NOT NULL REFERENCES orders(id),
  product_id    BIGINT      NOT NULL REFERENCES products(id),
  qty           INTEGER     NOT NULL,
  price_cents   INTEGER     NOT NULL,
  snapshot      JSONB       NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS coupons (
  id            BIGSERIAL PRIMARY KEY,
  code          VARCHAR(32)  NOT NULL UNIQUE,
  type          VARCHAR(16)  NOT NULL,   -- fixed|percent
  value         INTEGER      NOT NULL,
  min_spend     INTEGER      NOT NULL DEFAULT 0,
  expire_at     TIMESTAMPTZ  【选填】
);

CREATE TABLE IF NOT EXISTS reviews (
  id            BIGSERIAL PRIMARY KEY,
  product_id    BIGINT      NOT NULL REFERENCES products(id),
  user_id       BIGINT      NOT NULL REFERENCES users(id),
  rating        INTEGER     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content       TEXT        【选填】,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipments (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT      NOT NULL REFERENCES orders(id),
  carrier       VARCHAR(32) 【选填】,
  tracking_no   VARCHAR(64) 【选填】,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### B.9 全局智能体层（Phase 2，详见 §H）

```sql
CREATE TABLE IF NOT EXISTS agents (
  id            BIGSERIAL PRIMARY KEY,
  key           VARCHAR(64)  NOT NULL UNIQUE,  -- 如 "ops_bot"
  name          VARCHAR(128) NOT NULL,
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  daily_budget  INTEGER      【选填】,         -- 每日积分预算护栏
  config        JSONB        NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_providers (
  id            BIGSERIAL PRIMARY KEY,
  agent_key     VARCHAR(64)  NOT NULL,
  provider      VARCHAR(64)  NOT NULL,  -- 供应商标识
  model         VARCHAR(128) NOT NULL,
  weight        INTEGER      NOT NULL DEFAULT 1,
  priority      INTEGER      NOT NULL DEFAULT 10,
  cost_per_call INTEGER      NOT NULL DEFAULT 1,
  enabled       BOOLEAN      NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_ap_agent ON agent_providers(agent_key, enabled);

CREATE TABLE IF NOT EXISTS agent_calls (
  id            BIGSERIAL PRIMARY KEY,
  agent_key     VARCHAR(64)  NOT NULL,
  user_id       BIGINT       【选填】,
  provider      VARCHAR(64)  【选填】,
  ok            BOOLEAN      NOT NULL,
  latency_ms    INTEGER      NOT NULL,
  cost_credits  INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ac_agent_time ON agent_calls(agent_key, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_rules (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(128) NOT NULL,
  trigger       VARCHAR(64)  NOT NULL,  -- ban_ip|alert_error_rate|auto_reply
  condition     JSONB        NOT NULL,  -- 阈值等
  action        JSONB        NOT NULL,
  enabled       BOOLEAN      NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS agent_rule_logs (
  id            BIGSERIAL PRIMARY KEY,
  rule_id       BIGINT       NOT NULL,
  fired_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  result        TEXT         NOT NULL
);
```

---

<a id="c"></a>
## §C 认证与账务 API 契约

> 通用响应壳：
> ```json
> { "ok": true, "data": { ... } }      // 成功
> { "ok": false, "code": "ERR_xxx", "message": "用户可读信息" }  // 失败
> ```
> 鉴权头：`Authorization: Bearer <access_token>`（除 `/api/auth/*` 与 `/healthz`）。

### C.1 `POST /api/auth/register`

**鉴权**：无 ｜ **限流**：`api_zone`

请求体：
```json
{ "email": "user@example.com", "password": "Abc123!@#", "display_name": "小明" }
```
校验规则：
- email：RFC5322 基础正则，长度 ≤ 255，全小写规范化
- password：【必填】长度 8–64，须含大小写+数字（强密码策略，前端实时提示）
- display_name：【选填】缺省 "新用户"，≤ 64

成功（201）：
```json
{ "ok": true, "data": {
  "user": { "id": 12, "email": "user@example.com", "display_name": "小明", "role": "user", "credits_balance": 20 },
  "access_token": "eyJ...", "refresh_token": "eyJ...", "expires_in": 7200
}}
```
错误码：`ERR_EMAIL_EXISTS`(409) `ERR_WEAK_PASSWORD`(400) `ERR_INVALID_EMAIL`(400) `ERR_RATE_LIMIT`(429)

### C.2 `POST /api/auth/login`

**鉴权**：无 ｜ **限流**：`login_zone`（5 rps，burst 10）

请求体：`{ "email": "...", "password": "..." }`

成功（200）：同 register 的 token 结构（含 `credits_balance`）。

失败（401）：**统一返回** `ERR_AUTH_FAILED`（不区分"邮箱不存在/密码错"，防邮箱枚举）。登录失败计数写入 Redis（`login_fail:{ip}`），达 `RATE_BAN_THRESHOLD`(20) 自动封 IP 并入 `audit_logs`（action=security.ip_ban）。

### C.3 `POST /api/auth/refresh`

请求体：`{ "refresh_token": "eyJ..." }`
- 校验 jti 是否在 `token_blacklist`（登出后失效）
- 通过则签发新 `access_token`（不刷新 refresh，减少滚动风险）
成功（200）：`{ "ok": true, "data": { "access_token": "...", "expires_in": 7200 } }`
错误：`ERR_TOKEN_INVALID`(401) `ERR_TOKEN_REVOKED`(401)

### C.4 `POST /api/auth/logout`

**鉴权**：Bearer ｜ 请求体：`{ "refresh_token": "..." }`（可选，带则把 jti 进黑名单）
成功（200）：`{ "ok": true }`

### C.5 `GET /api/auth/me`

**鉴权**：Bearer ｜ 成功（200）：返回当前用户全字段（不含 `password_hash`）+ `credits_balance`。
错误：`ERR_UNAUTHORIZED`(401)

### C.6 `GET /api/credits/transactions`

**鉴权**：Bearer ｜ 查询参数：`?page=1&page_size=20&type=consume`

成功（200）：
```json
{ "ok": true, "data": {
  "items": [ { "id": 9, "type": "consume", "amount": -1, "balance_after": 19, "ref_type": "generation", "ref_id": "task_abc", "remark": "文生图", "created_at": "2026-08-02T03:11:00Z" } ],
  "total": 45, "page": 1, "page_size": 20
}}
```

### C.7 `POST /api/admin/users/:id/credits`（管理员手动充值/扣减）

**鉴权**：Bearer + `role=admin`
请求体：`{ "delta": 100, "remark": "活动赠送" }` ｜ `delta` 可正（充值）可负（扣减，但扣减后余额不可 < 0，否则 `ERR_INSUFFICIENT`）。

写入 `credit_transactions`（type=grant/adjust），返回新余额。

### C.8 `GET /api/admin/users`（管理后台用户列表）

**鉴权**：Bearer + admin ｜ 参数：`?q=keyword&role=user&status=active&page=1&page_size=20`
返回：`{ items:[{id,email,display_name,role,credits_balance,status,last_login_at,created_at}], total }`

详见文档其余 admin 端点（transactions / stats）在 DESIGN §11–§12。

---

<a id="d"></a>
## §D 计费一致性实现（原子预扣 / 幂等 / 回退）

### D.1 生成前原子预扣（防 1000 并发超扣）

```sql
-- 在事务内执行；cost 来自 models.credit_cost（缺省 GENERATION_DEFAULT_COST）
UPDATE users
SET credits_balance = credits_balance - $1,
    updated_at = now()
WHERE id = $2 AND credits_balance >= $1
RETURNING credits_balance;
```
- 返回行 → 预扣成功，继续生成；
- 返回空 → 余额不足，立即 `ERR_INSUFFICIENT`（**不消耗任何资源**）。

### D.2 成功落账 / 失败回退

```sql
-- 成功：写一笔 consume（amount 为负，balance_after = 预扣后余额）
INSERT INTO credit_transactions(user_id,type,amount,balance_after,ref_type,ref_id,remark)
VALUES ($2,'consume',-$1, (SELECT credits_balance FROM users WHERE id=$2), 'generation',$3,'文生图');

-- 失败：回退预扣
UPDATE users SET credits_balance = credits_balance + $1 WHERE id = $2;
INSERT INTO credit_transactions(...,'refund',+$1, (SELECT credits_balance...), 'generation',$3,'生成失败回退');
```

### D.3 幂等（任务级）

`/api/generate` 接收客户端 `task_id`（UUID）。同一 `task_id` 重复提交：
- 已存在 `generation_tasks` 行 → 直接返回已有状态，不重复计费（避免网络重试双扣）。
- dispatcher 后台执行完 UPDATE 状态，前端凭 `task_id` 轮询（见 DESIGN §生成刷新持久化）。

### D.4 下单防超卖（电商，Phase 5）

```sql
UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING stock;
-- 返回空 → ERR_OUT_OF_STOCK，整单回滚
```

---

<a id="e"></a>
## §E 模块化与编排（节点 API 约定 / Workflow 状态机）

### E.1 节点独立 API 约定（"每个节点都能单独用"）

每个创作/电商节点对外暴露**统一形态**的 REST：

```
GET    /api/nodes/{node_key}/items      # 列表（本人）
POST   /api/nodes/{node_key}/items      # 新建（触发该节点智能体）
GET    /api/nodes/{node_key}/items/:id  # 详情
PUT    /api/nodes/{node_key}/items/:id  # 编辑
DELETE /api/nodes/{node_key}/items/:id  # 删除
```

`node_key` ∈ {idea, script, storyboard, video, episode, product, order, ...}。
每个节点内部按 §F/§G 各自的数据表落地；横切（Auth/Credits/Agent/Skills）自动注入。

### E.2 Workflow 编排（"整体联动"）

`workflows` 表（设计预留）：
```sql
CREATE TABLE IF NOT EXISTS workflows (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id),
  steps JSONB NOT NULL,   -- [{node_key, input_from, status, output_ref}]
  status VARCHAR(16) NOT NULL DEFAULT 'running'
);
```
编排层逻辑（伪代码）：
```
for step in workflow.steps:
    input = resolve(step.input_from)        # 取上一步产物
    res = POST /api/nodes/{step.node_key}/items  body={...input}
    step.output_ref = res.id
    step.status = 'done'
    if step fails: workflow.status='paused'; break   # 支持断点续跑
```
- **断点续跑**：重启后从首个 `status != 'done'` 的 step 继续，已产出的不重做（靠 `output_ref` 幂等）。
- **回退迭代**：剧本不满意 → 手动把 `script` step 置 `pending`，重跑该步及之后。

### E.3 同一套接口两种用法

单独用 = 直接调节点 REST；联动 = Workflow 顺序调节点 REST。底层完全同一套，**零额外开发**。

---

<a id="f"></a>
## §F 创作流水线节点契约（Phase 4）

| 节点 | REST 入口 | 数据表 | 智能体（skill） | 计费 |
|---|---|---|---|---|
| 点子孵化 | `/api/nodes/idea` | `ideas` | brainstorm | 1 |
| 小说转剧本 | `/api/nodes/script` | `scripts` | screenwriter | 3 |
| 无限画布分镜 | `/api/nodes/storyboard` | `storyboards`+`canvas_nodes` | comic_layout | 按张 1/张 |
| 视频生成 | `/api/nodes/video` | `video_jobs` | video_gen | 10/片段 |
| 剧集管理 | `/api/nodes/episode` | `episodes` | publish_agent | 0（编排） |

每个节点 `POST` 创建时：校验积分 → 调 skill_registry 取 adapter → 调 Agent Layer 执行 → 写产物 → 落 `credit_transactions`。详见 DESIGN §13。

---

<a id="g"></a>
## §G 电商模块契约（Phase 5）

### G.1 八节点 × 智能体映射

| 节点 | 智能体 key | 做什么 |
|---|---|---|
| 商品上架 | `product_writer` | 根据素材自动生成标题/卖点/类目 |
| 详情设计 | `product_designer` | 生成结构化图文（功效对比/成分图谱/场景卡） |
| 营销文案 | `copywriter` | 种草文案/促销话术 |
| 智能客服 | `smart_cs`（复用 ops_bot） | 问答草稿、退换货引导 |
| 个性推荐 | `recommender` | 基于行为的推荐位 |
| 语义搜索 | `search_agent` | 自然语言搜商品 |
| 交易下单 | `deal_agent` | 凑单/优惠券最优组合 |
| 售后退换 | `aftersale_agent` | 自动初审退换申请 |

### G.2 详情页字段清单（`/product/:id`）

- **左：图区** — 主图轮播（cover_url + ai_fields.gallery[]）、缩略图条、放大镜/3D 预览占位
- **右上：信息区** — 标题、副标题、价格（¥xx.xx / 积分价）、销量、评分星、库存、规格 SKU 选择器、数量步进、加入购物车、立即购买
- **右：智能体协助面板**（DESIGN §15 mockup）— 按钮：改写卖点 / 写种草文案 / 配图建议 / 问答预测；输出区显示 agent 返回；可一键"应用到详情"
- **下：AI 结构化图文** — `ai_fields` 渲染的 功效对比表 / 成分图谱 / 场景卡（由 product_designer 生成）
- **下：评价** — 评分分布 + 最新 reviews

### G.3 下单流程（含积分抵现 + 防超卖）

```
1. 校验登录（Bearer）
2. 锁库存（§D.4 行锁）逐 SKU
3. 计算：total_cents - credit_used*RATE；credit_used 走 §D.1 原子预扣
4. 建 orders + order_items（pending）
5. 调支付（微信/支付宝/纯积分）→ 成功置 paid，失败回退库存+积分
6. 写 audit_logs(action=order.create)
```

---

<a id="h"></a>
## §H 总控台与智能体层监控

### H.1 SSE 实时推送协议

```
GET /api/admin/console/stream   (Bearer + admin)
-- 服务端 text/event-stream，每 1s 或事件触发推送：
event: metrics
data: {"online": 812, "qps": 43, "gen_today": 1290, "credit_today": 3012, "success_rate": 0.982, "avg_latency": 210}

event: traffic
data: {"t": "03:11:00", "qps": 45}

event: flow
data: {"id": 991, "user": "u12", "type": "consume", "amount": -1, "balance_after": 19, "ts": "..."}

event: log
data: {"level": "WARN", "action": "security.ip_ban", "msg": "1.2.3.4 banned", "ts": "..."}

event: agent
data: {"agent": "ops_bot", "calls": 12, "ok_rate": 1.0, "cost": 5, "ts": "..."}
```

前端用 `EventSource` 接收，零轮询；1000 用户只有 1 个 admin 连接，压力可忽略。

### H.2 指标定义与告警规则

| 指标 | 来源 | 告警阈值 |
|---|---|---|
| online 用户 | Redis `online:{uid}` TTL 心跳 | — |
| QPS | Redis 计数 + request_logs | > 800 持续 1m 预警 |
| 成功率 | agent_calls / request_logs | < 95% 告警 |
| 平均延迟 | request_logs.latency_ms | p95 > 1s 告警 |
| 错误率飙升 | request_logs status≥500 | 5xx 比率 > 2% 告警 |
| 异常 IP | login_fail / request_logs | 单 IP 失败 20 次 → 自动封（ops_bot） |
| 视频积压 | video_jobs status=pending 计数 | > 50 告警、弹性扩容 worker |

### H.3 自动化运营智能体（ops_bot）规则

| 规则 | 触发 | 动作 |
|---|---|---|
| ban_ip | login_fail ≥ 20 / IP | 写 IP 黑名单（Redis）+ audit_logs |
| alert_error_rate | 5xx 比率 > 2% | 推总控台 WARN + 通知 admin |
| auto_reply | 客服咨询命中知识库 | 生成应答草稿（人工确认后发） |

---

<a id="i"></a>
## §I 安全细则

### I.1 密码哈希（零原生依赖，Node `crypto.scrypt`）

```
salt = randomBytes(16)
hash = scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 })
存储： "scrypt$16384$8$1$" + saltHex + "$" + hashHex
验证： 取参重算比对（timingSafeEqual）
```
- N=16384 在千人在线下单次校验 < 50ms，可接受；如需更强可调 N=32768。

### I.2 JWT 结构

```
Header: { alg: "HS256", typ: "JWT" }
Payload(access): { sub: userId, role, jti, iat, exp }   exp = iat + 7200
Payload(refresh): { sub, jti, exp }                      exp = iat + 2592000
签名： HMAC-SHA256(base64(header)+"."+base64(payload), JWT_SECRET)
```
- access 无状态，多进程共享 JWT_SECRET 即可；
- refresh 的 jti 存入 `token_blacklist` 实现登出/封禁即时失效。

### I.3 防爆破 / 防枚举

- 登录限流（nginx `login_zone` 5rps burst10）+ Redis `login_fail:{ip}` 计数封禁；
- 登录失败统一 `ERR_AUTH_FAILED`，不暴露"邮箱不存在"；
- 注册邮箱存在返回 `ERR_EMAIL_EXISTS`（注册接口不限"是否存在"泄露，因本就是注册动作）。

### I.4 全局错误码表

| 码 | HTTP | 含义 |
|---|---|---|
| ERR_UNAUTHORIZED | 401 | 缺/无效 access token |
| ERR_TOKEN_INVALID | 401 | refresh/jti 非法 |
| ERR_TOKEN_REVOKED | 401 | token 已登出进黑名单 |
| ERR_AUTH_FAILED | 401 | 登录邮箱或密码错（统一） |
| ERR_EMAIL_EXISTS | 409 | 注册邮箱已存在 |
| ERR_WEAK_PASSWORD | 400 | 密码强度不足 |
| ERR_INVALID_EMAIL | 400 | 邮箱格式错 |
| ERR_INSUFFICIENT | 402 | 积分/库存不足 |
| ERR_RATE_LIMIT | 429 | 触发限流 |
| ERR_NOT_FOUND | 404 | 资源不存在 |
| ERR_PERMISSION | 403 | 角色/权限不足 |
| ERR_OUT_OF_STOCK | 409 | 商品超卖 |

---

<a id="j"></a>
## §J 配置参数总表（默认值一览）

| 参数 | 默认 | 说明 |
|---|---|---|
| PORT | 3001 | Node 监听 |
| PG_POOL_MAX | 10 | 每进程 PG 连接（×实例数 ≤ PgBouncer 池） |
| REDIS 持久化 | AOF everysec | 黑名单/限流不丢 |
| JWT_ACCESS_TTL | 7200s | access 时效 |
| JWT_REFRESH_TTL | 2592000s | refresh 时效 |
| SIGNUP_FREE_CREDITS | 20 | 注册赠送 |
| GENERATION_DEFAULT_COST | 1 | 默认单次生成消耗 |
| RATE_LOGIN_RPS | 5 | 登录限流 |
| RATE_API_RPS | 30 | 通用 API 限流 |
| RATE_BAN_THRESHOLD | 20 | 封 IP 失败次数 |
| scrypt N | 16384 | 密码派生复杂度 |
| PM2 instances | max | = vCPU |
| nginx client_max_body_size | 50m | 上传上限 |
| proxy_read_timeout | 120s | 视频生成慢接口 |

---

## 落地顺序建议（详细版）

1. **Phase 0**：§A 全部配置 + §B 建表脚本（自动化 `CREATE TABLE IF NOT EXISTS` 内联进 server.js，沿用现有模式）+ §I 安全基线。
2. **Phase 1**：§C 认证 8 接口 + §D 计费一致性 + 前端 AuthContext/登录注册页/路由守卫/用户菜单（见 DESIGN §5）。
3. **Phase 2**：§H 总控台 + §B.9 智能体层 + admin 后台 + 支付适配器（dev 模拟）。
4. **Phase 3**：§A.2–A.4 生产部署脚本固化 + README。
5. **Phase 4**：§E/§F 创作流水线 + §B.7 表。
6. **Phase 5**：§G 电商 + §B.8 表。

> 本文档随编码推进持续补全各 Phase 的"前端组件 props / 状态管理 / 测试清单"等更细一层。需要我把某一 Phase 再往下钻（例如 Phase 1 的前端组件树 + 每个组件的 props/状态/交互），直接说"展开 Phase X"。
