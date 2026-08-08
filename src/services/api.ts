// API 客户端 — 唯一数据持久化通道（浏览器本地不落盘）
// 所有数据（媒体/供应商/模型/设置/OSS/角色）一律存后端，浏览器本地不落盘。
// 用法：在需要数据的地方先 `await ensureApi()`，成功后各 apiGet* 才有数据可读。

import type { IMediaItem } from '@/data/media';

let API_BASE = '';
let API_TOKEN = '';
let discoverPromise: Promise<boolean> | null = null;

/** 手动指定后端地址（一般不需要，ensureApi 会自动发现） */
export function initApi(baseUrl: string, token: string) {
  API_BASE = baseUrl.replace(/\/$/, '');
  API_TOKEN = token;
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_TOKEN}`,
  };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // 确保 API 已连接（首次调用时自动发现后端 + 获取 token）
  if (!API_TOKEN) await ensureApi();
  // credentials:'include' → 浏览器自动携带会话 cookie（后端 set-cookie 的 sid），用于 /api/generate 等需登录接口归属用户
  const res = await fetch(`${API_BASE}${path}`, { ...options, credentials: 'include', headers: { ...headers(), ...options?.headers } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * 确保 API 已连接（模块级缓存，只发现一次）。
 * 根据当前访问地址自动推导后端：http://<hostname>:3001 并获取 token。
 * 后端不可用时返回 false，调用方降级到内置默认数据（仅内存，不落盘）。
 */
export function ensureApi(): Promise<boolean> {
  if (API_BASE && API_TOKEN) return Promise.resolve(true);
  if (!discoverPromise) {
    discoverPromise = (async () => {
      try {
        // 同域：直接走相对路径
        let apiBase = '';
        if (typeof window !== 'undefined') {
          const { protocol, host } = window.location;
          apiBase = `${protocol}//${host}`;
        }
        const res = await fetch(`${apiBase}/api/token`, { headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
        if (res.ok) {
          const { token } = await res.json();
          initApi(apiBase, token);
          console.log(`[API] 已连接 ${apiBase}`);
          return true;
        }
      } catch {
        console.log('[API] 后端未启动，使用内置默认数据（不持久化）');
      }
      return false;
    })();
  }
  return discoverPromise;
}

// ─── Media ──────────────────────────────────────
export async function apiGetMedia(): Promise<any[]> {
  try { return await apiFetch('/api/media'); } catch { return []; }
}
export async function apiSaveMedia(items: any[]) {
  try { await apiFetch('/api/media', { method: 'POST', body: JSON.stringify(items) }); } catch {}
}
export async function apiDeleteMedia(id: string) {
  try { await apiFetch(`/api/media/${id}`, { method: 'DELETE' }); } catch {}
}
/**
 * 单条部分更新（探测失败时回写 status/errorMessage/failedAt 用）
 * 后端只更新传入的非空字段，不破坏其他字段
 */
export async function apiUpdateMedia(id: string, patch: Partial<IMediaItem>) {
  try { await apiFetch(`/api/media/${id}`, { method: 'PUT', body: JSON.stringify(patch) }); } catch {}
}
/** 媒体分类计数（侧边栏角标用） */
export interface MediaCounts {
  total: number;
  image: number;
  video: number;
  character: number;
  scene: number;
  prop: number;
  other: number;
  upload: number;
}
export async function apiGetMediaCounts(): Promise<MediaCounts | null> {
  try { return await apiFetch<MediaCounts>('/api/media/counts'); } catch { return null; }
}

// ─── Providers ──────────────────────────────────
export async function apiGetProviders(): Promise<any[]> {
  try { return await apiFetch('/api/providers'); } catch { return []; }
}
export async function apiSaveProviders(items: any[]) {
  try { await apiFetch('/api/providers', { method: 'POST', body: JSON.stringify(items) }); } catch {}
}
export async function apiDeleteProvider(id: string): Promise<void> {
  await apiFetch(`/api/providers/${id}`, { method: 'DELETE' });
}
// 账号冷热状态快照（调度器内存态）
export async function apiGetProviderStates(): Promise<Record<string, any>> {
  try { const r = await apiFetch<{ states: Record<string, any> }>('/api/providers/states'); return r.states || {}; } catch { return {}; }
}
// 手动强切账号冷热：state='hot'|'cold'|null；cooldownMs 可选（秒→毫秒由后端处理？此处传毫秒）
export async function apiSetProviderCooldown(id: string, state: string | null, cooldownMs?: number) {
  try { return await apiFetch(`/api/providers/${id}/cooldown`, { method: 'POST', body: JSON.stringify({ state, cooldownMs }) }); } catch { return null; }
}

// ─── Models ─────────────────────────────────────
export async function apiGetModels(): Promise<any[]> {
  try { return await apiFetch('/api/models'); } catch { return []; }
}
export async function apiSaveModels(items: any[]) {
  try { await apiFetch('/api/models', { method: 'POST', body: JSON.stringify(items) }); } catch {}
}
export async function apiDeleteModel(id: string) {
  try { await apiFetch(`/api/models/${id}`, { method: 'DELETE' }); } catch {}
}
/** 单模型局部更新（管理员）：传任意可编辑字段子集，后端 PATCH 仅更新传入列 */
export async function apiPatchModel(id: string, patch: Record<string, any>) {
  try { return await apiFetch(`/api/models/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); } catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}

/**
 * 代理下载外部图片（绕开浏览器 CORS）
 * 后端服务器对服务器 fetch，无 CORS 限制
 */
export async function apiProxyFetch(
  imageUrl: string,
  headers: Record<string, string> = {},
): Promise<{ success: boolean; base64?: string; contentType?: string; size?: number; message?: string }> {
  try {
    return await apiFetch('/api/proxy-fetch', {
      method: 'POST',
      body: JSON.stringify({ imageUrl, headers }),
    });
  } catch (e) {
    return { success: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 100) };
  }
}

// ─── Settings ───────────────────────────────────
export async function apiGetSettings(): Promise<any> {
  try { return await apiFetch('/api/settings'); } catch { return {}; }
}
export async function apiSaveSettings(settings: Record<string, any>) {
  try { await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }); } catch {}
}

// ─── OSS（多槽位 + 总开关） ────────────────────────────────────────
export interface IOssOverview {
  enabled: boolean;
  activeId: string;
  active: any | null;
  configs: any[];
  [k: string]: any;
}

export async function apiGetOss(): Promise<IOssOverview> {
  try {
    const r = await apiFetch('/api/oss');
    return (r || {}) as IOssOverview;
  } catch {
    return { enabled: true, activeId: '', active: null, configs: [] } as IOssOverview;
  }
}
/** 切总开关（enabled） */
export async function apiSetOssEnabled(enabled: boolean) {
  try { await apiFetch('/api/oss', { method: 'PUT', body: JSON.stringify({ enabled }) }); } catch {}
}

/** 新建 OSS 槽位（POST /api/oss/configs）；返回后端生成的 id */
export async function apiCreateOssSlot(slot: Partial<any>): Promise<any> {
  try { return await apiFetch('/api/oss/configs', { method: 'POST', body: JSON.stringify(slot) }); }
  catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}
/** 更新槽位（PUT /api/oss/configs/:id） */
export async function apiUpdateOssSlot(id: string, slot: Partial<any>): Promise<any> {
  try { return await apiFetch(`/api/oss/configs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ id, ...slot }) }); }
  catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}
/** 删除槽位 */
export async function apiDeleteOssSlot(id: string): Promise<any> {
  try { return await apiFetch(`/api/oss/configs/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}
/** 设为 active（POST /api/oss/configs/:id/activate） */
export async function apiActivateOssSlot(id: string): Promise<any> {
  try { return await apiFetch(`/api/oss/configs/${encodeURIComponent(id)}/activate`, { method: 'POST' }); }
  catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}

/**
 * 测试槽位连接（真探活；走 PUT 一字节 + 错误码诊断）
 * 推荐用具体槽位 ID。若没传 id 则走老的"按 body 里的字段试"模式（兼容）
 */
export async function apiTestOssSlot(id: string): Promise<{ success: boolean; message: string; status?: number }> {
  try {
    const r = await apiFetch(`/api/oss/configs/${encodeURIComponent(id)}/test`, { method: 'POST' });
    return r || { success: false, message: '无响应' };
  } catch (e) {
    return { success: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 100) };
  }
}
/**
 * 旧：传 cfg 试探（无槽位 ID 时使用，如 UI 在保存前即时校验）
 */
export async function apiTestOss(config: Record<string, any>): Promise<{
  success: boolean;
  message: string;
  files?: { name: string; size: number; lastModified: string }[];
}> {
  try {
    return await apiFetch('/api/oss/test', { method: 'POST', body: JSON.stringify(config) });
  } catch (e) {
    return { success: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 100) };
  }
}

/**
 * 向业务服务器申请 OSS 直传预签名（后端零字节：只鉴权 + 锁 userId 前缀 + 签发 PUT/GET 预签名）。
 * 返回的 putUrl 由浏览器直接 fetch PUT 到 OSS；getUrl 为 7 天有效访问签名。
 */
export async function apiSignOssUpload(
  fileName: string,
  contentType: string,
): Promise<{
  success: boolean;
  objectKey?: string;
  putUrl?: string;
  getUrl?: string;
  putExpires?: number;
  expires?: number;
  providerType?: string;
  message?: string;
}> {
  try {
    return await apiFetch('/api/oss/sign-upload', {
      method: 'POST',
      body: JSON.stringify({ fileName, contentType }),
    });
  } catch (e) {
    return {
      success: false,
      message: (e instanceof Error ? e.message : String(e)).slice(0, 100),
    };
  }
}

// ─── Characters ─────────────────────────────────
export async function apiGetCharacters(): Promise<any[]> {
  try { return await apiFetch('/api/characters'); } catch { return []; }
}
export async function apiSaveCharacters(items: any[]) {
  try { await apiFetch('/api/characters', { method: 'POST', body: JSON.stringify(items) }); } catch {}
}
export async function apiDeleteCharacter(id: string) {
  try { await apiFetch(`/api/characters/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch {}
}
export async function apiGetCharacterStats(id: string): Promise<{ totalGenerations: number; favorites: number }> {
  try { return await apiFetch(`/api/characters/${encodeURIComponent(id)}/stats`); }
  catch { return { totalGenerations: 0, favorites: 0 }; }
}

// ─── 创作工作室（M5 流水线）────────────────────────────────
import type { IStudioProject } from '@/data/studio';

export async function apiGetStudioProjects(): Promise<IStudioProject[]> {
  try { return await apiFetch<IStudioProject[]>('/api/studio/projects'); } catch { return []; }
}
export async function apiGetStudioProject(id: string): Promise<IStudioProject | null> {
  try { const r = await apiFetch<{ project: IStudioProject }>(`/api/studio/projects/${encodeURIComponent(id)}`); return r?.project || null; }
  catch { return null; }
}
export async function apiCreateStudioProject(payload: Partial<IStudioProject>): Promise<{ ok: boolean; project?: IStudioProject; error?: string }> {
  try {
    const r = await apiFetch<{ ok: boolean; project: IStudioProject }>('/api/studio/projects', { method: 'POST', body: JSON.stringify(payload) });
    return { ok: true, project: r.project };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) };
  }
}
export async function apiUpdateStudioProject(id: string, payload: Partial<IStudioProject>): Promise<{ ok: boolean; project?: IStudioProject; error?: string }> {
  try {
    const r = await apiFetch<{ ok: boolean; project: IStudioProject }>(`/api/studio/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    return { ok: true, project: r.project };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) };
  }
}
export async function apiDeleteStudioProject(id: string): Promise<{ ok: boolean }> {
  try { await apiFetch(`/api/studio/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); return { ok: true }; }
  catch { return { ok: false }; }
}

// ─── 后台示例库（运营维护，一键推送给顾客） ───
export async function apiGetSamples(): Promise<any[]> {
  try { const r = await apiFetch<{ samples: any[] }>('/api/admin/samples'); return r?.samples ?? []; } catch { return []; }
}
export async function apiCreateSample(payload: any) {
  return apiFetch('/api/admin/samples', { method: 'POST', body: JSON.stringify(payload) });
}
export async function apiUpdateSample(id: string, payload: any) {
  return apiFetch(`/api/admin/samples/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function apiDeleteSample(id: string) {
  return apiFetch(`/api/admin/samples/${id}`, { method: 'DELETE' });
}
export async function apiPushSamples() {
  return apiFetch('/api/admin/samples/push', { method: 'POST' });
}

/** 过滤掉刷新后失效的 blob URL 临时项（本地上传的临时文件不持久化） */
export function stripBlobItems<T extends { thumbnail?: string }>(items: T[]): T[] {
  return items.filter((m) => !m.thumbnail?.startsWith('blob:'));
}

// ─── 服务端生成分发 ─────────────────────────────
/**
 * 调用后端 /api/generate（默认异步）：立即返回 taskId，前端再用 taskId 轮询状态。
 * 旧调用方式（同步返回完整结果）仍兼容：传 `sync: true` 时后端会一次性返回 images。
 */
export type GenerateResponse =
  | { status: 'pending'; taskId: string; error?: string; code?: string }
  | { status: 'success' | 'failed'; taskId?: string; images?: string[]; error?: string; source?: string; usedProviders?: string[]; code?: string };

export async function apiGenerate(payload: {
  model: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  quality?: 'low' | 'standard' | 'high';
  count?: number;
  contentType?: 'image' | 'video';
  referenceImages?: string[];
  pendingIds?: string[]; // 把前端的 pending 占位 id 告诉后端，便于刷新恢复
  negative?: string;     // 反向提示词（正负向搭配刚需，随生图请求透传）
  idempotencyKey?: string; // 幂等键：每次生成请求一个 UUID，防网络抖动双扣（后端必需）
  sync?: boolean;         // 兼容旧测试：传 true 后端一次性返回结果
}): Promise<GenerateResponse> {
  try {
    return await apiFetch('/api/generate', { method: 'POST', body: JSON.stringify(payload) }) as GenerateResponse;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 后端 402 会返回 {status:'failed',error,code}；apiFetch 抛 "API 402: {...}"，这里提取 code 透传，
    // 供前端区分「不支持奖励且充值不足(NEED_RECHARGE)」与「支持奖励但双池皆不足(INSUFFICIENT)」。
    let code: string | undefined;
    const m = msg.match(/^API \d+:\s*(\{[\s\S]*\})\s*$/);
    if (m) { try { const b = JSON.parse(m[1]); if (b && b.code) code = b.code; } catch {} }
    return { status: 'failed', error: msg.slice(0, 200), code, images: [] };
  }
}

// 查询单个生成任务状态（用于前端轮询 / 刷新恢复）
export async function apiGetGenerationStatus(taskId: string): Promise<{
  taskId: string;
  status: 'running' | 'done' | 'failed' | 'not_found' | 'unknown';
  result?: { images?: string[]; source?: string; usedProviders?: string[] } | null;
  error?: string;
  pendingIds?: string[];
  model?: string;
  prompt?: string;
  count?: number;
  contentType?: string;
  clientMeta?: Record<string, unknown>;
  createdAt?: string;
  completedAt?: string;
}> {
  try {
    return await apiFetch(`/api/generate/status/${encodeURIComponent(taskId)}`);
  } catch (e) {
    return { taskId, status: 'unknown', error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

// 等待区聚合状态（公开接口，仅返回聚合数，不含逐账号明细）：
// 供前台判断是否提示"资源不足"（所有资源不可用 且 等待区积压 > 阈值）。
export async function apiGetQueueStatus(): Promise<{
  waitingAreaSize: number;
  memberWaiting: number;
  allResourcesDown: boolean;
  threshold: number;
  triggered: boolean;
}> {
  try {
    return await apiFetch('/api/generate/queue-status');
  } catch {
    return { waitingAreaSize: 0, memberWaiting: 0, allResourcesDown: false, threshold: 10, triggered: false };
  }
}

// 列出在途任务（用于页面刷新后批量恢复）
export async function apiListActiveGenerations(): Promise<{
  tasks: Array<{
    taskId: string;
    status: 'running' | 'done' | 'failed';
    result?: { images?: string[]; source?: string; usedProviders?: string[] } | null;
    error?: string;
    pendingIds?: string[];
    model?: string;
    prompt?: string;
    count?: number;
    contentType?: string;
    clientMeta?: Record<string, unknown>;
    createdAt?: string;
    completedAt?: string;
  }>;
  error?: string;
}> {
  try {
    return await apiFetch('/api/generate/active');
  } catch (e) {
    return { tasks: [], error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

// ─── 智能体 skill：AI 提示词优化 ─────────────────────
/**
 * 调用后端 /api/agent/optimize-prompt：后台自动选一个启用的 type=text 推理模型，
 * 把用户原始 prompt 改写成更适合图像/视频生成的英文结构化提示词。
 * 失败时：
 *   - code='NO_REASONING_MODEL' → 提示用户去「模型 Hub」添加 text 类型模型
 *   - 其他 error → 通用错误消息
 */
export async function apiOptimizePrompt(
  prompt: string,
  opts?: { targetLang?: 'en' | 'zh' | 'both' },
): Promise<{
  success: boolean;
  /** 主语言正向提示词（en→英文 / zh→中文 / both→英文） */
  positive?: string;
  /** 主语言反向提示词 */
  negative?: string;
  /** 中文正向对照（供中英对照模式展示） */
  positiveZh?: string;
  /** 中文反向对照 */
  negativeZh?: string;
  /** 实际采用的语言 */
  targetLang?: 'en' | 'zh' | 'both';
  error?: string;
  code?: 'NO_REASONING_MODEL' | string;
  modelUsed?: string;
  providerId?: string;
  fallback?: boolean;
  warning?: string;
}> {
  try {
    return await apiFetch('/api/agent/optimize-prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt, targetLang: opts?.targetLang || 'en' }),
    });
  } catch (e) {
    return { success: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

// ─── 同步服务商模型列表（后端代理，避免前端持有真实 Key）───
export async function apiSyncProviderModels(id: string): Promise<{ success: boolean; models?: Array<{ id: string; name: string }>; message?: string }> {
  try {
    return await apiFetch(`/api/providers/${id}/sync`, { method: 'POST' });
  } catch (e) {
    return { success: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

// ─── 测试服务商端点（后端代理）───
export async function apiTestProviderEndpoint(
  id: string,
  endpoint: Record<string, unknown>,
  vars: Record<string, unknown>,
): Promise<{ success: boolean; status?: number; body?: unknown; message?: string }> {
  try {
    return await apiFetch(`/api/providers/${id}/test-endpoint`, { method: 'POST', body: JSON.stringify({ endpoint, vars }) });
  } catch (e) {
    return { success: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

export async function apiTestProviderDefault(
  id: string,
  testInput: string,
): Promise<{ success: boolean; status?: number; body?: unknown; message?: string }> {
  try {
    return await apiFetch(`/api/providers/${id}/test-default`, { method: 'POST', body: JSON.stringify({ testInput }) });
  } catch (e) {
    return { success: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

// ─── Auth（cookie 会话；fetch 带 credentials:'include' 自动携带 sid）───
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  credits: number;
  /** 奖励余额：平台赠送/活动发放，仅支持奖励余额的模型可用，全局优先扣减 */
  rewardCredits: number;
  /** 充值余额：真钱充值，所有模型可用 */
  rechargeCredits: number;
  role: string;
  plan?: string;
}

/** 注册：成功后后端种下会话 cookie，返回用户（含赠送积分） */
export async function apiRegister(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ ok: boolean; user: AuthUser }> {
  return apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

/** 登录：成功后后端种下会话 cookie */
export async function apiLogin(email: string, password: string): Promise<{ ok: boolean; user: AuthUser }> {
  return apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

/** 登出：清除会话 cookie */
export async function apiLogout(): Promise<{ ok: boolean }> {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

/** 当前登录用户（无 cookie 时 401，已被 apiFetch 抛错，这里兜底返回空） */
export async function apiMe(): Promise<{ user?: AuthUser }> {
  try {
    return await apiFetch('/api/auth/me');
  } catch {
    return {};
  }
}

/** 更新昵称（账户设置） */
export async function apiUpdateProfile(displayName: string): Promise<{ ok: boolean; user?: { id: string; displayName: string } }> {
  return apiFetch('/api/auth/profile', { method: 'PUT', body: JSON.stringify({ displayName }) });
}

/** 修改密码（账户设置） */
export async function apiChangePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return apiFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) });
}

/** 公开创作者主页资料（无需登录） */
export async function apiGetUser(id: string): Promise<{ user: { id: string; displayName: string; createdAt: string }; stats: { media: number } }> {
  return apiFetch(`/api/users/${encodeURIComponent(id)}`);
}

/** 公开创作者主页媒资（无需登录） */
export async function apiGetUserMedia(id: string): Promise<{ items: any[] }> {
  return apiFetch(`/api/users/${encodeURIComponent(id)}/media`);
}

// ─── 充值订单（M2 账务 / 真实支付通道）───
export interface RechargeOrder {
  id: string;
  payOrderNo: string;
  amount: number;
  channel: string;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  createdAt: string;
  paidAt?: string | null;
  expiresAt?: string | null;
  failReason?: string | null;
}
/** 创建充值订单（真实支付通道；无通道由后端返回 503，无模拟回退） */
export async function apiCreateRechargeOrder(params: { amount: number; channel: string }): Promise<{ ok: boolean; order?: RechargeOrder; error?: string }> {
  try {
    return await apiFetch('/api/credits/orders', { method: 'POST', body: JSON.stringify(params) });
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}
/** 当前用户的充值订单历史 */
export async function apiListRechargeOrders(): Promise<{ items: RechargeOrder[] }> {
  try { return await apiFetch('/api/credits/orders'); } catch { return { items: [] }; }
}
/** 轮询单个充值订单状态（支付成功后前端据此跳到成功态） */
export async function apiGetRechargeOrderStatus(payOrderNo: string): Promise<{ order?: RechargeOrder; error?: string }> {
  try {
    return await apiFetch(`/api/credits/orders/${encodeURIComponent(payOrderNo)}`);
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

// ─── 管理后台（M3 总控台 / M4 智能体层 / M2 账务）───
// 走会话 cookie（管理员登录态），无需额外 header；ensureApi 已注入 API_TOKEN 兜底。
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  credits: number;
  createdAt: string;
}
export async function apiAdminUsers(params: { q?: string; role?: string; limit?: number; offset?: number } = {}): Promise<{ items: AdminUser[]; total: number }> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  try { return await apiFetch(`/api/admin/users?${qs.toString()}`); } catch { return { items: [], total: 0 }; }
}

export async function apiAdminRecharge(userId: string, amount: number, note?: string): Promise<{ ok: boolean; credits?: number; error?: string }> {
  try {
    return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/credits`, {
      method: 'POST',
      body: JSON.stringify({ amount, note }),
    });
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

export interface AdminTx {
  id: number;
  userId: string;
  user: string;
  kind: string;
  amount: number;
  balanceAfter: number | null;
  ref?: string;
  createdAt: string;
}
export async function apiAdminTransactions(params: { limit?: number; offset?: number; type?: string; userId?: string } = {}): Promise<{ items: AdminTx[]; total: number }> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  try { return await apiFetch(`/api/admin/transactions?${qs.toString()}`); } catch { return { items: [], total: 0 }; }
}

export interface AdminAgent {
  key: string;
  name: string;
  enabled: boolean;
  dailyBudget: number;
  config: Record<string, unknown>;
  agentType: 'model' | 'skill';
  skillKey: string;
  createdAt: string;
}
export async function apiAdminAgents(): Promise<AdminAgent[]> {
  try { return await apiFetch('/api/admin/agents'); } catch { return []; }
}
export async function apiAdminUpsertAgent(a: { key: string; name: string; enabled?: boolean; dailyBudget?: number; config?: Record<string, unknown>; agentType?: 'model' | 'skill'; skillKey?: string }): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch('/api/admin/agents', { method: 'POST', body: JSON.stringify(a) }); } catch (e) { return { ok: false, error: (e as Error).message }; }
}
export async function apiAdminToggleAgent(key: string, enabled: boolean): Promise<{ ok: boolean }> {
  try { return await apiFetch(`/api/admin/agents/${encodeURIComponent(key)}/toggle`, { method: 'PUT', body: JSON.stringify({ enabled }) }); } catch { return { ok: false }; }
}

export interface AgentProvider {
  id: string;
  agentKey: string;
  provider: string;
  model: string;
  weight: number;
  priority: number;
  costPerCall: number;
  enabled: boolean;
  createdAt: string;
}
export async function apiAdminAgentProviders(agentKey?: string): Promise<AgentProvider[]> {
  try { return await apiFetch(agentKey ? `/api/admin/agents/${encodeURIComponent(agentKey)}/providers` : '/api/admin/agent-providers'); } catch { return []; }
}
export async function apiAdminUpsertAgentProvider(p: { id?: string; agentKey: string; provider: string; model: string; weight?: number; priority?: number; costPerCall?: number; enabled?: boolean }): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch('/api/admin/agent-providers', { method: 'POST', body: JSON.stringify(p) }); } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export interface AgentRule {
  id: string;
  name: string;
  trigger: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}
export async function apiAdminAgentRules(): Promise<AgentRule[]> {
  try { return await apiFetch('/api/admin/agent-rules'); } catch { return []; }
}
export async function apiAdminUpsertAgentRule(r: { id?: string; name: string; trigger: string; condition?: Record<string, unknown>; action?: Record<string, unknown>; enabled?: boolean }): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch('/api/admin/agent-rules', { method: 'POST', body: JSON.stringify(r) }); } catch (e) { return { ok: false, error: (e as Error).message }; }
}
export async function apiAdminToggleAgentRule(id: string, enabled: boolean): Promise<{ ok: boolean }> {
  try { return await apiFetch(`/api/admin/agent-rules/${encodeURIComponent(id)}/toggle`, { method: 'PUT', body: JSON.stringify({ enabled }) }); } catch { return { ok: false }; }
}

// ─── 技能注册表 + AI 市集（M4/M6 数字能力包）───
export interface ISkill {
  key: string;
  name: string;
  stage: string;            // generation | prompt | post | analysis
  adapter: string;          // prompt_optimize | text_gen | ...
  costCredits: number;
  enabled: boolean;
  description: string;
  author: string;
  icon: string;
  version: string;
  params?: Record<string, unknown>;
}
export interface IShopProduct {
  id: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  kind: string;             // skill_pack | agent_template
  refKey: string;           // skill_registry.key
  priceCredits: number;
  priceCents: number;
  author: string;
  description: string;
  tags: string[];
  installs: number;
  createdAt: string;
}
export interface IShopProductDetail {
  product: IShopProduct & { status?: string; coverUrl?: string };
  skill: (ISkill & { costCredits?: number }) | null;
}
export interface IMySkill {
  skillKey: string;
  acquiredAt: string;
  name?: string;
  stage?: string;
  adapter?: string;
  description?: string;
  icon?: string;
  version?: string;
}

// 能力目录（公开，仅启用）
export async function apiGetSkills(): Promise<ISkill[]> {
  try { const d = await apiFetch<{ items: ISkill[] }>('/api/skills'); return d.items || []; } catch { return []; }
}
// 后台技能列表（含未启用）
export async function apiAdminListSkills(): Promise<ISkill[]> {
  try { const d = await apiFetch<{ items: ISkill[] }>('/api/admin/skills'); return d.items || []; } catch { return []; }
}
// 新建 / 更新（有 key 走 PUT，无 key 走 POST）
export async function apiAdminSaveSkill(s: Partial<ISkill> & { key: string; params?: Record<string, unknown> }): Promise<{ ok: boolean; error?: string }> {
  try {
    if (s.key) return await apiFetch(`/api/admin/skills/${encodeURIComponent(s.key)}`, { method: 'PUT', body: JSON.stringify(s) });
    return await apiFetch('/api/admin/skills', { method: 'POST', body: JSON.stringify(s) });
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
export async function apiAdminDeleteSkill(key: string): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch(`/api/admin/skills/${encodeURIComponent(key)}`, { method: 'DELETE' }); }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

// 市集商品列表（公开，仅 published）
export async function apiGetShopProducts(): Promise<IShopProduct[]> {
  try { const d = await apiFetch<{ items: IShopProduct[] }>('/api/shop/products'); return d.items || []; } catch { return []; }
}
// 市集商品详情（公开）
export async function apiGetProduct(id: string): Promise<IShopProductDetail | null> {
  try { return await apiFetch<IShopProductDetail>(`/api/shop/products/${encodeURIComponent(id)}`); } catch { return null; }
}
// 获取安装（登录；免费/积分；现金收银台本版未做）
export async function apiAcquireProduct(id: string): Promise<{ ok: boolean; alreadyOwned?: boolean; skillKey?: string; installs?: number; error?: string; kind?: string }> {
  try { return await apiFetch(`/api/shop/products/${encodeURIComponent(id)}/acquire`, { method: 'POST' }); }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}
// 我的技能（登录）
export async function apiGetMySkills(): Promise<IMySkill[]> {
  try { const d = await apiFetch<{ items: IMySkill[] }>('/api/skills/mine'); return d.items || []; } catch { return []; }
}
// 试跑技能 / 执行技能（登录；真实扣积分）
export async function apiRunSkill(payload: { key: string; input: string; idempotencyKey?: string }): Promise<{ ok: boolean; content?: string; modelUsed?: string; costCredits?: number; error?: string }> {
  try { return await apiFetch('/api/skill/run', { method: 'POST', body: JSON.stringify(payload) }); }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

// ─── 用户侧账务（积分流水 / 充值订单 / 概览）───
export async function apiMeSummary(): Promise<{
  credits: number; rewardCredits: number; rechargeCredits: number; totalRecharged: number; totalConsumed: number; monthConsumed: number; totalGranted: number; totalAdjusted?: number;
}> {
  try { return await apiFetch('/api/me/summary'); }
  catch { return { credits: 0, rewardCredits: 0, rechargeCredits: 0, totalRecharged: 0, totalConsumed: 0, monthConsumed: 0, totalGranted: 0 }; }
}
export interface MeTx {
  id: number; kind: string; amount: number; ref?: string; balanceAfter: number | null; createdAt: string;
}
export async function apiMeTransactions(params: { limit?: number; offset?: number } = {}): Promise<{ items: MeTx[]; total: number }> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  try { return await apiFetch(`/api/me/transactions?${qs.toString()}`); } catch { return { items: [], total: 0 }; }
}
export interface MeRecharge {
  id: string; payOrderNo: string; amount: number; channel: string; status: string; createdAt: string; paidAt: string | null;
}
export async function apiMeRecharges(): Promise<{ items: MeRecharge[] }> {
  try { return await apiFetch('/api/me/recharges'); } catch { return { items: [] }; }
}

// ─── 公开充值套餐（充值弹窗预览，无需登录）───
export interface TopupPackage {
  id: string; name: string; credits: number; price: number; bonus: number; sortOrder: number; remark: string;
}
export async function apiPublicTopupPackages(): Promise<{ items: TopupPackage[] }> {
  try { return await apiFetch('/api/finance/topup-packages'); } catch { return { items: [] }; }
}

// ─── 后台账务系统（Phase 4：总览 / 对账 / 账本 / 套餐）───
export interface FinanceOverview {
  totalCreditsInSystem: number;
  totalUsers: number;
  totalRechargePaid: number;
  rechargePaidCount: number;
  totalRechargePending: number;
  rechargePendingCount: number;
  rechargeFailedCount: number;
  totalConsumed: number;
  totalGranted: number;
  totalAdjusted: number;
  series: { day: string; rechargePaid: number; consumed: number; granted: number }[];
}
export async function apiAdminFinanceOverview(): Promise<FinanceOverview | null> {
  try { return await apiFetch('/api/admin/finance/overview'); } catch { return null; }
}
export async function apiAdminFinanceRecharges(params: { limit?: number; offset?: number; status?: string; channel?: string } = {}): Promise<{ items: any[]; total: number }> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  try { return await apiFetch(`/api/admin/finance/recharges?${qs.toString()}`); } catch { return { items: [], total: 0 }; }
}
export async function apiAdminFinanceReconcile(): Promise<{ checkedAt: number; checkedUsers: number; alertCount: number; alerts: any[]; ok: boolean } | null> {
  try { return await apiFetch('/api/admin/finance/reconcile'); } catch { return null; }
}
export async function apiAdminFinanceLedger(userId: string): Promise<any | null> {
  try { return await apiFetch(`/api/admin/finance/users/${encodeURIComponent(userId)}/ledger`); } catch { return null; }
}
export async function apiAdminFinancePackages(): Promise<{ items: TopupPackage[] }> {
  try { return await apiFetch('/api/admin/finance/topup-packages'); } catch { return { items: [] }; }
}
export async function apiAdminFinanceCreatePackage(p: Partial<TopupPackage> & { enabled?: boolean }): Promise<{ ok: boolean; id?: string; error?: string }> {
  try { return await apiFetch('/api/admin/finance/topup-packages', { method: 'POST', body: JSON.stringify(p) }); }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}
export async function apiAdminFinanceUpdatePackage(id: string, p: Partial<TopupPackage> & { enabled?: boolean }): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch(`/api/admin/finance/topup-packages/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(p) }); }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}
export async function apiAdminFinanceDeletePackage(id: string): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch(`/api/admin/finance/topup-packages/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}

// ─── 支付全局设置 + 服务商管理（后台 PaymentSettingsPage）───
export interface PaymentSettings {
  id: number;
  enabled: boolean;
  defaultExpiresMin: number;
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
  maxOpenOrders: number;
  allowTest: boolean;
  updatedAt: string;
}
export interface PaymentProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  weight: number;
  sortOrder: number;
  apiBase: string;
  productNamePrefix: string;
  allowRefund: boolean;
  supportedMethods: string[];
  remark: string;
  hasPid: boolean;
  hasPkey: boolean;
  hasWebhook: boolean;
  createdAt: string;
  updatedAt: string;
}
/** 当前可用的充值支付方式（由后台 payment_providers.supported_methods 并集决定） */
export async function apiGetPaymentMethods(): Promise<string[]> {
  try {
    const r = await apiFetch<{ items: string[] }>('/api/credits/payment-methods');
    return r?.items || [];
  } catch {
    return ['alipay', 'wxpay'];
  }
}
export async function apiAdminPaymentSettings(): Promise<PaymentSettings | null> {
  try { return await apiFetch('/api/admin/finance/payment-settings'); } catch { return null; }
}
export async function apiUpdatePaymentSettings(body: Partial<PaymentSettings>): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch('/api/admin/finance/payment-settings', { method: 'PUT', body: JSON.stringify(body) }); }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}
export async function apiAdminProviders(): Promise<{ items: PaymentProvider[] }> {
  try { return await apiFetch('/api/admin/finance/providers'); } catch { return { items: [] }; }
}
export async function apiCreateProvider(p: Partial<PaymentProvider> & { pid?: string; pkey?: string; webhookSecret?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  try { return await apiFetch('/api/admin/finance/providers', { method: 'POST', body: JSON.stringify(p) }); }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}
export async function apiUpdateProvider(id: string, p: Partial<PaymentProvider> & { pid?: string; pkey?: string; webhookSecret?: string }): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch(`/api/admin/finance/providers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(p) }); }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}
export async function apiAdminDeleteProvider(id: string): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch(`/api/admin/finance/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}
export async function apiToggleProvider(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  try { return await apiFetch(`/api/admin/finance/providers/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }); }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}

// ─── 用户 / 电商相关 API 历史原因内聚在 UsersPage.tsx，这里统一再导出，
// 保持 "@/services/api" 为唯一 API 入口（避免其它页面 import 缺失）───
export {
  apiAddToCart,
  apiAdminDeleteUser,
  apiAdminSetUserRole,
  apiAdminSetUserStatus,
  apiCreateOrder,
  apiGetCart,
  apiGetOrder,
  apiGetOrders,
  apiRemoveCartItem,
  apiUpdateCartItem,
} from '@/pages/Admin/UsersPage';
export type {
  CartItem,
  ShopOrder,
  ShopProduct,
  ShopProductDetail,
} from '@/pages/Admin/UsersPage';

// ─── 反馈 / 举报 / 导出 ───────────────────────────
export async function apiSubmitFeedback(payload: { type: string; title: string; content: string; contact?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  try { return await apiFetch('/api/feedback', { method: 'POST', body: JSON.stringify(payload) }); }
  catch (e) { return { ok: false, error: (e as Error).message.slice(0, 200) }; }
}
export async function apiSubmitReport(payload: { type: string; targetUrl?: string; content: string; evidence?: string; contact?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  try { return await apiFetch('/api/report', { method: 'POST', body: JSON.stringify(payload) }); }
  catch (e) { return { ok: false, error: (e as Error).message.slice(0, 200) }; }
}
export async function apiExportMyMedia(): Promise<{ ok: boolean; url?: string; filename?: string; count?: number; error?: string }> {
  try { return await apiFetch('/api/export/my-media'); }
  catch (e) { return { ok: false, error: (e as Error).message.slice(0, 200) }; }
}

// ─── 后台「核心错误历史」持久化日志（#449–#453：每一次核心错误落库展示）───
export interface SystemErrorItem {
  id: number;
  category: string;
  source: string;
  message: string;
  meta: any;
  stack: string | null;
  createdAt: string; // ISO
}
export interface SystemErrorStats {
  total: number;
  today: number;
  last24h: number;
  byCategory: { category: string; count: number }[];
}
export interface SystemErrorsResponse {
  items: SystemErrorItem[];
  total: number;
  stats: SystemErrorStats;
}
/**
 * 拉取历史核心错误（持久化落库 system_error_logs）。
 * 支持 server 端按 category / keyword 检索；limit 用于分页（LOAD MORE）。
 */
export async function apiGetErrors(params: { category?: string; keyword?: string; limit?: number } = {}): Promise<SystemErrorsResponse> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  try {
    return await apiFetch<SystemErrorsResponse>(`/api/admin/errors?${qs.toString()}`);
  } catch {
    return { items: [], total: 0, stats: { total: 0, today: 0, last24h: 0, byCategory: [] } };
  }
}
/** 清空历史错误（可仅清某 category） */
export async function apiClearErrors(category?: string): Promise<{ ok: boolean }> {
  const qs = new URLSearchParams();
  if (category) qs.set('category', category);
  try {
    return await apiFetch<{ ok: boolean }>(`/api/admin/errors?${qs.toString()}`, { method: 'DELETE' });
  } catch {
    return { ok: false };
  }
}

// ─── 首次部署初始化向导（公开接口，无需 token）───
export interface ISetupModelPreset {
  id: string;
  modelId: string;
  displayName: string;
  type: string;
  supportedResolutions: string[];
}
export interface ISetupStatus {
  initialized: boolean;
  presetProviders: { id: string; name: string }[];
  presetModels: ISetupModelPreset[];
}
export interface ISetupInitPayload {
  adminEmail: string;
  adminPassword: string;
  adminDisplayName?: string;
  provider?: { name?: string; base_url?: string; api_key: string; protocol?: string } | null;
  selectedModelIds?: string[];
}
export async function getSetupStatus(): Promise<ISetupStatus> {
  const res = await fetch('/api/setup/status', { credentials: 'include' });
  if (!res.ok) throw new Error(`setup status ${res.status}`);
  return res.json();
}
export async function postSetupInit(
  payload: ISetupInitPayload,
): Promise<{ ok: boolean; initialized: boolean; adminEmail: string; providerCreated: boolean; modelsEnabled: number }> {
  const res = await fetch('/api/setup/init', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `setup init ${res.status}`) as Error & { code?: string };
    err.code = data.error;
    throw err;
  }
  return data;
}
