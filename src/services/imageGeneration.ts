// 图片生成 API 服务层 —— 委托给 genericClient.imageClient
// 老 API 保留（向后兼容）。新代码建议直接用 '@/services/genericClient' 的 imageClient。

const logger = { info: console.log, warn: console.warn, error: console.error };
import type { IModelProvider, IAiModel, Resolution } from '@/data/models';
import { imageClient } from './genericClient';

export interface GenerateResult {
  images: string[];
  status: 'success' | 'failed' | 'mock';
  error?: string;
  /** 生成来源：provider（服务商API）| mock（本地降级）| platform（平台能力） */
  source: 'provider' | 'mock' | 'platform';
}

/**
 * 通过后台配置的服务商 API 生成图片（老 API，向后兼容）
 * @param modelDisplayName 用户选择的模型显示名（如 "DALL·E 3"）
 * @param prompt 生成提示词
 * @param ratio 画面比例
 * @param count 生成数量
 * @param providers 服务商列表
 * @param models 模型列表
 * @param resolution 分辨率（'1k' | '2k' | '4k' | '8k'，默认 '1k'）
 */
export async function generateImageViaProvider(
  modelDisplayName: string,
  prompt: string,
  ratio: string,
  count: number,
  providers: IModelProvider[],
  models: IAiModel[],
  resolution: Resolution | string = '1k',
): Promise<GenerateResult> {
  // 1. 查找模型
  const model = models.find(
    (m) => m.displayName === modelDisplayName && m.type === 'image',
  );
  if (!model) {
    return {
      images: [],
      status: 'failed',
      source: 'mock',
      error: `未在模型列表中找到模型: ${modelDisplayName}，请检查 ModelHub 配置`,
    };
  }

  // 2. 查找服务商
  const provider = providers.find((p) => p.id === model.providerId);
  if (!provider) {
    return {
      images: [],
      status: 'failed',
      source: 'mock',
      error: `模型 "${modelDisplayName}" 所属服务商未找到，请重新配置`,
    };
  }

  // 3. 校验服务商
  if (!provider.enabled) {
    return {
      images: [],
      status: 'failed',
      source: 'mock',
      error: `服务商 "${provider.name}" 已被禁用，请先启用`,
    };
  }

  // 4. 内置模型（p0）没有真实 API 端点 → 强制降级
  if (provider.id === 'p0') {
    logger.warn('内置模型不可用于实际 API 生成，降级到 mock');
    return {
      images: [],
      status: 'failed',
      source: 'mock',
      error: '内置模型不支持 API 生成，请在 ModelHub 配置真实服务商',
    };
  }

  // 5. 校验 API 凭据
  if (!provider.apiKey || provider.apiKey.includes('*')) {
    return {
      images: [],
      status: 'failed',
      source: 'mock',
      error: `服务商 "${provider.name}" 未配置有效 API Key，请在 ModelHub 中设置`,
    };
  }

  logger.info(
    `[generateImageViaProvider] 委托给 imageClient: ${provider.name}/${model.modelId}，protocol=${provider.protocol || 'openai-compatible'}`,
  );

  // 6. 委托给通用 client
  const result = await imageClient.generate({
    provider,
    model,
    prompt,
    ratio,
    resolution: resolution as Resolution,
    count,
  });

  if (result.status === 'success') {
    logger.info(`[generateImageViaProvider] 成功：${result.images.length} 张图片`);
    return { images: result.images, status: 'success', source: 'provider' };
  }
  return { images: [], status: 'failed', source: 'mock', error: result.error };
}