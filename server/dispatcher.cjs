'use strict';
// 服务端生成分发器
const crypto = require('crypto');
const billing = require('./billing.cjs'); // Phase A 计费（reserve/commit/release）
const accounting = require('./accounting.cjs'); // 全局双边账务：generate 真实消耗走账
// 负责：按 model_id 找到所有已启用的「模型行 × 服务商」组合，
// 在「全局最大并发 maxThreads」+「每家服务商 max_concurrent」约束下，
// round-robin 把 N 个生成请求均衡分配到不同服务商。
// 协议兼容 OpenAI-compatible 默认接口 + 自定义 endpoint（与前端 genericClient 对齐）。

// ─── 全局并发状态（跨请求共享，实现真正全局信号量）───
let GLOBAL_ACTIVE = 0;
let GLOBAL_MAX = 10;
let RR_POINTER = 0;

// ─── 统一共享 B 桶调度（方向 A 受限账号）/ unlimited（方向 B 普通付费）───
// 单实例内存态（PM2 必须 instances:1，见 deploy/ecosystem.config.cjs）。
// 多实例横向扩展需把 ACCT 状态迁至 Redis（deployment-plan.md §6）。
const ACCT = {};
const DEFAULT_BUCKET = 20;                              // 默认 B：每账号每 60s 可用 B 个「单位」
const DEFAULT_OP_COST = { '1k': 1, '2k': 2, '4k': 20, 'video': 20 }; // 各操作消耗单位（cap=floor(B/cost)）
const DEFAULT_RPM = { '1k': 20, '2k': 10, '4k': 1, '8k': 1 };        // 仅旧格式 {RPM上限} 归一用
const DEFAULT_COOLDOWN_MS = 60000;                     // 整账号冷却默认 60s（可调）
const ACCOUNT_CONC_CAP = 4;                            // 单账号并发硬上限（与 provider.max_concurrent 取小）
const MAX_RETRY = 3;                                   // 单任务「全部账号不可用」时的最多重试（无感切换）

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
  // 允许端点单独覆盖 baseUrl（如 Agnes 视频轮询在根域 /agnesapi，而提交在 /v1 下）
  const effBase = (endpoint && endpoint.baseUrl) || baseUrl;
  let url = `${effBase.replace(/\/+$/, '')}${endpoint.path.startsWith('/') ? endpoint.path : '/' + endpoint.path}`;
  const method = endpoint.method || 'POST';
  const headers = { 'Content-Type': 'application/json', ...(endpoint.headers || {}) };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  // GET/DELETE：把 vars 作为查询参数拼到 URL（轮询类端点常用，如 video_id=xxx）
  if ((method === 'GET' || method === 'DELETE') && vars && typeof vars === 'object') {
    const qs = Object.entries(vars)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
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

// Agnes Video 按画幅方向给分辨率（Agnes 会再自动标准化，方向正确即可）
function agnesVideoSize(ratio) {
  switch (ratio) {
    case '16:9': return { width: 1152, height: 648 };
    case '9:16': return { width: 648, height: 1152 };
    case '4:3': return { width: 1024, height: 768 };
    case '3:4': return { width: 768, height: 1024 };
    case '1:1': return { width: 1024, height: 1024 };
    default: return { width: 1024, height: 1024 };
  }
}

async function imageGenerate(provider, model, opts) {
  const { prompt, ratio, resolution, count, referenceImages, negative } = opts;
  const baseUrl = provider.base_url;
  const apiKey = provider.api_key;
  if (!apiKey) return { images: [], status: 'error', error: '服务商未配置 API Key' };

  const isAgnes = /agnes-ai\.cn/i.test(baseUrl || '');
  const de = provider.default_endpoint || {};
  const me = (model && model.endpoint) || {};
  const sizeFormat = me.sizeFormat || de.sizeFormat || (isAgnes ? 'agnes' : 'openai');
  const img2imgInExtraBody = (me.img2imgInExtraBody != null ? me.img2imgInExtraBody
    : (de.img2imgInExtraBody != null ? de.img2imgInExtraBody : isAgnes));

  const hasImages = Array.isArray(referenceImages) && referenceImages.length > 0;
  const size = sizeFormat === 'agnes'
    ? String(resolution || '1k').toUpperCase()
    : bumpSize(RATIO_TO_SIZE[ratio] || '1024x1024', resolution);

  const vars = {
    model: model.model_id,
    prompt,
    n: Math.max(1, Math.min(4, count || 1)),
    size,
    ratio,
  };
  if (sizeFormat !== 'agnes') {
    vars.resolution = resolution;
  }
  // 反向提示词（正负向搭配刚需）：SD/自定义端点支持 negative_prompt 字段；
  // agnes 图像端点规范不含此字段，跳过以免其严格校验报错（negative 仍存库，UI 完整展示）。
  if (sizeFormat !== 'agnes' && negative) {
    vars.negative_prompt = negative;
  }
  // 图生图/多图合成：Agnes 等要求把参考图放到 extra_body.image；
  // 同时保留顶层 images 兼容 relay / 自定义端点。
  if (hasImages) {
    vars.images = referenceImages;
    if (img2imgInExtraBody) {
      vars.extra_body = { image: referenceImages, response_format: 'url' };
    }
  }

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
  const { prompt, ratio, durationSec, referenceImages, negative } = opts;
  const baseUrl = provider.base_url;
  const apiKey = provider.api_key;
  if (!apiKey) return { videoUrl: '', status: 'error', error: '服务商未配置 API Key' };

  // Agnes Video V2.0 字段与通用视频端点不同：用 num_frames/frame_rate 控制时长（非 duration），
  // height/width 控制分辨率，image+mode=ti2vid 做图生视频，extra_body.image+mode=keyframes 做关键帧动画。
  const isAgnesVideo = /agnes-ai\.cn/i.test(baseUrl || '') && /video/i.test(model.model_id || '');
  let vars;
  if (isAgnesVideo) {
    const hasImages = Array.isArray(referenceImages) && referenceImages.length > 0;
    const frameRate = 25;
    // num_frames 必须 ≤441 且 = 8n+1
    let numFrames = Math.round((Number(durationSec) || 6) * frameRate);
    numFrames = Math.min(441, Math.max(9, numFrames));
    numFrames = Math.floor((numFrames - 1) / 8) * 8 + 1;
    const { width, height } = agnesVideoSize(ratio);
    vars = {
      model: model.model_id,
      prompt,
      height,
      width,
      num_frames: numFrames,
      frame_rate: frameRate,
    };
    if (negative) vars.negative_prompt = negative;
    if (hasImages) {
      if (referenceImages.length >= 2) {
        // 关键帧动画：多图进 extra_body.image
        vars.mode = 'keyframes';
        vars.extra_body = { image: referenceImages, mode: 'keyframes' };
      } else {
        // 图生视频
        vars.image = referenceImages[0];
        vars.mode = 'ti2vid';
      }
    }
  } else {
    vars = {
      model: model.model_id,
      prompt,
      ratio,
      duration: durationSec || 6,
      firstFrame: referenceImages && referenceImages[0] ? referenceImages[0] : '',
      images: referenceImages || [],
    };
    // 反向提示词：custom 端点经 fillTemplate 的 {{negative}}/{{negative_prompt}} 占位替换生效；
    // 标准视频端点忽略未知字段。最终仍写入 generation_tasks.payload 与 media，UI 完整展示。
    if (negative) { vars.negative = negative; vars.negative_prompt = negative; }
  }

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
      // 轮询查询参数名可配置（Agnes 用 video_id，通用用 task_id）
      const pollQueryParam = (pollEp && pollEp.taskQueryParam) || 'task_id';
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep((pollEp && pollEp.taskPollIntervalMs) || 3000);
        const r = await callEndpoint(baseUrl, pollEp, apiKey, { [pollQueryParam]: taskId });
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

// ─── 统一共享 B 桶调度 ─────────────────────────────
// 旧格式 rate_limits = {"1k":20,"2k":10,"4k":1}（值为每分钟上限 RPM）。
// 新格式 rate_limits = { bucket_units_per_min:B, ops:{1k,2k,4k,video}, manual_state? }
//   · ops 的值是「每次操作消耗的单位数」，cap[op] = floor(B / cost[op])
//   · 所有操作（1k/2k/4k/video）从同一桶扣 → 单账号额度共享
//   · manual_state('hot'|'cold')：管理员手动强切（持久化到 rate_limits JSONB，随库恢复）
function normalizeRateLimits(rl) {
  if (rl && typeof rl === 'object' && rl.ops && typeof rl.bucket_units_per_min === 'number') {
    const out = { bucket_units_per_min: rl.bucket_units_per_min, ops: { ...DEFAULT_OP_COST, ...rl.ops } };
    if (rl.manual_state) out.manual_state = rl.manual_state;
    return out;
  }
  // 旧格式：值是各分辨率 RPM 上限 → 归一为成本（cost = B / cap）
  const old = (rl && typeof rl === 'object') ? rl : {};
  const B = (typeof old['1k'] === 'number' && old['1k'] > 0) ? old['1k'] : DEFAULT_BUCKET;
  const ops = {};
  for (const t of ['1k', '2k', '4k', 'video']) {
    const cap = (typeof old[t] === 'number' && old[t] > 0)
      ? old[t]
      : (t === '1k' ? DEFAULT_RPM['1k'] : t === '2k' ? DEFAULT_RPM['2k'] : DEFAULT_RPM['4k']);
    ops[t] = Math.max(1, Math.round(B / cap));
  }
  return { bucket_units_per_min: B, ops };
}

function costFor(a, tier) {
  const c = a.ops && a.ops[tier];
  return (typeof c === 'number' && c > 0) ? c : (DEFAULT_OP_COST[tier] || 1);
}

function getAcct(pid, provider) {
  if (!ACCT[pid]) {
    const norm = normalizeRateLimits(provider && provider.rate_limits);
    ACCT[pid] = {
      bucketB: norm.bucket_units_per_min,
      ops: norm.ops,
      manualState: norm.manual_state || null,
      cooldownMs: DEFAULT_COOLDOWN_MS,
      bucket: { cap: norm.bucket_units_per_min, tokens: norm.bucket_units_per_min, last: Date.now() },
      conc: 0,
      cooldownUntil: 0,
      consecutiveRejects: 0,
      capacityModel: (provider && provider.capacity_model === 'unlimited') ? 'unlimited' : 'limited',
    };
  }
  const a = ACCT[pid];
  // 热改生效：DB 改 rate_limits / capacity_model / cooldown_ms 立即同步（不重置桶余额）
  if (provider) {
    const norm = normalizeRateLimits(provider.rate_limits);
    a.bucketB = norm.bucket_units_per_min;
    a.ops = norm.ops;
    a.manualState = norm.manual_state || null;
    a.bucket.cap = norm.bucket_units_per_min;
    if (provider.capacity_model) a.capacityModel = (provider.capacity_model === 'unlimited') ? 'unlimited' : 'limited';
    if (typeof provider.cooldown_ms === 'number' && provider.cooldown_ms > 0) a.cooldownMs = provider.cooldown_ms;
  }
  return a;
}

// 令牌桶按时间回流：B 个令牌 / 60 秒
function refillAccount(a, now) {
  const dt = (now - a.bucket.last) / 1000;
  if (dt > 0) a.bucket.tokens = Math.min(a.bucket.cap, a.bucket.tokens + dt * (a.bucket.cap / 60));
  a.bucket.last = now;
}

function isCold(a, now) {
  if (a.manualState === 'cold') return true;
  if (a.manualState === 'hot') return false;
  return now < a.cooldownUntil;
}

// 拒单：切下一个供应商、不扣费、不返错；首次拒单即冷，连续 3 拒也冷（双路径，任一即冷却）
function markReject(a, now) {
  a.consecutiveRejects += 1;
  a.cooldownUntil = now + (a.cooldownMs || DEFAULT_COOLDOWN_MS);
}

// 在单个账号上尝试一次生成；账号不可用（冷却/桶空/并发满）或失败（429/异常）返回 null（上层切下一个）
async function attemptOnAccount(p, tier, input, contentType) {
  const now = Date.now();
  const a = getAcct(p.provider.id, p.provider);
  if (isCold(a, now)) { markReject(a, now); return null; }     // 整账号冷却 → 拒单切下一个
  refillAccount(a, now);
  const cost = costFor(a, tier);
  if (a.capacityModel !== 'unlimited' && a.bucket.tokens < cost) { markReject(a, now); return null; } // 共享桶空 → 拒单
  // per-model 并发覆盖：模型自身设了 max_concurrent（非 null 正数）则优先用，否则回退服务商默认
  const modelConc = (p.model && typeof p.model.max_concurrent === 'number' && p.model.max_concurrent > 0) ? p.model.max_concurrent : null;
  const concCap = Math.min(modelConc ?? (Number(p.provider.max_concurrent) || 2), ACCOUNT_CONC_CAP);
  if (a.conc >= concCap) return null;                          // 单账号并发满（非拒单，仅忙）
  if (a.capacityModel !== 'unlimited') a.bucket.tokens -= cost; // 占用单位
  a.conc += 1; GLOBAL_ACTIVE += 1;
  try {
    const res = contentType === 'video'
      ? await videoGenerate(p.provider, p.model, input)
      : await imageGenerate(p.provider, p.model, input);
    if (res && res.rateLimited) {                              // 真实 429 → 退还、整账号冷却、拒单（不扣费）
      if (a.capacityModel !== 'unlimited') a.bucket.tokens += cost;
      a.conc -= 1; GLOBAL_ACTIVE -= 1;
      markReject(a, now);
      return null;
    }
    a.consecutiveRejects = 0;                                  // 成功 → 重置拒单计数、释放并发槽
    a.conc -= 1; GLOBAL_ACTIVE -= 1;
    // 精确归因：本次成功出自哪个 provider / model / 类型 / 产出资产数（供双边记账）
    const units = res.images ? (res.images.length || 0) : (res.videoUrl ? 1 : 0);
    return { ...res, providerId: p.provider.id, modelId: p.model.model_id, modelType: contentType, units };
  } catch (e) {
    if (a.capacityModel !== 'unlimited') a.bucket.tokens += cost;
    a.conc -= 1; GLOBAL_ACTIVE -= 1;
    markReject(a, now);
    return null;
  }
}

// 单任务：轮询所有账号，拒单静默切下一个；全部不可用 → 有界退避重试；仍失败 → throttled（无硬错、前台无感）
async function dispatchOne(pairs, tier, input, contentType) {
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const seq = pairs.slice(RR_POINTER).concat(pairs.slice(0, RR_POINTER));
    for (const p of seq) {
      if (GLOBAL_ACTIVE >= GLOBAL_MAX) { await sleep(120); break; }
      const r = await attemptOnAccount(p, tier, input, contentType);
      if (r) { RR_POINTER = (RR_POINTER + 1) % pairs.length; return r; }
    }
    await sleep(200 * (attempt + 1));                          // 整轮回不可用 → 短退避后重试
  }
  return { status: 'throttled', retryAfter: DEFAULT_COOLDOWN_MS, images: [], providerId: null, error: '资源紧张，请稍候重试' };
}

// ─── 主入口 ────────────────────────────────────────
async function generate(pgPool, opts) {
  const { model, prompt, ratio, resolution, count, contentType, referenceImages, negative, durationSec } = opts;
  // 分辨率 → 桶档位：video 走 video 档（cost=20，与 4k 同权重）；8k 按 4k 计；未知按 1k
  const tier = contentType === 'video' ? 'video'
    : (['1k', '2k', '4k'].includes(resolution) ? resolution
      : (resolution === '8k' ? '4k' : '1k'));

  // 1. 全局最大并发 + 等待区阈值（均可被 settings.app 实时覆盖）
  try {
    const r = await pgPool.query("SELECT value FROM settings WHERE key='app'");
    const v = r.rows[0] && r.rows[0].value;
    if (v && v.maxThreads) GLOBAL_MAX = Number(v.maxThreads) || 10;
    if (v && typeof v.waitingAreaThreshold === 'number' && v.waitingAreaThreshold > 0) {
      WAITING_THRESHOLD = Math.floor(v.waitingAreaThreshold);
    }
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

  // 5. 并发分配：单任务内部已做「拒单静默切下一个供应商」+「全部不可用 → throttled」
  const total = Math.max(1, Math.min(4, Number(count) || 1));
  const tasks = [];
  for (let i = 0; i < total; i++) {
    tasks.push((async () => {
      const input = { prompt, ratio, resolution, count: 1, referenceImages, negative, durationSec };
      return dispatchOne(pairs, tier, input, contentType);
    })());
  }

  const results = await Promise.all(tasks);
  const images = [];
  const videos = [];        // 视频 URL 单独收集（与 images 通道并列，便于上层按 contentType 区分）
  const errors = [];
  const usedProviders = [];
  const consumption = [];   // 双边记账聚合：每组 (providerId, modelId, modelType) 的产出资产数
  let throttled = false;
  for (const r of results) {
    if (r.providerId) usedProviders.push(r.providerId);
    if (r.providerId && r.modelId && r.units) {
      consumption.push({ providerId: r.providerId, modelId: r.modelId, modelType: r.modelType, units: r.units });
    }
    if (r.status === 'throttled') { throttled = true; if (r.error) errors.push(r.error); continue; }
    if (r.status === 'success') {
      if (r.images && r.images.length) {
        images.push(r.images[0]);
      } else if (r.videoUrl) {
        // 视频：videoUrl 单独通道；同时并入 images 以兼容上层 images.length 成功判定
        videos.push(r.videoUrl);
        images.push(r.videoUrl);
      }
    } else if (r.error) {
      errors.push(r.error);
    }
  }
  const usedProvidersUniq = [...new Set(usedProviders)];
  if (images.length > 0) {
    return { status: 'success', images, videoUrl: videos[0], source: 'provider', errors: errors.length ? errors : undefined, usedProviders: usedProvidersUniq, consumption };
  }
  if (throttled) {
    return { status: 'throttled', retryAfter: DEFAULT_COOLDOWN_MS, error: errors[0] || '资源紧张，请稍候重试', images: [], usedProviders: usedProvidersUniq };
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
  const { model, prompt, count, contentType, referenceImages, pendingIds = [], clientMeta = {}, user_id, idempotencyKey, cost = 0, costPool = 'recharge' } = opts;
  // 生成一个稳定 taskId：便于前端 localStorage 持久化关联
  const taskId = `gt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await pgPool.query(
      `INSERT INTO generation_tasks
         (task_id, status, model, prompt, count, content_type, pending_ids, client_meta, user_id, idempotency_key, cost, cost_pool)
       VALUES ($1, 'running', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [taskId, model || '', prompt || '', count || 1, contentType || 'image', pendingIds, clientMeta, user_id || null, idempotencyKey || null, cost || 0, costPool || 'recharge'],
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
          await billing.commitCredits(pgPool, user_id, cost, idempotencyKey, costPool);
          // 双边记账：按 (provider, model) 组记录后台量 vs 客户量（图/视频按资产数；客户收费按产出比例分摊，整体 margin 精确）
          try {
            const groups = (result && result.consumption) || [];
            const totalUnits = groups.reduce((s, g) => s + (g.units || 0), 0) || 1;
            for (const g of groups) {
              const alloc = Math.round((cost || 0) * (g.units || 0) / totalUnits);
              await accounting.recordConsumption(pgPool, {
                scope: 'user', actorId: user_id || '', purpose: 'generate',
                providerId: g.providerId || '', modelId: g.modelId || '', modelType: g.modelType || 'image',
                outputUnits: g.units || 0, customerChargeCredits: alloc,
                idempotencyKey: `${idempotencyKey}:${g.providerId}:${g.modelId}`, taskRef: taskId,
              });
            }
          } catch (e) { console.warn('[accounting generate-async]', e.message); }
          await pgPool.query(
            `UPDATE generation_tasks SET status=$2, result=$3, error=$4, completed_at=NOW(), user_id=$5
             WHERE task_id=$1`,
            [taskId, 'done', JSON.stringify(result || {}), (result && result.error) || '', user_id],
          );
        } else if (result && result.status === 'throttled') {
          // 资源全不可用（该任务所有可用供应商都冷却/限流）→ 进入等待区后台重试，
          // 不立即判失败、不释放积分（仍持有，等待真正生成或超时再释放）。
          // 前台是否提示"资源不足"由等待区积压 + 平台全冷状态决定（见 getWaitingAreaStatus）。
          enqueueWaiting(taskId, opts);
          await updateTaskStatus(pgPool, taskId, 'running', null, '资源紧张，已进入等待区排队重试', user_id);
          runWaitingPump(pgPool).catch((e) => console.warn('[waiting] pump error:', e.message));
        } else {
          // 生成失败：释放 held 积分（G3 释放点，按池回退）
          await billing.releaseCredits(pgPool, user_id, cost, idempotencyKey, costPool);
          await pgPool.query(
            `UPDATE generation_tasks SET status=$2, result=$3, error=$4, completed_at=NOW(), user_id=$5
             WHERE task_id=$1`,
            [taskId, 'failed', JSON.stringify(result || {}), (result && result.error) || '', user_id],
          );
        }
      } catch (e) {
        console.warn('[dispatcher] 完成回调失败:', e.message);
      }
    })
    .catch(async (e) => {
      // 异常：释放 held 积分（按池回退）
      await billing.releaseCredits(pgPool, user_id, cost, idempotencyKey, costPool).catch(() => {});
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
  getAcct, normalizeRateLimits, costFor, getAccountStates, setManualState,
  // ── 等待区（资源全不可用时积压 + 前台"资源不足"提示）───
  getWaitingAreaStatus, enqueueWaiting, dequeueWaiting, waitingAreaSize,
  allResourcesDown, waitingAreaTriggered, setWaitingThreshold, getWaitingThreshold,
  refreshWaitingThreshold, runWaitingPump, updateTaskStatus, planPriority,
};

// ─── 等待区（资源全不可用时积压请求；超阈值触发前台"资源不足"）───
// 仅当某任务的所有可用供应商都不可用时，dispatchOne 返回 'throttled'；
// 该任务不立即判失败，而是进入等待区后台重试，直到资源恢复或超时。
// 当「所有账号全冷（平台级全不可用）」且「等待区积压 > 阈值」时，前台提示"资源不足"。
// 阈值（默认 10）可调：写入 settings.app.waitingAreaThreshold（管理面板「调度设置」）。
//
// 会员优先调度（商业优化）：不同套餐在等待区拥有不同出队优先级，
// 资源一旦恢复，会员任务优先抢到空闲账号 → 把"资源不足"从痛点转成付费理由。
// 优先级仅影响排队次序，不豁免计费/限额。后续若需可配置权重，可迁到 settings.app.planPriority。
const PLAN_PRIORITY = { free: 0, pro: 1, team: 2 };
function planPriority(plan) {
  return typeof PLAN_PRIORITY[plan] === 'number' ? PLAN_PRIORITY[plan] : 0;
}
const WAITING_AREA = new Map();            // taskId -> { enqueueAt, lastAttempt, attempts, priority, opts }
let WAITING_THRESHOLD = 10;                // 可调：所有资源不可用时，等待区积压超过该值 → 触发前台提示
const WAITING_MAX_WAIT_MS = 5 * 60 * 1000; // 单任务最长等待 5 分钟，超时判失败（释放积分）
let waitingPumpRunning = false;

function setWaitingThreshold(n) {
  if (typeof n === 'number' && n > 0) WAITING_THRESHOLD = Math.floor(n);
}
function getWaitingThreshold() { return WAITING_THRESHOLD; }

// 从 settings.app.waitingAreaThreshold 实时刷新内存阈值（供 queue-status 接口在返回前调用，
// 保证前台阈值调整即时生效，无需等下一次 generate()）。
async function refreshWaitingThreshold(pgPool) {
  if (!pgPool) return;
  try {
    const r = await pgPool.query("SELECT value FROM settings WHERE key='app'");
    const v = r.rows[0] && r.rows[0].value;
    if (v && typeof v.waitingAreaThreshold === 'number' && v.waitingAreaThreshold > 0) {
      WAITING_THRESHOLD = Math.floor(v.waitingAreaThreshold);
    }
  } catch {}
}

// 平台级"所有资源不可用"：所有已加载账号都冷（含手动 cold / 冷却中）。
// 无账号配置时不算"全不可用"，避免误报（没有账号本就该报"无可用模型"而非"资源不足"）。
function allResourcesDown() {
  const entries = Object.values(getAccountStates());
  if (entries.length === 0) return false;
  return entries.every((s) => !!s.cold);
}

function enqueueWaiting(taskId, opts) {
  if (!WAITING_AREA.has(taskId)) {
    WAITING_AREA.set(taskId, {
      enqueueAt: Date.now(),
      lastAttempt: 0,
      attempts: 0,
      priority: planPriority(opts && opts.userPlan),
      opts,
    });
  }
}
function dequeueWaiting(taskId) { WAITING_AREA.delete(taskId); }
function waitingAreaSize() { return WAITING_AREA.size; }

// 触发条件：所有资源不可用 且 等待区积压 > 阈值（阈值可调，默认 10）
function waitingAreaTriggered() {
  return allResourcesDown() && waitingAreaSize() > WAITING_THRESHOLD;
}

function getWaitingAreaStatus() {
  const down = allResourcesDown();
  const size = waitingAreaSize();
  let memberWaiting = 0;
  for (const item of WAITING_AREA.values()) if (item.priority > 0) memberWaiting++;
  return {
    waitingAreaSize: size,
    memberWaiting,
    allResourcesDown: down,
    threshold: WAITING_THRESHOLD,
    triggered: down && size > WAITING_THRESHOLD,
  };
}

// 退避间隔：随重试次数指数增长，封顶 30s，避免打爆供应商
function waitingBackoff(attempts) {
  return Math.min(30000, 2000 * Math.pow(1.6, attempts));
}

// 统一任务状态写回（完成 / 失败 / 重置为 running）。done/failed 时落 completed_at。
async function updateTaskStatus(pgPool, taskId, status, result, error, userId) {
  try {
    await pgPool.query(
      `UPDATE generation_tasks SET status=$2, result=$3, error=$4,
         completed_at = CASE WHEN $2 IN ('done','failed') THEN NOW() ELSE completed_at END,
         user_id=$5
       WHERE task_id=$1`,
      [taskId, status, result ? JSON.stringify(result) : null, error || '', userId || null],
    );
  } catch (e) {
    console.warn('[waiting] 更新任务状态失败:', e.message);
  }
}

// 等待区后台泵：周期性重试积压任务，资源恢复即出队；超时则判失败释放积分。
// 同一进程内单例（waitingPumpRunning 守卫），由首个入队任务触发，跑完自动退出。
async function runWaitingPump(pgPool) {
  if (waitingPumpRunning) return;
  waitingPumpRunning = true;
  try {
    while (WAITING_AREA.size > 0) {
      const now = Date.now();
      const due = [];
      for (const [taskId, item] of WAITING_AREA) {
        if (now - item.enqueueAt > WAITING_MAX_WAIT_MS) {
          due.push({ taskId, item, reason: 'timeout' });
        } else if (now - item.lastAttempt >= waitingBackoff(item.attempts)) {
          due.push({ taskId, item, reason: 'retry' });
        }
      }
      // 会员优先出队：priority 降序（会员先抢恢复的资源），同优先级按入队时间升序（FIFO）。
      due.sort((a, b) => (b.item.priority - a.item.priority) || (a.item.enqueueAt - b.item.enqueueAt));
      for (const { taskId, item, reason } of due) {
        if (WAITING_AREA.get(taskId) !== item) continue; // 已被其它分支移除
        const opts = item.opts;
        if (reason === 'timeout') {
          await billing.releaseCredits(pgPool, opts.user_id, opts.cost, opts.idempotencyKey, opts.costPool).catch(() => {});
          await updateTaskStatus(pgPool, taskId, 'failed', null, '等待区超时：资源长时间不可用', opts.user_id);
          WAITING_AREA.delete(taskId);
          continue;
        }
        item.lastAttempt = now;
        item.attempts += 1;
        const result = await generate(pgPool, opts);
        const ok = result && result.status === 'success' && Array.isArray(result.images) && result.images.length;
        if (ok) {
          await billing.commitCredits(pgPool, opts.user_id, opts.cost, opts.idempotencyKey, opts.costPool).catch(() => {});
          await updateTaskStatus(pgPool, taskId, 'done', result, null, opts.user_id);
          WAITING_AREA.delete(taskId);
        } else if (result && result.status === 'throttled') {
          // 仍不可用：继续留在等待区，下一轮再试（任务保持 running，前台仍显示"生成中"）
        } else {
          await billing.releaseCredits(pgPool, opts.user_id, opts.cost, opts.idempotencyKey, opts.costPool).catch(() => {});
          await updateTaskStatus(pgPool, taskId, 'failed', result, (result && result.error) || '生成失败', opts.user_id);
          WAITING_AREA.delete(taskId);
        }
      }
      if (WAITING_AREA.size === 0) break;
      await sleep(1500);
    }
  } finally {
    waitingPumpRunning = false;
  }
}

// ─── 管理面板用：账号冷热状态快照 + 手动强切（持久化到 rate_limits JSONB / cooldown_ms 列）───
function getAccountStates() {  const out = {};
  const now = Date.now();
  for (const pid of Object.keys(ACCT)) {
    const a = ACCT[pid];
    out[pid] = {
      capacityModel: a.capacityModel,
      bucketUnitsPerMin: a.bucketB,
      tokens: Math.round(a.bucket.tokens * 100) / 100,
      cap: a.bucket.cap,
      conc: a.conc,
      cooldownUntil: a.cooldownUntil,
      cooldownMs: a.cooldownMs,
      cold: isCold(a, now),
      manualState: a.manualState,
      consecutiveRejects: a.consecutiveRejects,
      ops: a.ops,
    };
  }
  return out;
}

function setManualState(pid, state, cooldownMs, pgPool) {
  const a = ACCT[pid];
  if (a) {
    a.manualState = state || null;
    if (typeof cooldownMs === 'number' && cooldownMs > 0) a.cooldownMs = cooldownMs;
    if (state === 'cold') a.cooldownUntil = Date.now() + (a.cooldownMs || DEFAULT_COOLDOWN_MS);
  }
  // 持久化：manual_state 写入 rate_limits JSONB；cooldown_ms 写独立列（随库恢复，重启后仍生效）
  if (pgPool) {
    pgPool.query('SELECT rate_limits FROM providers WHERE id=$1', [pid])
      .then((r) => {
        if (!r.rows[0]) return;
        const rl = (r.rows[0].rate_limits && typeof r.rows[0].rate_limits === 'object') ? r.rows[0].rate_limits : {};
        if (state) rl.manual_state = state; else delete rl.manual_state;
        const cols = ['rate_limits=$1'];
        const params = [JSON.stringify(rl)];
        if (typeof cooldownMs === 'number' && cooldownMs > 0) { cols.push('cooldown_ms=$2'); params.push(cooldownMs); }
        params.push(pid);
        return pgPool.query(`UPDATE providers SET ${cols.join(', ')} WHERE id=$${params.length}`, params);
      })
      .catch(() => {});
  }
  return a ? { ok: true, state: a.manualState } : { ok: false, error: '账号不存在' };
}
