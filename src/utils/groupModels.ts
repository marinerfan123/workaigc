import { IAiModel, ModelType, Resolution } from '@/data/models';

/**
 * 按 model_id 聚合的模型组。
 *
 * 负载均衡场景：同一个 model_id 在多家供应商各建一行（相同 display_name），
 * 前端不应把多行渲染成「重名模型」，而是聚合成一个入口，背后关联 N 家供应商。
 * 后端 dispatcher 已按 display_name → model_id → 所有启用行 做 round-robin 分发。
 */
export interface GroupedModel {
  /** 聚合 key（接口模型 ID） */
  modelId: string;
  /** 展示名：取首个启用行的 displayName（编辑时整组同步） */
  displayName: string;
  type: ModelType;
  /** 任一启用行启用即视为可用 */
  enabled: boolean;
  /** 该 model_id 关联的所有 providerId（去重，保持出现顺序） */
  providerIds: string[];
  providerCount: number;
  /** 原始多行（供编辑/删除整组使用） */
  rows: IAiModel[];
  /** 合并去重后的支持分辨率 */
  supportedResolutions: Resolution[];
}

/**
 * 把扁平的模型行列表按 model_id 聚合。
 * - 相同 model_id 的多行合并为一个 GroupedModel
 * - displayName 取首个启用行（无启用行则取首行）
 * - enabled = 任一启用行启用
 * - rows 排序：启用的在前，便于 UI 取代表
 */
export function groupModelsByModelId(models: IAiModel[]): GroupedModel[] {
  const map = new Map<string, GroupedModel>();

  for (const m of models) {
    let g = map.get(m.modelId);
    if (!g) {
      g = {
        modelId: m.modelId,
        displayName: '',
        type: m.type,
        enabled: false,
        providerIds: [],
        providerCount: 0,
        rows: [],
        supportedResolutions: [],
      };
      map.set(m.modelId, g);
    }

    g.rows.push(m);
    if (m.enabled) g.enabled = true;

    if (!g.providerIds.includes(m.providerId)) {
      g.providerIds.push(m.providerId);
    }

    // displayName：优先首个启用行，其次任意行
    if (!g.displayName) g.displayName = m.displayName;
    if (m.enabled && g.rows.filter((r) => r.enabled).length === 1) {
      g.displayName = m.displayName;
    }

    if (m.supportedResolutions) {
      for (const r of m.supportedResolutions) {
        if (!g.supportedResolutions.includes(r)) g.supportedResolutions.push(r);
      }
    }
  }

  const result: GroupedModel[] = [];
  for (const g of map.values()) {
    if (!g.displayName && g.rows[0]) g.displayName = g.rows[0].displayName;
    g.providerCount = g.providerIds.length;
    // 启用的行排前面，便于取代表
    g.rows.sort((a, b) => (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1));
    result.push(g);
  }

  return result;
}
