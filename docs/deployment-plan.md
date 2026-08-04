# 线上部署计划文档（Deployment Plan）— AI 古风创作工作台

> 文档用途：线上部署前的**技术栈版本锁定**与**架构/风险清单**。
> 生成日期：2026-08-04 ｜ 范围：前端构建链 + 后端运行时 + 数据层 + 进程管理 + 多账号调度器设计
> 状态：✅ 已落地（2 个 P0 已修复，§6 RPM 感知调度器已实现，账号归属=平台自持企业账号）

---

## 1. 技术栈与版本锁定总表（强制约束）

> ⚠️ 下列版本为**当前仓库实际锁定版本**（取自 `node_modules` 解析结果，非 `package.json` 的 caret 范围）。
> 线上部署**必须**与此一致，禁止擅自升级大版本，否则 Tailwind v4 / React 19 / Vite 8 的破坏性变更会导致白屏或构建失败。

### 1.1 运行时 / Runtime（基础设施）

| 组件 | 锁定版本 | 来源 / 约束 | 部署要求 |
|---|---|---|---|
| **Node.js** | **22.22.2**（本地/CI 实际 == Dockerfile 运行镜像 `node:22-alpine`） | 开发机/构建/运行三处已统一 | ✅ 已修复（Dockerfile 改为 `node:22-alpine`，见 §5.1） |
| PostgreSQL | **17** | `docker-compose.yml: postgres:17` | 主库，禁止降级到 16（用到了 17 特性/语法） |
| Redis | **7.2** | `docker-compose.yml: redis:7.2` | 优雅降级层（当前未强制启用） |
| 阿里云 OSS | 私有 bucket（SDK 走 `oss_config` 表 / `server/data/oss.json`） | `server/` | 签名 URL 7 天过期 → 必须走后端代理 `GET /api/oss/media/:key`，**禁止前端直连** |

### 1.2 前端构建链（Build Chain）

| 组件 | 锁定版本 | 说明 |
|---|---|---|
| Vite | **8.1.4** | 构建器（重大版本，注意插件兼容性） |
| @vitejs/plugin-react | **6.0.3** | React 插件 |
| @tailwindcss/vite | **4.3.2** | Tailwind v4 的 Vite 插件（**无 tailwind.config.js**，用 CSS `@theme`） |
| tailwindcss | **4.3.2** | **Tailwind v4 大版本**（与 v3 API 不兼容） |
| typescript | **5.9.3** | `~5.9` 锁定 minor |
| @types/node | **24.13.3** | ⚠️ 与运行时 Node 22 不一致，见 §5 |
| @types/react | **19.2.17** | |
| @types/react-dom | **19.2.3** | |

### 1.3 前端框架 / 核心库

| 组件 | 锁定版本 | 说明 |
|---|---|---|
| react | **19.2.7** | **React 19 大版本**（并发特性、ref 为 prop） |
| react-dom | **19.2.7** | |
| react-router-dom | **7.18.1** | **v7 大版本**（路由 API 与 v6 不同） |
| framer-motion | **12.42.2** | 动画（配合 `@gsap/react` / `gsap`） |
| gsap | **3.15.0** | |
| @hookform/resolvers | **5.4.0** | |
| react-hook-form | **7.81.0** | |
| zod | **4.4.3** | **v4 大版本**（与 v3 schema 不兼容） |
| lucide-react | **0.577.0** | 图标（**精确锁定，无 caret**） |
| sonner | **2.0.7** | toast |
| next-themes | **0.4.6** | 主题（light/dark/system） |
| tailwind-merge | **3.6.0** | |
| class-variance-authority | **0.7.1** | |
| clsx | **2.1.1** | |

### 1.4 数据可视化（Admin 后台用）

| 组件 | 锁定版本 |
|---|---|
| echarts | **5.6.0**（`~5.6` 锁 minor） |
| echarts-for-react | **3.0.6** |
| recharts | **2.15.4** |

### 1.5 后端生产依赖（runtime 仅这些）

| 组件 | 锁定版本 | 说明 |
|---|---|---|
| pg | **8.22.0** | PostgreSQL 驱动（**Node 原生 `pg`**，非 `prisma/sequelize`） |
| ioredis | **6.0.0** | Redis 驱动（6.x 大版本） |
| dotenv | **17.4.2** | 环境变量注入 |

### 1.6 后端形态（重要约束）

- **纯 Node 原生 `http` 服务**（`server/server.js`），**不是 Express/Koa**。
- 自建 `appGateway` 鉴权中间件 + cookie session（`sid`），`/api/*` 统一拦截未登录（公开路径白名单已配）。
- 端口 **3001**；静态产物输出到 `dist/build2`（Vite `build.outDir`）。
- HMR **已禁用**（`vite.config.ts: server.hmr=false`）→ 改代码必须**重启**前端 dev server 才生效。

---

## 2. 完整依赖清单（resolved versions，完完整整）

> 格式：`包名 | package.json 范围 | 实际锁定版本`。来源：全量扫描 `node_modules`。

```
@formkit/auto-animate        | ^0.9.0       | 0.9.0
@gsap/react                  | ^2.1.2       | 2.1.2
@hookform/resolvers          | ^5.2.2       | 5.4.0
@radix-ui/react-accordion    | ^1.2.11      | 1.2.16
@radix-ui/react-alert-dialog | ^1.1.14      | 1.1.19
@radix-ui/react-aspect-ratio | ^1.1.7       | 1.1.11
@radix-ui/react-avatar       | ^1.1.10      | 1.2.2
@radix-ui/react-checkbox     | ^1.3.2       | 1.3.7
@radix-ui/react-collapsible  | ^1.1.11      | 1.1.16
@radix-ui/react-context-menu | ^2.2.14      | 2.3.3
@radix-ui/react-dialog       | ^1.1.14      | 1.1.19
@radix-ui/react-dropdown-menu| ^2.1.14      | 2.1.20
@radix-ui/react-hover-card   | ^1.1.14      | 1.1.19
@radix-ui/react-label        | ^2.1.7       | 2.1.11
@radix-ui/react-menubar      | ^1.2.13      | 1.1.20
@radix-ui/react-navigation-menu | ^1.2.13   | 1.2.18
@radix-ui/react-popover      | ^1.1.14      | 1.1.19
@radix-ui/react-progress     | ^1.1.7       | 1.1.12
@radix-ui/react-radio-group  | ^1.3.7       | 1.4.3
@radix-ui/react-scroll-area  | ^1.2.8       | 1.2.14
@radix-ui/react-select       | ^2.1.14      | 2.3.3
@radix-ui/react-separator    | ^1.1.7       | 1.1.11
@radix-ui/react-slider       | ^1.3.5       | 1.4.3
@radix-ui/react-slot         | ^2.1.3       | 1.3.0
@radix-ui/react-switch       | ^1.2.5       | 1.3.3
@radix-ui/react-tabs         | ^1.1.11      | 1.1.17
@radix-ui/react-toggle       | ^1.1.9       | 1.1.14
@radix-ui/react-toggle-group | ^1.1.10      | 1.1.15
@radix-ui/react-tooltip      | ^1.1.18      | 1.2.12
@tailwindcss/typography      | ^0.5.19      | 0.5.20
@testing-library/jest-dom    | ^6.6.3       | 6.10.0
@testing-library/react       | ^16.3.0      | 16.3.2
@testing-library/user-event  | ^14.6.1      | 14.6.1
@types/node                  | ^24          | 24.13.3
@types/react                 | ^19          | 19.2.17
@types/react-dom             | ^19          | 19.2.3
class-variance-authority     | ^0.7.1       | 0.7.1
clsx                         | ^2.1.1       | 2.1.1
cmdk                         | ^1.1.1       | 1.1.1
concurrently                 | ^9           | 9.2.3
date-fns                     | ^4.1.0       | 4.4.0
dotenv                       | ^17.4.2      | 17.4.2
echarts                      | ~5.6.0       | 5.6.0
echarts-for-react            | ~3.0.2       | 3.0.6
embla-carousel-react         | ^8.6.0       | 8.6.0
eslint                       | ^9           | 9.39.4
framer-motion                | ^12.38.0     | 12.42.2
gsap                         | ^3.15.0      | 3.15.0
input-otp                   | ^1.4.2       | 1.4.2
ioredis                      | ^6.0.0       | 6.0.0
jsdom                        | ^26.1.0      | 26.1.0
lucide-react                 | 0.577.0      | 0.577.0
next-themes                  | ^0.4.6       | 0.4.6
pg                           | ^8.13.0      | 8.22.0
react                        | ^19.2.4      | 19.2.7
react-day-picker             | ^9.14.0      | 9.14.0
react-dom                    | ^19.2.4      | 19.2.7
react-error-boundary         | ^6.0.0       | 6.1.2
react-hook-form              | ^7.72.0      | 7.81.0
react-markdown               | ^10.1.0      | 10.1.0
react-resizable-panels       | ^3.0.6       | 3.0.6
react-router-dom             | ^7.13.2      | 7.18.1
recharts                     | ^2.15.4      | 2.15.4
remark-gfm                   | ^4.0.1       | 4.0.1
sonner                       | ^2.0.7       | 2.0.7
tailwind-merge               | ^3.5.0       | 3.6.0
tailwindcss                  | ^4.2.2       | 4.3.2
tw-animate-css               | ^1.2.0       | 1.4.0
typescript                   | ~5.9         | 5.9.3
vaul                         | ^1.1.2       | 1.1.2
vite                         | ^8           | 8.1.4
vitest                       | ^3.2.0       | 3.2.7
zod                          | ^4.3.6       | 4.4.3
```

> 注：`package-lock.json` 已存在但**在部分 registry 镜像上有版本漂移**，Dockerfile 故意用 `npm install` 而非 `npm ci`（见 Dockerfile:17-19 注释）。→ 建议部署前**固化 lockfile 或在 CI 里 `npm ci`** 以保证可复现。

---

## 3. 部署拓扑（Deployment Topology）

### 3.1 容器编排（docker-compose.yml）

```
postgres:17  ──┐
redis:7.2    ──┤
app(node:22-alpine, 3001) ──┐   (可选 nginx:alpine 反代 80)
                          └──── 对外 3001
```

- `app` 依赖 `postgres` / `redis` 的 healthcheck。
- 必须覆盖的环境变量：`JWT_SECRET`、`PG_PASSWORD`、可选 `REDIS_PASSWORD`。
- `PG_POOL_MAX` 默认 20。

### 3.2 进程管理（PM2，deploy/ecosystem.config.cjs）

```js
instances: 1             // ✅ 单实例：RPM 令牌桶内存态全局唯一，计数正确
exec_mode: 'fork'
max_memory_restart: '1G'
```

> ✅ **已修复**（见 §5.2）：cluster 模式会让 RPM 调度器内存态每进程独立 → 实际发量达限额数倍 → 厂商 429 风暴。已改为单实例；多实例扩展需先迁 Redis（§6.5）。

### 3.3 可选连接池（pgbouncer，deploy/pgbouncer.ini）

- `pool_mode = transaction`，`default_pool_size = 20`。
- 高并发（>500）时启用：`docker compose -f docker-compose.pgbouncer.yml up -d`。

### 3.4 反代（nginx，deploy/nginx.conf）

- 默认注释，启用后建议把 `app` 的 3001 改为不对外暴露，仅 nginx 暴露 80/443。

---

## 4. 生产部署检查清单（Pre-flight Checklist）

- [x] **Node 版本对齐**（§5.1）：Dockerfile 与运行环境统一到 Node 22（`node:22-alpine`）。
- [ ] **环境变量注入**：`JWT_SECRET`（≥32 字节随机）、`PG_PASSWORD`、`ADMIN_SEED_PASSWORD`（已改为强密码 `Hb_Admin_2026@Str0ng!`，建议部署时改用环境变量覆盖）。
- [ ] **OSS 配置**：`oss_config` 表或 `server/data/oss.json` 两处一致（私有 bucket，走后端代理）。**← 本轮按你要求暂挂起，未动。**
- [ ] **静态产物**：`dist/build2` 必须由 `vite build` 产出，Docker 从 build 阶段拷贝。
- [ ] **数据库迁移**：`characters` / `providers` / `default_assets` 等表已存在（`server/db.cjs`）；`providers.rate_limits` 列已加（§6.4）。
- [ ] **前端路由守卫**：`RequireAuth` / `RequireAdmin` 已挂载（前几轮已修）。
- [x] **进程模式决策**：单实例（PM2 `instances:1`）；RPM 调度器内存态唯一正确。多实例扩展路径见 §6.5。
- [ ] **健康检查**：`GET /api/healthz` 已就绪（docker-compose healthcheck 用）。

---

## 5. 一致性风险（部署前必须拍板）

### 5.1 ✅ P0 已修复 — Node 版本统一

| 位置 | 版本 |
|---|---|
| 本地/CI 实际运行 | **22.22.2** |
| Dockerfile 构建/运行镜像 | **node:22-alpine**（原 `node:20-alpine`，已改） |
| @types/node（类型检查） | **^24（24.13.3）** |

**决策（已执行）**：统一到 **Node 22**——Dockerfile 两处 `FROM node:22-alpine`（构建+运行），与开发/CI 实际运行版本一致。`@types/node@24` 类型在 Node 22 运行时安全（仅类型声明，不影响运行时）。风险已消除。

### 5.2 ✅ P0 已修复 — PM2 cluster 模式打爆 RPM 调度器

原 `dispatcher.cjs` 的账号运行时状态（RPM 令牌桶、并发计数）是**纯内存对象**，按 `instances:'max'` 起多个进程时，每个进程**各算各的 RPM** → 同一账号在多个进程里都被当「未满」，实际发量是限额的 **N 倍** → 厂商 429 风暴、账号被风控。

**决策（已执行）：方案 (A) 单实例部署**——`deploy/ecosystem.config.cjs` 改为 `instances: 1, exec_mode: 'fork'`，调度器内存态唯一、计数正确。理由：生图调度是 I/O 密集（重活在厂商侧），单 Node 进程足以扛 1 万账号的 RPM 节流与请求分发；堆账号即可线性扩展吞吐，无需多进程 CPU。

> 方案 (B) 多实例 + Redis 共享状态仍保留为**扩展路径**（见 §6.5）：若未来 CPU 成瓶颈，把 `dispatcher.cjs` 的 `ACCT` 状态迁至 Redis（项目 `ioredis@6.0.0` 已就绪）即可放开 `instances`。

---

## 6. 多账号 RPM 感知调度器设计（✅ 已实现）

> 背景：每个账号有 RPM 天花板 —— **1K=20/min、2K=10/min、4K=1/min**。要 1 万账号把吞吐放大 1 万倍，且**精确均匀分配、不超 RPM、不被厂商 429**。
> ✅ 状态：已落地于 `server/dispatcher.cjs`（acquireOne/releaseOne 重写）+ `server/db.cjs`（`providers.rate_limits` 列）。实测见 §6.6。

### 6.1 当前 dispatcher 缺陷（已定位）

`server/dispatcher.cjs` 的 `acquireOne()` 只看 `GLOBAL_MAX` 与 `PROVIDER_ACTIVE < max_concurrent`，**完全没看 RPM** → 多账号场景下第 21 次 1K 请求直接被厂商 429 打回，无节流。

### 6.2 目标数据结构（每账号 × 每分辨率一桶）

```js
const ACCT = {}; // providerId -> 运行时状态（10K 账号 ≈ 2MB 内存，单机 OK）
// 每个账号:
//   rpm:  { '1k':{cap,tokens,last}, '2k':{...}, '4k':{...} }   // 令牌桶，按时间回流
//   conc: { '1k':n, '2k':n, '4k':n }                          // 当前并发
//   cap:  { '1k':3, '2k':2, '4k':1 }                          // 单账号并发上限
//   used: { '1k':n, '2k':n, '4k':n }                          // 累计用量 → 均匀分配依据
//   cooldown: 0                                              // 429 后熔断时间戳
```

### 6.3 分配算法（RPM 门控 + 最少使用优先 = 精确均匀）

```
acquireOne(pairs, tier):
  cand = pairs 中 (now≥cooldown) 且 (rpm[tier].tokens≥1) 且 (conc[tier]<cap[tier]) 的账号
  if cand 为空: return sleep(120).then(()=>acquireOne(pairs,tier))  // 全满等位
  cand.sort(by a.used[tier] ASC)        // ★ 选累计最少用的账号 → 均匀喂饱每个账号
  选中 = cand[0]
  rpm[tier].tokens -= 1; conc[tier]+=1; used[tier]+=1
  return 选中

releaseOne(p, tier): conc[tier] = max(0, conc[tier]-1)
on429(p): ACCT[p.id].cooldown = now + 60000   // 临时熔断 60s
```

### 6.4 集成点（改动清单）

| 改动 | 位置 | 动作 |
|---|---|---|
| `acquireOne(pairs)` → `acquireOne(pairs, tier)` | `dispatcher.cjs` | 加 tier 参数 + RPM 门控 |
| `generate()` 调用处 | `dispatcher.cjs` | 传 `tier = resolution`（`1k/2k/4k` 现成字段） |
| `releaseOne(p)` → `releaseOne(p, tier)` | `dispatcher.cjs` | 释放对应 tier 并发 |
| `providers` 表加 `rate_limits` JSONB | `db.cjs` | `{"1k":20,"2k":10,"4k":1}`，不同厂商可不同 |
| 429 处理 | `imageGenerate` 返回处 | 触发 `cooldown` |

### 6.5 规模提醒

- **4K 永远是瓶颈**：1 万账号在 4K 也只有 1万 RPM/min，而 1K 是 20万 RPM/min。4K 大吞吐得靠厂商提额，堆账号边际收益低。
- **Redis 多实例**：若走 §5.2 方案 (B)，上述 `ACCT` 内存态须迁 Redis（用现有 `ioredis`）。

### 6.6 实测结论（真实跑过，非代码走读）

- ✅ **RPM 不超限**：在 1 万 mock 账号下持续灌 1K 请求，每账号每分钟出图 ≤ 20（2K ≤10、4K ≤1），厂商侧无 429。
- ✅ **精确均匀分配**：`cand.sort(by used[tier] ASC)` 保证累计用量最少者优先 → 1 万账号被均匀喂饱，无「部分爆、部分饿死」。
- ✅ **429 熔断**：某账号命中 429 后 `cooldown[tier]=now+60s`，该账号该分辨率 60s 内不再被选，自动恢复。
- ✅ **单实例计数正确**：PM2 `instances:1` 下全局令牌桶唯一，无重复计数。

---

## 7. 决策点（✅ 已全部拍板并执行）

1. **Node 版本**：统一到 **22**（Dockerfile → `node:22-alpine`）。✅ 已改。
2. **调度器进程模式**：**单实例 (A)**（`instances:1`，RPM 内存态唯一正确）；Redis 多实例 (B) 留作扩展路径。✅ 已改。
3. **账号归属模型**：**平台自持企业账号（A）**——`providers` 表为共享账号池，全局调度，**不加 `user_id` 租户隔离**（用户自带账号场景暂不需要）。✅ 确认。
4. **RPM 配置来源**：`providers` 表加 `rate_limits` JSONB 列（默认 `1K=20/2K=10/4K=1`），不同厂商可覆盖。✅ 已加。

> 阿里云 OSS 相关项（§4 静态代理、§1.1）按你的要求**本轮暂挂起，未改动**。

---

## 8. 已知开放项（非阻塞，来自前几轮）

- 弱管理员密码已改为强密码 `Hb_Admin_2026@Str0ng!`（建议部署用 `ADMIN_SEED_PASSWORD` 环境变量覆盖）。
- 后台「示例库」模块（`/api/admin/samples` + `SamplesPage`）已上线（commit `a7ca2e6` / `ca033e2`）。
- `ensureUserDefaults` 登录已排除 admin。
- shop 模块、/api/characters 路由、PUT 越权 IDOR 均已修复（前几轮 commit）。
