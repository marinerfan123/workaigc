# 版本变更记录（CHANGELOG）

> 本文件记录每次版本（提交）的改动内容，便于回溯与回退。
> **约定**：每次提交代码必须同步更新本文件，写清「日期 + commit + 做了什么」。
> **备份策略**：接入重大改动前，先打 `backup/*` annotated tag 作为可回退快照。

---

## 当前稳定版本

### 2026-08-06 · commit `8f41c2b` — 接入 shadcn/ui 大改前的稳定备份点
- Workspace / ModelHub / GenerationBar 三处遮挡与懒加载问题已全部修复并验证通过
- 支付安全：已彻底移除 DEV / 模拟支付路径，仅保留真实易支付通道
- 已打备份 tag：`backup/stable-2026-08-06`
- 完整历史见下方「版本明细」

---

## 版本明细（新 → 旧）

### 2026-08-07（启动白屏修复）
- `9dbc0b7` **fix(app)**：`FirstRunGate` 缺少 `useNavigate` import，导致运行时 `ReferenceError: useNavigate is not defined`，页面直接白屏崩溃。补 `import { Routes, Route, useNavigate } from 'react-router-dom'`；typecheck/build 通过。

### 2026-08-06（premium 玻璃套件）
- `f31479b` **feat(premium)**：新增 `src/components/premium/` 可复用高级效果套件——`LiquidGlass`（液体玻璃容器，subtle/strong 双变体，mask-composite 渐变描边）、`BlurText`（IntersectionObserver 逐词 blur 入场）、`FadingVideo`（rAF 驱动交叉淡入、手动 loop）、`FadeIn`/`fadeIn`（Framer Motion blur+y 错峰入场封装）；`src/styles/premium.css` 落地精确液体玻璃 CSS。
- `f31479b` **feat(theme)**：`index.html` 引入 Instrument Serif + Barlow 字体；`tailwind-theme.css` 加 `--font-display` / `--font-barlow` 令牌（`font-display` 默认斜体）；全站可用 `font-display` / `font-barlow` 工具类。
- `f31479b` **feat(setup-demo)**：`SetupWizardPage` 主面板与「已完成」面板改用 `LiquidGlass`，欢迎标题用 `BlurText`，整卡用 `FadeIn` 错峰淡入，作为套件在应用内的示范（功能与 emerald/zinc 结构不变）。
- 依赖：framer-motion 12 已在项目内，无需新增；`tsc` 未引入新错误，`vite build` 成功。

### 2026-08-06（初始化向导版）
- `0e94bea` **feat(setup)**：新增首次部署初始化向导 `/setup`（前端多步 premium 暗色页面，未初始化访问站点根路径自动跳转）+ 后端 `GET /api/setup/status`、`POST /api/setup/init`（fails-closed：首个管理员建好后返回 409 锁定，无法重复初始化）。
- `0e94bea` **security**：管理员账号不再硬编码弱口令，改为 opt-in（仅当显式设置 `ADMIN_SEED_PASSWORD` 才自动建）；否则由 `/setup` 向导接管，消除公开仓库硬编码弱口令风险。
- `0e94bea` **feat(seed)**：新增 `server/seed-defaults.cjs` 首次部署兜底种子（占位服务商 + 常用图像模型 DALL·E 3 / SDXL / FLUX，enabled=false，需填 Key 启用；`ON CONFLICT DO NOTHING` 幂等），在 `initDB` 中 providers 表为空时自动写入。
- `0e94bea` **docs**：README 部署章节补充本地（compose 内置 PG/Redis）与远程（RDS 经 `.env` 的 PG_HOST/REDIS_HOST）双路径 + `/setup` 向导使用说明。

### 2026-08-06
- `8f41c2b` **fix(generation-bar)**：三个抽屉（图像质量/清晰度/比例、模型选择、智能体菜单）全部 `createPortal` 渲染到 `document.body`，遮罩 `z-[9998]`、面板 `z-[9999]`，基于触发按钮 `getBoundingClientRect()` 定位，scroll/resize 自动关闭 → 抽屉永远在最外层，不再被卡片遮挡。
- `f11f25d` **fix(modelhub)**：修复「服务商删除后刷新复现」。根因 `POST /api/providers` 走 upsert 不删除；改为事务内先删 keepIds 外的 models/providers 再 upsert。`useModelHub.deleteProvider` 改 async 并行 DELETE + 本地过滤（失败回滚）；`apiDeleteProvider` 不再静默吞错。
- `b57b48f` **fix(ui)**：MediaCard「更多」菜单改 Portal 到 body（修复 `will-change` 包含块导致浮层错位）；懒加载加三重兜底（hover 强制 / 挂载 600ms / 2.5s 硬超时）解决灰卡片；Workspace gridCols 修复 S/M 重复。
- `5aa21e1` **fix(workspace)**：恢复底部生成栏被 `git reset --hard` 冲掉的 `relative z-40` 层级；MediaCard 正式接入 `useInView` 视口懒加载（`useImageProbe` 加 `enabled` 开关）。
- `c1dd87a` **fix(security)**：彻底移除全部 DEV/模拟支付路径（`isDevPayAllowed`/`devPayPage`/callback/路由），无 provider 时 `createOrder` 返回 503；接真实 webhook 四关 fails-closed；顺带修 ModelHub 重复卡片。
- `454412b` **fix(model-hub)**：移除 providers tab 重复的 ProviderSchedulerStatus 卡片网格。

### 2026-08-05
- `cad2edc` **fix(oss/ui)**：客户上传图自动上 OSS；修复移动端布局塌方。
- `d5ff591` **refactor(modelhub)**：删冗余 OSS 操作日志卡片；storage tab 容器加宽；刷新不保持状态。
- `1a5e73a` **feat(oss)**：OssConfigPanel 双栏布局 + 实时 SSE 日志流。
- `65fdf91` **feat(oss)**：多槽位 OSS + 腾讯云 COS + 协议配置抽屉 + 布局重构。
- `0d814f9` **refactor(dispatcher)**：统一共享 B 桶调度 + 方向 A/B 容量模型 + COLD 状态机。
- `c668d03` **docs**：更新上线清单 OSS 状态与 IndexedDB 说明。
- `8deaf10` **移除 IndexedDB**：资产改 OSS 主路径 + 模型官方链接兜底。
- `b04008d` **支付 P0 收尾 + A 图消失修复 + 上线准备**。

### 2026-08-04
- `144cf1c` 移除 GenerationBar forwardRef，消除 React 19 dev 警告。
- `8729fcb` 挂载 sonner Toaster，消除 props ref 警告。
- `fcb81cc` RechargeModal 补 useEffect 导入，修复工作台白屏。
- `a4bb743` **feat(finance)**：Phase4 充值/积分/后台账务系统落地。
- `dd70564` fix(deploy)：RPM 感知调度器 + Node/PM2 版本统一。
- `ca033e2` fix(admin)：ensureUserDefaults 登录排除 admin，示例只推顾客。
- `a7ca2e6` feat(admin)：后台示例库模块，一键推送示例给顾客。
- `41e5664` fix：越权/隔离漏洞、补齐路由、强化管理员密码。
- `69a9aac` fix：补齐前端路由鉴权守卫。
- `6b6654b` fix：修复整页空白（UsersPage 缺默认导出 + api.ts 缺失导出）。
- `e3dc684` feat(generation-bar)：折叠尺寸设置到向上弹窗。
- `d96c4c5` feat(admin)：实时日志总线（PG/Redis 连接监控）。
- `48f66e9` feat(admin)：实时监控大屏，全站 HTTP 活动流。
- `05d66dc` feat：后台安全加固 + 模型管理并入后台。
- `417c127` feat：公共默认资产(per-user seed) + Node 静态路由修复。
- `e69da35` feat：商用化 alpha，多用户骨架 + 设计骨架 4 项 + estimated_seconds 回填。

### 2026-08-03
- `3199499` feat(nav)：统一全局产品切换条 ProductSwitcher。
- `c36bf46` feat(shop)：Phase 5 电商模块(AI 市集) 接真实后端数据。
- `c83287b` 多产品导航承接闭环：ProductSwitcher 接入 Studio/Shop/Admin 壳。
- `f74b964` 多租户隔离红线：媒体与 OSS 资产按用户 id 隔离。

---

## 后续约定
- **每次提交**：commit message 写清改动；同步在上方「版本明细」追加一条（日期分组）。
- **重大改动前**：`git tag -a backup/<描述>-<日期> -m "..."` 打快照。
- **回退方式**：`git checkout backup/<tag>` 查看快照，或 `git revert <commit>` 反向提交。
