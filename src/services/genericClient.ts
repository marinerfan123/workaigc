// 通用 AI 模型客户端 —— 支持 OpenAI 兼容默认 + 完全自定义端点模板
// 用法：
//   import { imageClient, videoClient, textClient } from '@/services/genericClient';
//   await imageClient.generate({ provider, model, prompt, ratio, resolution, count });
//
// 自定义端点字段：
//   - IEndpoint.path / method / headers / bodyTemplate（支持 {{var}} 占位符）
//   - IEndpoint.imageFieldPath / videoFieldPath / textFieldPath 响应字段 JSONPath
//   - IEndpoint.taskIdPath / taskStatusPath / taskResultPath 异步任务字段
//
// 兼容性：未配置 endpoint / protocol='openai-compatible' 时走 OpenAI 标准接口。

import type { IModelProvider, IAiModel, IEndpoint, IModelEndpoint, Resolution } from '@/data/models';

// ─── 占位符替换 ────────────────────────────────────────
/**
 * 把 bodyTemplate 里的 {{var}} 替换成 vars[var]（JSON 字符串安全转义）。
 * vars 接受任意 JSON-safe 值（字符串/数字/数组），会自动 stringify。
 */
export function fillTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = key.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), vars);
    if (v == null) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    return JSON.stringify(v);
  });
}

// ─── JSONPath 解析（轻量版，支持 data.0.url / data[0].url） ───
/**
 * 按路径取嵌套对象的值。支持 `.` 分隔和 `[i]` 下标。
 * 例子：getByPath({data:[{url:'x'}]}, 'data[0].url') → 'x'
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const tokens: Array<string | number> = [];
  // 拆分点号 + 数组下标
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    if (m[2] != null) tokens.push(Number(m[2]));
    else if (m[1] != null) tokens.push(m[1]);
  }
  let cur: any = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = typeof t === 'number' ? cur[t] : cur[t];
  }
  return cur;
}

/** JSONPath 提取数组（用于 listModels 返回模型数组） */
export function getArrayByPath(obj: unknown, path: string): unknown[] {
  const v = getByPath(obj, path);
  return Array.isArray(v) ? v : [];
}

// ─── HTTP 调用 ────────────────────────────────────────
export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * 统一 fetch 调用（带超时、自动 API Key Bearer）。
 * baseUrl + path 拼接时去重末尾斜杠。
 */
export async function callEndpoint(
  baseUrl: string,
  endpoint: IEndpoint,
  apiKey: string,
  vars: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  const url = `${baseUrl.replace(/\/+$/, '')}${endpoint.path.startsWith('/') ? endpoint.path : '/' + endpoint.path}`;
  const method = endpoint.method || 'POST';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(endpoint.headers || {}),
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  let body: string | undefined;
  if (endpoint.bodyTemplate) {
    body = fillTemplate(endpoint.bodyTemplate, { ...vars, apiKey });
  } else if (method !== 'GET' && method !== 'DELETE') {
    body = JSON.stringify(vars);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch {}
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

// ─── 端点解析（模型覆盖 > 服务商默认 > OpenAI 兼容默认） ───
export function resolveEndpoint(
  provider: IModelProvider,
  model: IAiModel,
  kind: 'listModels' | 'generate' | 'poll',
): { protocol: 'openai-compatible' | 'custom'; endpoint: IEndpoint | undefined } {
  const m = model.endpoint?.[kind];
  if (m) return { protocol: model.endpoint!.protocol, endpoint: m };
  const p = provider.defaultEndpoint?.[kind];
  if (p) return { protocol: provider.defaultEndpoint!.protocol, endpoint: p };
  // 默认：openai-compatible 协议，返回 undefined 表示用内置默认结构
  return { protocol: provider.protocol || 'openai-compatible', endpoint: undefined };
}

// ─── 图片生成 ─────────────────────────────────────────
export interface GenerateImageInput {
  provider: IModelProvider;
  model: IAiModel;
  prompt: string;
  ratio: string;
  resolution: Resolution;
  count: number;
  referenceImages?: string[]; // 图生图（base64 / URL）
}

export interface GenerateImageResult {
  images: string[]; // URL 或 base64 dataURL
  raw: unknown;
  status: 'success' | 'error';
  error?: string;
}

const RATIO_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '1:2': '1024x2048',
  '2:1': '2048x1024',
  '9:16': '1024x1792',
  '16:9': '1792x1024',
  '3:4': '896x1280',
  '4:3': '1024x768',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '5:4': '1280x1024',
  '4:5': '1024x1280',
  '21:9': '2520x1080',
  '9:21': '1080x2520',
  // 'auto' 走默认 1024x1024（fallback 已处理）
};
const RES_MULTIPLIER: Record<Resolution, number> = { '1k': 1, '2k': 2, '4k': 4, '8k': 8 };

function bumpSizeByResolution(size: string, res: Resolution): string {
  const mul = RES_MULTIPLIER[res] || 1;
  if (mul === 1) return size;
  const [w, h] = size.split('x').map(Number);
  return `${w * mul}x${h * mul}`;
}

export const imageClient = {
  async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
    const { provider, model, prompt, ratio, resolution, count, referenceImages } = input;
    if (!provider.apiKey) return { images: [], raw: null, status: 'error', error: '服务商未配置 API Key' };

    const size = bumpSizeByResolution(RATIO_TO_SIZE[ratio] || '1024x1024', resolution);
    const vars = {
      model: model.modelId,
      prompt,
      n: Math.max(1, Math.min(4, count)),
      size,
      ratio,
      resolution,
      images: referenceImages || [],
    };

    const { protocol, endpoint } = resolveEndpoint(provider, model, 'generate');

    try {
      if (protocol === 'custom' && endpoint) {
        const { status, body } = await callEndpoint(provider.baseUrl, endpoint, provider.apiKey, vars);
        if (status >= 400) return makeErrorResult(body, status, '图片生成失败', { images: [] });
        const imgs = extractImages(body, endpoint);
        return imgs.length > 0
          ? { images: imgs, raw: body, status: 'success' }
          : { images: [], raw: body, status: 'error', error: '响应中未找到图片字段' };
      }
      // OpenAI 兼容默认
      const apiUrl = `${provider.baseUrl.replace(/\/$/, '')}/images/generations`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify(vars),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) return makeErrorResult(data, response.status, '图片生成失败', { images: [] });
      const imgs = extractImages(data, undefined);
      return imgs.length > 0
        ? { images: imgs, raw: data, status: 'success' }
        : { images: [], raw: data, status: 'error', error: '响应中未找到图片数据' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { images: [], raw: null, status: 'error', error: `网络错误：${msg.slice(0, 120)}` };
    }
  },
};

// ─── 视频生成（异步 submit+poll 模式） ─────────────────
export interface GenerateVideoInput {
  provider: IModelProvider;
  model: IAiModel;
  prompt: string;
  ratio: string;
  durationSec?: number;
  referenceImages?: string[]; // 视频首帧
}

export interface GenerateVideoResult {
  videoUrl: string;
  raw: unknown;
  status: 'success' | 'error';
  error?: string;
}

export const videoClient = {
  async generate(input: GenerateVideoInput): Promise<GenerateVideoResult> {
    const { provider, model, prompt, ratio, durationSec, referenceImages } = input;
    if (!provider.apiKey) return { videoUrl: '', raw: null, status: 'error', error: '服务商未配置 API Key' };

    const vars = {
      model: model.modelId,
      prompt,
      ratio,
      duration: durationSec || 6,
      firstFrame: referenceImages?.[0] || '',
      images: referenceImages || [],
    };

    const { protocol, endpoint } = resolveEndpoint(provider, model, 'generate');
    const isAsync = provider.defaultEndpoint?.async || model.endpoint?.async || protocol === 'custom';

    try {
      if (isAsync && endpoint) {
        // 1. submit
        const { status, body } = await callEndpoint(provider.baseUrl, endpoint, provider.apiKey, vars);
        if (status >= 400) return makeErrorResult(body, status, '视频任务提交失败', { videoUrl: '' });
        const taskId = String(getByPath(body, endpoint.taskIdPath || 'data.task_id') ?? '');
        if (!taskId) return { videoUrl: '', raw: body, status: 'error', error: '未返回任务 ID（taskIdPath 配置？）' };
        // 2. poll（轮询直到成功/失败）
        const pollEndpoint = resolveEndpoint(provider, model, 'poll').endpoint;
        if (!pollEndpoint) return { videoUrl: '', raw: body, status: 'error', error: '未配置 poll 端点（异步任务需配置轮询）' };
        const deadline = Date.now() + 90 * 60 * 1000; // 防僵尸安全线 90 分钟；超时只标 timeout，成败听生成端回复
        while (Date.now() < deadline) {
          await sleep(3000);
          const r = await callEndpoint(provider.baseUrl, pollEndpoint, provider.apiKey, { task_id: taskId, ...vars });
          const statusVal = String(getByPath(r.body, pollEndpoint.taskStatusPath || 'data.status') ?? '').toLowerCase();
          const successVals = (pollEndpoint.taskSuccessValues || ['succeeded', 'success', 'done', 'completed']).map((s) => s.toLowerCase());
          if (successVals.includes(statusVal)) {
            const url = String(getByPath(r.body, pollEndpoint.taskResultPath || 'data.video_url') ?? '');
            return url ? { videoUrl: url, raw: r.body, status: 'success' } : { videoUrl: '', raw: r.body, status: 'error', error: '任务成功但未返回视频 URL（taskResultPath？）' };
          }
          if (statusVal === 'failed' || statusVal === 'error' || statusVal === 'canceled') {
            return makeErrorResult(r.body, 200, '视频生成失败', { videoUrl: '' });
          }
        }
        // 超时只标 timeout（非 error）：成败只能听生成端回复，时间不判失败。
        return { videoUrl: '', raw: null, status: 'timeout', error: '等待生成端回复超过安全线（90分钟），任务保留待复核' };
      }
      // 同步模式（理论上视频很少用，保留兼容）
      const { status, body } = await callEndpoint(provider.baseUrl, endpoint!, provider.apiKey, vars);
      if (status >= 400) return makeErrorResult(body, status, '视频生成失败', { videoUrl: '' });
      const url = String(getByPath(body, endpoint?.videoFieldPath || 'data.video_url') ?? '');
      return url ? { videoUrl: url, raw: body, status: 'success' } : { videoUrl: '', raw: body, status: 'error', error: '响应中未找到视频 URL' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { videoUrl: '', raw: null, status: 'error', error: `网络错误：${msg.slice(0, 120)}` };
    }
  },
};

// ─── 文本推理 ─────────────────────────────────────────
export interface GenerateTextInput {
  provider: IModelProvider;
  model: IAiModel;
  prompt: string;
  systemPrompt?: string;
  images?: string[]; // 多模态视觉输入
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateTextResult {
  text: string;
  raw: unknown;
  status: 'success' | 'error';
  error?: string;
}

export const textClient = {
  async generate(input: GenerateTextInput): Promise<GenerateTextResult> {
    const { provider, model, prompt, systemPrompt, images, temperature, maxTokens } = input;
    if (!provider.apiKey) return { text: '', raw: null, status: 'error', error: '服务商未配置 API Key' };

    const vars = {
      model: model.modelId,
      prompt,
      system: systemPrompt || '',
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens || 2048,
      images: images || [],
    };

    const { protocol, endpoint } = resolveEndpoint(provider, model, 'generate');

    try {
      if (protocol === 'custom' && endpoint) {
        const { status, body } = await callEndpoint(provider.baseUrl, endpoint, provider.apiKey, vars);
        if (status >= 400) return makeErrorResult(body, status, '文本生成失败', { text: '' });
        const text = String(getByPath(body, endpoint.textFieldPath || 'choices.0.message.content') ?? '').trim();
        return text
          ? { text, raw: body, status: 'success' }
          : { text: '', raw: body, status: 'error', error: '响应中未找到文本字段（textFieldPath？）' };
      }
      // OpenAI 兼容默认（chat/completions）
      const apiUrl = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const messages: any[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      if (images && images.length > 0 && model.capabilities?.vision) {
        // 多模态：把图片作为 content 数组传入
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        });
      } else {
        messages.push({ role: 'user', content: prompt });
      }
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ model: model.modelId, messages, temperature: vars.temperature, max_tokens: vars.max_tokens }),
      });
      const data = await response.json();
      if (!response.ok) return makeErrorResult(data, response.status, '文本生成失败', { text: '' });
      const text = data?.choices?.[0]?.message?.content ?? '';
      return text ? { text, raw: data, status: 'success' } : { text: '', raw: data, status: 'error', error: '响应中无文本' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { text: '', raw: null, status: 'error', error: `网络错误：${msg.slice(0, 120)}` };
    }
  },
};

// ─── 获取模型列表 ─────────────────────────────────────
export interface ListModelsInput {
  provider: IModelProvider;
}

export interface ListModelsResult {
  models: Array<{ id: string; name?: string }>;
  raw: unknown;
  status: 'success' | 'error';
  error?: string;
}

export const modelListClient = {
  async list(input: ListModelsInput): Promise<ListModelsResult> {
    const { provider } = input;
    if (!provider.apiKey) return { models: [], raw: null, status: 'error', error: '服务商未配置 API Key' };

    // 注：listModels 端点是按服务商配置（不分模型），用 provider 的 defaultEndpoint.listModels
    const endpoint = provider.defaultEndpoint?.listModels;
    const protocol = provider.defaultEndpoint?.protocol || provider.protocol || 'openai-compatible';

    try {
      if (endpoint) {
        const { status, body } = await callEndpoint(provider.baseUrl, endpoint, provider.apiKey);
        if (status >= 400) return makeErrorResult(body, status, '获取模型列表失败', { models: [] });
        const arr = getArrayByPath(body, endpoint.listFieldPath || 'data');
        const models = arr.map((m: any) => ({
          id: String(getByPath(m, endpoint.listIdFieldPath || 'id') ?? ''),
          name: String(getByPath(m, endpoint.listNameFieldPath || 'name') ?? ''),
        })).filter((m) => m.id);
        return { models, raw: body, status: 'success' };
      }
      // OpenAI 兼容默认
      const apiUrl = `${provider.baseUrl.replace(/\/$/, '')}/models`;
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${provider.apiKey}` },
      });
      const data = await response.json();
      if (!response.ok) return makeErrorResult(data, response.status, '获取模型列表失败', { models: [] });
      const arr = Array.isArray(data?.data) ? data.data : [];
      const models = arr.map((m: any) => ({ id: String(m.id ?? ''), name: String(m.id ?? '') })).filter((m) => m.id);
      return { models, raw: data, status: 'success' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { models: [], raw: null, status: 'error', error: `网络错误：${msg.slice(0, 120)}` };
    }
  },
};

// ─── 内部 helpers ─────────────────────────────────────
function extractImages(body: unknown, endpoint: IEndpoint | undefined): string[] {
  if (!body) return [];
  if (endpoint?.imageFieldPath) {
    const v = getByPath(body, endpoint.imageFieldPath);
    return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  }
  // OpenAI 默认：data: [{ url: '...' }]
  if (Array.isArray((body as any)?.data)) {
    return (body as any).data.map((d: any) => d?.url || d?.b64_json || '').filter(Boolean);
  }
  return [];
}

function makeErrorResult<T extends Record<string, unknown>>(body: unknown, status: number, fallback: string, extra: T) {
  const errMsg =
    (body as any)?.error?.message ||
    (body as any)?.message ||
    (typeof body === 'string' ? body.slice(0, 200) : '') ||
    `HTTP ${status}`;
  return { raw: body, status: 'error' as const, error: `${fallback}：${errMsg}`, ...extra };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }