'use strict';
// 服务端生成分发器
const crypto = require('crypto');
const billing = require('./billing.cjs'); // Phase A 计费（reserve/commit/release）
// 负责：按 model_id 找到所有已启用的「模型行 × 服务商」组合，
// 在「全局最大并发 maxThreads」+「每家服务商 max_concurrent」约束下，
// round-robin 把 N 个生成请求均衡分配到不同服务商。
// 协议兼容 OpenAI-compatible 默认接口 + 自定义 endpoint（与前端 genericClient 对齐）。

// ─── 全局并发状态（跨请求共享，实现真正全局信号量）───
let GLOBAL_ACTIVE = 0;
let GLOBAL_MAX = 10;
let RR_POINTER = 0;

// ─── RPM 感知调度：每账号每分辨率令牌桶 + 最少使用优先 ───
// 单实例内存态（PM2 必须 instances:1，见 deploy/ecosystem.config.cjs）。
// 多实例横向扩展需把 ACCT 状态迁至 Redis（deployment-plan.md §6）。
const ACCT = {};
const DEFAULT_RPM = { '1k': 20, '2k': 10, '4k': 1, '8k': 1 };
const CONC_CAP = { '1k': 4, '2k': 3, '4k': 1, '8k': 1 };

// ─── 占位符替换 ─────────────────────────────────────
function fillTemplate(template, vars) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), vars);
    if (v == null) return 'null';
    return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  });
}

// ─── JSONPath 解析 ──────────────────────────────────
function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const tokens = [];
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(path))) {
    if (m[2] != null) tokens.push(Number(m[2]));
    else if (m[1] != null) tokens.push(m[1]);
  }
  let cur = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = typeof t === 'number' ? cur[t] : cur[t];
  }
  return cur;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── HTTP 调用 ──────────────────────────────────────
async function callEndpoint(baseUrl, endpoint, apiKey, vars) {
  const url = `${baseUrl.replace(/\/+$/, '')}${endpoint.path.startsWith('/') ? endpoint.path : '/' + endpoint.path}`;
  const method = endpoint.method || 'POST';
  const headers = { 'Content-Type': 'application/json', ...(endpoint.headers || {}) };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  let body;
  if (endpoint.bodyTemplate) body = fillTemplate(endpoint.bodyTemplate, { ...vars, apiKey });
  else if (method !== 'GET' && method !== 'DELETE') body = JSON.stringify(vars);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

// ─── 端点解析（模型覆盖 > 服务商默认 > OpenAI 兼容默认）───
function resolveEndpoint(provider, model, kind) {
  const me = model.endpoint || {};
  if (me[kind]) return { protocol: me.protocol, endpoint: me[kind] };
  const pe = provider.default_endpoint || {};
  if (pe[kind]) return { protocol: pe.protocol, endpoint: pe[kind] };
  return { protocol: provider.protocol || 'openai-compatible', endpoint: undefined };
}

// ─── 图片生成 ──────────────────────────────────────
const RATIO_TO_SIZE = { '16:9': '1792x1024', '4:3': '1024x768', '1:1': '1024x1024', '3:4': '768x1024', '9:16': '1024x1792' };
const RES_MULTIPLIER = { '1k': 1, '2k': 2, '4k': 4, '8k': 8 };

function bumpSize(size, res) {
  const mul = RES_MULTIPLIER[res] || 1;
  if (mul === 1) return size;
  const [w, h] = size.split('x').map(Number);
  return `${w * mul}x${h * mul}`;
}

async function imageGenerate(provider, model, opts) {
  const { prompt, ratio, resolution, count, referenceImages } = opts;
  const baseUrl = provider.base_url;
  const apiKey = provider.api_key;
  if (!apiKey) return { images: [], status: 'error', error: '服务商未配置 API Key' };

  const size = bumpSize(RATIO_TO_SIZE[ratio] || '1024x1024', resolution);
  const vars = {
    model: model.model_id,
    prompt,
    n: Math.max(1, Math.min(4, count || 1)),
    size,
    ratio,
    resolution,
    images: referenceImages || [],
  };

  const { protocol, endpoint } = resolveEndpoint(provider, model, 'generate');
  try {
    if (protocol === 'custom' && endpoint) {
      const { status, body } = await callEndpoint(baseUrl, endpoint, apiKey, vars);
      if (status >= 400) return makeError(body, status, '图片生成失败');
      const imgs = extractImages(body, endpoint);
      return imgs.length
        ? { images: imgs, status: 'success' }
        : { images: [], status: 'error', error: '响应中未找到图片字段' };
    }
    const apiUrl = `${baseUrl.replace(/\/$/, '')}/images/generations`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(vars),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) return makeError(data, response.status, '图片生成失败');
    const imgs = extractImages(data, undefined);
    return imgs.length
      ? { images: imgs, status: 'success' }
      : { images: [], status: 'error', error: '响应中无图片数据' };
  } catch (e) {
    return { images: [], status: 'error', error: `网络错误：${(e && e.message) || String(e)}`.slice(0, 120) };
  }
}

// ─── 视频生成（异步 submit + poll 模式）───
async function videoGenerate(provider, model, opts) {
  const { prompt, ratio, durationSec, referenceImages } = opts;
  const baseUrl = provider.base_url;
  const apiKey = provider.api_key;
  if (!apiKey) return { videoUrl: '', status: 'error', error: '服务商未配置 API Key' };

  const vars = {
    model: model.model_id,
    prompt,
    ratio,
    duration: durationSec || 6,
    firstFrame: referenceImages && referenceImages[0] ? referenceImages[0] : '',
    images: referenceImages || [],
  };

  const { protocol, endpoint } = resolveEndpoint(provider, model, 'generate');
  const isAsync = !!(provider.default_endpoint && provider.default_endpoint.async) ||
    !!(model.endpoint && model.endpoint.async) || protocol === 'custom';

  try {
    if (isAsync && endpoint) {
      const { status, body } = await callEndpoint(baseUrl, endpoint, apiKey, vars);
      if (status >= 400) return makeError(body, status, '视频任务提交失败');
      const taskId = String(getByPath(body, (endpoint.taskIdPath) || 'data.task_id') ?? '');
      if (!taskId) return { videoUrl: '', status: 'error', error: '未返回任务 ID（taskIdPath 配置？）' };
      const pollEp = resolveEndpoint(provider, model, 'poll').endpoint;
      if (!pollEp) return { videoUrl: '', status: 'error', error: '未配置 poll 端点（异步任务需轮询）' };
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(3000);
        const r = await callEndpoint(baseUrl, pollEp, apiKey, { task_id: taskId, ...vars });
        const st = String(getByPath(r.body, pollEp.taskStatusPath || 'data.status') ?? '').toLowerCase();
        const okVals = (pollEp.taskSuccessValues || ['succeeded', 'success', 'done', 'completed']).map((s) => s.toLowerCase());
        if (okVals.includes(st)) {
          const url = String(getByPath(r.body, pollEp.taskResultPath || 'data.video_url') ?? '');
          return url ? { videoUrl: url, status: 'success' } : { videoUrl: '', status: 'error', error: '任务成功但未返回视频 URL（taskResultPath？）' };
        }
        if (st === 'failed' || st === 'error' || st === 'canceled') return makeError(r.body, 200, '视频生成失败');
      }
      return { videoUrl: '', status: 'error', error: '视频生成超时（5分钟）' };
    }
    const { status, body } = await callEndpoint(baseUrl, endpoint, apiKey, vars);
    if (status >= 400) return makeError(body, status, '视频生成失败');
    const url = String(getByPath(body, (endpoint && endpoint.videoFieldPath) || 'data.video_url') ?? '');
    return url ? { videoUrl: url, status: 'success' } : { videoUrl: '', status: 'error', error: '响应中未找到视频 URL' };
  } catch (e) {
    return { videoUrl: '', status: 'error', error: `网络错误：${(e && e.message) || String(e)}`.slice(0, 120) };
  }
}

// ─── helpers ───────────────────────────────────────
function extractImages(body, endpoint) {
  if (!body) return [];
  if (endpoint && endpoint.imageFieldPath) {
    const v = getByPath(body, endpoint.imageFieldPath);
    return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  }
  if (Array.isArray(body && body.data)) {
    return body.data.map((d) => (d && (d.url || d.b64_json)) || '').filter(Boolean);
  }
  return [];
}

function makeError(body, status, fallback) {
  const errMsg =
    (body && body.error && body.error.message) ||
    (body && body.message) ||
    (typeof body === 'string' ? body.slice(0, 200) : '') ||
    `HTTP ${status}`;
  return { status: 'error', error: `${fallback}：${errMsg}`, images: [], videoUrl: '', rateLimited: status === 429 };
}

// ─── RPM 感知调度：令牌获取 / 释放 ───────────────────
// 每个 (账号 × 分辨率) 一桶：令牌桶按时间回流（cap 个/60s），
// 累计用量 used[tier] 用于「最少使用优先」精确均匀分配。
// 厂商限额：1K=20 RPM、2K=10 RPM、4K=1 RPM（可由 providers.rate_limits 覆盖）
function rateFor(provider, tier) {
  const rl = provider && provider.rate_limits;
  const v = rl && typeof rl === 'object' ? rl[tier] : undefined;
  if (typeof v === 'number' && v > 0) return v;
  return DEFAULT_RPM[tier] || 10;
}

function getAcct(pid, provider, tier) {
  if (!ACCT[pid]) {
    ACCT[pid] = {
      tier: {},
      conc: { '1k': 0, '2k': 0, '4k': 0 },
      used: { '1k': 0, '2k': 0, '4k': 0 },
      cooldown: { '1k': 0, '2k': 0, '4k': 0 },
    };
  }
  const a = ACCT[pid];
  if (!a.tier[tier]) {
    const cap = rateFor(provider, tier);
    a.tier[tier] = { cap, tokens: cap, last: Date.now() };
  }
  return a;
}

// 令牌桶按时间回流：cap 个令牌 / 60 秒
function refill(b, now) {
  const dt = (now - b.last) / 1000;
  if (dt > 0) b.tokens = Math.min(b.cap, b.tokens + dt * (b.cap / 60));
  b.last = now;
}

function acquireOne(pairs, tier) {
  tier = tier || '1k';
  while (true) {
    if (GLOBAL_ACTIVE < GLOBAL_MAX) {
      const now = Date.now();
      const order = pairs.slice(RR_POINTER).concat(pairs.slice(0, RR_POINTER));
      const cand = [];
      for (const p of order) {
        const pid = p.provider.id;
        const a = getAcct(pid, p.provider, tier);
        a.tier[tier].cap = rateFor(p.provider, tier); // 运行时同步 cap（DB 改 rate_limits 立即生效）
        if (now < a.cooldown[tier]) continue;          // 该账号该分辨率熔断中，跳过
        refill(a.tier[tier], now);
        if (a.tier[tier].tokens < 1) continue;         // 本账号本分辨率 RPM 已耗尽
        const concCap = Math.min(Number(p.provider.max_concurrent) || 2, CONC_CAP[tier]);
        if (a.conc[tier] >= concCap) continue;          // 单账号并发已满
        cand.push({ p, a });
      }
      if (cand.length === 0) {
        // 全部账号本分辨率都已满 → 让出事件循环稍后重试（不报错，避免 429）
        return sleep(120).then(() => acquireOne(pairs, tier));
      }
      // ★ 精确均匀分配：挑「本分辨率累计用量最少」的账号
      cand.sort((x, y) => x.a.used[tier] - y.a.used[tier]);
      const { p, a } = cand[0];
      a.tier[tier].tokens -= 1;
      a.conc[tier] += 1;
      a.used[tier] += 1;
      GLOBAL_ACTIVE += 1;
      RR_POINTER = (RR_POINTER + 1) % pairs.length;
      return p;
    }
    return sleep(120).then(() => acquireOne(pairs, tier));
  }
}

function releaseOne(p, tier) {
  tier = tier || '1k';
  GLOBAL_ACTIVE = Math.max(0, GLOBAL_ACTIVE - 1);
  const a = ACCT[p.provider.id];
  if (a) a.conc[tier] = Math.max(0, a.conc[tier] - 1);
}

// ─── 主入口 ────────────────────────────────────────
async function generate(pgPool, opts) {
  const { model, prompt, ratio, resolution, count, contentType, referenceImages } = opts;
  // 分辨率 → RPM 桶：1k/2k/4k 各有独立限额；未知分辨率一律按 1k 处理
  const tier = ['1k', '2k', '4k', '8k'].includes(resolution) ? resolution : '1k';

  // 1. 全局最大并发
  try {
    const r = await pgPool.query("SELECT value FROM settings WHERE key='app'");
    const v = r.rows[0] && r.rows[0].value;
    if (v && v.maxThreads) GLOBAL_MAX = Number(v.maxThreads) || 10;
  } catch {}

  // 2. 按 display_name / model_id 找模型行
  let mrows = await pgPool.query('SELECT * FROM models WHERE display_name=$1 AND enabled=true', [model]);
  let modelIds = [...new Set((mrows.rows || []).map((r) => r.model_id))];
  if (modelIds.length === 0) {
    const m2 = await pgPool.query('SELECT * FROM models WHERE model_id=$1 AND enabled=true', [model]);
    modelIds = [...new Set((m2.rows || []).map((r) => r.model_id))];
  }
  if (modelIds.length === 0) {
    return { status: 'failed', error: `未找到模型：${model}`, images: [] };
  }

  // 3. 该 model_id 下所有已启用模型行
  const allModels = await pgPool.query('SELECT * FROM models WHERE model_id=ANY($1) AND enabled=true', [modelIds]);
  const providerIds = [...new Set((allModels.rows || []).map((r) => r.provider_id))];
  const prows = await pgPool.query('SELECT * FROM providers WHERE id=ANY($1)', [providerIds]);

  // 4. 组装可用 (modelRow × providerRow) 对
  const pairs = [];
  for (const mr of allModels.rows || []) {
    const pr = (prows.rows || []).find((p) => p.id === mr.provider_id);
    if (!pr || !pr.enabled) continue;
    if (!pr.api_key || pr.api_key.length < 6) continue;
    pairs.push({ model: mr, provider: pr });
  }
  if (pairs.length === 0) {
    return { status: 'failed', error: '该模型没有可用的已启用服务商（请检查服务商密钥与启用状态）', images: [] };
  }

  // 5. 并发分配
  const total = Math.max(1, Math.min(4, Number(count) || 1));
  const tasks = [];
  for (let i = 0; i < total; i++) {
    tasks.push((async () => {
      const p = await acquireOne(pairs, tier);
      try {
        const input = {
          provider: p.provider,
          model: p.model,
          prompt,
          ratio,
          resolution,
          count: 1,
          referenceImages,
        };
        const res = contentType === 'video' ? await videoGenerate(p.provider, p.model, input) : await imageGenerate(p.provider, p.model, input);
        if (res && res.rateLimited) {
          // 该账号该分辨率命中厂商 RPM/429 限流 → 临时熔断 60s，避免反复打爆
          const a = getAcct(p.provider.id, p.provider, tier);
          a.cooldown[tier] = Date.now() + 60000;
        }
        if (contentType === 'video') {
          return res.videoUrl ? { images: [res.videoUrl], status: res.status, error: res.error, providerId: p.provider.id } : { images: [], status: res.status, error: res.error, providerId: p.provider.id };
        }
        return { ...res, providerId: p.provider.id };
      } catch (e) {
        return { images: [], status: 'error', error: (e && e.message) || String(e), providerId: p.provider.id };
      } finally {
        releaseOne(p, tier);
      }
    })());
  }

  const results = await Promise.all(tasks);
  const images = [];
  const errors = [];
  const usedProviders = [];
  for (const r of results) {
    if (r.providerId) usedProviders.push(r.providerId);
    if (r.images && r.images.length) {
      images.push(r.images[0]);
    } else if (r.error) {
      errors.push(r.error);
    }
  }
  const usedProvidersUniq = [...new Set(usedProviders)];
  if (images.length > 0) {
    return { status: 'success', images, source: 'provider', errors: errors.length ? errors : undefined, usedProviders: usedProvidersUniq };
  }
  return { status: 'failed', error: errors[0] || '所有服务商生成失败', images: [], usedProviders: usedProvidersUniq };
}

function getArrayByPath(obj, path) {
  const v = getByPath(obj, path);
  return Array.isArray(v) ? v : [];
}

// ─── 异步生成：返回 taskId 立即让前端可轮询，状态写入 PG ───
async function generateAsync(pgPool, opts) {
  if (!pgPool) return { taskId: null, error: '数据库不可用' };
  const { model, prompt, count, contentType, referenceImages, pendingIds = [], clientMeta = {}, user_id, idempotencyKey, cost = 0 } = opts;
  // 生成一个稳定 taskId：便于前端 localStorage 持久化关联
  const taskId = `gt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await pgPool.query(
      `INSERT INTO generation_tasks
         (task_id, status, model, prompt, count, content_type, pending_ids, client_meta, user_id, idempotency_key, cost)
       VALUES ($1, 'running', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [taskId, model || '', prompt || '', count || 1, contentType || 'image', pendingIds, clientMeta, user_id || null, idempotencyKey || null, cost || 0],
    );
  } catch (e) {
    return { taskId: null, error: `写入任务表失败：${e.message}` };
  }
  // 后台跑：完成后更新 PG（不再 await）
  generate(pgPool, opts)
    .then(async (result) => {
      const ok = result && result.status === 'success' && Array.isArray(result.images) && result.images.length;
      try {
        if (ok) {
          // G3 结算点：成功 commit（reserve 已在 /api/generate handler 扣除）。
          // 注意：media 由前端负责写入（含 OSS 上传 + 探活 + 永久化），后端不重复写，
          // 避免双写重复行 + 原始服务商 URL 易过期（与 OSS 永久化目标冲突）。
          await billing.commitCredits(pgPool, user_id, cost, idempotencyKey);
        } else {
          // 生成失败：释放 held 积分（G3 释放点）
          await billing.releaseCredits(pgPool, user_id, cost, idempotencyKey);
        }
        await pgPool.query(
          `UPDATE generation_tasks SET status=$2, result=$3, error=$4, completed_at=NOW(), user_id=$5
           WHERE task_id=$1`,
          [taskId, ok ? 'done' : 'failed', JSON.stringify(result || {}), (result && result.error) || '', user_id],
        );
      } catch (e) {
        console.warn('[dispatcher] 完成回调失败:', e.message);
      }
    })
    .catch(async (e) => {
      // 异常：释放 held 积分
      await billing.releaseCredits(pgPool, user_id, cost, idempotencyKey).catch(() => {});
      await pgPool.query(
        `UPDATE generation_tasks SET status='failed', error=$2, completed_at=NOW(), user_id=$3
         WHERE task_id=$1`,
        [taskId, String((e && e.message) || e), user_id],
      ).catch(() => {});
    });
  return { taskId };
}

// 查询单个任务状态
async function getTaskStatus(pgPool, taskId) {
  if (!pgPool) return { status: 'unknown', error: '数据库不可用' };
  try {
    const r = await pgPool.query(
      `SELECT task_id, status, result, error, pending_ids, client_meta, model, prompt, count, content_type, created_at, completed_at
         FROM generation_tasks WHERE task_id=$1`,
      [taskId],
    );
    if (r.rows.length === 0) return { status: 'not_found', error: '任务不存在或已清理' };
    const row = r.rows[0];
    return {
      taskId: row.task_id,
      status: row.status,
      result: row.result || null,
      error: row.error || '',
      pendingIds: row.pending_ids || [],
      clientMeta: row.client_meta || {},
      model: row.model,
      prompt: row.prompt,
      count: row.count,
      contentType: row.content_type,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  } catch (e) {
    return { status: 'unknown', error: e.message };
  }
}

// 列出在途任务（status='running'，以及最近 1 小时内 done/failed 便于客户端发现刚完成但未及时拉到的事件）
// 严格按 user_id 归属过滤（防多用户串看，G1）；旧 user_id IS NULL 的历史行不再对全员可见
async function listActiveTasks(pgPool, userId) {
  if (!pgPool) return { tasks: [] };
  try {
    const params = [];
    let where = `WHERE (status='running' OR (completed_at > NOW() - INTERVAL '1 hour'))`;
    if (userId) {
      params.push(userId);
      where += ` AND user_id=$${params.length}`;
    }
    const r = await pgPool.query(
      `SELECT task_id, status, result, error, pending_ids, client_meta, model, prompt, count, content_type, created_at, completed_at
         FROM generation_tasks ${where}
         ORDER BY created_at DESC
         LIMIT 100`,
      params,
    );
    return {
      tasks: r.rows.map((row) => ({
        taskId: row.task_id,
        status: row.status,
        result: row.result || null,
        error: row.error || '',
        pendingIds: row.pending_ids || [],
        clientMeta: row.client_meta || {},
        model: row.model,
        prompt: row.prompt,
        count: row.count,
        contentType: row.content_type,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      })),
    };
  } catch (e) {
    return { tasks: [], error: e.message };
  }
}

// 导出内部调度函数（供测试 / 调试断言 RPM 门控与均匀分配用）
module.exports = {
  generate, generateAsync, getTaskStatus, listActiveTasks, callEndpoint, getByPath, getArrayByPath,
  acquireOne, releaseOne, getAcct, rateFor,
};
