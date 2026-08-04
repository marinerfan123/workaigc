// 统一解析媒体展示 URL：优先 OSS → 本地 IndexedDB 缓存 → provider 原始 URL。
// 修复"图自动消失"：OSS 不可用时，图片二进制已存 IndexedDB（localCacheKey），
// 即使 provider URL 过期，本机仍能从缓存读取展示。
//
// 关键设计：
// - 返回完整状态 { url, isLoading, isFailed } 而非单 string，让消费组件能根据状态
//   渲染对应占位（loading spinner / 失效提示 / 正常图）。
// - 缓存命中失败时，**不**回退到 item.fullUrl（过期的 provider 签名 URL），而是
//   标记 isFailed，由消费组件显示"图片已失效"占位——避免之前"图自动消失"的根本原因。
// - effect 内 cleanup 提到顶部统一注册，避免提前 return 时被跳过。
import { useEffect, useState } from 'react';
import { getCachedImage } from '@/utils/imageCache';
import type { IMediaItem } from '@/data/media';

export type MediaUrlState = {
  url: string;
  isLoading: boolean;
  isFailed: boolean;
  /** 失败原因（用于在占位中显示给用户） */
  reason: 'no-item' | 'no-source' | 'loading-cache' | 'cache-miss' | 'ready' | 'oss-ready' | 'provider-fallback';
};

const INITIAL: MediaUrlState = { url: '', isLoading: true, isFailed: false, reason: 'loading-cache' };

export function useMediaUrlStatus(item?: IMediaItem | null): MediaUrlState {
  const [state, setState] = useState<MediaUrlState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    // 切到新 item 时重置为 loading
    setState(INITIAL);

    const finish = (next: MediaUrlState) => {
      if (!cancelled) setState(next);
    };

    if (!item) {
      finish({ url: '', isLoading: false, isFailed: false, reason: 'no-item' });
      return () => {
        cancelled = true;
      };
    }

    // 1. OSS 永久 URL：直接 ready（永远有效，不走 IndexedDB）
    if (item.ossUrl) {
      finish({ url: item.ossUrl, isLoading: false, isFailed: false, reason: 'oss-ready' });
      return () => {
        cancelled = true;
      };
    }

    // 2. IndexedDB 缓存：异步读取
    if (item.localCacheKey) {
      getCachedImage(item.localCacheKey).then((blobUrl) => {
        if (cancelled) return;
        if (blobUrl) {
          finish({ url: blobUrl, isLoading: false, isFailed: false, reason: 'ready' });
        } else {
          // 缓存读不到：标记 failed，**不**回退到 item.fullUrl（已过期的 provider 签名 URL）
          // 这是修复"图自动消失"的关键：之前 setUrl(item.fullUrl) 让浏览器加载 404/403 链接
          finish({ url: '', isLoading: false, isFailed: true, reason: 'cache-miss' });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    // 3. 兜底：provider 原始 URL（会过期，仅在没缓存时短暂使用）
    if (item.fullUrl) {
      finish({ url: item.fullUrl, isLoading: false, isFailed: false, reason: 'provider-fallback' });
      return () => {
        cancelled = true;
      };
    }

    // 4. 都没：no-source
    finish({ url: '', isLoading: false, isFailed: false, reason: 'no-source' });
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.ossUrl, item?.localCacheKey, item?.fullUrl]);

  return state;
}

/** 兼容旧接口：仅返回 url（消费方自行处理空/loading 态——多数场景下 useMediaUrlStatus 更合适） */
export function useMediaUrl(item?: IMediaItem | null): string {
  return useMediaUrlStatus(item).url;
}
