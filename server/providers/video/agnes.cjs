'use strict';
// Agnes Video V2.0 适配器（从 dispatcher.videoGenerate 的 isAgnesVideo 分支抽离）
// 行为与原内联实现保持等价：num_frames/frame_rate 控制时长，height/width 控制分辨率，
// image+mode=ti2vid 做图生视频，extra_body.image+mode=keyframes 做关键帧动画。
// submit/poll 端点来自 provider/model 的 endpoint 配置（custom async）。
const { callEndpoint, getByPath, resolveEndpoint, agnesVideoSize, pollLoop, makeError } = require('./shared.cjs');

// 构造 Agnes 视频提交体（与历史实现逐字段一致）
function buildAgnesVars(opts, model) {
  const { prompt, ratio, durationSec, referenceImages, negative, resolution } = opts;
  const hasImages = Array.isArray(referenceImages) && referenceImages.length > 0;
  const frameRate = 25;
  // num_frames 必须 ≤441 且 = 8n+1
  let numFrames = Math.round((Number(durationSec) || 6) * frameRate);
  numFrames = Math.min(441, Math.max(9, numFrames));
  numFrames = Math.floor((numFrames - 1) / 8) * 8 + 1;
  const { width, height } = agnesVideoSize(ratio, resolution);
  const vars = {
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
  return vars;
}

async function submitAndPoll(provider, model, opts) {
  const apiKey = provider.api_key;
  if (!apiKey) return { videoUrl: '', status: 'error', error: '服务商未配置 API Key' };

  const vars = buildAgnesVars(opts, model);
  const { protocol, endpoint } = resolveEndpoint(provider, model, 'generate');
  const isAsync = !!(provider.default_endpoint && provider.default_endpoint.async) ||
    !!(model.endpoint && model.endpoint.async) || protocol === 'custom';
  if (!isAsync || !endpoint) {
    return { videoUrl: '', status: 'error', error: 'Agnes 视频端点未配置（需 async generate+poll）' };
  }

  let submitRes;
  try {
    submitRes = await callEndpoint(provider.base_url, endpoint, apiKey, vars);
  } catch (e) {
    return { videoUrl: '', status: 'error', error: `提交异常：${(e && e.message) || String(e)}`.slice(0, 160) };
  }
  const { status, body } = submitRes;
  if (status >= 400) return makeError(body, status, '视频任务提交失败');

  const taskId = String(getByPath(body, (endpoint.taskIdPath) || 'data.task_id') ?? '');
  if (!taskId) return { videoUrl: '', status: 'error', error: '未返回任务 ID（taskIdPath 配置？）' };

  const pollResolved = resolveEndpoint(provider, model, 'poll');
  const pollEp = pollResolved.endpoint;
  if (!pollEp) return { videoUrl: '', status: 'error', error: '未配置 poll 端点（异步任务需轮询）' };
  // 轮询查询参数名可配置（Agnes 用 video_id，通用用 task_id）
  const pollQueryParam = (pollEp && pollEp.taskQueryParam) || 'task_id';

  return pollLoop({
    intervalMs: (pollEp && pollEp.taskPollIntervalMs) || 3000,
    timeoutMs: 5 * 60 * 1000,
    pollFn: async () => {
      const r = await callEndpoint(provider.base_url, pollEp, apiKey, { [pollQueryParam]: taskId });
      const st = String(getByPath(r.body, pollEp.taskStatusPath || 'data.status') ?? '').toLowerCase();
      const okVals = (pollEp.taskSuccessValues || ['succeeded', 'success', 'done', 'completed']).map((s) => s.toLowerCase());
      if (okVals.includes(st)) {
        const url = String(getByPath(r.body, pollEp.taskResultPath || 'data.video_url') ?? '');
        return url ? { videoUrl: url, status: 'success' } : { videoUrl: '', status: 'error', error: '任务成功但未返回视频 URL（taskResultPath？）' };
      }
      if (st === 'failed' || st === 'error' || st === 'canceled' || st === 'cancelled') {
        return { videoUrl: '', status: 'error', error: `视频生成失败：${JSON.stringify(r.body).slice(0, 160)}` };
      }
      return { videoUrl: '', status: 'pending' };
    },
  });
}

module.exports = { submitAndPoll };
