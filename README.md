# AI 图像创作工作室 (AI Image Studio)

一个本地优先的 AI 图像创作应用：调用多家模型服务商生成图片，内置素材库管理、阿里云 OSS 对象存储、并发批量生成。前端 React + Vite + Tailwind，后端 Node 原生 HTTP **单端口一体服务**。

---

## ✨ 功能特性

- **多模型 / 多服务商**：通过 OpenAI 兼容协议接入，可在设置中配置 provider 与 model
- **并发批量生成**：一次提交触发 N 次独立请求，提高出图效率
- **素材库**：图片 / 视频 / 角色 / 场景 / 道具 / 其他 / 上传内容 分类管理，侧边栏显示实时数量
- **OSS 存储**：生成图自动上传阿里云 OSS（私有桶 + 后端代理访问，无需公开桶）
- **后端代理**：私有对象通过后端签名转发给前端，永久有效、不暴露凭证

---

## 🏗 架构

```
┌─────────┐
│ Browser │
└────┬────┘
     │  http://localhost:3001
     ▼
┌─────────────────────────────────────────────┐
│  server.js  (Node 原生 HTTP, 单端口 :3001)    │
│   ├── 前端静态文件  dist/build2 (vite build)  │
│   ├── REST API        /api/*                  │
│   └── PostgreSQL 17  (主库)                    │
│         └── Redis 7  (预留，当前版本未启用)    │
└─────────────────────────────────────────────┘
```

- 开发时：Vite dev server（默认 5173）提供前端热更新，`server.js`（3001）提供 API
- 生产时：`server.js` 单端口同时托管前端构建产物与 API，无需额外静态服务器

---

## 📋 环境要求

| 组件 | 版本 | 必需 |
|------|------|------|
| Node.js | ≥ 20 | ✅ |
| PostgreSQL | 17 | ✅ |
| Redis | 7 | ⬜ 预留，当前未使用 |
| 阿里云 OSS bucket | — | ⬜ 可选（不配则用模型返回的原图 URL） |

---

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
#   编辑 .env，填入 PostgreSQL 连接信息

# 3. 配置 OSS（可选，不配则图片使用模型返回的原始链接）
cp server/data/oss.json.example server/data/oss.json
#   编辑 oss.json，填入阿里云 AccessKey / Secret / bucket / endpoint

# 4. 启动
npm run dev        # 开发模式：前端 + 后端一起起
#   或生产模式：
npm run build && npm start
```

- 默认访问地址：**http://localhost:3001**
- **首次启动 `server.js` 会自动建表**（6 张表，`CREATE TABLE IF NOT EXISTS`），无需手动迁移
- 旧数据从 JSON 迁移到 PG 可用 `node server/migrate.cjs`（仅历史数据迁移用）

---

## ⚙️ 配置说明

### PostgreSQL
在 `.env` 中配置 `PG_HOST` / `PG_PORT` / `PG_DATABASE` / `PG_USER` / `PG_PASSWORD`。
需先手动创建数据库（如 `huabu`）：

```sql
CREATE DATABASE huabu;
```

### 阿里云 OSS
编辑 `server/data/oss.json`：

| 字段 | 说明 | 示例 |
|------|------|------|
| `endpointExternal` / `endpointInternal` | OSS 访问域名 | `oss-cn-shanghai.aliyuncs.com` |
| `bucket` | 桶名（注意部分账号桶名本身含 `-cn-shanghai` 后缀） | `my-bucket-cn-shanghai` |
| `region` | 区域 | `cn-shanghai` |
| `accessKeyId` / `accessKeySecret` | AccessKey | — |
| `pathPrefix` | 对象前缀 | `images/` |
| `enabled` | 是否启用上传 | `true` |

> ⚠️ `.env` 与 `oss.json` 含私密凭据，已被 `.gitignore` 忽略，**切勿提交到仓库**。

---

## 📡 API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/media` | 媒体列表 |
| `POST` | `/api/media` | 保存媒体 |
| `DELETE` | `/api/media/:id` | 删除（联动删除 OSS 对象） |
| `GET` | `/api/media/counts` | 各分类数量统计 |
| `POST` | `/api/oss/upload` | 上传对象到 OSS（v1 签名） |
| `GET` | `/api/oss/media/:key` | 后端代理读取私有对象 |

---

## 📁 目录结构

```
.
├── src/                  # 前端 (React + Vite + Tailwind v4)
├── server/               # 后端 (Node 原生 HTTP)
│   ├── server.js         # API + 静态服务 + OSS 上传/代理
│   ├── db.cjs            # PostgreSQL 连接与建表
│   ├── migrate.cjs       # JSON → PG 迁移（旧数据）
│   └── data/             # 运行时配置与数据（oss.json 等，已被忽略）
├── dist/build2/          # 前端构建产物（被忽略）
├── .env.example          # 环境变量模板
└── server/data/oss.json.example  # OSS 配置模板
```

---

## 🚢 部署

| 平台 | 支持 |
|------|------|
| Railway / Render / Fly.io / 任意 VPS / Docker | ✅ |
| GitHub Pages | ❌ 本应用需要 Node 运行时 + PostgreSQL，Pages 仅托管静态文件 |

### Docker 示例

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "server/server.js"]
```

部署时需提供 `.env`（环境变量）与 `server/data/oss.json`（可通过挂载卷或构建参数注入）。

---

## 📄 License

[MIT](./LICENSE) © 2026 吴八哥
