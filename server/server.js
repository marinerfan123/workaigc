// 纯 Node.js 后端 API — PostgreSQL 17 + Redis 7.2
// 用法: node server.js
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
let API_TOKEN = '';
try { API_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim(); } catch {}
if (!API_TOKEN) {
  API_TOKEN = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, API_TOKEN);
  console.log(`\n🔑 API Token: ${API_TOKEN}\n`);
}

// ─── 数据库：PostgreSQL ─────────────────────────
import pgLib from 'pg';
const { Pool } = pgLib;
let pgPool = null;
import dispatcher from './dispatcher.cjs';

async function initDB() {
  try {
    pgPool = new Pool({
      host: 'localhost', port: 5432, database: 'huabu',
      user: 'postgres', password: '0.0.1abcd', max: 10,
    });
    await pgPool.query('SELECT 1');
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'official', base_url TEXT DEFAULT '', api_key TEXT DEFAULT '', supported_types TEXT[] DEFAULT '{}', enabled BOOLEAN DEFAULT TRUE, protocol TEXT DEFAULT 'openai-compatible', remark TEXT DEFAULT '', default_endpoint JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, model_id TEXT NOT NULL, display_name TEXT NOT NULL, mapping_name TEXT DEFAULT '', type TEXT DEFAULT 'image', provider_id TEXT REFERENCES providers(id) ON DELETE CASCADE, enabled BOOLEAN DEFAULT TRUE, supported_resolutions TEXT[] DEFAULT '{}', capabilities JSONB DEFAULT '{}', endpoint JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, title TEXT DEFAULT '', type TEXT DEFAULT 'image', thumbnail TEXT DEFAULT '', full_url TEXT DEFAULT '', prompt TEXT DEFAULT '', model TEXT DEFAULT '', ratio TEXT DEFAULT '1:1', source TEXT DEFAULT 'user', is_favorite BOOLEAN DEFAULT FALSE, is_deleted BOOLEAN DEFAULT FALSE, oss_url TEXT DEFAULT '', oss_object_key TEXT DEFAULT '', oss_uploaded BOOLEAN DEFAULT FALSE, category TEXT DEFAULT 'generated', status TEXT DEFAULT 'success', error_message TEXT DEFAULT '', failed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());
      -- 兼容旧库：缺失列自动补齐
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media' AND column_name='status') THEN ALTER TABLE media ADD COLUMN status TEXT DEFAULT 'success'; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media' AND column_name='error_message') THEN ALTER TABLE media ADD COLUMN error_message TEXT DEFAULT ''; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media' AND column_name='failed_at') THEN ALTER TABLE media ADD COLUMN failed_at TIMESTAMPTZ; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='models' AND column_name='mapping_name') THEN ALTER TABLE models ADD COLUMN mapping_name TEXT DEFAULT ''; END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS oss_config (id INTEGER PRIMARY KEY DEFAULT 1, provider TEXT DEFAULT 'aliyun-oss', access_point_name TEXT DEFAULT '', endpoint_external TEXT DEFAULT '', endpoint_internal TEXT DEFAULT '', bucket TEXT DEFAULT '', region TEXT DEFAULT '', region_label TEXT DEFAULT '', access_key_id TEXT DEFAULT '', access_key_secret TEXT DEFAULT '', path_prefix TEXT DEFAULT 'images/', custom_domain TEXT DEFAULT '', enabled BOOLEAN DEFAULT TRUE);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
      ALTER TABLE providers ADD COLUMN IF NOT EXISTS max_concurrent INT DEFAULT 2;
      INSERT INTO oss_config (id, enabled) VALUES (1, TRUE) ON CONFLICT (id) DO NOTHING;
      INSERT INTO settings (key, value) VALUES ('app', '{}') ON CONFLICT (key) DO NOTHING;
    `);
    console.log('[DB] PostgreSQL 连接成功');
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
  display_name:'displayName', model_id:'modelId', provider_id:'providerId', max_concurrent:'maxConcurrent', mapping_name:'mappingName',
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

function sendJSON(res, code, data) {
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
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(fs.readFileSync(filePath));
  } catch { res.end(); }
}

// ─── Auth ────────────────────────────────────────
function auth(req) {
  return req.headers['authorization'] === `Bearer ${API_TOKEN}`;
}

// ══════════════════════════════════════════════════
// API 路由（PG 优先，JSON 降级）
// ══════════════════════════════════════════════════
async function handleAPI(req, res) {
  if (!auth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });

  const url = req.url.replace(/\/$/, '');
  const method = req.method;

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
    // 平台专有路径或本地 dev 占位（/spark/app/...、/runtime/...）
    if (url.startsWith('/') && !url.startsWith('//')) {
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
      .filter((m) => m.status !== 'failed' && m.thumbnail)
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
      const r = await pgPool.query('SELECT * FROM media WHERE is_deleted=FALSE ORDER BY created_at DESC');
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
      const r = await pgPool.query(`
        SELECT
          COUNT(*) FILTER (WHERE NOT is_deleted)                                         AS total,
          COUNT(*) FILTER (WHERE type='image' AND NOT is_deleted)                       AS image,
          COUNT(*) FILTER (WHERE type='video' AND NOT is_deleted)                       AS video,
          COUNT(*) FILTER (WHERE category='character' AND NOT is_deleted)               AS character,
          COUNT(*) FILTER (WHERE category='scene' AND NOT is_deleted)                   AS scene,
          COUNT(*) FILTER (WHERE category='prop' AND NOT is_deleted)                     AS prop,
          COUNT(*) FILTER (WHERE category='other' AND NOT is_deleted)                    AS other,
          COUNT(*) FILTER (WHERE category='upload' AND NOT is_deleted)                   AS upload
        FROM media
      `);
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
        await pgPool.query(
          `INSERT INTO media (id,title,type,thumbnail,full_url,prompt,model,ratio,source,is_favorite,is_deleted,oss_url,oss_object_key,oss_uploaded,category,status,error_message,failed_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,full_url=EXCLUDED.full_url,thumbnail=EXCLUDED.thumbnail,oss_url=EXCLUDED.oss_url,oss_object_key=EXCLUDED.oss_object_key,oss_uploaded=EXCLUDED.oss_uploaded,is_deleted=EXCLUDED.is_deleted,status=EXCLUDED.status,error_message=EXCLUDED.error_message,failed_at=EXCLUDED.failed_at`,
          [s.id, s.title, s.type, s.thumbnail, s.full_url, s.prompt, s.model, s.ratio, s.source, s.is_favorite || false, s.is_deleted || false, s.oss_url, s.oss_object_key, s.oss_uploaded || false, s.category || 'generated', s.status || 'success', s.error_message || '', s.failed_at || null, s.created_at || new Date().toISOString()]
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
    if (pgPool) { await pgPool.query('DELETE FROM media WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }
    writeJSON('media', readJSON('media').filter(m => m.id !== id));
    return sendJSON(res, 200, { ok: true });
  }
  // 单条部分更新：用于探测失败后回写 status/errorMessage/failed_at
  if (url.startsWith('/api/media/') && method === 'PUT') {
    const id = url.split('/api/media/')[1];
    const body = await parseBody(req);
    if (!body || !id) return sendJSON(res, 400, { error: 'Invalid request' });
    const s = toSnake(body);
    if (pgPool) {
      // 动态拼 UPDATE：只更新传入的字段
      const fields = [];
      const vals = [];
      let i = 1;
      for (const [k, v] of Object.entries(s)) {
        if (v === undefined) continue;
        fields.push(`${k}=$${i}`);
        vals.push(v);
        i++;
      }
      if (fields.length === 0) return sendJSON(res, 200, { ok: true, noop: true });
      vals.push(id);
      await pgPool.query(`UPDATE media SET ${fields.join(',')} WHERE id=$${i}`, vals);
      return sendJSON(res, 200, { ok: true });
    }
    const list = readJSON('media');
    const idx = list.findIndex(m => m.id === id);
    if (idx >= 0) { list[idx] = { ...list[idx], ...body }; writeJSON('media', list); }
    return sendJSON(res, 200, { ok: true });
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
    const items = await parseBody(req); if (!items) return sendJSON(res, 400, { error: 'Invalid JSON' });
    const arr = Array.isArray(items) ? items : [items];
    if (pgPool) {
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
    }
    const list = readJSON('providers');
    for (const it of arr) { const idx = list.findIndex(p => p.id === it.id); if (idx >= 0) list[idx] = it; else list.push(it); }
    writeJSON('providers', list);
    return sendJSON(res, 200, { ok: true });
  }
  if (url.startsWith('/api/providers/') && method === 'DELETE') {
    const id = url.split('/api/providers/')[1];
    if (pgPool) { await pgPool.query('DELETE FROM models WHERE provider_id=$1', [id]); await pgPool.query('DELETE FROM providers WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }
    writeJSON('providers', readJSON('providers').filter(p => p.id !== id));
    return sendJSON(res, 200, { ok: true });
  }

  // ── 服务端生成分发（同模型多供应商动态均衡）──
  if (url === '/api/generate' && method === 'POST') {
    if (!pgPool) return sendJSON(res, 200, { status: 'failed', error: '数据库不可用，无法分发生成任务' });
    const body = await parseBody(req);
    if (!body || !body.model || !body.prompt) return sendJSON(res, 400, { error: '缺少 model 或 prompt' });
    try {
      const result = await dispatcher.generate(pgPool, {
        model: body.model,
        prompt: body.prompt,
        ratio: body.ratio || '1:1',
        resolution: body.resolution || '1k',
        count: body.count || 1,
        contentType: body.contentType || 'image',
        referenceImages: body.referenceImages || [],
      });
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, 200, { status: 'failed', error: `分发异常：${(e && e.message) || String(e)}` });
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
    const items = await parseBody(req); if (!items) return sendJSON(res, 400, { error: 'Invalid JSON' });
    const arr = Array.isArray(items) ? items : [items];
    if (pgPool) {
      for (const it of arr) {
        const s = toSnake(it);
        await pgPool.query(
          `INSERT INTO models (id,model_id,display_name,mapping_name,type,provider_id,enabled,supported_resolutions,capabilities,endpoint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name,mapping_name=EXCLUDED.mapping_name,enabled=EXCLUDED.enabled`,
          [s.id, s.model_id, s.display_name, s.mapping_name || '', s.type, s.provider_id, s.enabled !== false, s.supported_resolutions || [], JSON.stringify(s.capabilities || {}), JSON.stringify(s.endpoint || {})]
        );
      }
      return sendJSON(res, 200, { ok: true });
    }
    const list = readJSON('models');
    for (const it of arr) { const idx = list.findIndex(m => m.id === it.id); if (idx >= 0) list[idx] = it; else list.push(it); }
    writeJSON('models', list);
    return sendJSON(res, 200, { ok: true });
  }
  if (url.startsWith('/api/models/') && method === 'DELETE') {
    const id = url.split('/api/models/')[1];
    if (pgPool) { await pgPool.query('DELETE FROM models WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }
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

  // ── 本地文件读取 ──
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

  return sendJSON(res, 404, { error: 'Not Found' });
}

// ─── 启动 ────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' });
    return res.end();
  }
  if (req.url === '/api/token' && req.method === 'GET') return sendJSON(res, 200, { token: API_TOKEN });
  if (req.url.startsWith('/api/')) return handleAPI(req, res);
  if (fs.existsSync(CLIENT_DIR)) return serveStatic(req, res);
  sendJSON(res, 404, { error: 'Not Found' });
});

await initDB();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 服务: http://localhost:${PORT} | 📁 ${DATA_DIR} | 🐘 PG:${pgPool ? 'connected' : 'json-fallback'}`);
});