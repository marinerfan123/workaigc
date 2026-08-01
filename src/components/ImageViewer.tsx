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
} from 'lucide-react';
import Image from '@/components/ui/image';
import { IMediaItem } from '@/data/media';
import { getModelDisplayNameByDisplayName } from '@/hooks/useModelHub';

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

  const current = items[currentIndex];
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
          src={current.fullUrl}
          alt={current.title}
          className="max-h-[85vh] max-w-[90vw] object-contain select-none pointer-events-none"
          draggable={false}
        />
      </div>

      {/* 底部信息 */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-6 px-6 py-4 bg-gradient-to-t from-black/60 to-transparent">
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>{getModelDisplayNameByDisplayName(current.model) || current.model}</span>
          <span>·</span>
          <span>{current.ratio}</span>
          <span>·</span>
          <span>{new Date(current.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
      </div>
    </div>
  );
}
