# AI 古风创作工作台 - 需求拆解文档

## 产品概述

- **产品类型**: AI 图像/视频创作工具（AIGC 创作工作台）
- **场景类型**: <scene_type>prototype-app</scene_type>
- **目标用户**: AI 古风内容创作者、汉服爱好者、国风设计师
- **核心价值**: 一站式完成古风人像的图片/视频生成、素材管理、角色一致性维护与作品导出
- **界面语言**: 中文
- **主题偏好**: 深色（参考截图全部为纯黑背景深色模式，视觉风格统一）
- **导航模式**: 路径导航
- **导航布局**: Sidebar（左侧侧边栏，三栏工作台布局）

---

## 页面结构总览

> **说明**：参考 Google Flow 的三栏工作台布局，左侧导航 + 中间素材网格 + 右侧详情面板，底部悬浮创作输入框。共规划 3 个一级页面 + 1 个二级页面。

| 页面名称 | 文件名 | 路由 | 页面类型 | 入口来源 |
|---------|-------|------|---------|---------|
| 创作工作台 | `WorkspacePage.tsx` | `/` | 一级 | 导航 |
| 图片编辑页 | `ImageEditorPage.tsx` | `/edit/:id` | 二级 | 工作台 → 点击图片卡片 |
| 素材库 | `LibraryPage.tsx` | `/library` | 一级 | 导航 |
| 角色管理 | `CharactersPage.tsx` | `/characters` | 一级 | 导航 |

> **页面精简理由**：
> - 「场景」「上传的内容」「工具」「回收站」等功能合并进素材库页的筛选/分类，不单独成页，避免页面碎片化
> - 设置、帮助、关于等通过右上角菜单触发，不占独立页面
> - 图片编辑为二级页，从工作台点击进入

---

## 页面布局建议

### 创作工作台（WorkspacePage）

- **布局模式**: 三栏主从布局（Sidebar + 素材网格主区 + 右侧详情面板）+ 底部悬浮输入栏
- **视觉重心**: 中间素材网格区（生成的图片/视频是核心产出，占最大面积）
- **结果承载区**: 中间瀑布流/网格布局展示生成结果；右侧面板展示选中作品的提示词、模型、日期等详情；初始态为示例占位（3-5 张古风汉服示例图 + 空状态提示）
- **源材料承载区**: 底部输入栏左侧展示已添加的参考图缩略图（图生图模式下持续可见），支持点击预览/移除

### 图片编辑页（ImageEditorPage）

- **布局模式**: 居中大图预览 + 顶部历史缩略图横条 + 底部编辑输入栏
- **视觉重心**: 中央大图预览区（用户要仔细查看和修改生成结果）
- **结果承载区**: 大图预览区；顶部横向排列历史生成版本缩略图，支持快速切换对比；初始态为当前选中图片

### 素材库（LibraryPage）

- **布局模式**: 顶部搜索筛选栏 + 左侧分类过滤 + 右侧素材网格
- **视觉重心**: 素材网格（浏览和管理素材）
- **结果承载区**: 瀑布流网格展示素材卡片；初始态为全部素材列表

### 角色管理（CharactersPage）

- **布局模式**: 左侧角色列表 + 右侧角色详情/预览
- **视觉重心**: 角色形象预览与一致性管理
- **结果承载区**: 右侧展示选中角色的多张形象图 + 角色描述 + 生成记录；初始态为第一个角色详情

---

## 插件规划

| 插件实例名称 | 基于官方插件 | 业务用途 | 输出模式 | 所属页面 |
|------------|-----------|---------|---------|---------|
| ai-image-generate | ai-text-to-image | 根据用户输入的提示词生成古风人像图片 | unary | 创作工作台 |
| ai-image-edit | ai-image-to-image | 基于已有图片进行图生图编辑、风格转换、局部修改 | unary | 图片编辑页 |
| ai-prompt-optimize | ai-text-generate | 优化用户输入的简单提示词为详细专业的古风人像描述 | stream | 创作工作台 |

---

## 导航配置

- **导航布局**: Sidebar（左侧固定侧边栏）
- **导航项**（仅一级页面）:

| 导航文字 | 路由 | 图标 |
|---------|------|------|
| 所有媒体内容 | `/` | Grid（网格） |
| 素材库 | `/library` | Image（图片） |
| 角色管理 | `/characters` | User（人形） |

> **侧边栏底部补充项**（不占路由，为功能入口）:
> - 回收站（Trash 图标）
> - 收起/展开侧边栏按钮

---

## 数据来源声明

| 数据/操作 | 来源类型 | 实现要求 | mock 兜底 |
|---|---|---|---|
| 文生图创作 | real-plugin | capabilityClient 调 ai-text-to-image 实例，传入用户输入的提示词、选中的模型和画面比例，输出生成的图片 | 失败提示（toast "生成服务暂不可用"） |
| 图生图编辑 | real-plugin | capabilityClient 调 ai-image-to-image 实例，传入用户选中的原图和修改指令，输出编辑后的新图 | 失败提示（toast "编辑服务暂不可用"） |
| 提示词优化 | real-plugin | capabilityClient.callStream 调 ai-text-generate 实例，传入用户输入的简短描述，流式输出优化后的详细提示词 | 失败提示（toast "优化服务暂不可用"） |
| 作品素材列表 | server-persist | 通过受鉴权 API 读写 PostgreSQL 中的媒体元数据；浏览器不得作为权威数据源 | 无；测试数据必须显式注入 |
| 角色数据 | server-persist | 通过受鉴权 API 读写 PostgreSQL 中的角色与参考图数据；浏览器不得作为权威数据源 | 无；测试数据必须显式注入 |
| 作品下载导出 | import-export | 通过 a 标签 + download 属性触发图片下载 | 无 |
| 创作参数设置 | server-persist | 通过受鉴权 API 保存用户或组织维度的创作偏好；仅允许短生命周期 UI 状态留在内存 | 服务端默认值 |

> 插件行 mock 兜底均为失败提示，符合 real-plugin 不可 mock 的约束。

---

## 功能列表

### 页面: 创作工作台（WorkspacePage）

- **页面目标**: 用户在此输入提示词、配置参数、生成并浏览 AI 创作的古风图片/视频
- **功能点**:
  - **提示词输入与生成**: 底部悬浮输入框，支持文本输入 + 参考图上传 + 智能体按钮；右侧显示当前模型和生成数量；点击箭头触发生成
  - **生成参数配置面板**: 右侧弹出式设置面板，支持图片/视频切换、5 种画面比例选择、模型下拉切换、生成数量（x1-x4）选择、底部显示消耗点数
  - **素材网格展示**: 中间区域瀑布流/网格布局展示所有生成作品，卡片带圆角，hover 显示操作按钮（收藏、重做、更多）
  - **作品详情面板**: 右侧展示选中作品的完整提示词、创建日期、使用模型、画面比例，顶部有下载、撤销、删除三个操作按钮
  - **作品更多操作**: 点击卡片更多按钮展开下拉菜单，包含收藏、重复使用提示、添加动画效果、添加到提示、下载、重命名、分享、设置项目封面、移至回收站等选项
  - **搜索与筛选**: 顶部搜索栏 + 筛选按钮，弹出过滤面板（类型、宽高比、创建日期、时长、排序方式）

### 页面: 图片编辑页（ImageEditorPage）

- **页面目标**: 对单张图片进行精细化查看和图生图编辑
- **功能点**:
  - **大图预览**: 中央区域展示高清大图，左侧有裁剪、选区等编辑工具图标
  - **历史版本切换**: 顶部横向排列该作品的历史生成版本缩略图，点击切换，当前版本高亮
  - **图生图编辑**: 底部输入框输入修改指令（如"把衣服换成红色"），选择模型后提交生成新版本
  - **快捷操作栏**: 顶部右侧收藏、下载、删除、分享、隐藏历史记录、完成按钮

### 页面: 素材库（LibraryPage）

- **页面目标**: 统一管理所有创作素材（图片、视频、角色、场景）
- **功能点**:
  - **分类浏览**: 左侧分类导航（全部、图片、视频、角色、场景、上传的内容），点击切换分类
  - **素材网格展示**: 右侧瀑布流网格展示素材卡片，支持批量选择模式
  - **批量操作**: 网格/批量视图切换，批量选择后支持批量删除、批量收藏、批量添加到集合

### 页面: 角色管理（CharactersPage）

- **页面目标**: 维护角色一致性，管理角色形象和描述
- **功能点**:
  - **角色列表**: 左侧展示已创建的角色卡片（头像 + 名称）
  - **角色详情**: 右侧展示角色的多张形象图、角色描述文本、使用的基础模型
  - **创建角色**: 新建角色入口，支持上传参考图 + 填写角色描述，生成统一风格的角色形象

---

## 数据共享配置

| 存储键名 | 数据说明 | 使用页面 |
|---------|---------|---------|
| 服务端媒体资源 | 所有生成的媒体素材，类型为 `IMediaItem[]`，以 PostgreSQL 与对象存储为准 | 创作工作台、素材库、图片编辑页 |
| 前端当前选择 | 当前选中的媒体 ID 或 `IMediaItem` 快照，仅为页面交互状态 | 创作工作台、图片编辑页 |
| 服务端角色资源 | 角色列表，类型为 `ICharacter[]`，以 PostgreSQL 与对象存储为准 | 角色管理页、创作工作台 |
| 服务端创作偏好 | 用户或组织维度的 `IGenerationSettings` | 创作工作台、图片编辑页 |

```ts
interface IMediaItem {
  id: string;
  title: string;
  type: 'image' | 'video';
  thumbnail: string; // 缩略图 URL
  fullUrl: string; // 原图/原视频 URL
  prompt: string; // 正面提示词
  model: string; // 使用的模型名称
  ratio: string; // 画面比例 如 "16:9"
  createdAt: string; // 创建日期 ISO 字符串
  isFavorite: boolean; // 是否收藏
  isDeleted: boolean; // 是否在回收站
  source: 'mock' | 'user'; // 数据来源标记
}

interface ICharacter {
  id: string;
  name: string;
  avatar: string; // 角色头像
  description: string; // 角色描述
  referenceImages: string[]; // 参考图 URL 数组
  baseModel: string; // 基础模型
  createdAt: string;
  source: 'mock' | 'user';
}

interface IGenerationSettings {
  contentType: 'image' | 'video';
  ratio: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  model: string;
  count: 1 | 2 | 3 | 4;
  duration?: 4 | 6 | 8 | 10; // 视频时长
}

-------

<scene_type>prototype-app</scene_type>

# UI 设计指南

## 1. 设计推导依据

- **参考意图**: Exact Reference —— 参考图为 Google Flow 高保真成品截图，视觉、布局、组件形态均从图中抽取还原
- **核心情绪 / 应用类型**: AI 图像/视频创作工作台，纯黑背景突出作品内容，工具克制不抢戏
- **独特记忆点**: 纯黑画布 + 深灰悬浮卡片 + 白色主按钮的三层明暗结构，让生成的人像作品成为绝对视觉主角

## 2. Art Direction

- **方向名**: 极简深色创作台
- **Design Style**: Minimal Dark + Rounded Soft —— 纯黑背景让作品发光，大圆角柔化工具感，适合长时间创作浏览
- **DNA 参数**: 圆角 `rounded-xl ~ rounded-2xl` / 阴影 `shadow-lg` 柔和悬浮 / 间距 `gap-4 p-4` 紧凑标准 / 字体方向 无衬线中性 / 装饰手法 极少量线性图标 + 分割线
- **应用类型**: Tool —— 三栏工作台布局，左导航 + 中作品网格 + 右详情面板，底部悬浮输入条

## 3. Color System

**色彩关系**: 纯黑背景 + 深灰卡片层 + 白色主交互，三级明度差构建清晰悬浮层级
**配色设计理由**: 背景纯黑最大化图片对比度；卡片用深灰承载表单与菜单，与背景形成柔和分离；主按钮与关键操作使用纯白，确保在深色环境中一眼可辨；accent 用中灰承接 hover 与选中态，避免彩色干扰作品欣赏
**主色推导**: 从参考图抽取，primary 为近白色（hsl 0 0% 98%），承担主按钮、完成态、关键操作；产品无强品牌色，以中性明暗对比作为核心识别语言
**使用比例**: 85% 纯黑背景 / 12% 深灰卡片与文字 / 3% 白色主交互；primary 只用于主 CTA、完成按钮、当前选中缩略图边框

| 角色 | CSS 变量 | Tailwind Class | HSL 值 | 设计说明 |
|---|---|---|---|---|
| bg | `--background` | `bg-background` | hsl(0 0% 0%) | 页面纯黑背景，作品画布 |
| card | `--card` | `bg-card` | hsl(0 0% 10%) | 深灰卡片、弹层、菜单、输入框 |
| text | `--foreground` | `text-foreground` | hsl(0 0% 95%) | 标题与正文，高对比 |
| textMuted | `--muted-foreground` | `text-muted-foreground` | hsl(0 0% 60%) | 元信息、说明、占位符 |
| primary | `--primary` | `bg-primary` / `text-primary` | hsl(0 0% 98%) | 主按钮、完成态、选中边框 |
| primaryForeground | `--primary-foreground` | `text-primary-foreground` | hsl(0 0% 8%) | primary 上的深色文字 |
| accent | `--accent` | `bg-accent` | hsl(0 0% 20%) | hover / 选中浅底、分段控件激活态 |
| accentForeground | `--accent-foreground` | `text-accent-foreground` | hsl(0 0% 90%) | accent 上的文字与图标 |
| border | `--border` | `border-border` | hsl(0 0% 18%) | 卡片边界、分隔线、输入框描边 |

**语义色提示**: 危险操作用红色 hsl(0 80% 60%)，三态：bg `hsl(0 30% 12%)` / border `hsl(0 40% 25%)` / text `hsl(0 80% 65%)`；饱和度与 primary 的无彩色系形成差异但控制在低饱和区间，避免刺眼；成功/警告色本产品暂不使用

## 4. 字体与节奏

- **font-display**: Inter, Noto Sans SC —— 中性无衬线，工具感清晰，不与作品争艳
- **font-body**: Inter, Noto Sans SC —— 同字体族，保证中英文混排一致性
- **字号**: H1 text-2xl；H2 text-lg；body text-sm；muted text-xs。
- **圆角**: 大（rounded-xl ~ 2xl）—— 参考图所有卡片、按钮、输入框均为大圆角，柔化深色界面的冷硬感

## 5. 全局布局契约

- **Reference Layout Use**: Exact，三栏工作台（左导航 220px + 中作品网格 + 右详情面板 320px）+ 底部悬浮输入条，完全来自参考图
- **Page / Section Order**: 工作台首页（媒体库网格）→ 作品详情/编辑页 → 资源选择弹窗 → 设置面板，与参考图页面层级一致
- **Standard Content Zone**: 后台工作台，内容区随浏览器自适应，中间网格区 `max-w-none` 铺满可用空间
- **Shell / Frame Alignment**: 三栏独立滚动，左侧导航固定、中间网格滚动、右侧详情面板固定
- **Padding & Rhythm**: `p-4` 全局内边距，卡片间距 `gap-4`，保持 4px 倍数紧凑节奏
- **Full-bleed Zones**: 作品图片与视频全宽展示于卡片内，无额外边距
- **Local Narrowing**: 表单、设置面板、详情文字区在卡片内 `p-4`，不单独收窄
- **Overflow Strategy**: 历史缩略图横排、资源列表、筛选面板使用 `overflow-x-auto` / `overflow-y-auto`
- **Flexibility Boundary**: 允许移动端折叠为单栏 + 底部输入条；不允许改变主色、圆角系统、卡片层级关系

## 6. 视觉与动效

- **装饰**: 极细分割线 + 线性图标，无多余装饰
- **阴影/边界**: 中 —— 悬浮面板带柔和阴影，与纯黑背景形成清晰层级
- **动效**: 克制 —— hover 轻微提亮背景、面板滑入滑出 150ms、生成加载用呼吸态，不做夸张动效

## 7. 组件原则

- 按钮、分段选择器、下拉菜单、开关、输入框必须有 Default / Hover / Active / Focus / Disabled 状态
- Primary 用纯白填充，只给"完成""发送"等主行动；其余操作使用深灰 ghost 按钮
- 分段控件（图片/视频、比例选择、倍速选择）激活态用 accent 中灰背景，未激活用 card 深灰
- 下拉菜单与右键菜单用 card 深灰 + 大圆角 + 细分割线，hover 用 accent 提亮
- 空状态与加载态延续深灰 + 线性图标语言，不引入彩色插画

## 8. Image Direction

- **Image Role**: 产品核心内容（作品展示区、缩略图、预览图），非装饰图
- **Image Art Direction**: 电影级写真人像，东方古典审美；构图居中或三分法，侧窗柔光，木格窗与竹影为背景母题；色调偏冷灰蓝/暖棕，光影柔和有层次，质感接近胶片写真
- **Image Prompt Keywords**: 东方古典美人、汉服、宋制明制风格、木格花窗、竹影、侧窗柔光、电影级光影、8K 超写实、珍珠配饰、温婉气质、中式室内场景
- **Image Avoidance**: 过度磨皮塑料感、夸张网红脸、高饱和艳色服饰、杂乱背景、廉价影楼风、正脸证件照构图

## 9. Anti-patterns

- **Split personality**: 页面之间切换背景色、圆角或阴影语言；全站保持纯黑底 + 深灰卡 + 白按钮三级结构
- **Color invasion**: 引入品牌蓝/紫/渐变等彩色主色，破坏作品展示的中性画布感
- **Default SaaS drift**: 回到默认浅色模式 + 蓝色按钮；本产品核心是作品展示，深色是功能需求不是装饰
- **Invisible interaction**: hover 做了 focus-visible 丢了；深色环境下 focus 环用 2px 白色描边 + 轻微外发光
- **Mono-hue tyranny**: 白色同时用于主按钮、tab 激活、icon、边框、链接；primary 只给 CTA 与关键状态，其余用 accent 中灰
- **Rounded inconsistency**: 按钮 rounded-full 而卡片 rounded-md；全站统一大圆角语言，圆角半径差不超过 1 级

---

# 墨灵AI工程开发总规则

> 本文件为项目最高优先级工程纪律，已收口此前零散的「AI 协作铁律 / Phase 门禁」规则，**全文以本文件为准**。任何 AI 助手与开发 Agent 在修改本系统时必须严格遵守。

## 1. 项目性质

这是一个已经长期开发、存在真实用户业务逻辑、准备测试/部署/持续迭代的生产项目。

本项目不是 Demo。

所有修改必须满足：

- 可实际编码
- 可实际运行
- 可实际测试
- 可实际部署
- 可备份
- 可恢复
- 可回滚
- 可验证
- 可维护

禁止只实现"概念架构"。

---

## 2. 老项目重构最高原则

任何 AI 在修改现有系统前必须遵循：

1. 先读取。
2. 再搜索依赖。
3. 再确认真实行为。
4. 再建立修改范围。
5. 再修改。
6. 再测试。
7. 再总结。
8. 再提交。

禁止：

先看到一个文件就直接重构。

禁止假设：

"这个函数应该没人在用了。"

必须通过全项目搜索证明。

---

## 3. 禁止推倒重写

除非用户明确授权，否则禁止：

- 重写整个后端
- 重写 ModelHub
- 更换数据库
- 更换前端框架
- 更换状态管理框架
- 引入微服务
- 引入 Kubernetes
- 引入 Kafka
- 为追求架构美观移动大量文件
- 一次修改几十个无关模块
- 删除当前兼容逻辑
- 删除看起来"旧"的接口
- 删除数据库旧字段
- 删除现有生成能力

优先采用：

Incremental Migration

而不是：

Big Bang Rewrite

---

## 4. 修改前事实审计

涉及一个模块时必须先检查：

- 入口
- 调用者
- 被调用者
- API
- DB
- 类型定义
- UI
- 后台任务
- billing
- dispatcher
- recovery
- tests

特别是下列关键词必须全项目搜索：

model_id
display_name
mapping_name
provider_id
credit_cost
provider_task_id
billing
generate
dispatcher
models
providers

只有确认调用链之后才能修改。

---

## 5. 一次只改变一个核心维度

严禁一次同时大改：

数据库结构
+
API语义
+
计费语义
+
路由算法
+
UI交互

任何 Phase 最多只允许改变一个主要架构维度。

允许增加兼容层。

不允许为了减少工作量跳过兼容层。

---

## 6. 数据库重构规则

数据库必须采用：

旧结构
→ 增加新结构
→ 数据回填
→ 兼容读取
→ 新路径切换
→ 验证
→ 稳定运行
→ 最后删除旧结构

禁止第一阶段：

DROP COLUMN
DROP TABLE
RENAME COLUMN 导致旧代码立即失效

Migration 必须：

- 幂等
- 支持已有生产数据
- 支持空数据库
- 支持重复执行
- 提供验证 SQL
- 提供恢复方案

---

## 7. ModelHub 核心身份规则

从 ModelHub V3 开始：

modelId
= 永久稳定机器身份

displayName
= 用户界面展示名称

mappingName / upstreamModelName
= 服务商真实模型名称

任何新代码禁止重新把 displayName 作为永久运行主键。

允许为了兼容旧接口临时解析：

displayName
→ resolver
→ modelId

但是兼容逻辑必须集中，不允许散落在 dispatcher / billing / UI 中。

---

## 8. Model 与 Provider 实例规则

必须区分：

Logical Model

和：

Provider Model Binding

例如：

Logical Model:
Kling 3.0

Provider Bindings:
Kling 3.0 @ Provider A
Kling 3.0 @ Provider B
Kling 3.0 @ Provider C

逻辑模型描述：

- 名称
- 类型
- 分类
- 通用能力
- 用户售价

Provider Binding 描述：

- provider
- upstream model name
- endpoint
- provider capabilities
- provider cost
- concurrency
- rate limit
- health
- routing weight

禁止长期把这两种概念混为一张业务实体。

---

## 9. 价格规则

必须区分：

用户售价

和：

Provider 成本

禁止使用同一个字段同时表示两者。

目标语义：

userCreditPrice
= 用户生成一次需要多少积分

providerCost
= 调用供应商一次真实成本

未来利润：

revenue - providerCost

必须能够被准确计算。

---

## 10. 路由规则

第一阶段路由算法必须：

可解释
可重复测试
可配置
可关闭
可回退

禁止使用不可解释的"AI 自动决定线路"。

目标流程：

candidate bindings
→ enabled
→ capability
→ health
→ cooldown
→ circuit breaker
→ rate limit
→ concurrency
→ score
→ weighted selection
→ execution

所有失败和选择结果最终都应留下数据。

---

## 11. Generation Job 规则

一个用户生成任务：

GenerationJob

允许拥有多个：

GenerationAttempt

例如：

Job 001

Attempt 1
Provider A
Timeout

Attempt 2
Provider B
429

Attempt 3
Provider C
Success

禁止因为发生重试而创建多个用户任务。

---

## 12. 计费安全规则

涉及：

扣费
奖励积分
充值余额
退款
预扣
结算

必须优先保持现有业务行为。

未经事实核实不得改变：

扣费时机
扣费数量
退款条件
奖励余额优先级
失败任务处理

任何计费架构调整必须有：

测试
兼容性说明
恢复方法

---

## 13. Git 规则

开始修改前：

git status

必须记录当前状态。

如果工作区本身存在未提交修改：

禁止自动覆盖。
禁止 reset --hard。
禁止 checkout 覆盖用户文件。
禁止 clean -fd。

每个 ModelHub Phase 独立提交。

推荐：

modelhub-v3/phase-1-model-identity
modelhub-v3/phase-2-bindings
modelhub-v3/phase-3-pricing
modelhub-v3/phase-4-concurrency
modelhub-v3/phase-5-generation-attempts
modelhub-v3/phase-6-routing
modelhub-v3/phase-7-runtime

每阶段完成前必须报告：

- changed files
- added files
- DB migrations
- API changes
- compatibility
- tests
- risks
- rollback

---

## 14. 测试最低要求

每个 Phase 至少执行项目已有的：

lint
typecheck
unit tests
integration tests
build

涉及数据库时增加：

migration test
backfill validation

涉及生成链时增加 smoke test：

UI/model selection
→ API
→ billing
→ dispatcher
→ provider selection
→ submission
→ task persistence

涉及失败处理时：

timeout
429
5xx
invalid response

不得只测试 happy path。

---

## 15. AI 工作方式

每次收到大型任务：

第一步：

输出 FACTS FOUND。

第二步：

输出 RISKS。

第三步：

输出 PLAN。

第四步：

才允许 CODE CHANGE。

发现与任务无关的问题：

记录到：

Deferred Issues

不要顺手修改。

---

## 16. 停止条件

出现以下情况立即停止扩展修改：

- 不确定现有业务语义
- DB 数据无法安全迁移
- billing 行为无法确认
- 测试基线本身失败
- 工作区出现未知修改
- migration 验证失败
- 核心 smoke test 失败

此时允许继续诊断。

禁止继续进入下一 Phase。

---

## 17. 完成定义

"代码写完"不代表完成。

必须同时满足：

代码完成
+
migration 完成
+
测试完成
+
兼容验证完成
+
风险记录完成
+
rollback 明确

才能声明 Phase 完成。

---

## 18. 最终原则

墨灵AI的目标不是拥有最复杂的架构。

目标是：

稳定
准确
快速
可恢复
可扩展
可持续开发

任何架构升级必须服务于真实生产问题。
