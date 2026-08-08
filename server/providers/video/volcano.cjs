'use strict';
// 火山方舟 Seedance 视频适配器（doubao-seedance-*）
// 提交：POST {base}/contents/generations/tasks  Bearer ARK_API_KEY
// 轮询：GET  {base}/contents/generations/tasks/{id}
// 说明：provider.base_url 应配置为 https://ark.cn-beijing.volces.com/api/v3 （含 /api/v3）
// 字段要点：
//   content[] 数组，text 用 { type:'text', text:prompt }
//   image 用 { type:'image_url', role, image_url:{ url } }（url 嵌套），role ∈ first_frame/last_frame/reference_image
//   顶层 resolution ∈ {480p,720p,1080p,4k}、ratio、duration、seed、camera_fixed、watermark 等可选
//   结果在 video_url（成功态）
const { buildVideoContent, deriveVideoMode, normalizeVideoStatus, pollLoop, makeError, fetchJson } = require('./shared.cjs');

// Volcano 真实分辨率枚举；传入已是枚举则透传，否则把抽象档位映射过去
const VOLCANO_RES = ['480p', '720p', '1080p', '4k'];
function toVolcanoResolution(res) {
  if (VOLCANO_RES.includes(res)) return res;
  const map = { '1k': '480p', '2k': '720p', '3k': '1080p', '4k': '4k', '8k': '4k' };
  return map[String(res || '1k').toLowerCase()] || '720p';
}

async function submitAndPoll(provider, model, opts) {
  const apiKey = provider.api_key;
  if (!apiKey) return { videoUrl: '', status: 'error', error: '服务商未配置 API Key' };

  const prompt = opts.prompt || '';
  const refs = opts.referenceImages || [];
  const mode = opts.videoMode || deriveVideoMode(refs);
  const content = buildVideoContent(refs, mode, prompt, 'volcano');

  let ratio = opts.ratio || '16:9';
  if (mode !== 't2v') ratio = 'adaptive';

  const resolution = toVolcanoResolution(opts.resolution);
  const duration = Math.round(Number(opts.durationSec) || 5);

  const body = {
    model: model.model_id,
    content,
    resolution,
    ratio,
    duration,
  };
  // 可选增强参数：seed / camera_fixed / watermark / generate_audio / frames / priority
  // 当前仅透传模型已配置在 endpoint 里的扩展（保持薄适配）；如需开放，由后台 param_template 控制。

  const base = (provider.base_url || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  const submitRes = await fetchJson(`${base}/contents/generations/tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  if (submitRes.status >= 400) return makeError(submitRes.body, submitRes.status, '视频任务提交失败');

  // 返回结构：{ id, ... } 或 { data:{ id } } 或错误体 { error:{ code, message } }
  const b = submitRes.body || {};
  const taskId = String(b.id || (b.data && b.data.id) || '').trim();
  if (!taskId) {
    const errMsg = (b.error && (b.error.message || b.error.msg)) || (b.message) || JSON.stringify(b).slice(0, 140);
    return { videoUrl: '', status: 'error', error: `未返回任务 ID：${errMsg}` };
  }

  const pollUrl = `${base}/contents/generations/tasks/${taskId}`;
  return pollLoop({
    intervalMs: 5000,
    timeoutMs: 5 * 60 * 1000,
    pollFn: async () => {
      const r = await fetchJson(pollUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } });
      const root = r.body || {};
      const obj = (root.data && typeof root.data === 'object') ? root.data : root;
      const st = normalizeVideoStatus(obj.status || root.status, 'volcano');
      if (st === 'success') {
        const url = String(obj.video_url || root.video_url || '');
        return url ? { videoUrl: url, status: 'success' } : { videoUrl: '', status: 'error', error: '任务成功但未返回 video_url' };
      }
      if (st === 'failed') return { videoUrl: '', status: 'error', error: `视频生成失败：${JSON.stringify(obj).slice(0, 160)}` };
      return { videoUrl: '', status: 'pending' };
    },
  });
}

module.exports = { submitAndPoll };
