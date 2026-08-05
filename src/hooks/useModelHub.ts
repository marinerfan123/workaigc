import { useCallback, useSyncExternalStore } from 'react';
import {
  IModelProvider,
  IAiModel,
  MOCK_PROVIDERS,
  MOCK_MODELS,
  type ModelType,
  getEffectiveModelName,
} from '@/data/models';
import { apiGetProviders, apiGetModels, apiSaveProviders, apiSaveModels, apiDeleteProvider, apiDeleteModel, apiPatchModel, ensureApi } from '@/services/api';

// 模块级共享状态（仅内存，持久化全部走后端 API）
let providersState: IModelProvider[] = [];
let modelsState: IAiModel[] = [];
const listeners = new Set<() => void>();
let initialized = false;

function notify() {
  listeners.forEach((l) => l());
}

async function initData() {
  if (initialized) return;
  initialized = true;

  const ok = await ensureApi();
  if (ok) {
    try {
      const [apiP, apiM] = await Promise.all([apiGetProviders(), apiGetModels()]);
      // 后端为空时用 MOCK 初始化并写回后端，保证所有设备看到同一份数据
      providersState = apiP.length > 0 ? apiP : [...MOCK_PROVIDERS];
      modelsState = apiM.length > 0 ? apiM : [...MOCK_MODELS];
      if (apiP.length === 0) apiSaveProviders(providersState);
      if (apiM.length === 0) apiSaveModels(modelsState);
    } catch {
      providersState = [...MOCK_PROVIDERS];
      modelsState = [...MOCK_MODELS];
    }
  } else {
    // 后端不可用：仅内存 MOCK，不落盘
    providersState = [...MOCK_PROVIDERS];
    modelsState = [...MOCK_MODELS];
  }
  notify();
}

// 模块加载时启动异步初始化
initData();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getProvidersSnapshot(): IModelProvider[] {
  return providersState;
}

function getModelsSnapshot(): IAiModel[] {
  return modelsState;
}

function setProviders(updater: (prev: IModelProvider[]) => IModelProvider[]) {
  providersState = updater(providersState);
  apiSaveProviders(providersState); // 同步后端（upsert 新增/更新）
  notify();
}

function setModels(updater: (prev: IAiModel[]) => IAiModel[]) {
  modelsState = updater(modelsState);
  apiSaveModels(modelsState); // 同步后端（upsert 新增/更新）
  notify();
}

/**
 * 单条删除 provider —— 必须走 DELETE 接口，不能只靠 setProviders+filter，
 * 因为后端 POST /api/providers 是 upsert 语义，filter 后的列表无法删除
 * 后端有但前端未传的项（用户报告"删了过一会儿又回来"就是这个 bug）。
 */
function deleteProvider(id: string) {
  providersState = providersState.filter((p) => p.id !== id);
  modelsState = modelsState.filter((m) => m.providerId !== id);
  apiDeleteProvider(id); // 走单条 DELETE，后端直接 filter 写回
  apiSaveProviders(providersState); // 兜底：让内存状态完全一致
  apiSaveModels(modelsState);
  notify();
}

/**
 * 单条删除模型（用于清理孤儿模型：providerId 指向已删除的 provider）
 */
function deleteModel(id: string) {
  modelsState = modelsState.filter((m) => m.id !== id);
  apiDeleteModel(id);
  apiSaveModels(modelsState);
  notify();
}

/**
 * 批量清理孤儿模型（providerId 不在 providers 列表里）
 * @returns 清理的数量
 */
function cleanupOrphanModels(): number {
  const validProviderIds = new Set(providersState.map((p) => p.id));
  const orphans = modelsState.filter((m) => !validProviderIds.has(m.providerId));
  if (orphans.length === 0) return 0;
  modelsState = modelsState.filter((m) => validProviderIds.has(m.providerId));
  // 后端逐条 DELETE + 兜底 save
  orphans.forEach((m) => apiDeleteModel(m.id));
  apiSaveModels(modelsState);
  notify();
  return orphans.length;
}

/**
 * 单模型局部更新（管理员）：乐观更新本地状态 + 调 PATCH 仅写变更列；
 * 失败自动回滚本地状态。用于「管理模型」抽屉里的显隐/价格/并发/耗时等字段级编辑。
 */
async function patchModel(id: string, patch: Record<string, any>) {
  const prev = modelsState.find((m) => m.id === id);
  if (!prev) return;
  const backup = { ...prev };
  modelsState = modelsState.map((m) => (m.id === id ? { ...m, ...patch } : m));
  notify();
  try {
    const r = await apiPatchModel(id, patch);
    if (!r || r.ok === false) throw new Error((r && r.error) || '更新失败');
  } catch (e) {
    modelsState = modelsState.map((m) => (m.id === id ? backup : m));
    notify();
    throw e;
  }
}

export function useModelHub() {
  const providers = useSyncExternalStore(subscribe, getProvidersSnapshot, getProvidersSnapshot);
  const models = useSyncExternalStore(subscribe, getModelsSnapshot, getModelsSnapshot);

  const getProviderName = useCallback((id: string) => {
    return providersState.find((p) => p.id === id)?.name || '未知';
  }, []);

  const getModelsByType = useCallback((type: ModelType) => {
    return modelsState.filter((m) => {
      const p = providersState.find((x) => x.id === m.providerId);
      return p && p.enabled && m.enabled && m.type === type && p.id !== 'p0';
    });
  }, []);

  const getDefaultModel = useCallback((type: ModelType) => {
    const ms = modelsState.filter((m) => {
      const p = providersState.find((x) => x.id === m.providerId);
      return p && p.enabled && m.enabled && m.type === type && p.id !== 'p0';
    });
    return ms[0]?.displayName || '';
  }, []);

  return {
    providers,
    models,
    setProviders,
    setModels,
    patchModel,
    deleteProvider,
    deleteModel,
    cleanupOrphanModels,
    getProviderName,
    getModelsByType,
    getDefaultModel,
  };
}

/**
 * 非 hook 查询：按 displayName（dispatch 存储键）找到模型行，
 * 返回其对外映射名（mappingName || displayName）。
 * 供 DetailPanel / ImageViewer 等不直接持有 models 的组件取「当前展示名」，
 * 避免重复订阅。模块级 modelsState 始终是最新值。
 */
export function getModelDisplayNameByDisplayName(displayName: string): string {
  if (!displayName) return '';
  const m = modelsState.find((x) => x.displayName === displayName);
  return getEffectiveModelName(m);
}

/**
 * 非 hook 查询：按 displayName 找到模型行，返回其单次生成消耗的积分数。
 * 找不到或未设置时返回 0。
 */
export function getModelCreditCostByDisplayName(displayName: string): number {
  if (!displayName) return 0;
  const m = modelsState.find((x) => x.displayName === displayName);
  return typeof m?.creditCost === 'number' ? m.creditCost : 0;
}
