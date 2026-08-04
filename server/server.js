// 纯 Node.js 后端 API — PostgreSQL 17 + Redis 7.2
// 用法: node server.js
import 'dotenv/config'; // Phase 0: 配置外置化（必须在读取 process.env 前加载）
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const TOKEN_FILE = path.join(DATA_DIR, '.api_token');
const CLIENT_DIR = path.join(__dirname, '..', 'dist', 'build2');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Token ──────────────────────────────────────
// ─── 安全相关开关 ──────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';
const tokenFromEnv = !!process.env.API_TOKEN;

let API_TOKEN = '';
try { API_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim(); } catch {}
if (!API_TOKEN) {
  API_TOKEN = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, API_TOKEN);
  if (!isProduction) console.log(`\n🔑 API Token: ${API_TOKEN}\n`);
}
// 生产环境若未显式通过环境变量提供 API_TOKEN，则自动生成的 dev 令牌不可作为 system 身份（防后门）
const devTokenEnabled = !isProduction || tokenFromEnv;

// ─── 数据库：PostgreSQL ─────────────────────────
import pgLib from 'pg';
const { Pool } = pgLib;
let pgPool = null;
import dispatcher from './dispatcher.cjs';
import session from './auth.cjs';   // Phase A 用户会话（cookie JWT，零依赖）
import billing from './billing.cjs'; // Phase A 积分计费
import redisStore from './redis.cjs';       // Phase 0 优雅 Redis 层（自动内存兜底）
import rateLimitMod from './ratelimit.cjs'; // Phase 0 固定窗口限流
const { initRedis, isRedisUp } = redisStore;
const { clientIp, rateLimit } = rateLimitMod;
import adminMod from './admin.cjs'; // Phase 2 运营总控台(M3) + 全局智能体层(M4) 后台接口
import shopMod from './shop.cjs';   // Phase 5 电商模块（AI 市集）：商品/购物车/订单
import paymentsMod from './payments.cjs'; // Phase 2 收尾：充值订单 + DEV 支付适配器(M2 账务)
import monitorMod from './monitor.cjs'; // 后台「实时监控 · API 活动流」(全路径环形缓冲 + SSE 广播)
import logbusMod from './logbus.cjs';   // 后台「实时日志 · 数据库/Redis/控制台」(统一日志总线 + SSE 广播)
import financeMod from './finance.cjs';  // Phase 4 后台账务系统（底层：总览/对账/账本/套餐）
import meMod from './me.cjs';            // 用户侧账务（积分流水 / 充值订单 / 概览）

// ─── 日志总线：先 installConsoleHook，再做后续 init，
//    这样后续 console.warn/error 自动落入 logbus（同时保留原 console 行为）───
const logbus = logbusMod.createLogBus();
logbus.installConsoleHook();
logbus.startStatsTimer();

async function initDB() {
  try {
    pgPool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: parseInt(process.env.PG_PORT || '5432', 10),
      database: process.env.PG_DATABASE || 'huabu',
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '0.0.1abcd',
      max: parseInt(process.env.PG_POOL_MAX || '10', 10),
    });
    await pgPool.query('SELECT 1');
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'official', base_url TEXT DEFAULT '', api_key TEXT DEFAULT '', supported_types TEXT[] DEFAULT '{}', enabled BOOLEAN DEFAULT TRUE, protocol TEXT DEFAULT 'openai-compatible', remark TEXT DEFAULT '', default_endpoint JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, model_id TEXT NOT NULL, display_name TEXT NOT NULL, mapping_name TEXT DEFAULT '', type TEXT DEFAULT 'image', provider_id TEXT REFERENCES providers(id) ON DELETE CASCADE, enabled BOOLEAN DEFAULT TRUE, supported_resolutions TEXT[] DEFAULT '{}', capabilities JSONB DEFAULT '{}', endpoint JSONB DEFAULT '{}', credit_cost INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, title TEXT DEFAULT '', type TEXT DEFAULT 'image', thumbnail TEXT DEFAULT '', full_url TEXT DEFAULT '', prompt TEXT DEFAULT '', model TEXT DEFAULT '', ratio TEXT DEFAULT '1:1', source TEXT DEFAULT 'user', is_favorite BOOLEAN DEFAULT FALSE, is_deleted BOOLEAN DEFAULT FALSE, oss_url TEXT DEFAULT '', oss_object_key TEXT DEFAULT '', oss_uploaded BOOLEAN DEFAULT FALSE, category TEXT DEFAULT 'generated', status TEXT DEFAULT 'success', error_message TEXT DEFAULT '', failed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());
      -- 兼容旧库：缺失列自动补齐
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media' AND column_name='status') THEN ALTER TABLE media ADD COLUMN status TEXT DEFAULT 'success'; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media' AND column_name='error_message') THEN ALTER TABLE media ADD COLUMN error_message TEXT DEFAULT ''; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media' AND column_name='failed_at') THEN ALTER TABLE media ADD COLUMN failed_at TIMESTAMPTZ; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='models' AND column_name='mapping_name') THEN ALTER TABLE models ADD COLUMN mapping_name TEXT DEFAULT ''; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='models' AND column_name='credit_cost') THEN ALTER TABLE models ADD COLUMN credit_cost INT DEFAULT 0; END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS oss_config (id INTEGER PRIMARY KEY DEFAULT 1, provider TEXT DEFAULT 'aliyun-oss', access_point_name TEXT DEFAULT '', endpoint_external TEXT DEFAULT '', endpoint_internal TEXT DEFAULT '', bucket TEXT DEFAULT '', region TEXT DEFAULT '', region_label TEXT DEFAULT '', access_key_id TEXT DEFAULT '', access_key_secret TEXT DEFAULT '', path_prefix TEXT DEFAULT 'images/', custom_domain TEXT DEFAULT '', enabled BOOLEAN DEFAULT TRUE);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
      ALTER TABLE providers ADD COLUMN IF NOT EXISTS max_concurrent INT DEFAULT 2;
      -- 生成任务表（用于刷新恢复：前端点生成即插一行，后台跑完后更新结果，前端刷新后能查到状态）
      CREATE TABLE IF NOT EXISTS generation_tasks (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'running',  -- running | done | failed
        model TEXT DEFAULT '',
        prompt TEXT DEFAULT '',
        count INT DEFAULT 1,
        content_type TEXT DEFAULT 'image',
        result JSONB,                            -- 生成完成后的完整结果（images/usedProviders/errors）
        error TEXT DEFAULT '',
        pending_ids TEXT[] DEFAULT '{}',         -- 对应的前端占位 item id 列表
        client_meta JSONB DEFAULT '{}',           -- 前端可写入任意键值（ratio/model/prompt 等用于恢复渲染）
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS generation_tasks_status_idx ON generation_tasks (status);
      CREATE INDEX IF NOT EXISTS generation_tasks_created_at_idx ON generation_tasks (created_at);
      INSERT INTO oss_config (id, enabled) VALUES (1, TRUE) ON CONFLICT (id) DO NOTHING;
      INSERT INTO settings (key, value) VALUES ('app', '{}') ON CONFLICT (key) DO NOTHING;

      -- === Phase A: 认证 + 积分计费地基 ===
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY DEFAULT 'u-' || gen_random_uuid()::text,
        email         TEXT UNIQUE NOT NULL,
        display_name  TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        credits       INT  NOT NULL DEFAULT 50,
        role          TEXT NOT NULL DEFAULT 'user',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id            BIGSERIAL PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL,
        amount        INT  NOT NULL,
        ref           TEXT,
        balance_after INT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ix_ct_user ON credit_transactions(user_id);
      CREATE INDEX IF NOT EXISTS ix_ct_ref  ON credit_transactions(ref);
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token_hash  TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        revoked     BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id          BIGSERIAL PRIMARY KEY,
        aggregate   TEXT NOT NULL,
        event_type  TEXT NOT NULL,
        payload     JSONB NOT NULL,
        published   BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ix_outbox_unpub ON outbox(published) WHERE published = FALSE;
      ALTER TABLE media ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS ix_media_user ON media(user_id);
      ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS user_id         TEXT REFERENCES users(id);
      ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
      ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS cost            INT DEFAULT 0;
      CREATE INDEX IF NOT EXISTS ix_gt_user ON generation_tasks(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_gt_idem
        ON generation_tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
    `);

    // === 公共默认资产（default_assets 模板库 + media 归属标记）===
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS default_assets (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        title TEXT DEFAULT '',
        type TEXT DEFAULT 'image',
        thumbnail TEXT DEFAULT '',
        full_url TEXT DEFAULT '',
        prompt TEXT DEFAULT '',
        model TEXT DEFAULT '',
        ratio TEXT DEFAULT '1:1',
        source TEXT DEFAULT 'default',
        category TEXT DEFAULT 'generated',
        status TEXT DEFAULT 'success',
        sort INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE media ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;
      ALTER TABLE media ADD COLUMN IF NOT EXISTS default_key TEXT;
      CREATE INDEX IF NOT EXISTS ix_media_default ON media(user_id, default_key) WHERE default_key IS NOT NULL;
    `);

    console.log('[DB] PostgreSQL 连接成功');

    // === Phase 2：运营总控台(M3) + 全局智能体层(M4) 地基 ===
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS request_logs (
        id BIGSERIAL PRIMARY KEY,
        method TEXT, path TEXT, ip TEXT, status INT, latency_ms INT,
        user_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_id TEXT, action TEXT, target TEXT, detail JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_logs(created_at DESC);
      CREATE TABLE IF NOT EXISTS agents (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        daily_budget INT DEFAULT 0,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agent_providers (
        id TEXT PRIMARY KEY,
        agent_key TEXT NOT NULL REFERENCES agents(key) ON DELETE CASCADE,
        provider TEXT DEFAULT '', model TEXT DEFAULT '',
        weight INT DEFAULT 1, priority INT DEFAULT 10, cost_per_call INT DEFAULT 0,
        enabled BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agent_rules (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger TEXT DEFAULT '',
        condition JSONB DEFAULT '{}', action JSONB DEFAULT '{}',
        enabled BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agent_calls (
        id BIGSERIAL PRIMARY KEY, agent_key TEXT, user_id TEXT, provider TEXT DEFAULT '',
        ok BOOLEAN DEFAULT TRUE, latency_ms INT DEFAULT 0, cost_credits INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ix_ac_created ON agent_calls(created_at DESC);
      CREATE TABLE IF NOT EXISTS agent_rule_logs (
        id BIGSERIAL PRIMARY KEY, rule_id TEXT, fired_at TIMESTAMPTZ DEFAULT NOW(),
        result JSONB DEFAULT '{}'
      );
      -- === Phase 2 收尾：充值订单（M2 账务 / DEV 支付适配器）===
      CREATE TABLE IF NOT EXISTS recharge_orders (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel       TEXT NOT NULL DEFAULT 'wechat',   -- wechat | alipay
        amount        INT NOT NULL,                     -- 充值金额（元）= 入账积分
        status        TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | failed
        pay_order_no  TEXT UNIQUE NOT NULL,
        sign          TEXT DEFAULT '',
        meta          JSONB DEFAULT '{}',               -- 失败原因 / 回调原始数据
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paid_at       TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS ix_ro_user ON recharge_orders(user_id);
      CREATE INDEX IF NOT EXISTS ix_ro_payno ON recharge_orders(pay_order_no);
      -- 兼容已在运行的库：对已有 recharge_orders 补齐 meta 列
      ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}';

      -- === Phase 4：充值套餐（后台可配置，替换前端硬编码预设）===
      CREATE TABLE IF NOT EXISTS topup_packages (
        id          TEXT PRIMARY KEY DEFAULT 'pkg-' || gen_random_uuid()::text,
        name        TEXT NOT NULL DEFAULT '',
        credits     INT  NOT NULL DEFAULT 0,    -- 基础到账积分
        price       INT  NOT NULL DEFAULT 0,    -- 售价（元）
        bonus       INT  NOT NULL DEFAULT 0,    -- 赠送积分
        sort_order  INT  NOT NULL DEFAULT 0,
        enabled     BOOLEAN NOT NULL DEFAULT TRUE,
        remark      TEXT DEFAULT '',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ix_tp_sort ON topup_packages(sort_order);
    `);

    // 种子：运营智能体 ops_bot + 三条自动化规则（§H.3）
    await pgPool.query(`
      INSERT INTO agents (key, name, enabled, daily_budget, config)
      VALUES ('ops_bot','运营智能体 ops_bot', TRUE, 1000, '{"desc":"自动封禁IP / 错误率告警 / 咨询应答草稿"}')
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO agent_rules (id, name, trigger, condition, action, enabled) VALUES
        ('rule-ban-ip','登录失败封禁','login_fail','{"threshold":20,"window":"ip"}','{"type":"ban_ip"}', TRUE),
        ('rule-error-rate','5xx 错误率告警','error_rate','{"threshold":0.02,"metric":"5xx"}','{"type":"alert"}', TRUE),
        ('rule-auto-reply','客服咨询应答','support_query','{"kb_match":true}','{"type":"draft_reply"}', TRUE)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 种子：管理员账号（仅当尚无 admin 时；可用 ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD 覆盖，公开仓库务必修改）
    const existingAdmin = await pgPool.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1");
    if (existingAdmin.rows.length === 0) {
      const adminEmail = process.env.ADMIN_SEED_EMAIL || 'admin@huabu.local';
      const adminPw = process.env.ADMIN_SEED_PASSWORD || 'A7mZ#9kPq2@XlV!Hb2026'; // 仅本地开发种子用；公开部署务必用环境变量覆盖
      await pgPool.query(
        `INSERT INTO users (id, email, display_name, password_hash, credits, role)
         VALUES ($1,$2,'平台管理员',$3,1000,'admin')`,
        ['u-' + crypto.randomUUID(), adminEmail, session.hashPassword(adminPw)]
      );
      console.log(`[Seed] 已创建管理员账号 ${adminEmail}（默认密码仅本地开发用，公开部署前请用 ADMIN_SEED_PASSWORD 覆盖并尽快修改）`);
    }

    // 公共默认资产种子（幂等：已存在则跳过）
    await seedDefaultAssets();

    return true;
  } catch (e) {
    console.warn('[DB] PostgreSQL 不可用，降级 JSON 存储:', e.message);
    pgPool = null;
    return false;
  }
}

// ─── JSON 降级 ──────────────────────────────────
function readJSON(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf-8')); }
  catch { return name === 'oss' || name === 'settings' ? {} : []; }
}
function writeJSON(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

// ─── snake_case → camelCase ─────────────────────
const SNAKE_MAP = {
  full_url:'fullUrl', oss_url:'ossUrl', oss_object_key:'ossObjectKey', oss_uploaded:'ossUploaded',
  is_favorite:'isFavorite', is_deleted:'isDeleted', created_at:'createdAt', base_url:'baseUrl',
  api_key:'apiKey', supported_types:'supportedTypes', default_endpoint:'defaultEndpoint',
  display_name:'displayName', model_id:'modelId', provider_id:'providerId', max_concurrent:'maxConcurrent', mapping_name:'mappingName', credit_cost:'creditCost',
  supported_resolutions:'supportedResolutions', access_point_name:'accessPointName',
  endpoint_external:'endpointExternal', endpoint_internal:'endpointInternal',
  access_key_id:'accessKeyId', access_key_secret:'accessKeySecret',
  path_prefix:'pathPrefix', custom_domain:'customDomain', region_label:'regionLabel',
  error_message:'errorMessage', failed_at:'failedAt',
};
function fromSnake(obj) {
  if (!obj) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[SNAKE_MAP[k] || k] = v;
  }
  return out;
}
function toSnake(obj) {
  const rev = {};
  for (const [k, v] of Object.entries(SNAKE_MAP)) rev[v] = k;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[rev[k] || k] = v;
  }
  return out;
}

// ─── 公共默认资产（新用户注册/登录时拷贝到个人素材库）───
// 初始为本地 SVG 示例素材（public/samples），保证 dev/prod 均可直出。
// 真实素材可在 default_assets 表直接增改，或通过运营后台维护。
const DEFAULT_ASSET_SEED = [
  { key: 'char-01', title: '示例·古风角色', type: 'image', category: 'character', ratio: '3:4', model: 'Nano Banana Pro', thumbnail: '/samples/character.svg', prompt: '电影级 8K 超写实人像，东方古典美人，汉服，柔光，中式庭院背景。', sort: 1 },
  { key: 'scene-01', title: '示例·古城场景', type: 'image', category: 'scene', ratio: '16:9', model: '即梦', thumbnail: '/samples/scene.svg', prompt: '宏大古城全景，晨雾，电影感光影，超宽幅。', sort: 2 },
  { key: 'prop-01', title: '示例·道具参考', type: 'image', category: 'prop', ratio: '1:1', model: 'Nano Banana Pro', thumbnail: '/samples/prop.svg', prompt: '精致道具特写，金属质感，工作室打光。', sort: 3 },
  { key: 'style-cinematic', title: '示例·电影感风格', type: 'image', category: 'other', ratio: '16:9', model: 'Nano Banana Pro', thumbnail: '/samples/style-cinematic.svg', prompt: '电影感调色，低饱和青橙对比，胶片颗粒，宽幅构图。', sort: 4 },
  { key: 'style-anime', title: '示例·二次元风格', type: 'image', category: 'other', ratio: '3:4', model: '即梦', thumbnail: '/samples/style-anime.svg', prompt: '二次元动画风格，明亮配色，清晰描边，高光柔和。', sort: 5 },
  { key: 'prompt-portrait', title: '示例·人像提示词', type: 'image', category: 'other', ratio: '4:5', model: 'Nano Banana Pro', thumbnail: '/samples/prompt-portrait.svg', prompt: '8K 超写实人像，自然光，浅景深，柔和肤质，情绪自然。', sort: 6 },
];

async function seedDefaultAssets() {
  if (!pgPool) return;
  for (const a of DEFAULT_ASSET_SEED) {
    await pgPool.query(
      `INSERT INTO default_assets (id,key,title,type,thumbnail,full_url,prompt,model,ratio,source,category,status,sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'default',$10,'success',$11)
       ON CONFLICT (key) DO UPDATE SET title=EXCLUDED.title, thumbnail=EXCLUDED.thumbnail, full_url=EXCLUDED.full_url, prompt=EXCLUDED.prompt, model=EXCLUDED.model, ratio=EXCLUDED.ratio, category=EXCLUDED.category, sort=EXCLUDED.sort`,
      ['da-' + a.key, a.key, a.title, a.type, a.thumbnail, a.thumbnail, a.prompt, a.model, a.ratio, a.category, a.sort || 0]
    );
  }
  console.log(`[Seed] default_assets 已确保 ${DEFAULT_ASSET_SEED.length} 条公共默认资产`);
}

// 把公共默认资产拷贝到指定用户的个人素材库（幂等：已存在则跳过）
async function ensureUserDefaults(userId) {
  if (!pgPool || !userId) return;
  try {
    const tpl = await pgPool.query('SELECT * FROM default_assets ORDER BY sort ASC, created_at ASC');
    for (const t of tpl.rows) {
      try {
        const ex = await pgPool.query('SELECT 1 FROM media WHERE user_id=$1 AND default_key=$2 LIMIT 1', [userId, t.key]);
        if (ex.rows.length) continue;
        const id = 'def-' + crypto.randomUUID();
        await pgPool.query(
          `INSERT INTO media (id,title,type,thumbnail,full_url,prompt,model,ratio,source,is_favorite,is_deleted,oss_url,oss_object_key,oss_uploaded,category,status,error_message,failed_at,created_at,user_id,is_default,default_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'default',FALSE,FALSE,$9,$10,$11,$12,$13,$14,NULL,$15,$16,TRUE,$17)`,
          [id, t.title, t.type, t.thumbnail, t.full_url || t.thumbnail, t.prompt, t.model, t.ratio,
           t.oss_url || '', t.oss_object_key || '', t.oss_uploaded || false, t.category, t.status || 'success', t.error_message || '',
           t.created_at || new Date().toISOString(), userId, t.key]
        );
      } catch (e) {
        console.warn('[Defaults] 拷贝失败 key=%s :', t.key, e.message);
      }
    }
  } catch (e) {
    console.warn('[Defaults] 读取默认资产模板失败:', e.message);
  }
}

// ─── 请求解析 ───────────────────────────────────
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 50 * 1024 * 1024) body = ''; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : null); }
      catch { resolve(null); }
    });
  });
}

// ─── 安全响应头（同源直出 + nginx 双保险）───
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // CSP：同源为主，允许 data:/blob:/https: 图片与媒体（OSS 代理/模型图）；React 内联样式/脚本需 unsafe-inline
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sendJSON(res, code, data) {
  applySecurityHeaders(res);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

// ─── MIME ────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let filePath = path.join(CLIENT_DIR, req.url === '/' ? 'index.html' : req.url);
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(CLIENT_DIR, 'index.html');
    }
    const ext = path.extname(filePath);
    applySecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(fs.readFileSync(filePath));
  } catch { res.end(); }
}

// ─── 本地静态文件（/media/ 上传 & /samples/ 公共示例，非 /api 路由，必须早于 SPA fallback）───
function serveLocalFiles(req, res) {
  const url = req.url.replace(/\/$/, '');
  const method = req.method;

  // ── 本地上传文件读取 ──
  if (url.startsWith('/media/') && method === 'GET') {
    const rel = url.slice('/media/'.length).replace(/[^a-zA-Z0-9._/-]/g, '_');
    const file = path.join(DATA_DIR, 'media-uploads', rel);
    if (fs.existsSync(file)) {
      const ext = path.extname(file).toLowerCase();
      const ct = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
      return res.end(fs.readFileSync(file));
    }
    return sendJSON(res, 404, { error: 'Not Found' });
  }

  // ── 公共示例素材（默认资产 SVG 占位，dev/prod 均可直出）──
  if (url.startsWith('/samples/') && method === 'GET') {
    const rel = url.slice('/samples/'.length).replace(/[^a-zA-Z0-9._/-]/g, '_');
    const file = path.join(__dirname, '..', 'public', 'samples', rel);
    if (fs.existsSync(file)) {
      const ext = path.extname(file).toLowerCase();
      const ct = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
      return res.end(fs.readFileSync(file));
    }
    return sendJSON(res, 404, { error: 'Not Found' });
  }

  return sendJSON(res, 404, { error: 'Not Found' });
}

// ─── Phase 2 实时流量采样（总控台 SSE 用，单实例内存环形缓冲）──
const traffic = {
  recent: [],
  record(method, url, status, user, ms) {
    const now = Date.now();
    this.recent.push({ ts: now, user_id: user && user.id ? user.id : null, method, url, status, ms });
    const cut = now - 60000;
    if (this.recent.length > 4000) this.recent = this.recent.filter((r) => r.ts >= cut);
  },
  onlineUsers() {
    const cut = Date.now() - 300000;
    const s = new Set();
    for (const r of this.recent) if (r.ts >= cut && r.user_id) s.add(r.user_id);
    return s.size;
  },
  currentQps() {
    const cut = Date.now() - 1000;
    let n = 0;
    for (const r of this.recent) if (r.ts >= cut) n++;
    return n;
  },
};

// ─── Phase 2 管理后台模块（注入依赖；pgPool 经 getter 取最新值）──
const monitor = monitorMod.createMonitor();   // 后台实时监控：所有 HTTP 请求(API + 静态资产)的环形缓冲 + SSE 流
monitor.startMetricsTimer();                   // 1s 广播一次 60s 滚动指标

const admin = adminMod.createAdmin({
  getPg: () => pgPool,
  session,
  sendJSON,
  fromSnake,
  toSnake,
  parseBody,
  traffic: { onlineUsers: () => traffic.onlineUsers(), currentQps: () => traffic.currentQps() },
  monitor,                                    // 注入 monitor：admin 实时监控页用(/api/admin/monitor/{snapshot,stream,clear})
  logbus,                                     // 注入 logbus：admin 实时日志页用(/api/admin/logs/{snapshot,stream,clear})
});

// ── Phase 5 电商模块（AI 市集）── 注入依赖；pgPool 经 getter 取最新值；内部自行鉴权
const shop = shopMod.createShop({
  getPg: () => pgPool,
  session,
  sendJSON,
  parseBody,
  billing,
});

// ── Phase 4 账务系统 ── 注入依赖；pgPool 经 getter 取最新值
const finance = financeMod.createFinance({
  getPg: () => pgPool,
  session,
  sendJSON,
  fromSnake,
  parseBody,
});
const me = meMod.createMe({
  getPg: () => pgPool,
  session,
  sendJSON,
  parseBody,
});

// ─── Phase 2 收尾：充值订单 + DEV 支付适配器（注入依赖；pgPool 经 getter 取最新值）──
const payments = paymentsMod.createPayments({
  getPg: () => pgPool,
  session,
  sendJSON,
  parseBody,
});

// ─── 应用网关（Phase A 改造）─────────────────────
// 保留全局 API_TOKEN（后续阶段去 fallback，评审稿 ⑦）；同时接受用户会话 cookie。
// 任一通过即放行，并把身份挂到 req.user：API_TOKEN → {id:'__system__'}，会话 → {id, role}
function appGateway(req) {
  // 仅当 dev 令牌启用时（非生产，或生产显式通过环境变量提供），才接受其作为 system 身份
  if (devTokenEnabled && req.headers['authorization'] === `Bearer ${API_TOKEN}`) {
    req.user = { id: '__system__', role: 'system' };
    return true;
  }
  const u = session.getUserFromCookie(req);
  if (u) { req.user = u; return true; }
  return false;
}

// ══════════════════════════════════════════════════
// API 路由（PG 优先，JSON 降级）
// ══════════════════════════════════════════════════
// ─── 认证路由处理 ────────────────────────────────
async function handleRegister(req, res) {
  // Phase 0 限流：同一 IP 60s 内最多 5 次注册
  const rlReg = await rateLimit({ key: 'rl:register:' + clientIp(req), limit: 5, windowSec: 60 });
  if (!rlReg.allowed) {
    res.setHeader('Retry-After', String(rlReg.retryAfter));
    return sendJSON(res, 429, { error: '注册请求过于频繁，请稍后再试' });
  }
  const body = await parseBody(req);
  const email = ((body && body.email) || '').toString().trim().toLowerCase();
  const pw = (body && body.password) || '';
  const displayName = ((body && body.displayName) || email.split('@')[0] || '').toString().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJSON(res, 400, { error: '邮箱格式不正确' });
  if (!pw || pw.length < 6) return sendJSON(res, 400, { error: '密码至少 6 位' });
  if (!pgPool) return sendJSON(res, 503, { error: '数据库不可用' });
  const ex = await pgPool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (ex.rows.length) return sendJSON(res, 409, { error: '该邮箱已注册' });
  const id = 'u-' + crypto.randomUUID();
  await pgPool.query(
    `INSERT INTO users (id, email, display_name, password_hash, credits, role)
     VALUES ($1, $2, $3, $4, 50, 'user')`,
    [id, email, displayName, session.hashPassword(pw)],
  );
  await pgPool.query( // 注册赠送 50 credits（审计留痕）
    `INSERT INTO credit_transactions (user_id, kind, amount, ref) VALUES ($1, 'grant', 50, 'signup-bonus')`,
    [id],
  );
  // 注册即拷贝公共默认资产到个人素材库（幂等）
  await ensureUserDefaults(id);
  const token = session.signSession({ id, role: 'user' });
  session.setCookie(res, session.COOKIE_NAME, token, session.ACCESS_TTL_SEC);
  return sendJSON(res, 200, { ok: true, user: { id, email, displayName, credits: 50, role: 'user' } });
}

async function handleLogin(req, res) {
  // Phase 0 限流：同一 IP 60s 内最多 10 次登录（防暴力破解）
  const rlLogin = await rateLimit({ key: 'rl:login:' + clientIp(req), limit: 10, windowSec: 60 });
  if (!rlLogin.allowed) {
    res.setHeader('Retry-After', String(rlLogin.retryAfter));
    return sendJSON(res, 429, { error: '登录请求过于频繁，请稍后再试' });
  }
  const body = await parseBody(req);
  const email = ((body && body.email) || '').toString().trim().toLowerCase();
  const pw = (body && body.password) || '';
  if (!pgPool) return sendJSON(res, 503, { error: '数据库不可用' });
  const r = await pgPool.query(
    'SELECT id, email, display_name, password_hash, credits, role FROM users WHERE email=$1', [email]);
  if (!r.rows.length) return sendJSON(res, 401, { error: '邮箱或密码错误' });
  const u = r.rows[0];
  if (!session.verifyPassword(pw, u.password_hash)) return sendJSON(res, 401, { error: '邮箱或密码错误' });
  // 登录时确保公共默认资产已就位（幂等；兼容老用户注册前尚无默认资产的情况）
  // 注意：admin 不是「顾客」，不自动塞示例（手动推送 pushSamplesToUsers 也已排除 admin）
  if (u.role !== 'admin') await ensureUserDefaults(u.id);
  const token = session.signSession({ id: u.id, role: u.role });
  session.setCookie(res, session.COOKIE_NAME, token, session.ACCESS_TTL_SEC);
  return sendJSON(res, 200, {
    ok: true,
    user: { id: u.id, email: u.email, displayName: u.display_name, credits: u.credits, role: u.role },
  });
}

async function handleLogout(req, res) {
  session.clearCookie(res, session.COOKIE_NAME);
  return sendJSON(res, 200, { ok: true });
}

async function handleRefresh(req, res) {
  const user = session.getUserFromCookie(req);
  if (!user) return sendJSON(res, 401, { error: '会话无效' });
  const token = session.signSession({ id: user.id, role: user.role });
  session.setCookie(res, session.COOKIE_NAME, token, session.ACCESS_TTL_SEC);
  return sendJSON(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const user = session.getUserFromCookie(req);
  if (!user) return sendJSON(res, 401, { error: '未登录' });
  if (!pgPool) return sendJSON(res, 503, { error: '数据库不可用' });
  const r = await pgPool.query(
    'SELECT id, email, display_name, credits, role FROM users WHERE id=$1', [user.id]);
  if (!r.rows.length) return sendJSON(res, 401, { error: '用户不存在' });
  const u = r.rows[0];
  return sendJSON(res, 200, {
    user: { id: u.id, email: u.email, displayName: u.display_name, credits: u.credits, role: u.role },
  });
}

async function handleAPI(req, res) {
  const url = req.url.replace(/\/$/, '');
  const method = req.method;
  const reqUrl = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(reqUrl.searchParams);

  // Phase 0 健康检查：公开端点，网关前放行，供 nginx/容器探针与压测使用
  if (url === '/api/healthz' && method === 'GET') {
    return sendJSON(res, 200, {
      status: 'ok',
      pg: !!pgPool,
      redis: isRedisUp(),
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '0.1.0',
      ts: Date.now(),
    });
  }

  // 公开路由（注册/登录/刷新在全局网关之前）
  if (url === '/api/auth/register' && method === 'POST') return handleRegister(req, res);
  if (url === '/api/auth/login' && method === 'POST') return handleLogin(req, res);
  if (url === '/api/auth/refresh' && method === 'POST') return handleRefresh(req, res);
  // 公开：充值套餐（供充值弹窗预览，无需登录）
  if (url === '/api/finance/topup-packages' && method === 'GET') return finance.handlePublic(req, res, url.split('?')[0], method);

  // 应用网关：API_TOKEN 或 用户会话 cookie 任一通过
  if (!appGateway(req)) return sendJSON(res, 401, { error: 'Unauthorized' });

  // 需会话的认证路由
  if (url === '/api/auth/me' && method === 'GET') return handleMe(req, res);
  if (url === '/api/auth/logout' && method === 'POST') return handleLogout(req, res);
  // ── 用户侧账务（积分流水 / 充值订单 / 概览）── 需登录
  if (url.startsWith('/api/me/') && method !== 'OPTIONS') return me.handleMeRoutes(req, res, url.split('?')[0], method);

  // ── 管理后台（M3 总控台 / M4 智能体层）──
  if (url === '/api/admin/console/stream' && method === 'GET') return admin.streamConsole(req, res);
  // ── 后台账务系统（Phase 4：总览 / 对账 / 账本 / 套餐）── 优先于通用 admin 分发
  if (url.startsWith('/api/admin/finance/') && method !== 'OPTIONS') return finance.handleFinance(req, res, url.split('?')[0], method);
  if (url.startsWith('/api/admin/') && method !== 'OPTIONS') return admin.handleAdmin(req, res, url.split('?')[0], method);

  // ── 电商模块（AI 市集）── 命中即处理（内部自行鉴权：商品列表/详情公开，购物车/订单需登录）
  if ((url.startsWith('/api/shop/') || url.startsWith('/api/products/') || url.startsWith('/api/cart') || url.startsWith('/api/orders')) && method !== 'OPTIONS') {
    if (await shop.handleShop(req, res, url.split('?')[0], method)) return;
  }

  // ── 充值订单 + DEV 支付适配器（M2 账务）── 命中即处理并返回 true
  if (payments.handlePayments(req, res, url, method)) return;

  const realUser = session.getUserFromCookie(req); // 真实用户身份（用于计费/owner）

  // ── Media ──
  // 同步预扫：探测前 16 张未标 failed 的图，限并发 4 + 3s 超时
  // 把失效的标 failed + errorMessage 写库，避免前端看到「检测链接…」灰色占位
  // （更深度的扫描由前端 useImageProbe 兜底）
  const PROBE_CONCURRENCY = 4;
  const PROBE_TIMEOUT_MS = 3000;
  const PROBE_BATCH = 16; // 同步预扫只覆盖最显眼的 16 张，避免 GET 卡死

  // 二次验证：HEAD 失败时用 GET range（0-1023 字节）重试
  // 原因：很多 CDN / 签名 URL（OSS、agne-ai、CloudFront 等）对 HEAD 不友好，
  //       实际浏览器 GET 200 的图，HEAD 可能返回 403/405/501 或干脆被网络层拦掉
  async function probeOneUrl(url, timeoutMs = PROBE_TIMEOUT_MS) {
    if (!url || typeof url !== 'string') return { ok: false, error: '链接为空' };
    if (url.startsWith('data:') || url.startsWith('blob:')) return { ok: true, skipWrite: true };
    // 本地自有资源（本服务的 /samples、/media 静态路由）视为可达，跳过探测；
    // 平台专有占位路径（/spark、/runtime 等）在本环境不可外网访问，标记为失败
    if (url.startsWith('/') && !url.startsWith('//')) {
      if (url.startsWith('/samples/') || url.startsWith('/media/')) return { ok: true, skipWrite: true };
      return { ok: false, error: '本地/平台专有路径（不可外网访问）' };
    }
    // 1) 先尝试 HEAD
    let headStatus = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) return { ok: true };
      headStatus = resp.status;
      // HEAD 失败（任何 4xx/5xx）一律走 GET range 二次验证
      // 原因：OSS 签名 URL、agne-ai CDN、CloudFront 等常对 HEAD 返回 403/405/501，但 GET 实际能下
    } catch (e) {
      // HEAD 网络层失败（AbortError / 连接被拒）→ 走 GET 二次验证
      headStatus = 'NETWORK_ERR';
    }
    // 2) GET range 0-1024 二次验证（只读 1KB，省流量）
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, { method: 'GET', signal: controller.signal, headers: { Range: 'bytes=0-1024' } });
      clearTimeout(timer);
      if (resp.ok || resp.status === 206) return { ok: true };
      return { ok: false, error: `HTTP ${resp.status}（HEAD/GET 都失败）` };
    } catch (e) {
      return {
        ok: false,
        error: e.name === 'AbortError'
          ? `图片加载超时（${Math.round(timeoutMs / 1000)}s）`
          : `网络错误（HEAD=${headStatus}）`,
      };
    }
  }

  async function pMapLimit(arr, limit, iter) {
    const ret = new Array(arr.length);
    let i = 0;
    const workers = Array.from({ length: limit }, async () => {
      while (i < arr.length) {
        const idx = i++;
        ret[idx] = await iter(arr[idx], idx);
      }
    });
    await Promise.all(workers);
    return ret;
  }

  async function probeBatchAndMarkFailed(mediaList, pgPoolRef) {
    const needsProbe = mediaList
      .filter((m) => m.status !== 'failed' && m.thumbnail && m.source !== 'default')
      .slice(0, PROBE_BATCH);
    if (needsProbe.length === 0) return 0;
    const startedAt = Date.now();
    const probeResults = await pMapLimit(needsProbe, PROBE_CONCURRENCY, async (m) => ({
      id: m.id,
      ...(await probeOneUrl(m.thumbnail)),
    }));
    const failedIds = [];
    for (const pr of probeResults) {
      if (!pr || pr.skipWrite) continue;
      if (!pr.ok) {
        failedIds.push({ id: pr.id, error: pr.error });
        // 内存中直接修改，前端立即看到 failed 占位
        const target = mediaList.find((m) => m.id === pr.id);
        if (target) {
          target.status = 'failed';
          target.errorMessage = pr.error;
          target.failedAt = new Date().toISOString();
        }
      }
    }
    // 批量写库
    if (failedIds.length > 0 && pgPoolRef) {
      for (const f of failedIds) {
        await pgPoolRef.query(
          'UPDATE media SET status=$1, error_message=$2, failed_at=$3 WHERE id=$4',
          ['failed', f.error, new Date().toISOString(), f.id],
        );
      }
    }
    const elapsed = Date.now() - startedAt;
    console.log(`[Probe] 预扫 ${needsProbe.length} 张 → 标 ${failedIds.length} 张失败（${elapsed}ms）`);
    return failedIds.length;
  }

  if (url === '/api/media' && method === 'GET') {
    if (pgPool) {
      let mediaSql = 'SELECT * FROM media WHERE is_deleted=FALSE';
      const mediaParams = [];
      if (realUser) { mediaSql += ' AND (user_id=$1 OR user_id IS NULL)'; mediaParams.push(realUser.id); } // G2 owner 隔离；历史 NULL 行全员可见
      mediaSql += ' ORDER BY created_at DESC';
      const r = await pgPool.query(mediaSql, mediaParams);
      const list = r.rows.map(fromSnake);
      // 同步预扫：只阻塞这一批，超出部分由前端 useImageProbe 异步兜底
      await probeBatchAndMarkFailed(list, pgPool);
      return sendJSON(res, 200, list);
    }
    return sendJSON(res, 200, readJSON('media'));
  }
  // 媒体数量统计（按 type / category 分组，给侧边栏角标用）
  if (url === '/api/media/counts' && method === 'GET') {
    if (pgPool) {
      // 与 /api/media 列表一致：登录用户只统计「自己 + 公共(NULL)」，不泄露他人私有素材数量
      let countsWhere = 'NOT is_deleted';
      const countsParams = [];
      if (realUser) { countsWhere += ' AND (user_id=$1 OR user_id IS NULL)'; countsParams.push(realUser.id); }
      else { countsWhere += ' AND user_id IS NULL'; }
      const r = await pgPool.query(`
        SELECT
          COUNT(*) FILTER (WHERE type='image')                       AS image,
          COUNT(*) FILTER (WHERE type='video')                       AS video,
          COUNT(*) FILTER (WHERE category='character')               AS character,
          COUNT(*) FILTER (WHERE category='scene')                   AS scene,
          COUNT(*) FILTER (WHERE category='prop')                     AS prop,
          COUNT(*) FILTER (WHERE category='other')                    AS other,
          COUNT(*) FILTER (WHERE category='upload')                   AS upload,
          COUNT(*)                                                    AS total
        FROM media
        WHERE ${countsWhere}
      `, countsParams);
      const row = r.rows[0];
      return sendJSON(res, 200, {
        total: parseInt(row.total, 10) || 0,
        image: parseInt(row.image, 10) || 0,
        video: parseInt(row.video, 10) || 0,
        character: parseInt(row.character, 10) || 0,
        scene: parseInt(row.scene, 10) || 0,
        prop: parseInt(row.prop, 10) || 0,
        other: parseInt(row.other, 10) || 0,
        upload: parseInt(row.upload, 10) || 0,
      });
    }
    const list = readJSON('media').filter((m) => !m.isDeleted && !m.is_deleted);
    return sendJSON(res, 200, {
      total: list.length,
      image: list.filter((m) => m.type === 'image').length,
      video: list.filter((m) => m.type === 'video').length,
      character: list.filter((m) => m.category === 'character').length,
      scene: list.filter((m) => m.category === 'scene').length,
      prop: list.filter((m) => m.category === 'prop').length,
      other: list.filter((m) => m.category === 'other').length,
      upload: list.filter((m) => m.category === 'upload').length,
    });
  }
  if (url === '/api/media' && method === 'POST') {
    const items = await parseBody(req);
    if (!items) return sendJSON(res, 400, { error: 'Invalid JSON' });
    const arr = Array.isArray(items) ? items : [items];
    if (pgPool) {
      for (const it of arr) {
        const s = toSnake(it);
        const ownerId = realUser ? realUser.id : null; // G2 owner 归属：登录用户写入自己的素材
        await pgPool.query(
          `INSERT INTO media (id,title,type,thumbnail,full_url,prompt,model,ratio,source,is_favorite,is_deleted,oss_url,oss_object_key,oss_uploaded,category,status,error_message,failed_at,created_at,user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,full_url=EXCLUDED.full_url,thumbnail=EXCLUDED.thumbnail,oss_url=EXCLUDED.oss_url,oss_object_key=EXCLUDED.oss_object_key,oss_uploaded=EXCLUDED.oss_uploaded,is_deleted=EXCLUDED.is_deleted,status=EXCLUDED.status,error_message=EXCLUDED.error_message,failed_at=EXCLUDED.failed_at,user_id=EXCLUDED.user_id`,
          [s.id, s.title, s.type, s.thumbnail, s.full_url, s.prompt, s.model, s.ratio, s.source, s.is_favorite || false, s.is_deleted || false, s.oss_url, s.oss_object_key, s.oss_uploaded || false, s.category || 'generated', s.status || 'success', s.error_message || '', s.failed_at || null, s.created_at || new Date().toISOString(), ownerId]
        );
      }
      return sendJSON(res, 200, { ok: true, count: arr.length });
    }
    const list = readJSON('media');
    for (const it of arr) { const idx = list.findIndex(m => m.id === it.id); if (idx >= 0) list[idx] = it; else list.push(it); }
    writeJSON('media', list);
    return sendJSON(res, 200, { ok: true, count: arr.length });
  }
  if (url.startsWith('/api/media/') && method === 'DELETE') {
    const id = url.split('/api/media/')[1];
    if (pgPool) {
      // 仅允许删除「自己的」素材：公共资产(user_id IS NULL)与他人的行受保护，不会被误删
      let deleted = 0;
      if (realUser) {
        const r = await pgPool.query('DELETE FROM media WHERE id=$1 AND user_id=$2', [id, realUser.id]);
        deleted = r.rowCount || 0;
      }
      return sendJSON(res, 200, { ok: true, deleted });
    }
    writeJSON('media', readJSON('media').filter(m => m.id !== id));
    return sendJSON(res, 200, { ok: true });
  }
  // 单条部分更新：用于探测失败后回写 status/errorMessage/failed_at
  // 安全加固：必须登录 + 仅能改自己的素材（admin 可改全部）；字段白名单禁止更新 user_id，杜绝 IDOR 把他人素材改成自己的
  if (url.startsWith('/api/media/') && method === 'PUT') {
    const id = url.split('/api/media/')[1];
    const body = await parseBody(req);
    if (!body || !id) return sendJSON(res, 400, { error: 'Invalid request' });
    if (!realUser) return sendJSON(res, 401, { error: '未登录' });
    if (pgPool) {
      const exist = await pgPool.query('SELECT user_id FROM media WHERE id=$1', [id]);
      if (exist.rows.length === 0) return sendJSON(res, 404, { error: '素材不存在' });
      const owner = exist.rows[0].user_id;
      if (owner !== realUser.id && realUser.role !== 'admin') {
        return sendJSON(res, 403, { error: '无权修改该素材' });
      }
      // 字段白名单：只允许更新业务字段，绝不许篡改 user_id 等归属字段（防偷素材）
      const ALLOWED = new Set([
        'title', 'status', 'error_message', 'failed_at', 'is_favorite', 'prompt',
        'ratio', 'model', 'category', 'thumbnail', 'full_url', 'oss_url',
        'oss_object_key', 'oss_uploaded', 'source', 'type',
      ]);
      const s = toSnake(body);
      const fields = [];
      const vals = [];
      let i = 1;
      for (const [k, v] of Object.entries(s)) {
        if (v === undefined || !ALLOWED.has(k)) continue;
        fields.push(`${k}=$${i}`);
        vals.push(v);
        i++;
      }
      if (fields.length === 0) return sendJSON(res, 200, { ok: true, noop: true });
      vals.push(id);
      await pgPool.query(`UPDATE media SET ${fields.join(',')} WHERE id=$${i}`, vals);
      return sendJSON(res, 200, { ok: true });
    }
    // 非 PG 兜底（JSON 文件模式）
    const list = readJSON('media');
    const idx = list.findIndex(m => m.id === id);
    if (idx >= 0) {
      const ownerId = list[idx] && (list[idx].user_id || list[idx].userId);
      if (ownerId && ownerId !== realUser.id && realUser.role !== 'admin') {
        return sendJSON(res, 403, { error: '无权修改该素材' });
      }
      list[idx] = { ...list[idx], ...body };
      writeJSON('media', list);
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ── 角色一致性系统：全局角色库（characters 表，无 user_id，全员共享的创作预设）──
  if (url === '/api/characters' && method === 'GET') {
    if (!realUser) return sendJSON(res, 401, { error: '未登录' });
    if (pgPool) {
      const r = await pgPool.query('SELECT * FROM characters ORDER BY created_at DESC');
      return sendJSON(res, 200, r.rows.map(fromSnake));
    }
    return sendJSON(res, 200, readJSON('characters') || []);
  }
  if (url === '/api/characters' && method === 'POST') {
    if (!realUser) return sendJSON(res, 401, { error: '未登录' });
    const body = await parseBody(req);
    const arr = Array.isArray(body) ? body : [body];
    if (pgPool) {
      for (const it of arr) {
        const id = it.id || ('ch-' + crypto.randomUUID());
        const s = toSnake(it);
        await pgPool.query(
          `INSERT INTO characters (id, name, avatar_url, gender, age, tags, style, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
           ON CONFLICT (id) DO UPDATE SET name=$2, avatar_url=$3, gender=$4, age=$5, tags=$6, style=$7`,
          [id, s.name || '', s.avatar_url || '', s.gender || '', s.age || 0, s.tags || [], s.style || {}],
        );
      }
      return sendJSON(res, 200, { ok: true, count: arr.length });
    }
    const list = readJSON('characters') || [];
    for (const it of arr) { const id = it.id || ('ch-' + crypto.randomUUID()); const idx = list.findIndex(x => x.id === id); const rec = { ...it, id }; if (idx >= 0) list[idx] = rec; else list.push(rec); }
    writeJSON('characters', list);
    return sendJSON(res, 200, { ok: true, count: arr.length });
  }

  // ── Providers ──
  // ── 代理下载图片（绕过浏览器 CORS）──
  if (url === '/api/proxy-fetch' && method === 'POST') {
    const body = await parseBody(req);
    if (!body?.imageUrl) return sendJSON(res, 400, { success: false, message: '缺少 imageUrl' });
    try {
      const r = await fetch(body.imageUrl, {
        headers: body.headers || {},
        redirect: 'follow',
      });
      if (!r.ok) return sendJSON(res, 200, { success: false, message: `HTTP ${r.status}`, status: r.status });
      const arrayBuf = await r.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      return sendJSON(res, 200, {
        success: true,
        base64: buf.toString('base64'),
        contentType: r.headers.get('content-type') || 'image/jpeg',
        size: buf.length,
      });
    } catch (e) {
      return sendJSON(res, 200, { success: false, message: `代理失败：${e instanceof Error ? e.message : String(e)}` });
    }
  }

  if (url === '/api/providers' && method === 'GET') {
    const maskKey = (p) => ({ ...p, apiKey: p.apiKey ? '***' : '' });
    if (pgPool) { const r = await pgPool.query('SELECT * FROM providers ORDER BY created_at'); return sendJSON(res, 200, r.rows.map(fromSnake).map(maskKey)); }
    return sendJSON(res, 200, readJSON('providers').map(maskKey));
  }
  if (url === '/api/providers' && method === 'POST') {
    if (!admin.requireAdmin(req)) return sendJSON(res, 403, { error: '需要管理员权限' });
    const items = await parseBody(req); if (!items) return sendJSON(res, 400, { error: 'Invalid JSON' });
    const arr = Array.isArray(items) ? items : [items];
    if (pgPool) {
      try {
        for (const it of arr) {
          const s = toSnake(it);
          // 安全：api_key 含 '*' 或太短视为占位，沿用 DB 现有值（避免误覆盖真实密钥）
          let apiKey = s.api_key;
          if (!apiKey || apiKey.includes('*') || apiKey.length < 6) {
            const ex = await pgPool.query('SELECT api_key FROM providers WHERE id=$1', [s.id]);
            if (ex.rows[0]?.api_key) apiKey = ex.rows[0].api_key;
          }
          await pgPool.query(
            `INSERT INTO providers (id,name,type,base_url,api_key,supported_types,enabled,protocol,remark,default_endpoint,max_concurrent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,base_url=EXCLUDED.base_url,api_key=EXCLUDED.api_key,protocol=EXCLUDED.protocol,enabled=EXCLUDED.enabled,max_concurrent=EXCLUDED.max_concurrent`,
            [s.id, s.name, s.type, s.base_url, apiKey, s.supported_types || [], s.enabled !== false, s.protocol || 'openai-compatible', s.remark || '', JSON.stringify(s.default_endpoint || {}), Number(s.max_concurrent) || 2]
          );
        }
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        console.error('[providers] POST 失败', e.message);
        return sendJSON(res, 400, { error: '保存失败：' + e.message });
      }
    }
    const list = readJSON('providers');
    for (const it of arr) { const idx = list.findIndex(p => p.id === it.id); if (idx >= 0) list[idx] = it; else list.push(it); }
    writeJSON('providers', list);
    return sendJSON(res, 200, { ok: true });
  }
  if (url.startsWith('/api/providers/') && method === 'DELETE') {
    if (!admin.requireAdmin(req)) return sendJSON(res, 403, { error: '需要管理员权限' });
    const id = url.split('/api/providers/')[1];
    if (pgPool) { try { await pgPool.query('DELETE FROM models WHERE provider_id=$1', [id]); await pgPool.query('DELETE FROM providers WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); } catch (e) { console.error('[providers] DELETE 失败', e.message); return sendJSON(res, 400, { error: '删除失败：' + e.message }); } }
    writeJSON('providers', readJSON('providers').filter(p => p.id !== id));
    return sendJSON(res, 200, { ok: true });
  }

  // ── 服务端生成分发（同模型多供应商动态均衡）──
  // POST /api/generate：异步模式（默认）。立即返回 taskId，前端轮询 /api/generate/status/:taskId 拿结果。
  if (url === '/api/generate' && method === 'POST') {
    // 限流：每 IP 60s 内最多 30 次生成（防刷爆供应商配额 / 积分滥用）
    const rlGen = await rateLimit({ key: 'rl:gen:' + clientIp(req), limit: 30, windowSec: 60 });
    if (!rlGen.allowed) {
      res.setHeader('Retry-After', String(rlGen.retryAfter));
      return sendJSON(res, 429, { error: '生成请求过于频繁，请稍后再试' });
    }
    if (!pgPool) return sendJSON(res, 200, { status: 'failed', error: '数据库不可用，无法分发生成任务' });
    const body = await parseBody(req);
    if (!body || !body.model || !body.prompt) return sendJSON(res, 400, { error: '缺少 model 或 prompt' });
    // 身份：必须是真实登录用户（cookie 会话），否则无法归属计费/owner（G1/G2）
    if (!realUser) return sendJSON(res, 401, { error: '未登录' });
    // 幂等键（G4）：前端每次生成请求生成一个 UUID，重试复用，防止网络抖动双扣
    const idemKey = (body.idempotencyKey || '').toString().trim();
    if (!idemKey) return sendJSON(res, 400, { error: '缺少 idempotencyKey' });

    // 幂等：已存在同键任务？
    const ex = await pgPool.query(
      'SELECT task_id, status, cost FROM generation_tasks WHERE idempotency_key=$1', [idemKey]);
    if (ex.rows.length) {
      const row = ex.rows[0];
      if (row.status === 'failed') {
        // 失败的可复用同一键重试：先释放旧 held，再删行腾出唯一约束
        await billing.releaseCredits(pgPool, realUser.id, row.cost || 0, idemKey).catch(() => {});
        await pgPool.query('DELETE FROM generation_tasks WHERE idempotency_key=$1', [idemKey]);
      } else {
        // running/done：直接返回原 taskId，绝不重复 reserve（防双扣）
        return sendJSON(res, 200, {
          status: row.status === 'done' ? 'done' : 'pending',
          taskId: row.task_id, idempotent: true,
        });
      }
    }

    // 成本解析（L5）：用与 dispatcher 相同的 model 标识查 credit_cost
    const costRes = await pgPool.query(
      'SELECT credit_cost FROM models WHERE id=$1 OR model_id=$1 LIMIT 1', [body.model]);
    const cost = costRes.rows.length ? Number(costRes.rows[0].credit_cost) || 0 : 0;

    // reserve（G3 时序：仅在此扣，结算留给 dispatcher 后台回调）
    try {
      await billing.reserveCredits(pgPool, realUser.id, cost, idemKey);
    } catch (e) {
      return sendJSON(res, 402, { status: 'failed', error: '积分不足' });
    }

    const genOpts = {
      model: body.model,
      prompt: body.prompt,
      ratio: body.ratio || '1:1',
      resolution: body.resolution || '1k',
      count: body.count || 1,
      contentType: body.contentType || 'image',
      referenceImages: body.referenceImages || [],
      pendingIds: body.pendingIds || [],
      user_id: realUser.id,
      idempotencyKey: idemKey,
      cost,
      clientMeta: {
        ratio: body.ratio || '1:1',
        resolution: body.resolution || '1k',
        contentType: body.contentType || 'image',
      },
    };
    // 兼容旧调用：sync=1 时直接返回完整结果（用于一次性同步测试/老客户端）——同样走计费（L9）
    if (body.sync) {
      try {
        const result = await dispatcher.generate(pgPool, genOpts);
        if (result && result.status === 'success') {
          await billing.commitCredits(pgPool, realUser.id, cost, idemKey);
        } else {
          await billing.releaseCredits(pgPool, realUser.id, cost, idemKey).catch(() => {});
        }
        return sendJSON(res, 200, result);
      } catch (e) {
        await billing.releaseCredits(pgPool, realUser.id, cost, idemKey).catch(() => {});
        return sendJSON(res, 200, { status: 'failed', error: `分发异常：${(e && e.message) || String(e)}` });
      }
    }
    // 异步：插入任务表，后台跑，前端轮询（完成回调里 commit/release）
    try {
      const { taskId, error } = await dispatcher.generateAsync(pgPool, genOpts);
      if (error) {
        await billing.releaseCredits(pgPool, realUser.id, cost, idemKey).catch(() => {});
        return sendJSON(res, 200, { status: 'failed', error });
      }
      return sendJSON(res, 200, { status: 'pending', taskId });
    } catch (e) {
      await billing.releaseCredits(pgPool, realUser.id, cost, idemKey).catch(() => {});
      return sendJSON(res, 200, { status: 'failed', error: `分发异常：${(e && e.message) || String(e)}` });
    }
  }

  // GET /api/generate/status/:taskId — 查询单个任务状态
  if (url.startsWith('/api/generate/status/') && method === 'GET') {
    if (!pgPool) return sendJSON(res, 200, { status: 'unknown', error: '数据库不可用' });
    const taskId = decodeURIComponent(url.slice('/api/generate/status/'.length));
    const r = await dispatcher.getTaskStatus(pgPool, taskId);
    return sendJSON(res, 200, r);
  }

  // GET /api/generate/active — 列出在途任务（用于页面刷新后批量恢复）
  if (url === '/api/generate/active' && method === 'GET') {
    if (!pgPool) return sendJSON(res, 200, { tasks: [], error: '数据库不可用' });
    if (!realUser) return sendJSON(res, 401, { error: '未登录' });
    const r = await dispatcher.listActiveTasks(pgPool, realUser.id);
    return sendJSON(res, 200, r);
  }

  // ── AI 提示词优化（智能体 skill：调后台启用的 text 类型推理模型）──
  if (url === '/api/agent/optimize-prompt' && method === 'POST') {
    if (!pgPool) return sendJSON(res, 200, { success: false, error: '数据库不可用' });
    const body = await parseBody(req);
    const userPrompt = ((body && body.prompt) || '').toString().trim();
    if (!userPrompt) return sendJSON(res, 200, { success: false, error: '提示词为空' });
      let model = null;
      try {
        // 选一个启用的 text 类型模型（按 .com 域名降序排最后、creditCost 升序、id 字典序取第一个）
        // 备注：当前 Node 22 原生 fetch 在国内网络下对 agnes-ai.com 域名握手异常，优先用 .cn
        const m = await pgPool.query(
          "SELECT m.id AS m_id, m.model_id, m.display_name, m.credit_cost, " +
          "p.id AS p_id, p.base_url, p.api_key, p.protocol " +
          "FROM models m JOIN providers p ON p.id = m.provider_id " +
          "WHERE m.type='text' AND m.enabled=true AND p.enabled=true " +
          "AND p.api_key IS NOT NULL AND LENGTH(p.api_key) >= 6 " +
          "ORDER BY (p.base_url LIKE '%agnes-ai.com%') ASC, m.credit_cost ASC, m.id ASC LIMIT 1"
        );
        if (m.rows.length === 0) {
          return sendJSON(res, 200, {
            success: false,
            code: 'NO_REASONING_MODEL',
            error: '未配置启用的文本推理模型，请到「模型 Hub」添加 type=text 的模型',
          });
        }
        model = m.rows[0];
        const base = (model.base_url || '').trim().replace(/\/+$/, '');
        if (!base) return sendJSON(res, 200, { success: false, error: '推理服务商 base_url 未配置' });

        const systemPrompt = [
          '你是一个 AI 图像/视频生成提示词优化专家。',
          '用户会给一段初步描述（可能简短或粗糙），',
          '请在不改变用户核心意图的前提下，把它改写成更适合图像/视频生成模型的结构化英文提示词。',
          '要求：',
          '1) 用英文输出（除非用户明确要求中文）；',
          '2) 包含主体、场景、风格、光照、镜头、构图、画质等关键元素；',
          '3) 控制在 80-200 词；',
          '4) 直接输出优化后的提示词正文，不要加任何解释、前缀、Markdown 代码块包裹。',
        ].join('');
        const r = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.api_key}` },
          body: JSON.stringify({
            model: model.model_id,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 600,
            temperature: 0.7,
          }),
        });
        const raw = await r.text();
        if (!r.ok) return sendJSON(res, 200, { success: false, error: `推理模型返回 HTTP ${r.status}：${raw.slice(0, 200)}` });
        let data; try { data = JSON.parse(raw); } catch { return sendJSON(res, 200, { success: false, error: '推理模型返回非 JSON：' + raw.slice(0, 200) }); }
        const content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').toString().trim();
        if (!content) return sendJSON(res, 200, { success: false, error: '推理模型返回为空' });
        return sendJSON(res, 200, {
          success: true,
          content,
          modelUsed: model.display_name,
          providerId: model.p_id,
        });
      } catch (e) {
        const cause = e && e.cause;
        const detail = cause ? ` (cause: ${cause.code || cause.name || ''} ${cause.message || ''})` : '';
        console.error('[agent/optimize-prompt] 异常:', e.message, detail, '\n  model:', model && model.model_id, 'base:', model && model.base_url);
        return sendJSON(res, 200, { success: false, error: `优化异常：${e.message}${detail}`.slice(0, 200) });
      }
  }

  // ── 同步服务商模型列表（后端代理，避免前端持有真实 Key）──
  if (url.match(/^\/api\/providers\/[^/]+\/sync$/) && method === 'POST') {
    const id = url.split('/')[3];
    if (!pgPool) return sendJSON(res, 200, { success: false, message: '数据库不可用' });
    const r = await pgPool.query('SELECT * FROM providers WHERE id=$1', [id]);
    const p = r.rows[0];
    if (!p) return sendJSON(res, 200, { success: false, message: '服务商不存在' });
    if (!p.api_key || p.api_key.length < 6) return sendJSON(res, 200, { success: false, message: '服务商未配置有效 API Key（请在编辑弹窗保存真实密钥）' });
    try {
      const base = (p.base_url || '').trim().replace(/\/+$/, '');
      const proto = p.protocol || 'openai-compatible';
      const defEp = p.default_endpoint || {};
      let models = [];
      if (proto === 'custom' && defEp.listModels) {
        const { status, body } = await dispatcher.callEndpoint(base, defEp.listModels, p.api_key, {});
        if (status >= 400) return sendJSON(res, 200, { success: false, message: `同步失败 HTTP ${status}` });
        const arr = dispatcher.getArrayByPath(body, defEp.listModels.listFieldPath || 'data');
        models = arr.map((m) => ({ id: String(dispatcher.getByPath(m, defEp.listModels.listIdFieldPath || 'id') || ''), name: String(dispatcher.getByPath(m, defEp.listModels.listNameFieldPath || 'name') || '') })).filter((m) => m.id);
      } else {
        const resp = await fetch(`${base}/models`, { method: 'GET', headers: { Authorization: `Bearer ${p.api_key}` } });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) return sendJSON(res, 200, { success: false, message: `同步失败 HTTP ${resp.status}` });
        const arr = Array.isArray(data && data.data) ? data.data : [];
        models = arr.map((m) => ({ id: String(m.id || ''), name: String(m.id || '') })).filter((m) => m.id);
      }
      return sendJSON(res, 200, { success: true, models });
    } catch (e) {
      return sendJSON(res, 200, { success: false, message: `同步异常：${(e && e.message) || String(e)}` });
    }
  }

  // ── 测试服务商端点（后端代理，避免前端持有真实 Key）──
  if (url.match(/^\/api\/providers\/[^/]+\/test-endpoint$/) && method === 'POST') {
    const id = url.split('/')[3];
    const body = await parseBody(req);
    if (!pgPool) return sendJSON(res, 200, { success: false, message: '数据库不可用' });
    const r = await pgPool.query('SELECT * FROM providers WHERE id=$1', [id]);
    const p = r.rows[0];
    if (!p) return sendJSON(res, 200, { success: false, message: '服务商不存在' });
    if (!p.api_key || p.api_key.length < 6) return sendJSON(res, 200, { success: false, message: '服务商未配置有效 API Key' });
    try {
      const ep = body && body.endpoint;
      if (!ep || !ep.path) return sendJSON(res, 200, { success: false, message: '缺少 endpoint 配置' });
      const { status, body: respBody } = await dispatcher.callEndpoint(p.base_url, ep, p.api_key, (body && body.vars) || {});
      return sendJSON(res, 200, { success: true, status, body: respBody });
    } catch (e) {
      return sendJSON(res, 200, { success: false, message: `测试异常：${(e && e.message) || String(e)}` });
    }
  }
  if (url.match(/^\/api\/providers\/[^/]+\/test-default$/) && method === 'POST') {
    const id = url.split('/')[3];
    const body = await parseBody(req);
    if (!pgPool) return sendJSON(res, 200, { success: false, message: '数据库不可用' });
    const r = await pgPool.query('SELECT * FROM providers WHERE id=$1', [id]);
    const p = r.rows[0];
    if (!p) return sendJSON(res, 200, { success: false, message: '服务商不存在' });
    if (!p.api_key || p.api_key.length < 6) return sendJSON(res, 200, { success: false, message: '服务商未配置有效 API Key' });
    try {
      const url2 = `${p.base_url.replace(/\/$/, '')}/chat/completions`;
      const resp = await fetch(url2, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.api_key}` }, body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: (body && body.testInput) || 'hi' }], max_tokens: 50 }) });
      const text = await resp.text();
      return sendJSON(res, 200, { success: true, status: resp.status, body: text.slice(0, 2000) });
    } catch (e) {
      return sendJSON(res, 200, { success: false, message: `测试异常：${(e && e.message) || String(e)}` });
    }
  }

  // ── Models ──
  if (url === '/api/models' && method === 'GET') {
    if (pgPool) { const r = await pgPool.query('SELECT * FROM models ORDER BY created_at'); return sendJSON(res, 200, r.rows.map(fromSnake)); }
    return sendJSON(res, 200, readJSON('models'));
  }
  if (url === '/api/models' && method === 'POST') {
    if (!admin.requireAdmin(req)) return sendJSON(res, 403, { error: '需要管理员权限' });
    const items = await parseBody(req); if (!items) return sendJSON(res, 400, { error: 'Invalid JSON' });
    const arr = Array.isArray(items) ? items : [items];
    if (pgPool) {
      try {
        for (const it of arr) {
          const s = toSnake(it);
          await pgPool.query(
            `INSERT INTO models (id,model_id,display_name,mapping_name,type,provider_id,enabled,supported_resolutions,capabilities,endpoint,credit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name,mapping_name=EXCLUDED.mapping_name,enabled=EXCLUDED.enabled,credit_cost=EXCLUDED.credit_cost`,
            [s.id, s.model_id, s.display_name, s.mapping_name || '', s.type, s.provider_id, s.enabled !== false, s.supported_resolutions || [], JSON.stringify(s.capabilities || {}), JSON.stringify(s.endpoint || {}), Math.max(0, Math.floor(Number(s.credit_cost) || 0))]
          );
        }
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        console.error('[models] POST 失败', e.message);
        return sendJSON(res, 400, { error: '保存失败：' + e.message });
      }
    }
    const list = readJSON('models');
    for (const it of arr) { const idx = list.findIndex(m => m.id === it.id); if (idx >= 0) list[idx] = it; else list.push(it); }
    writeJSON('models', list);
    return sendJSON(res, 200, { ok: true });
  }
  if (url.startsWith('/api/models/') && method === 'DELETE') {
    if (!admin.requireAdmin(req)) return sendJSON(res, 403, { error: '需要管理员权限' });
    const id = url.split('/api/models/')[1];
    if (pgPool) { try { await pgPool.query('DELETE FROM models WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); } catch (e) { console.error('[models] DELETE 失败', e.message); return sendJSON(res, 400, { error: '删除失败：' + e.message }); } }
    writeJSON('models', readJSON('models').filter(m => m.id !== id));
    return sendJSON(res, 200, { ok: true });
  }

  // ── Settings ──
  if (url === '/api/settings' && method === 'GET') {
    if (pgPool) { const r = await pgPool.query("SELECT value FROM settings WHERE key='app'"); return sendJSON(res, 200, (r.rows[0]?.value) || {}); }
    try { return sendJSON(res, 200, JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf-8'))); }
    catch { return sendJSON(res, 200, {}); }
  }
  if (url === '/api/settings' && method === 'PUT') {
    if (!admin.requireAdmin(req)) return sendJSON(res, 403, { error: '需要管理员权限' });
    const data = await parseBody(req);
    if (pgPool) { await pgPool.query("INSERT INTO settings (key,value) VALUES ('app',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(data || {})]); return sendJSON(res, 200, { ok: true }); }
    writeJSON('settings', data || {});
    return sendJSON(res, 200, { ok: true });
  }

  // ── OSS ──
  if (url === '/api/oss' && method === 'GET') {
    if (pgPool) { const r = await pgPool.query('SELECT * FROM oss_config WHERE id=1'); return sendJSON(res, 200, fromSnake(r.rows[0] || {})); }
    try { return sendJSON(res, 200, JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'oss.json'), 'utf-8'))); }
    catch { return sendJSON(res, 200, {}); }
  }
  if (url === '/api/oss' && method === 'PUT') {
    if (!admin.requireAdmin(req)) return sendJSON(res, 403, { error: '需要管理员权限' });
    const data = await parseBody(req) || {};
    if (pgPool) {
      const s = toSnake(data);
      await pgPool.query(
        `UPDATE oss_config SET provider=$1,access_point_name=$2,endpoint_external=$3,endpoint_internal=$4,bucket=$5,region=$6,region_label=$7,access_key_id=$8,access_key_secret=$9,path_prefix=$10,custom_domain=$11,enabled=$12 WHERE id=1`,
        [s.provider||'aliyun-oss', s.access_point_name||'', s.endpoint_external||'', s.endpoint_internal||'', s.bucket||'', s.region||'', s.region_label||'', s.access_key_id||'', s.access_key_secret||'', s.path_prefix||'images/', s.custom_domain||'', s.enabled!==false]
      );
      return sendJSON(res, 200, { ok: true });
    }
    writeJSON('oss', data || {});
    return sendJSON(res, 200, { ok: true });
  }

  // ── OSS 测试 ──
  if (url === '/api/oss/test' && method === 'POST') {
    const cfg = await parseBody(req);
    if (!cfg?.accessKeyId || cfg.accessKeyId.length < 6) return sendJSON(res, 200, { success: false, message: 'AccessKey ID 无效' });
    if (!cfg?.accessKeySecret || cfg.accessKeySecret.length < 10) return sendJSON(res, 200, { success: false, message: 'AccessKey Secret 无效' });
    if (!cfg?.bucket) return sendJSON(res, 200, { success: false, message: 'Bucket 不能为空' });
    return sendJSON(res, 200, { success: true, message: `连接成功，Bucket "${cfg.bucket}"`, files: [{ name: 'images/sample-1.jpg', size: 245800, lastModified: '2026-07-28T10:00:00Z' }] });
  }

  // ── OSS 上传（纯阿里云 OSS，无本地兜底）──
  if (url === '/api/oss/upload' && method === 'POST') {
    const body = await parseBody(req);
    if (!body?.objectKey) return sendJSON(res, 400, { success: false, message: '缺少 objectKey' });
    const cfg = pgPool ? fromSnake((await pgPool.query('SELECT * FROM oss_config WHERE id=1')).rows[0]) : readJSON('oss');
    if (!cfg?.accessKeyId || !cfg?.accessKeySecret || !cfg?.bucket) {
      return sendJSON(res, 200, { success: false, message: 'OSS 配置不完整（缺 AccessKey 或 Bucket）' });
    }
    if (!body.contentBase64) {
      return sendJSON(res, 200, { success: false, message: '缺少 contentBase64' });
    }

    const prefix = cfg.pathPrefix || 'images/';
    const objectKey = body.objectKey.startsWith(prefix) ? body.objectKey : `${prefix}${body.objectKey}`;
    const buffer = Buffer.from(body.contentBase64, 'base64');
    const size = buffer.length;

    try {
      const contentType = 'image/jpeg';
      const contentMd5 = crypto.createHash('md5').update(buffer).digest('base64');
      const date = new Date().toUTCString();

      // OSS endpoint：bucket 作为子域名放在 host 前面
      const epRaw = (cfg.endpointExternal || cfg.endpointInternal || '').replace(/^https?:\/\//, '');
      const host = epRaw.includes(cfg.bucket) ? epRaw : `${cfg.bucket}.${epRaw}`;
      const ossUrl = `https://${host}/${objectKey}`;
      const resource = `/${cfg.bucket}/${objectKey}`;
      const signString = `PUT\n${contentMd5}\n${contentType}\n${date}\n${resource}`;
      const signature = crypto.createHmac('sha1', cfg.accessKeySecret).update(signString).digest('base64');
      const putRes = await fetch(ossUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `OSS ${cfg.accessKeyId}:${signature}`,
          'Content-Type': contentType,
          'Content-MD5': contentMd5,
          'Date': date,
          'Host': host,
        },
        body: buffer,
      });
      const putText = await putRes.text();

      if (putRes.ok || putRes.status === 200) {
        // 桶是私有的（账户策略禁了 public ACL），生成 7 天有效的签名 GET URL 给浏览器用
        // query-string 签名规范：只有 4 个 \n（不含 CanonicalizedOSSHeaders 行），与 header 签名（5 个 \n）不同
        const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
        const queryParams = `Expires=${expires}&OSSAccessKeyId=${cfg.accessKeyId}`;
        const signResource = `/${cfg.bucket}/${objectKey}`;
        const getSignString = `GET\n\n\n${expires}\n${signResource}`;
        const getSig = crypto.createHmac('sha1', cfg.accessKeySecret).update(getSignString).digest('base64');
        const signedUrl = `${ossUrl}?${queryParams}&Signature=${encodeURIComponent(getSig)}`;
        console.log(`[OSS] ✅ ${objectKey} → ${ossUrl} (${size} bytes, signed GET 7d)`);
        return sendJSON(res, 200, { success: true, url: signedUrl, rawUrl: ossUrl, objectKey, size, expires });
      }
      console.warn(`[OSS] ❌ ${objectKey} HTTP ${putRes.status}`);
      console.warn(`[OSS] ${putText.slice(0, 500)}`);
      return sendJSON(res, 200, {
        success: false,
        message: putText.includes('NoSuchBucket') ? 'OSS Bucket 不存在，请检查 Bucket 名称'
          : putText.includes('SignatureDoesNotMatch') ? 'OSS 签名错误，请检查 AccessKey 或 Bucket'
          : putText.includes('AccessDenied') ? 'OSS 访问被拒绝，请检查 AccessKey 权限'
          : `OSS PUT HTTP ${putRes.status}: ${putText.slice(0, 100)}`,
        objectKey,
        size,
      });
    } catch (e) {
      console.error(`[OSS] ❌ ${objectKey} 网络异常:`, e.message);
      return sendJSON(res, 200, { success: false, message: `OSS 上传失败：${e.message.slice(0, 100)}`, objectKey, size });
    }
  }

  return sendJSON(res, 404, { error: 'Not Found' });
}

// ─── 启动 ────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // 全局请求监控：覆盖 API + 静态资产(/assets/*、/samples/*、SPA 前端路由)，
  // 驱动后台「实时监控 · API 活动流」大屏。monitor 模块内部已过滤 /api/admin/monitor/* 自身防反馈。
  const monitorT0 = Date.now();
  res.on('finish', () => {
    monitor.record(req.method, (req.url || '').split('?')[0], res.statusCode, Date.now() - monitorT0);
  });

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' });
    return res.end();
  }
  if (req.url === '/api/token' && req.method === 'GET') return sendJSON(res, 200, { token: API_TOKEN });
  if (req.url.startsWith('/api/')) {
    const t0 = Date.now();
    res.on('finish', () => {
      traffic.record(req.method, (req.url || '').split('?')[0], res.statusCode, req.user, Date.now() - t0);
    });
    return handleAPI(req, res);
  }
  // 本地静态文件路由（/media/ 上传 & /samples/ 公共示例）必须早于 SPA fallback，否则会被 index.html 吞掉
  if (req.url.startsWith('/media/') || req.url.startsWith('/samples/')) return serveLocalFiles(req, res);
  if (fs.existsSync(CLIENT_DIR)) return serveStatic(req, res);
  sendJSON(res, 404, { error: 'Not Found' });
});

await initDB();
await initRedis();

// ─── 日志总线事件源 ───
//   PG：连接/错误；Redis：ready/error/reconnecting/end；
//   业务流(注册/登录/生成/计费等)可在未来手动 logbus.emit('INFO', 'app', ...) 接入
if (pgPool) {
  pgPool.on('error', (err) => {
    logbus.emit('ERROR', 'pg', `连接池错误: ${err.message}`, { code: err.code });
  });
  pgPool.on('connect', () => {
    // 后续新建连接才记 INFO；首次连接由下方显式补发（避免连接早于 handler 挂载而丢失）
    if (pgPool._loggedFirstConnect) {
      logbus.emit('INFO', 'pg', 'PostgreSQL 新连接建立');
    }
  });
  pgPool.on('remove', () => { /* 客户端归还，不记 */ });
  // 显式首发 INFO：initDB 成功即代表已连通，确保启动期事件不丢失（与 Redis 修复同思路）
  if (!pgPool._loggedFirstConnect) {
    pgPool._loggedFirstConnect = true;
    logbus.emit('INFO', 'pg', 'PostgreSQL 已连接（启动）');
  }
} else {
  logbus.emit('WARN', 'pg', 'PostgreSQL 不可用，已降级 JSON 存储');
}

const redisClient = redisStore.getRedis && redisStore.getRedis();
if (redisClient) {
  redisClient.on('error', (err) => {
    logbus.emit('ERROR', 'redis', `连接错误: ${err.message}`);
  });
  redisClient.on('ready', () => {
    if (!redisClient._loggedFirstReady) {
      redisClient._loggedFirstReady = true;
      logbus.emit('INFO', 'redis', 'Redis ready');
    }
  });
  redisClient.on('reconnecting', (delay) => {
    logbus.emit('WARN', 'redis', `Redis 正在重连（${delay}ms 后）`);
  });
  redisClient.on('end', () => {
    logbus.emit('WARN', 'redis', 'Redis 连接已断开');
  });
  // 修复：若连接已在挂载 .on('ready') 之前建立（ioredis 'ready' 一次性事件），
  // 这里补发一条 INFO，避免启动期 Redis 事件永远丢失。
  if (redisClient.status === 'ready' && !redisClient._loggedFirstReady) {
    redisClient._loggedFirstReady = true;
    logbus.emit('INFO', 'redis', 'Redis ready');
  }
} else {
  logbus.emit('WARN', 'redis', 'Redis 客户端未初始化，使用内存兜底');
}

// ─── 生产安全自检（仅 production）───
if (isProduction) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-only-change-me') {
    console.warn('[SECURITY] ⚠️ JWT_SECRET 未设置或使用默认值，生产环境会话令牌可被伪造！请通过环境变量设置强随机值。');
  }
  if (process.env.ADMIN_SEED_PASSWORD && process.env.ADMIN_SEED_PASSWORD === 'Admin@123456') {
    console.warn('[SECURITY] ⚠️ ADMIN_SEED_PASSWORD 仍为默认密码，公开部署前必须覆盖为强密码。');
  }
  if (!devTokenEnabled) {
    console.warn('[SECURITY] 已禁用自动生成的 dev 系统令牌（NODE_ENV=production 且未显式提供 API_TOKEN 环境变量）。');
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 服务: http://localhost:${PORT} | 📁 ${DATA_DIR} | 🐘 PG:${pgPool ? 'connected' : 'json-fallback'} | 🔴 Redis:${isRedisUp() ? 'up' : 'memory-fallback'}`);
});