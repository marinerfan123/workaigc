# Phase 0 多阶段构建 — 应用镜像
# 构建阶段产出 dist/build2；运行阶段仅含生产依赖 + server + 静态产物

# ── 构建阶段 ──
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ── 运行阶段 ──
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# 仅安装生产依赖（pg / ioredis / dotenv）
# 注：用 npm install 而非 npm ci —— 本仓库 package-lock.json 在部分 registry 镜像上
# 存在版本漂移，npm install 会按 package.json 补齐缺失项并复用已锁版本，更稳健。
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY dist ./dist
EXPOSE 3001
CMD ["node", "server/server.js"]
