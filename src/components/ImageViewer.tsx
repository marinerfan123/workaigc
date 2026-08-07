import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  Maximize2,
  Ruler,
  HardDrive,
} from 'lucide-react';
import Image from '@/components/ui/image';
import { IMediaItem } from '@/data/media';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { getModelDisplayNameByDisplayName } from '@/hooks/useModelHub';

// 把字节数格式化为「1.2 MB / 345 KB / 678 B」
function formatBytes(b?: number): string | null {
  if (!b || b <= 0) return null;
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}

// 根据像素估算文件大小（HEAD 拿不到 content-length 时兜底；按 JPG/PNG 平均）
function estimateBytes(w?: number, h?: number): string | null {
  if (!w || !h) return null;
  // 经验值：1920x1080 JPG ≈ 400KB，比例外推
  const bytes = Math.round((w * h * 0.2) / 1024) * 1024;
  return formatBytes(bytes) + '（估）';
}

interface ImageViewerProps {
  items: IMediaItem[];
  currentIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

export default function ImageViewer({
  items,
  currentIndex,
  onClose,
  onIndexChange,
}: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  // 当前图片的像素尺寸（来自 naturalWidth/Height，可能为空直到 onLoad 触发）
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // 当前图片的文件大小（字节），HEAD 拿不到时为 null
  const [bytes, setBytes] = useState<number | null>(null);
  // 上一张图 URL（用于切换时重置 dims/bytes）
  const lastSrcRef = useRef<string>('');

  const current = items[currentIndex];
  const viewUrl = useMediaUrl(current);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev) {
      onIndexChange(currentIndex - 1);
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [hasPrev, currentIndex, onIndexChange]);

  const handleNext = useCallback(() => {
    if (hasNext) {
      onIndexChange(currentIndex + 1);
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [hasNext, currentIndex, onIndexChange]);

  const handleZoomIn = () => setScale((s) => Math.min(s * 1.25, 5));
  const handleZoomOut = () => setScale((s) => Math.max(s / 1.25, 0.25));
  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleDownload = async () => {
    if (!current) return;
    try {
      const url = current.ossUrl || current.fullUrl;
      if (!url) return;
      // base64 dataURL：直接用
      if (url.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${current.title || 'image'}.jpg`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
      // 外部 URL：fetch → blob 强制下载
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${current.title || 'image'}.jpg`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      // 静默失败（ImageViewer 中不显示 toast 避免干扰浏览）
    }
  };

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          handlePrev();
          break;
        case 'ArrowRight':
          handleNext();
          break;
        case '+':
        case '=':
          handleZoomIn();
          break;
        case '-':
          handleZoomOut();
          break;
        case '0':
          handleReset();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handlePrev, handleNext]);

  // 滚轮缩放
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  };

  // 拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 点击遮罩关闭
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // 禁止 body 滚动
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // 从 Performance Resource Timing 读取浏览器实际下载大小（最准，不额外发请求）
  const readSizeFromTiming = useCallback((url: string) => {
    try {
      if (typeof performance === 'undefined') return null;
      const entries = performance.getEntriesByName(url, 'resource');
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as PerformanceResourceTiming;
        // transferSize 包含响应体大小；decodedBodySize/encodedBodySize 也可兜底
        if (e.transferSize && e.transferSize > 0) return e.transferSize;
        if (e.encodedBodySize && e.encodedBodySize > 0) return e.encodedBodySize;
      }
    } catch {
      // ignore
    }
    return null;
  }, []);

  // 切换图片时：重置像素/大小 + 异步 HEAD 拉文件大小
  useEffect(() => {
    if (!current || lastSrcRef.current === viewUrl) return;
    lastSrcRef.current = viewUrl;
    setDims(null);
    setBytes(null);
    // 后端已记录真实大小：无需再向浏览器 Timing/HEAD 探测
    if (current.fileSize && current.fileSize > 0) return;

    const url = viewUrl;
    // dataURL 直接转 base64 长度（KB/MB）
    if (url.startsWith('data:')) {
      const m = url.match(/^data:[^;]+;base64,(.+)$/);
      if (m) setBytes(Math.round((m[1].length * 3) / 4));
      return;
    }
    // 远程 URL：优先读 Performance Timing（已下载大小），再试 HEAD
    let cancelled = false;
    (async () => {
      const fromTiming = readSizeFromTiming(url);
      if (fromTiming) {
        if (!cancelled) setBytes(fromTiming);
        return;
      }
      try {
        const r = await fetch(url, { method: 'HEAD' });
        if (cancelled) return;
        const cl = r.headers.get('content-length');
        if (cl) {
          const n = parseInt(cl, 10);
          if (Number.isFinite(n) && n > 0) setBytes(n);
        }
      } catch {
        // CORS 或网络失败：忽略，留 null 让下方估算兜底
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewUrl, readSizeFromTiming]);

  if (!current) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm"
      onClick={handleBackdropClick}
      onWheel={handleWheel}
    >
      {/* 顶部工具栏 */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-400">
            {currentIndex + 1} / {items.length}
          </span>
          <span className="text-sm text-zinc-300 font-medium truncate max-w-md">
            {current.title}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleZoomOut}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
            title="缩小"
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="px-2 text-xs text-zinc-400 w-14 text-center tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
            title="放大"
          >
            <ZoomIn className="size-4" />
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
            title="重置"
          >
            <RotateCcw className="size-4" />
          </button>

          <div className="mx-2 h-5 w-px bg-zinc-700" />

          <button
            type="button"
            onClick={handleDownload}
            className="flex h-9 items-center gap-1.5 rounded-full bg-zinc-800/60 px-3 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
            title="下载原图"
          >
            <Download className="size-4" />
            <span className="text-xs">下载</span>
          </button>

          <div className="mx-2 h-5 w-px bg-zinc-700" />

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
            title="关闭 (Esc)"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* 左箭头 */}
      {hasPrev && (
        <button
          type="button"
          onClick={handlePrev}
          className="absolute left-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
          title="上一张 (←)"
        >
          <ChevronLeft className="size-6" />
        </button>
      )}

      {/* 右箭头 */}
      {hasNext && (
        <button
          type="button"
          onClick={handleNext}
          className="absolute right-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
          title="下一张 (→)"
        >
          <ChevronRight className="size-6" />
        </button>
      )}

      {/* 图片容器 */}
      <div
        ref={imgRef}
        className={`flex items-center justify-center ${scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        <Image
          src={viewUrl}
          alt={current.title}
          className="max-h-[85vh] max-w-[90vw] object-contain select-none pointer-events-none"
          draggable={false}
          onLoad={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            if (el.naturalWidth && el.naturalHeight) {
              setDims({ w: el.naturalWidth, h: el.naturalHeight });
            }
            // 图片已下载，从 Performance Timing 取准确大小（HEAD 被 CORS 拦截时的兜底）
            const actual = readSizeFromTiming(el.currentSrc || viewUrl);
            if (actual && actual > 0) setBytes(actual);
          }}
        />
      </div>

      {/* 底部信息 */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center px-6 py-4 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-3 rounded-full border border-zinc-800/80 bg-zinc-950/70 px-4 py-2 shadow-lg backdrop-blur">
          <span className="text-sm font-medium text-zinc-200">
            {getModelDisplayNameByDisplayName(current.model) || current.model}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="text-sm text-zinc-300">{current.ratio}</span>
          {dims ? (
            <>
              <span className="text-zinc-700">·</span>
              <span
                className="inline-flex items-center gap-1 rounded-md bg-cyan-500/10 px-2 py-0.5 text-sm font-semibold text-cyan-300 border border-cyan-500/20"
                title="图片像素尺寸"
              >
                <Ruler className="size-3.5" />
                {dims.w}×{dims.h}
              </span>
            </>
          ) : null}
          <span className="text-zinc-700">·</span>
          <span
            className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-sm font-semibold text-amber-300 border border-amber-500/20"
            title={(() => {
              const accurate = current.fileSize && current.fileSize > 0;
              const known = accurate || (bytes && bytes > 0);
              return known ? '文件大小（后端记录的准确值）' : '文件大小（按像素估算，后端未记录）';
            })()}
          >
            <HardDrive className="size-3.5" />
            {(() => {
              const accurate = current.fileSize && current.fileSize > 0 ? current.fileSize : null;
              const known = accurate || (bytes && bytes > 0 ? bytes : null);
              if (known) return formatBytes(known);
              // 后端未记录 + 浏览器也没探到：按像素估算，并标注（估）
              return (estimateBytes(dims?.w, dims?.h) || '— KB') + (dims ? '（估）' : '');
            })()}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="text-sm text-zinc-400">
            {current.createdAt
              ? new Date(current.createdAt).toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                })
              : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}
