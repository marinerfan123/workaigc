'use strict';
// Agnes Video V2.0 适配器（从 dispatcher.videoGenerate 的 isAgnesVideo 分支抽离）
// 行为与原内联实现保持等价：num_frames/frame_rate 控制时长，height/width 控制分辨率，
// image+mode=ti2vid 做图生视频，extra_body.image+mode=keyframes 做关键帧动画。
//
// 端点策略（开箱即用，不再依赖脆弱的 endpoint 显式配置）：
//   - Agnes 本质上是异步任务：create(POST) + poll(GET)，因此一律按 async 处理。
//   - submit 端点：{base_url}/videos（base_url 缺省 https://api.agnes-ai.cn/v1）。
//   - poll   端点：{origin}/agnesapi?video_id=（origin 取 base_url 的协议+主机，去掉 /v1）。
//   - 若 model.endpoint.generate / model.endpoint.poll 已显式配置，则以其为准（覆盖默认）。
//   - 成功时视频地址在 metadata.url（旧版也可能落在根 url），两者都尝试读取。
const { callEndpoint, getByPath, agnesVideoSize, pollLoop, makeError } = require('./shared.cjs');

// 取 base_url 的协议+主机（去掉 /v1 等路径），用于 poll 端点
function agnesRootBase(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return u.origin;
  } catch {
    return 'https://api.agnes-ai.cn';
  }
}

// 解析/补全 Agnes 规范端点（create + poll），保证开箱即用
function resolveAgnesEndpoint(provider, model) {
  const me = (model && model.endpoint) || {};
  const baseUrl = (provider && provider.base_url) || 'https://api.agnes-ai.cn/v1';
  const rootBase = agnesRootBase(baseUrl);

  const submitEp = me.generate
    ? { baseUrl, method: 'POST', ...me.generate }
    : { baseUrl, path: '/videos', method: 'POST' };
  const taskIdPath = submitEp.taskIdPath || 'video_id';

  const pollEp = me.poll
    ? { baseUrl: me.poll.baseUrl || rootBase, method: 'GET', ...me.poll }
    : {
        baseUrl: rootBase,
        path: '/agnesapi',
        method: 'GET',
        taskQueryParam: 'video_id',
        taskResultPath: 'metadata.url',
        taskStatusPath: 'status',
        taskSuccessValues: ['completed'],
        taskPollIntervalMs: 8000,
      };

  return { submitEp, pollEp, taskIdPath, baseUrl };
}

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
  const { submitEp, pollEp, taskIdPath } = resolveAgnesEndpoint(provider, model);

  // 提交任务（create）
  let submitRes;
  try {
    submitRes = await callEndpoint(provider.base_url, submitEp, apiKey, vars);
  } catch (e) {
    return { videoUrl: '', status: 'error', error: `提交异常：${(e && e.message) || String(e)}`.slice(0, 160) };
  }
  const { status, body } = submitRes;
  if (status >= 400) return makeError(body, status, '视频任务提交失败');

  const taskId = String(getByPath(body, taskIdPath) ?? '').trim();
  if (!taskId) return { videoUrl: '', status: 'error', error: '未返回任务 ID（taskIdPath 配置？）' };

  // 轮询任务结果
  const pollQueryParam = pollEp.taskQueryParam || 'video_id';
  return pollLoop({
    intervalMs: pollEp.taskPollIntervalMs || 8000,
    timeoutMs: 5 * 60 * 1000,
    pollFn: async () => {
      const r = await callEndpoint(provider.base_url, pollEp, apiKey, { [pollQueryParam]: taskId });
      const st = String(getByPath(r.body, pollEp.taskStatusPath || 'status') ?? '').toLowerCase();
      const okVals = (pollEp.taskSuccessValues || ['completed']).map((s) => s.toLowerCase());
      if (okVals.includes(st)) {
        // 成功视频地址优先级：taskResultPath → metadata.url → 根 url（兼容旧版）
        let url = getByPath(r.body, pollEp.taskResultPath || 'metadata.url');
        if (!url) url = getByPath(r.body, 'metadata.url');
        if (!url) url = getByPath(r.body, 'url');
        return url
          ? { videoUrl: String(url), status: 'success' }
          : { videoUrl: '', status: 'error', error: '任务成功但未返回视频 URL（taskResultPath？）' };
      }
      if (st === 'failed' || st === 'error' || st === 'canceled' || st === 'cancelled') {
        return { videoUrl: '', status: 'error', error: `视频生成失败：${JSON.stringify(r.body).slice(0, 160)}` };
      }
      return { videoUrl: '', status: 'pending' };
    },
  });
}

module.exports = { submitAndPoll, resolveAgnesEndpoint, agnesRootBase };
