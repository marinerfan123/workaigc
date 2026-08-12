// 生成任务实时流（SSE）—— 主流异步生成做法：服务端任务终态切换即推，替代前端固定 2s 轮询。
//
// 关键设计：内置轮询兜底。
//   生成「完成判定」是核心关键路径，绝不可因 SSE 异常（浏览器不支持 / 代理掐断 / 事件丢失）而丢失。
//   因此 waitForTask 在监听 SSE 事件的同时，每 3s 主动 query 一次状态接口；二者任一命中终态即 resolve。
//   这既拿到「SSE 近实时完成通知」的主流体验，又对 SSE 故障零信任依赖。
import { apiGetGenerationStatus } from '../services/api';

export type TaskUpdate = {
  taskId: string;
  status: 'running' | 'waiting' | 'done' | 'failed' | 'cancelled' | 'not_found' | 'unknown';
  result?: { images?: string[]; source?: string; usedProviders?: string[]; videoUrl?: string } | null;
  error?: string;
  pendingIds?: string[];
  model?: string;
  prompt?: string;
  count?: number;
  contentType?: string;
  clientMeta?: Record<string, unknown>;
  createdAt?: string;
  completedAt?: string;
};

let es: EventSource | null = null;
let esDisabled = false; // SSE 彻底不可用（浏览器不支持 / 反复失败）时禁用，避免无谓重试
const listeners = new Map<string, Set<(u: TaskUpdate) => void>>();
const fallbacks = new Map<string, ReturnType<typeof setInterval>>();

function ensureConnection(): void {
  if (es || esDisabled || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  try {
    es = new EventSource('/api/generate/stream');
    es.onopen = () => {
      esDisabled = false;
    };
    es.onmessage = (ev: MessageEvent) => {
      try {
        const u = JSON.parse(ev.data) as TaskUpdate;
        const set = listeners.get(u.taskId);
        if (set) set.forEach((fn) => fn(u));
      } catch {
        /* 忽略非法帧 */
      }
    };
    es.onerror = () => {
      // EventSource 原生会自动重连；此处仅标记，极端情况下不再反复建连。
      es = null;
      esDisabled = true;
    };
  } catch {
    esDisabled = true;
  }
}

// 等待指定 taskId 到达终态（done / failed / cancelled / not_found）。
// - SSE 事件命中即立即 resolve（近实时）。
// - 内置 3s 轮询兜底：SSE 未连 / 丢事件也能拿到结果。
// - 超过 timeoutMs（对齐原 MAX_POLLS 上限：视频 ~95min、图片 ~3.5min）仍非终态 → resolve 当前状态，
//   由调用方保留 pending 显示（成败只听生成端回复，绝不误判失败）。
export function waitForTask(taskId: string, opts?: { timeoutMs?: number }): Promise<TaskUpdate> {
  const timeoutMs = opts?.timeoutMs ?? 95 * 60 * 1000;
  ensureConnection();
  const deadline = Date.now() + timeoutMs;
  return new Promise<TaskUpdate>((resolve) => {
    let settled = false;
    let last: TaskUpdate = { taskId, status: 'running' };
    const settle = (u: TaskUpdate) => {
      if (settled) return;
      settled = true;
      const set = listeners.get(taskId);
      if (set) {
        set.delete(onUpdate);
        if (set.size === 0) listeners.delete(taskId);
      }
      const fb = fallbacks.get(taskId);
      if (fb) {
        clearInterval(fb);
        fallbacks.delete(taskId);
      }
      resolve(u);
    };
    const onUpdate = (u: TaskUpdate) => {
      last = u;
      if (u.status === 'done' || u.status === 'failed' || u.status === 'cancelled' || u.status === 'not_found') settle(u);
    };
    if (!listeners.has(taskId)) listeners.set(taskId, new Set());
    listeners.get(taskId)!.add(onUpdate);
    const fb = window.setInterval(async () => {
      try {
        const st = await apiGetGenerationStatus(taskId);
        last = st as TaskUpdate;
        if (st.status === 'done' || st.status === 'failed' || st.status === 'cancelled' || st.status === 'not_found') settle(st as TaskUpdate);
        else if (Date.now() > deadline) settle(last);
      } catch {
        /* 忽略单次查询异常，下一轮再试 */
      }
    }, 3000);
    fallbacks.set(taskId, fb);
  });
}
