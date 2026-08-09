# AI 古风创作承接页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有根路由改造成一页接近参考图的中文深色创作产品承接页，并保留现有认证状态、积分菜单和业务路由。

**Architecture:** 继续使用现有 `LandingPage` 单页组件和 Tailwind v4 utility classes，不新增页面路由或外部依赖。页面由固定顶栏、首屏价值主张、五阶段流水线、已开放能力和底部 CTA 组成；所有 CTA 继续进入现有工作台、素材库、角色管理和 AI 市集。

**Tech Stack:** React 18, TypeScript, React Router, Tailwind CSS v4, lucide-react, Vite.

## Global Constraints

- 界面语言为中文，主题为纯黑深色模式。
- 继承工作区现有未提交改动，不回滚用户文件。
- 不把浏览器状态作为服务端媒体或角色数据的权威来源。
- 交互按钮提供 hover、focus-visible、disabled 等状态；图标使用 lucide-react。
- 不引入新的图片依赖，承接页使用 CSS 网格、线性图标和现有项目字体资源。

---

### Task 1: 承接页视觉与交互重做

**Files:**
- Modify: `src/pages/LandingPage/LandingPage.tsx`
- Modify: `src/index.css` only if the page needs a reusable animation or responsive correction

**Interfaces:**
- Consumes: `useAuth`, `setAuthModalOpen`, `refreshUser`, `logout`, `isPathLocked`, existing React Router paths.
- Produces: responsive root route with working CTAs, user menu, feature cards, pipeline status and anchor navigation.

- [ ] 保留现有用户菜单和认证入口，统一按钮高度、焦点环、图标间距和文字层级。
- [ ] 重排首屏为参考图中的紧凑左对齐布局，使用纯黑网格背景、克制的青绿强调色和明确的主次 CTA。
- [ ] 将流水线卡片和能力卡改为更轻的工作台模块样式，确保桌面五列、平板两列、窄屏一列不溢出。
- [ ] 为导航锚点、工作台、素材库、角色和市集入口保留实际链接，并处理锁定创作室状态。

### Task 2: 验证

**Files:**
- Test: `src/pages/LandingPage/LandingPage.tsx` via TypeScript, ESLint, Vite build and local browser smoke check.

**Interfaces:**
- Consumes: Task 1 page output.
- Produces: evidence for compile, build and visible desktop/mobile layout.

- [ ] 运行 `npm run lint` 并修复新增错误。
- [ ] 运行 `npx tsc -b tsconfig.app.json` 并修复类型错误。
- [ ] 运行 `npm run build` 并确认构建退出码为 0。
- [ ] 使用本地页面检查首屏、滚动到能力区、用户菜单和移动宽度布局。

### Task 3: 工作状态记录

**Files:**
- Modify: `.codex/context/ACTIVE_STATE.md`

**Interfaces:**
- Consumes: verified diff and command output.
- Produces: compact resumable state with changed files, known risks and verification evidence.

- [ ] 记录当前目标、变更文件、已确认事实、验证命令和剩余风险。
