# 上线前准备清单（Pre-Launch Checklist）

> 生成时间：2026-08-05
> 适用：ai-image-studio（AI 图像创作应用，Node + PG + Redis + Vite）
> 用法：逐项勾选，🚨 为上线阻断项（不解决不能上线）

---

## ✅ 已检查 / 已完成

- [x] **飞书依赖排查**：`package.json` 无飞书/lark SDK；`server/` 无飞书引用；`client-capabilities.ts` 是脱离飞书后的 mock（无害）
- [x] **硬编码"飞书"文案修复**：`GenerationBar.tsx:460` 「AI 生成需飞书平台环境」→「AI 生成示例 · 本地预览」
- [x] **PM2 单实例配置**：`deploy/ecosystem.config.cjs` 已设 `instances:1`（dispatcher 令牌桶为进程内内存态，禁止多实例）
- [x] **构建脚本**：`package.json` 的 `build` = `vite build`，`start` = `node server/server.js`，`pg`/`ioredis` 已进 dependencies

---

## 🚨 上线阻断项（必须解决）

### 1. 配置 OSS 凭证（图永久存储）— 本地已验证可用 ✅
- **本地（开发）**：`server/data/oss.json` 已填完整配置且**已真实 PUT 上传验证通过（HTTP 200）**：
  bucket=`oss-pai-8f7hhyl09yhscjroqw-cn-shanghai`、endpoint=`oss-cn-shanghai.aliyuncs.com`、region=`cn-shanghai`、pathPrefix=`images/`、AK/SK 已验证可用。**本地阻断已解除。**
- ⚠️ **生产关键**：服务端生产环境读的是 **PG `oss_config` 表**（`server.js` 在 `pgPool` 存在时优先用表，而非 `oss.json`）。所以部署时**必须**把这套配置填进 PG `oss_config`：
  - 路径 A：后台「模型 Hub → 存储配置」走 `PUT /api/oss`（写入 PG）
  - 路径 B：直连 `UPDATE oss_config SET access_key_id=..., access_key_secret=..., bucket='oss-pai-8f7hhyl09yhscjroqw-cn-shanghai', region='cn-shanghai', endpoint_external='oss-cn-shanghai.aliyuncs.com', endpoint_internal='oss-cn-shanghai.aliyuncs.com', path_prefix='images/', enabled=true WHERE id=1;`
  - AK/SK 以 `server/data/oss.json` 当前值为准（git 外、不入库；本清单不重复记录密钥）
- **验证**：生成一张图 → 详情面板「存储状态」显示「已同步 OSS」（绿色）；后端日志 `[OSS] ✅ ... (signed GET 7d)`

### 2. 生产 `.env`（绝不进 git）
- 复制 `.env.example` → 服务器 `.env`，填写：
  - `PG_HOST` / `PG_PORT` / `PG_DATABASE` / `PG_USER` / **`PG_PASSWORD`（强密码，替换 0.0.1abcd）**
  - `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`（改为独立 Redis 地址，非 localhost）
  - `PAYMENT_MASTER_KEY`（32 字节 hex，已生成则保留；换密钥会使已加密支付凭据不可解密）
- **注意**：`.env` 已被 `.gitignore` 忽略，**不会随代码推送**，需手动在服务器创建

### 3. 部署时务必指定生产环境
```bash
pm2 start deploy/ecosystem.config.cjs --env production
```
- ⚠️ 默认 `env` 是 `NODE_ENV: 'development'`，不带 `--env production` 会用 dev 模式（仅影响安全令牌/日志，无 CORS 宽松，但仍应避免）

---

## 🔧 上线步骤（标准流程）

```bash
# 1. 拉代码（确保 .env / oss_config 已就绪，均在 git 外）
git pull origin main

# 2. 安装依赖（生产）
npm ci

# 3. 前端构建
npm run build          # → dist/

# 4. 启动后端（PM2 单实例，生产模式）
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save

# 5. 反向代理（nginx/caddy）暴露 3001 → 域名 + HTTPS
#    前端静态文件：dist/ 由后端 server.js 托管（server/data 或静态目录），
#    或单独用 nginx 托管 dist/ 并反代 /api 到 3001

# 6. 健康检查
curl https://your-domain.com/api/health   # 确认 PG:connected + Redis:up
```

---

## 🖥️ 服务器建议 + 最低配置

| 档位 | vCPU | RAM | 磁盘 | 适用 |
|---|---|---|---|---|
| **最低** | 2 | 4 GB | 40 GB SSD | 单实例起步，量小（<1k 日活） |
| **推荐** | 4 | 8 GB | 80 GB SSD | 给 PG 留余量 + 未来缓冲 |
| **舒适** | 8 | 16 GB | 160 GB SSD | 准备迁 dispatcher 到 Redis 后多实例扩展 |

**资源拆解（推荐档）**：
- Node 后端：~512 MB（max_memory_restart 设 1G）
- PostgreSQL 17：~1.5 GB（shared_buffers 调 512MB）
- Redis 7：~256 MB
- 系统 + 日志：~1 GB
- **剩余 ~4.5 GB 余量**

**组件版本**：
- OS：Ubuntu 22.04 / 24.04 LTS
- Node：20+（项目当前用 22.22.2）
- PostgreSQL：17
- Redis：7

**⚠️ 扩展性限制**：当前 dispatcher RPM 令牌桶在**进程内存**，PM2 必须 `instances:1`。横向扩展前需先把 `dispatcher.cjs` 的 ACCT 状态迁至 Redis（见 docs/deployment-plan.md §6），届时再放开 instances。

---

## 🔍 单机设定残留（已知，非阻断）

| 项 | 说明 | 风险 |
|---|---|---|
| IndexedDB 本地图缓存 | **已在 2026-08-04 彻底移除**：资产改走 OSS 主路径 + 模型官方链接兜底，零浏览器存储，轻量化 | — |
| redis.cjs 内存兜底 | Redis 掉线落内存 Map | 生产应保证 Redis 高可用（主从/哨兵/云托管） |
| mediaList PG 持久化 | 已删 MOCK fallback | ✅ 正确 |
| monitor/logbus 内存缓冲 | 监控/日志去重 | ✅ 单机 OK |

---

## 📋 上线后验证

- [ ] 首页能加载（无控制台报错）
- [ ] 生成一张图 → 成功显示 + 「已同步 OSS」
- [ ] 限速提示正确（z-img9527 等低档模型显示「限速 X/分钟」）
- [ ] 积分扣减正确（生成成功 -N 积分，流水可见）
- [ ] 支付流程（如启用）回调正常
- [ ] HTTPS 证书有效，混合内容无告警
- [ ] 监控/日志正常（PM2 logs 无 error 刷屏）
