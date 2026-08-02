import { useCallback, useSyncExternalStore } from 'react';
import {
  IOssConfig,
  DEFAULT_OSS_CONFIG,
} from '@/data/oss';
import { apiGetOss, apiSaveOss, apiTestOss, apiUploadToOss, ensureApi } from '@/services/api';
import { useAuth } from '@/services/authStore';

// 模块级共享状态（仅内存，持久化全部走后端 API）
let ossState: IOssConfig = { ...DEFAULT_OSS_CONFIG };
const listeners = new Set<() => void>();
let initialized = false;

function notify() {
  listeners.forEach((l) => l());
}

async function initConfig() {
  if (initialized) return;
  initialized = true;

  const ok = await ensureApi();
  if (ok) {
    try {
      const apiCfg = await apiGetOss();
      // 合并：默认配置 + 后端配置；强制 enabled=true（OSS 是默认开启的核心功能）
      ossState = {
        ...DEFAULT_OSS_CONFIG,
        ...(apiCfg || {}),
        // 不论后端存的是什么，OSS 默认开启（防止用户数据被误关）
        enabled: true,
      } as IOssConfig;
      apiSaveOss(ossState as any); // 立即写回，保证所有设备一致
    } catch {
      ossState = { ...DEFAULT_OSS_CONFIG, enabled: true };
    }
  } else {
    // 后端不可用：仅内存默认值，不落盘
    ossState = { ...DEFAULT_OSS_CONFIG, enabled: true };
  }
  notify();
}

// 模块加载时启动异步初始化
initConfig();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getOssSnapshot(): IOssConfig {
  return ossState;
}

function setConfig(updater: (prev: IOssConfig) => IOssConfig) {
  ossState = updater(ossState);
  apiSaveOss(ossState as any);
  notify();
}

function updateConfig(patch: Partial<IOssConfig>) {
  ossState = { ...ossState, ...patch };
  apiSaveOss(ossState as any);
  notify();
}

function resetConfig() {
  ossState = { ...DEFAULT_OSS_CONFIG };
  apiSaveOss(ossState as any);
  notify();
}

export function useOssConfig() {
  // useSyncExternalStore 让 React 19 在并发渲染下正确跟踪外部状态
  const config = useSyncExternalStore(subscribe, getOssSnapshot, getOssSnapshot);
  const { user } = useAuth(); // 多租户红线：拿当前用户 id 做 OSS key 命名空间

  /**
   * 测试 OSS 连接：调后端 /api/oss/test 验证连通性
   */
  const testConnection = useCallback(async (): Promise<{
    success: boolean;
    message: string;
    files?: { name: string; size: number; lastModified: string }[];
  }> => {
    return await apiTestOss(ossState);
  }, []);

  /**
   * 生成 OSS 访问 URL
   */
  const buildOssUrl = useCallback((objectKey: string): string => {
    const cfg = ossState;
    const domain = cfg.customDomain || cfg.endpointExternal;
    const prefix = cfg.pathPrefix || '';
    const key = objectKey.startsWith('/') ? objectKey.slice(1) : objectKey;
    return `https://${domain}/${prefix}${key}`;
  }, []);

  /**
   * 上传文件到 OSS：调后端 /api/oss/upload（后端代理阿里云 OSS SDK）
   * @param file File 或 Blob
   * @param fileName 文件名
   */
  const uploadFile = useCallback(
    async (
      file: File | Blob,
      fileName: string,
    ): Promise<{ success: boolean; url: string; objectKey: string }> => {
      const cfg = ossState;
      const uid = user?.id;
      if (!uid) {
        // 多租户红线：未登录不允许上传（资产必须归属到具体客户 id）
        return { success: false, url: '', objectKey: '' };
      }
      if (!cfg.enabled) {
        return { success: false, url: '', objectKey: '' };
      }
      if (!cfg.accessKeyId || !cfg.accessKeySecret) {
        return { success: false, url: '', objectKey: '' };
      }
      // File/Blob → base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // 去掉 "data:image/jpeg;base64," 前缀
          const idx = result.indexOf(',');
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const prefix = cfg.pathPrefix || 'images/';
      // 多租户红线：前端预置 user 命名空间（后端会二次强制 users/{uid}/，双重保险）
      const fileNameOnly = fileName.includes('/') ? fileName.split('/').pop()! : fileName;
      const objectKey = `users/${uid}/${prefix}${Date.now()}_${fileNameOnly}`;
      const result = await apiUploadToOss(objectKey, base64);
      if (result.success) {
        return { success: true, url: result.url, objectKey: result.objectKey };
      }
      return { success: false, url: '', objectKey };
    },
    [user],
  );

  return {
    config,
    setConfig,
    updateConfig,
    resetConfig,
    testConnection,
    buildOssUrl,
    uploadFile,
  };
}
