# 续建进度总览（Phase 2 收尾 + Phase 3）

本会话在「全栈顺序推进 2→3→4→5」框架下，闭合了 Phase 2 收尾（充值/支付）并完成了 Phase 3（生产部署加固 + 安全）。

## 一、Phase 2 收尾 #165 — 充值订单 + DEV 支付适配器（M2 账务）
- **后端** `server/payments.cjs`（新）：`recharge_orders` 建表 + 创建订单 + **幂等回调入账**（HMAC 验签 + `SELECT FOR UPDATE` 防重放/双入账）+ 订单历史 + DEV 模拟支付页。
- **后端** `server.js`：注入 payments 模块，路由 `/api/credits/orders`（POST 创建 / GET 历史 / dev-pay 模拟页 / callback 幂等）。
- **前端** `src/services/api.ts`：三函数 `apiCreateRechargeOrder` / `apiListRechargeOrders` / `apiRechargeCallback`。
- **前端** `src/components/RechargeModal.tsx`（新）：金额预设+自定义、微信/支付宝渠道、DEV 模拟支付、成功动画 + `refreshUser` 刷新积分。
- **前端** `src/components/TopBar.tsx`：账户区新增「充值」按钮挂接弹窗。
- **测试**：注册(50)→建单→回调→积分 80；二次回调 `alreadyPaid`；未登录 401。`vite build` 0 错误（1854 模块）。
- 推送 `2d3f42a → 98c1ccf`（5 文件 +442）。

## 二、Phase 3 #166 — 生产部署加固 + 安全头部 + 禁用 dev 令牌
- **安全响应头** `applySecurityHeaders`（server.js）+ nginx.conf 双保险：CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy；生产追加 HSTS。
- **生产禁用 dev 令牌**：`NODE_ENV=production` 且未显式提供 `API_TOKEN` 环境变量时，自动生成的系统令牌不再被 `appGateway` 接受（消除后门）；会话 cookie 鉴权不受影响（已确认全仓无端点仅凭 `system` 身份放行）。
- **生产自检告警**：JWT_SECRET 默认值 / 管理员默认密码 / dev 令牌禁用 → 打印 `[SECURITY]` 警告。
- **限流**：`/api/generate` 每 IP 60s 30 次，防刷爆供应商配额与积分滥用。
- **Dockerfile 修复**：运行时阶段 `COPY dist` → `COPY --from=build`（原从被 `.dockerignore` 排除的构建上下文拷贝，容器构建必失败）。
- **测试**：dev 安全头齐全 + 支付回归通过；production 启动告警触发、自动令牌 401、cookie 用户 200。
- 推送 `98c1ccf → 76614f5`（3 文件 +57/-3）。

## 三、关键工程事件
- 本机 `.git/index` 此前损坏（不跟踪真实文件，`git diff` 会幻觉删除核心文件）。已用临时索引 `GIT_INDEX_FILE=.git/tmp_index git read-tree <远端tip>` + 显式 `git add` + `write-tree` + `commit-tree -p` + 按 SHA 直推 `origin/main` 绕过；随后 `git read-tree <新tip>` + `git update-ref` 修复本地索引与 HEAD，现已对齐 `76614f5`。

## 四、待办（下一阶段）
- #168 Phase 4：创意生产流水线（M5，9 表 + /studio 五节点 REST + 2 页）
- #167 Phase 5：电商模块（M6，9 表 + /shop 六页）
- 本地遗留漂移（与本次无关，勿误提交）：`.gitignore`/`src/index.css` 因 CRLF 显示 M；`docs/PHASE0_*_VALIDATION.md` 未跟踪。

> 开发服务器运行于 `http://localhost:3001`（PG + Redis 已连）。
