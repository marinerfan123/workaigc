# 13 - 配置与 Secrets 清单

> 审计对象：墨灵 AI（E:\code）
> 审计性质：**只读**；结论以源码/配置文件为准，未运行任何写入/变更命令。
> 证据等级图例：【源码已证实】【运行时已证实】【数据库已证实】【测试已证实】【文档记载但源码未证实】【推断】【未知·待核验】

---

## 1. 审计范围与关键结论速览

- 活动 `.env`（E:\code\.env，15 行）**仅含 9 项**：PG×5、REDIS×3、PAYMENT_MASTER_KEY×1。
- `.env.example` 声明的 `NODE_ENV / PORT / JWT_SECRET / PG_POOL_MAX / ADMIN_SEED_*` **均未出现在活动 `.env`** → 生产部署存在多处回退到不安全默认值的风险（尤其 `JWT_SECRET` 回退 `'dev-only-change-me'`，会话可被伪造）。
- OSS 密钥、上游服务商密钥、支付凭据**均不在 `.env`**：OSS 与 provider 密钥以**明文存于 PostgreSQL**；支付凭据经 **AES-256-GCM（PAYMENT_MASTER_KEY）加密**后存于 `payment_providers`。
- `.env` 本身被 `.gitignore` 排除（不进 git），但**未纳入任何备份**，且**无密钥轮换机制**。

---

## 2. 配置项与 Secrets 总清单

### 2.1 活动 `.env` 中实际存在（E:\code\.env）

| # | Key | 来源文件/行 | 是否敏感 | 当前值形态 | 是否纳入备份 | 安全建议 | 证据等级 / 置信度 |
|---|-----|------------|---------|-----------|------------|---------|------------------|
| 1 | `PG_HOST` | .env:2 | 否 | 明文 `localhost` | 否（.env 未备份） | 内网固定即可 | 【源码已证实】高 |
| 2 | `PG_PORT` | .env:3 | 否 | 明文 `5432` | 否 | — | 【源码已证实】高 |
| 3 | `PG_DATABASE` | .env:4 | 低 | 明文 `huabu` | 否 | — | 【源码已证实】高 |
| 4 | `PG_USER` | .env:5 | 中 | 明文 `postgres`（**超级用户**） | 否 | 改专用低权账号，忌用超级用户直连应用 | 【源码已证实】高 |
| 5 | `PG_PASSWORD` | .env:6 | **高** | 明文弱口令 `0.0.1abcd` | 否 | 立即改为强随机；当前值可被轻易猜测。密钥入库管理 | 【源码已证实】高 |
| 6 | `REDIS_HOST` | .env:9 | 否 | 明文 `localhost` | 否 | — | 【源码已证实】高 |
| 7 | `REDIS_PORT` | .env:10 | 否 | 明文 `6379` | 否 | — | 【源码已证实】高 |
| 8 | `REDIS_PASSWORD` | .env:11 | 中（**空=无认证**） | 明文（**空**） | 否 | **必须设置密码**；当前 Redis 无认证，同网段可读写 | 【源码已证实】高 |
| 9 | `PAYMENT_MASTER_KEY` | .env:15 | **极高** | 64 hex（AES-256-GCM 主密钥） | 否（.env 未备份） | 入密钥库/机密管理；**丢失=全部已加密支付凭据不可解密**；轮换需重新录入所有支付服务商凭据 | 【源码已证实】高 |

### 2.2 `.env.example` 声明但活动 `.env` 缺失（预期生产应配）

| # | Key | 期望来源 | 是否敏感 | 活动 .env 缺失后的实际取值 | 是否纳入备份 | 安全建议 | 证据等级 / 置信度 |
|---|-----|---------|---------|--------------------------|------------|---------|------------------|
| 10 | `NODE_ENV` | .env.example:2 | 否 | 缺失 → 默认 `undefined` → 应用以 **dev** 模式运行 | 否 | 生产必须为 `production`（docker-compose 已设，但裸跑缺失） | 【源码已证实】高 |
| 11 | `PORT` | .env.example:3 | 否 | 缺失 → 默认 `3001` | 否 | — | 【源码已证实】高 |
| 12 | `JWT_SECRET` | .env.example:7 | **极高** | 缺失 → 回退固定值 `'dev-only-change-me'`（server.js:3714 告警） | 否 | **必须设强随机**；否则会话 JWT（HMAC-SHA256）可被伪造 | 【源码已证实】高 |
| 13 | `PG_POOL_MAX` | .env.example:15 | 否 | 缺失 → 默认 `10` | 否 | 高并发调大（20–50） | 【源码已证实】高 |
| 14 | `ADMIN_SEED_EMAIL` | .env.example:24 | 低 | 缺失 → 不建管理员（安全默认，server.js:768 仅当 `ADMIN_SEED_PASSWORD` 存在才建） | 否 | 按需设置 | 【源码已证实】高 |
| 15 | `ADMIN_SEED_PASSWORD` | .env.example:25 | **高** | 缺失 → **不自动建管理员**（安全默认）；若误设为默认 `Admin@123456` 会触发 server.js:3717 告警 | 否 | 若启用务必强密码 | 【源码已证实】高 |

### 2.3 不在 `.env`，存于数据库 / 运行时注入

| # | Key / 凭据 | 实际来源 | 是否敏感 | 当前值形态 | 是否纳入备份 | 安全建议 | 证据等级 / 置信度 |
|---|-----------|---------|---------|-----------|------------|---------|------------------|
| 16 | OSS 密钥（`access_key_id` / `access_key_secret`） | **PG：`oss_config` / `oss_configs` 表**（server.js:196–229；db.cjs:94–108） | **极高** | **明文存库，未加密** | 随 PG 备份（密文？否，明文） | 不应进 `.env` 本身合理；但**库内应加密/密钥隔离**；访问需最小权限 | 【源码已证实】高 |
| 17 | 上游服务商密钥（`providers.api_key`） | **PG：`providers` 表**（server.js:110） | **高** | **明文存库** | 随 PG 备份（明文） | 视合规要求考虑加密落库 | 【源码已证实】高 |
| 18 | 支付服务商凭据（`pid` / `pkey` / `webhook_secret`） | **PG：`payment_providers` 表**，经 `payments/crypto.cjs` AES-256-GCM 加密 | **极高** | 密文（`iv.tag.cipher`，crypto.cjs:33） | 随 PG 备份（**密文**） | 主密钥管理见 #9；对外 API 仅返回脱敏串 | 【源码已证实】高 |
| 19 | `PUBLIC_BASE_URL` | 仅 `payments.cjs:152` 读取 `process.env` | 低 | 活动 .env 缺失 → 回退请求 Host（本地联调） | 否 | 生产配公网可达域名，否则支付回调收不到 | 【源码已证实】中 |

> **关于"OSS 配置缺失"的核实结论**：`.env` 中**确实没有**任何 OSS/provider 级密钥，这不是遗漏，而是**设计上 OSS 密钥存于 `oss_config` / `oss_configs` 数据库表**（前端 OssConfigPanel 编辑、后端 oss-logger.cjs 脱敏回显）。因此 OSS 密钥既不在 `.env`、也非环境变量注入，而是**数据库托管 + 明文落库**。风险点在于"明文存库"而非"密钥位置"。

---

## 3. 重点风险标注

### 3.1 PG 明文弱口令（`PG_PASSWORD=0.0.1abcd`）
- 形式：明文、弱、且 `PG_USER=postgres` 为超级用户。【源码已证实】高。
- 影响：数据库可被同网段直接接管；应用以超级用户直连，越权面大。
- 建议：强随机口令 + 专用低权库账号；口令纳入密钥管理，不存明文 `.env`。

### 3.2 PAYMENT_MASTER_KEY（AES-256-GCM 主密钥，64 hex）
- 形式：`.env:15` 明文 64 hex，用于 `payments/crypto.cjs` 加密支付服务商凭据。【源码已证实】高。
- 关键约束（crypto.cjs:18、payments.cjs 注释）：**密钥缺失则支付密钥操作 fail-closed（拒绝明文存储）**；**改密钥会使已加密凭据全部不可解密，需重新录入**。【源码已证实】高。
- 当前 `.env` 内嵌明文、未备份、无轮换——一旦 `.env` 丢失/损坏，历史支付配置不可恢复。

### 3.3 Redis 无密码（`REDIS_PASSWORD=` 空）
- `redis.cjs:11` 与 `db.cjs:26` 均为 `process.env.REDIS_PASSWORD || undefined`；活动值为空。【源码已证实】高。
- 同网段任意进程可读写缓存/限流/队列。建议设密码并启用 `requirepass`。

### 3.4 OSS / Provider 密钥明文存库
- `oss_config`、`providers.api_key` 均以明文列存于 PG（server.js:110、196–229）。【源码已证实】高。
- 仅支付凭据走 AES-256-GCM 加密，OSS 与上游服务商密钥未加密。建议对敏感凭据统一加密落库或外置 KMS。

---

## 4. 密钥管理风险

| 风险项 | 现状 | 证据 | 置信度 |
|-------|------|------|-------|
| 明文 `.env` 未备份 | `.env` 被 `.gitignore` 排除，仓库 `backups/` 仅含 `db/`（逻辑库备份），无 `.env` 备份 | 【源码已证实】 | 高 |
| 无密钥轮换机制 | 代码中无轮换接口；`PAYMENT_MASTER_KEY` 注释明确"改密钥须重录凭据" | 【源码已证实】 | 高 |
| 密钥与代码同机明文 | `.env` 与源码同目录，仅靠 gitignore 防入库 | 【源码已证实】 | 高 |
| 弱口令/默认回退 | `PG_PASSWORD` 弱；`JWT_SECRET` 缺失回退 `'dev-only-change-me'`；`ADMIN_SEED_PASSWORD` 默认 `Admin@123456` 告警 | 【源码已证实】 | 高 |
| 敏感凭据明文落库 | OSS / provider 密钥明文；支付凭据密文 | 【源码已证实】 | 高 |

---

## 5. 审计发现摘要（最关键风险 5 条）

1. **`JWT_SECRET` 缺失→会话可被伪造**：活动 `.env` 无 `JWT_SECRET`，`auth.cjs:9` 回退固定 `'dev-only-change-me'`，生产若未显式注入强密钥，Cookie JWT 可被任意签发。【源码已证实·高】
2. **PG 弱口令 + 超级用户直连**：`PG_PASSWORD=0.0.1abcd` 且 `PG_USER=postgres`，明文、弱、未备份。【源码已证实·高】
3. **`PAYMENT_MASTER_KEY` 明文未备份无轮换**：丢失即全部支付配置不可解密，且无轮换/备份路径。【源码已证实·高】
4. **Redis 无认证**：`REDIS_PASSWORD` 为空，同网段可未授权读写。【源码已证实·高】
5. **OSS / 上游服务商密钥明文存库**：与已加密的支付凭据不同，这两类高敏凭据以明文落 PG，且随库备份一并明文外泄。【源码已证实·高】
