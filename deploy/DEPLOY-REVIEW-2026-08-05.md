# 上线部署全面排查报告（2026-08-05）

> 适用范围：`ai-image-studio`（AI 图像创作应用，React + Vite + 原生 Node 后端 + PG + Redis）
> 本文在你已有的 `deploy/PRE-LAUNCH-CHECKLIST.md` 基础上，**补充它没覆盖的部署级 bug 与完整部署方案**。
> 所有配置修改已落地（见「已修复项」）。

---

## 一、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + Vite 8 + TypeScript 5.9 | SPA，`vite build` → `dist/build2` |
| 样式 | Tailwind CSS v4 + @tailwindcss/vite | 无独立 CSS 文件，原子类驱动 |
| 路由 | React Router 7 | 含 `/workspace` `/studio` `/shop` `/admin` 等 |
| 动效 | framer-motion + gsap + @formkit/auto-animate | |
| UI | Radix UI 全套 + lucide-react + sonner(toast) | |
| 图表 | echarts / recharts | 监控大屏 |
| 后端 | **原生 Node HTTP**（`server/server.js`，ESM，~3000 行）+ 模块化 `*.cjs` | 无 Express/Fastify，手写路由分发 |
| 数据 | `pg`（PostgreSQL 17 连接池）+ `ioredis`（Redis 7.2） | Redis 缺失自动降级内存 |
| 配置 | `dotenv` 外置 `.env` | 不入库 |
| 认证 | 自签 JWT（HMAC-SHA256，cookie `sid`） | `JWT_SECRET` 环境变量 |
| 存储 | 阿里云 OSS / 腾讯云 COS（浏览器直传签名 URL） | 业务服务器零字节 |
| 部署 | Docker 多阶段 / docker-compose（PG+Redis+app+可选 nginx）/ pm2 裸机 | 见第三节 |

**关键事实**：前端静态与后端 API **同域**。`src/services/api.ts` 的 `ensureApi()` 用 `window.location` 自动推导 API base（`${protocol}//${host}`），再请求 `/api/token` 拿全局 token。**部署时前端静态与后端必须同源**（nginx 反代 `/api` 到 3001，静态由后端或 nginx 同域托管），否则自动发现会失效。

---

## 二、文件结构（关键路径）

```
ai-image-studio/
├── package.json            # scripts: dev / build(=vite build) / start(=node server/server.js) / typecheck
├── vite.config.ts          # outDir=dist/build2, copyPublicDir=true(已修), proxy /api→3001
├── index.html              # <div id="root">, 引用 /favicon.svg, 入口 /src/index.tsx
├── src/                    # 前端
│   ├── components/         # GenerationBar(生图条) / Sidebar / Layout / DetailPanel / ui/ ...
│   ├── pages/              # Workspace / Studio / Shop / Admin / Library / Characters ...
│   ├── hooks/              # useOssConfig / useMediaCounts ...
│   ├── services/api.ts     # 唯一数据通道，ensureApi 自动发现后端
│   └── data/               # 类型与默认数据
├── server/                 # 后端
│   ├── server.js           # 主入口：端口 3001，托管 dist/build2，SPA fallback，CSP 头
│   ├── dispatcher.cjs      # 厂商调度（进程内 RPM 令牌桶 → 必须单实例）
│   ├── oss-logger.cjs / db.cjs / auth.cjs / admin.cjs / shop.cjs / payments.cjs ...
│   └── data/               # oss.json / .api_token / media.json / models.json / providers.json（均不入库）
├── public/                 # favicon.svg / icons.svg / samples/*（示例素材；/samples 路由由此读取）
├── deploy/
│   ├── Dockerfile          # 多阶段构建（已修：COPY public）
│   ├── docker-compose.yml  # PG17 + Redis7.2 + app + 可选 nginx（已修：env_file）
│   ├── nginx.conf          # 反代 + 限流 + CSP + HTTPS 模板（已修：CSP 对齐 / server_name）
│   ├── ecosystem.config.cjs# pm2 单实例（instances:1 强制）
│   └── PRE-LAUNCH-CHECKLIST.md  # 你已有的上线清单（OSS/.env/pm2 已覆盖）
└── .env / .env.example     # 生产凭据（.env 不入库）
```

---

## 三、部署架构与两种路线

### 路线 A：Docker（推荐，一键编排）
`docker-compose.yml` 编排 `postgres:17` + `redis:7.2` + `app`（build 自 Dockerfile）+ **可选 nginx**。
- Dockerfile 多阶段：`build` 阶段 `npm run build` 产出 `dist/build2`；`runtime` 阶段装 prod 依赖 + `COPY server` + `COPY public` + `COPY --from=build /app/dist`。
- 默认 **nginx 是注释掉的**，即 `app` 在 `3001` **裸 HTTP 直出**。

### 路线 B：pm2 裸机
`pm2 start deploy/ecosystem.config.cjs --env production`（单实例，NODE_ENV=production）。
- 前置 nginx + HTTPS（同 `deploy/nginx.conf`）。

> ⚠️ **两条路线都依赖 nginx 做 HTTPS 反代**。后端 `server.js` 只监听 HTTP 3001，自身无 TLS。

---

## 四、🚨 上线阻断项（本次新发现，清单未覆盖）

| # | 问题 | 后果 | 状态 |
|---|---|---|---|
| B1 | **nginx CSP `connect-src 'self'`（缺 `https:`）** | 浏览器→OSS 直传 PUT 被 CSP 拦死（和本地调试时一模一样的问题，搬到生产会重演） | ✅ 已修：对齐后端 `connect-src 'self' https: ws: wss:` |
| B2 | **nginx HTTPS 未启用 + compose 默认无 nginx（app 3001 裸 HTTP）** | 前端 `https://www.fanan.fun` 页 fetch 到 HTTP 后端 = 混合内容被拦；OSS CORS 来源 `https` 与页面非 https 不匹配 | 🔧 **必须启用**：填证书路径 + 取消注释 443 段（模板已就位） |
| B3 | **vite `copyPublicDir: false`** | 生产 `favicon.svg` / `/samples/*` 不进 `dist` → 404 | ✅ 已修：`true` |
| B4 | **Docker 不拷 `public/`** | 容器里 `server.js` 读 `/samples/` 路由 404（SamplesPage 用 `/samples/character.svg`） | ✅ 已修：Dockerfile `COPY public ./public` |
| B5 | **`.dockerignore` 排除整个 `server/data`** | 容器缺 `models.json`/`providers.json`/`settings.json` 公共 JSON 兜底（PG 正常时 OK，PG 挂则无兜底） | ✅ 已修：细化为仅排除凭据/上传，保留公共 JSON |

### 已由你现有清单覆盖（确认 OK，不重复）
- OSS 凭证必须写入 PG `oss_config` 表（生产读表不读 `oss.json`）✅
- 生产 `.env` 覆盖 `PG_PASSWORD`/`REDIS`/`PAYMENT_MASTER_KEY` ✅
- `pm2 --env production`（否则走 development 模式）✅

---

## 五、🔧 本次已修复的配置

1. `vite.config.ts` → `copyPublicDir: true`（favicon/samples 进 `dist/build2`）
2. `server/server.js` `serveStatic` → `/assets/*`（vite contenthash 产物）改用 `Cache-Control: public, max-age=31536000, immutable`；`index.html` 仍 `no-store`（修复首屏每次重拉 837KB，利于 <1.5s 目标）
3. `deploy/nginx.conf` → CSP `connect-src` 对齐后端（含 `https: ws: wss:`）；`server_name www.fanan.fun fanan.fun`
4. `Dockerfile` → 加 `COPY public ./public`
5. `docker-compose.yml` → `env_file: - .env`（用宿主机 `.env` 覆盖默认危险值）
6. `.dockerignore` → `server/data` 细化为仅排除 `.api_token`/`oss.json`/`media.json`/`media-uploads/`，保留公共 JSON 进镜像

验证：`node --check server/server.js` OK；`vite build` 成功且 `dist/build2/favicon.svg` + `dist/build2/samples/` 已生成。

---

## 六、🟡 优化 / 待办（非阻断）

1. **单 chunk 837KB**：`vite build` 提示 chunk > 500kB。建议路由级 `React.lazy` + vendor 分包（react / echarts），满足首屏 <1.5s。当前不影响上线。
2. **docker-compose `app` 端口 `3001:3001` 公网暴露**：启用 nginx 后应改为 `expose: ["3001"]`（仅内网），避免后端 HTTP 直连。
3. **HTTPS 证书**：`deploy/nginx.conf` 的 443 段已写完整模板，但 `ssl_certificate` 路径需你填真实证书（Let's Encrypt 或阿里云 DV）。填好并取消注释即可。
4. **默认危险值**：`JWT_SECRET=change-me...`、`ADMIN_SEED_PASSWORD=Admin@123456`、`PG_PASSWORD=0.0.1abcd` 是占位符，`server.js` 启动会 warn；务必用 `.env` 覆盖（已加 `env_file`，但 `.env` 里要真的填）。
5. **CSP `frame-ancestors 'none'` + 后端无 `X-Frame-Options`**：nginx 已加 `X-Frame-Options DENY`，双保险 OK。

---

## 七、完整上线步骤（推荐 Docker 路线）

```bash
# 0. 前置：服务器已装 Docker + 有域名 www.fanan.fun 解析到本机 + 已申请 TLS 证书
#    证书放到 /etc/nginx/ssl/fullchain.pem + privkey.pem

# 1. 拉代码
git pull origin main

# 2. 创建生产 .env（复制 .env.example，覆盖所有默认值）
cp .env.example .env
#   必填：JWT_SECRET(随机长串) / PG_PASSWORD(强密码) / ADMIN_SEED_PASSWORD(强密码)
#        / REDIS_PASSWORD / PAYMENT_MASTER_KEY(32字节hex) / PG_HOST(若用compose内部则留默认)

# 3. 构建并启动（PG + Redis + app）
docker compose up -d --build

# 4. 启用 nginx + HTTPS
#   - 编辑 deploy/nginx.conf：填 ssl_certificate 路径、取消注释 listen 443 段
#   - 编辑 docker-compose.yml：取消注释 nginx 服务块
#   - docker compose up -d nginx
#   （或在宿主机独立装 nginx，include 该 conf）

# 5. OSS 凭证入 PG（清单 B 项）
#   后台「模型 Hub → 存储配置」填阿里云 OSS，或直连 UPDATE oss_config ...

# 6. 健康检查
curl https://www.fanan.fun/api/healthz   # 期望 PG:connected + Redis:up

# 7. 冒烟：首页加载无报错 → 生成一张图 → 详情「已同步 OSS」→ 积分扣减正确
```

**pm2 路线**（`deploy/ecosystem.config.cjs`）：`npm ci && npm run build && pm2 start deploy/ecosystem.config.cjs --env production`，前置同上 nginx + HTTPS。

---

## 八、上线后验证清单

- [ ] 首页加载无控制台报错；favicon 正常显示（不再 404）
- [ ] 生成图片 → 详情「存储状态：已同步 OSS」（绿色）
- [ ] 手机端布局正常（汉堡抽屉 + pill 行不竖排）
- [ ] HTTPS 证书有效，无混合内容告警（DevTools Security 面板）
- [ ] OSS 直传成功（DevTools Network 无 CSP / CORS 红 X）
- [ ] `/samples/*` 资源可访问（不再 404）
- [ ] 静态 JS/CSS 带 `Cache-Control: immutable`（首屏可缓存）
- [ ] `curl /api/healthz` 显示 PG:connected + Redis:up
- [ ] 后端日志无 `SECURITY ⚠️ JWT_SECRET 未设置` / `ADMIN_SEED_PASSWORD 默认` 警告
- [ ] pm2/docker 进程稳定，无 error 刷屏
```
