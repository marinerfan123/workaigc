'use strict';
// 视频 provider 路由：把 (provider, model) 映射到具体适配器。
// 解析优先级：
//   1. 显式声明：model.endpoint.videoAdapter 或 provider.default_endpoint.videoAdapter（值 'agnes'|'minimax'|'volcano'）
//   2. base_url 正则推断：agnes-ai.cn → agnes；minimax → minimax；volces/ark.cn-beijing/volcano → volcano
//   3. 兜底 'generic'（dispatcher 内联处理 openai-compatible / custom bodyTemplate 视频端点）
const agnes = require('./agnes.cjs');
const minimax = require('./minimax.cjs');
const volcano = require('./volcano.cjs');

const adapters = { agnes, minimax, volcano };

function resolveKey(provider, model) {
  const me = (model && model.endpoint) || {};
  const pe = (provider && (provider.default_endpoint || provider.defaultEndpoint)) || {};
  const v = me.videoAdapter || pe.videoAdapter;
  if (v && adapters[v]) return v;
  const base = (provider && provider.base_url) || '';
  if (/agnes-ai\.cn/i.test(base)) return 'agnes';
  if (/minimax/i.test(base)) return 'minimax';
  if (/volces|ark\.cn-beijing|volcano/i.test(base)) return 'volcano';
  return 'generic';
}

async function submitAndPoll(provider, model, opts) {
  const key = resolveKey(provider, model);
  const ad = adapters[key];
  if (!ad) return { videoUrl: '', status: 'error', error: `未找到视频适配器：${key}` };
  return ad.submitAndPoll(provider, model, opts);
}

module.exports = { adapters, resolveKey, submitAndPoll };
