// IndexedDB 图片缓存层：OSS 不可用时的本地持久化兜底。
// 生成图片时若 OSS 上传失败，前端已下载的图片二进制（imgBlob）会被存入 IndexedDB，
// 展示组件优先读缓存，避免依赖会过期的 provider 原始 URL（修复"图自动消失"问题）。

const DB_NAME = 'workaigc-image-cache';
const STORE = 'images';
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheImage(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[imageCache] 写入失败:', e);
  }
}

export async function getCachedImage(key: string): Promise<string | null> {
  try {
    const db = await openDB();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn('[imageCache] 读取失败:', e);
    return null;
  }
}

export async function removeCachedImage(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[imageCache] 删除失败:', e);
  }
}
