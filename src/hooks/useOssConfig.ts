import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  type IOssConfig,
  DEFAULT_OSS_CONFIG,
  DEFAULT_OSS_SLOT,
} from '@/data/oss';
import {
  apiGetOss, apiSetOssEnabled, apiCreateOssSlot, apiUpdateOssSlot,
  apiDeleteOssSlot, apiActivateOssSlot, apiTestOssSlot, apiTestOss,
  apiUploadToOss, ensureApi,
} from '@/services/api';

// ─── 多槽位 OSS 共享状态（仅内存，持久化全部走后端 API） ────────────

interface IOssState {
  enabled: boolean;
  activeId: string;
  configs: IOssConfig[];
}

let state: IOssState = { enabled: true, activeId: '', configs: [DEFAULT_OSS_CONFIG] };
const listeners = new Set<() => void>();
let initialized = false;

function notify() { listeners.forEach((l) => l()); }

function patch(updater: (s: IOssState) => IOssState) {
  state = updater(state);
  notify();
}

async function refresh() {
  const r = await apiGetOss();
  state = {
    enabled: !!r.enabled,
    activeId: r.activeId || '',
    configs: Array.isArray(r.configs) && r.configs.length > 0 ? r.configs : (r.active ? [r.active] : []),
  };
  notify();
}

async function initConfig() {
  if (initialized) return;
  initialized = true;
  const ok = await ensureApi();
  if (ok) {
    try { await refresh(); }
    catch { /* leave defaults */ }
  }
}
initConfig();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
function getSnapshot() { return state; }

export function useOssConfig() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const active = useMemo(() => s.configs.find(c => c.id === s.activeId) || null, [s]);

  /** 总开关 */
  const setEnabled = useCallback(async (enabled: boolean) => {
    patch(prev => ({ ...prev, enabled }));
    await apiSetOssEnabled(enabled);
  }, []);

  /** 主动 reload */
  const reload = useCallback(async () => { await refresh(); }, []);

  /** 创建槽位（POST） */
  const createSlot = useCallback(async (slot: Partial<IOssConfig>): Promise<IOssConfig | null> => {
    const r = await apiCreateOssSlot(slot);
    if (r && r.ok) {
      await refresh();
      return r;
    }
    return null;
  }, []);

  /** 更新槽位（PUT） */
  const updateSlot = useCallback(async (id: string, slot: Partial<IOssConfig>): Promise<boolean> => {
    const r = await apiUpdateOssSlot(id, slot);
    if (r && r.ok) {
      patch(prev => ({
        ...prev,
        configs: prev.configs.map(c => (c.id === id ? { ...c, ...slot, id } as IOssConfig : c)),
      }));
      // 后端字段可能规范化（trim 等），拉一次最新
      await refresh();
      return true;
    }
    return false;
  }, []);

  /** 删除槽位 */
  const deleteSlot = useCallback(async (id: string): Promise<boolean> => {
    const r = await apiDeleteOssSlot(id);
    if (r && r.ok) {
      patch(prev => ({
        ...prev,
        activeId: prev.activeId === id ? '' : prev.activeId,
        configs: prev.configs.filter(c => c.id !== id),
      }));
      await refresh();
      return true;
    }
    return false;
  }, []);

  /** 设为 active */
  const activateSlot = useCallback(async (id: string): Promise<boolean> => {
    const r = await apiActivateOssSlot(id);
    if (r && r.ok) {
      patch(prev => ({ ...prev, activeId: id }));
      await refresh();
      return true;
    }
    return false;
  }, []);

  /** 测试指定槽位（真探活） */
  const testSlot = useCallback(async (id: string) => apiTestOssSlot(id), []);

  /** 测试给定 cfg（保存前即时校验；老风格兼容） */
  const testConfig = useCallback((cfg: Partial<IOssConfig>) => apiTestOss(cfg as any), []);

  /**
   * 把 active 配置拼接给前端展示用的 URL（仅 build，并不访问）
   * 实际访问全部走后端 `/api/oss/upload` 拿到的 signedUrl，无需前端拼。
   */
  const buildOssUrl = useCallback((objectKey: string): string => {
    const cfg = active;
    if (!cfg) return '';
    const domain = cfg.customDomain || cfg.endpointExternal;
    const prefix = cfg.pathPrefix || '';
    const key = objectKey.startsWith('/') ? objectKey.slice(1) : objectKey;
    return `https://${domain}/${prefix}${key}`;
  }, [active]);

  /**
   * 上传文件到 active OSS
   */
  const uploadFile = useCallback(
    async (
      file: File | Blob,
      fileName: string,
    ): Promise<{ success: boolean; url: string; objectKey: string; providerType?: string }> => {
      if (!s.enabled || !active) {
        return { success: false, url: '', objectKey: '' };
      }
      if (!active.accessKeyId || !active.accessKeySecret) {
        return { success: false, url: '', objectKey: '' };
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const idx = result.indexOf(',');
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const prefix = active.pathPrefix || 'images/';
      const fileNameOnly = fileName.includes('/') ? fileName.split('/').pop()! : fileName;
      const objectKey = `${prefix}${Date.now()}_${fileNameOnly}`;
      const result = await apiUploadToOss(objectKey, base64);
      if (result.success) {
        return { success: true, url: result.url, objectKey: result.objectKey, providerType: result.providerType };
      }
      return { success: false, url: '', objectKey, providerType: result.providerType };
    },
    [s.enabled, active],
  );

  // 向后兼容：旧代码用 `const { config } = useOssConfig()` 拿单配置视图
  // 这里把 active 槽位展开并强制 enabled=全局总开关，保证 ossConfig.enabled 这种用法不炸
  const config = useMemo(
    () => ({ ...(active || DEFAULT_OSS_SLOT), enabled: s.enabled }),
    [active, s.enabled],
  );

  return {
    // state
    enabled: s.enabled,
    activeId: s.activeId,
    active,
    configs: s.configs,
    config, // legacy alias for GenerationBar / DetailPanel / WorkspacePage
    // actions
    setEnabled,
    reload,
    createSlot,
    updateSlot,
    deleteSlot,
    activateSlot,
    testSlot,
    testConfig,
    buildOssUrl,
    uploadFile,
  };
}
