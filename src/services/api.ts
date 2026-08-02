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
export async function apiDeleteProvider(id: string) {
  try { await apiFetch(`/api/providers/${id}`, { method: 'DELETE' }); } catch {}
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

// ─── OSS ────────────────────────────────────────
export async function apiGetOss(): Promise<any> {
  try { return await apiFetch('/api/oss'); } catch { return {}; }
}
export async function apiSaveOss(config: Record<string, any>) {
  try { await apiFetch('/api/oss', { method: 'PUT', body: JSON.stringify(config) }); } catch {}
}
/**
 * 测试 OSS 连接（走后端代理）
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
 * 上传文件到 OSS（走后端代理）
 */
export async function apiUploadToOss(
  objectKey: string,
  contentBase64: string,
): Promise<{ success: boolean; url: string; objectKey: string; size?: number; message?: string }> {
  try {
    return await apiFetch('/api/oss/upload', {
      method: 'POST',
      body: JSON.stringify({ objectKey, contentBase64 }),
    });
  } catch (e) {
    return {
      success: false,
      url: '',
      objectKey,
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
  | { status: 'pending'; taskId: string; error?: string }
  | { status: 'success' | 'failed'; taskId?: string; images?: string[]; error?: string; source?: string; usedProviders?: string[] };

export async function apiGenerate(payload: {
  model: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  count?: number;
  contentType?: 'image' | 'video';
  referenceImages?: string[];
  pendingIds?: string[]; // 把前端的 pending 占位 id 告诉后端，便于刷新恢复
  idempotencyKey?: string; // 幂等键：每次生成请求一个 UUID，防网络抖动双扣（后端必需）
  sync?: boolean;         // 兼容旧测试：传 true 后端一次性返回结果
}): Promise<GenerateResponse> {
  try {
    return await apiFetch('/api/generate', { method: 'POST', body: JSON.stringify(payload) }) as GenerateResponse;
  } catch (e) {
    return { status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 200), images: [] };
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
export async function apiOptimizePrompt(prompt: string): Promise<{
  success: boolean;
  content?: string;
  error?: string;
  code?: 'NO_REASONING_MODEL' | string;
  modelUsed?: string;
  providerId?: string;
}> {
  try {
    return await apiFetch('/api/agent/optimize-prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
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
  role: string;
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
