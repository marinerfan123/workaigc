import { useState } from 'react';
import {
  Heart,
  RefreshCw,
  MoreHorizontal,
  Play,
  Download,
  Trash2,
  Share2,
  Image as ImageIcon,
  Sparkles,
  FolderPlus,
  Edit3,
  Palette,
  Film,
  Cloud,
  Maximize2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Image from '@/components/ui/image';
import { IMediaItem } from '@/data/media';

interface MediaCardProps {
  item: IMediaItem;
  selected: boolean;
  onSelect: (item: IMediaItem) => void;
  onOpenViewer?: () => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  gridSize: 'S' | 'M' | 'L';
}

export default function MediaCard({
  item,
  selected,
  onSelect,
  onOpenViewer,
  onToggleFavorite,
  onDelete,
  gridSize,
}: MediaCardProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const navigate = useNavigate();

  const moreItems = [
    { icon: Heart, label: item.isFavorite ? '取消收藏' : '收藏' },
    { icon: Sparkles, label: '重复使用提示' },
    { icon: Film, label: '添加动画效果' },
    { icon: ImageIcon, label: '添加到提示' },
    { icon: Download, label: '下载' },
    { icon: Edit3, label: '重命名' },
    { icon: Share2, label: '分享' },
    { icon: Palette, label: '设置项目封面' },
    { icon: Trash2, label: '移至回收站', danger: true },
  ];

  const sizeClasses = {
    S: 'aspect-[3/4]',
    M: 'aspect-[4/5]',
    L: 'aspect-square',
  };

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 cursor-pointer transition-all duration-300 hover:border-zinc-700"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setMoreOpen(false);
      }}
      onClick={() => onSelect(item)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpenViewer?.();
      }}
    >
      <div className={`relative w-full ${sizeClasses[gridSize]} overflow-hidden`}>
        <Image
          src={item.thumbnail}
          alt={item.title}
          className="h-full w-full object-cover duration-500"
        />

        {/* 视频播放角标 */}
        {item.type === 'video' && (
          <div className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm text-white">
            <Play className="size-3.5 fill-current" />
          </div>
        )}

        {/* 收藏角标 */}
        {item.isFavorite && (
          <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 backdrop-blur-sm text-emerald-400">
            <Heart className="size-3.5 fill-current" />
          </div>
        )}

        {/* OSS 已上传角标 —— 左下角（避免与视频播放角标重叠） */}
        {item.ossUploaded && (
          <div className="absolute left-2 bottom-2 z-20 flex h-7 items-center gap-1 rounded-full bg-emerald-500/20 backdrop-blur-sm px-2 text-emerald-400" title="已同步到 OSS 云存储">
            <Cloud className="size-3.5" />
            <span className="text-[10px] font-semibold">OSS</span>
          </div>
        )}

        {/* 选中态边框 */}
        {selected && (
          <div className="absolute inset-0 ring-2 ring-emerald-500 ring-inset rounded-2xl z-10" />
        )}

        {/* 顶部操作栏 - hover 显示 */}
        <div
          className={`absolute inset-x-0 top-0 z-10 flex items-start justify-between p-2.5 transition-opacity duration-300 ${
            hovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(item.id);
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md transition-all duration-300 ${
              item.isFavorite
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-black/40 text-white hover:bg-black/60'
            }`}
          >
            <Heart className={`size-4 ${item.isFavorite ? 'fill-current' : ''}`} />
          </button>

          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                 onOpenViewer?.();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
              title="放大查看"
            >
              <Maximize2 className="size-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/edit/${item.id}`);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
              title="编辑"
            >
              <Edit3 className="size-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMoreOpen(!moreOpen);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
              title="更多"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </div>
        </div>

        {/* 底部信息栏 - hover 显示 */}
        <div
          className={`absolute inset-x-0 bottom-0 z-10 p-2.5 transition-opacity duration-300 ${
            hovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="truncate text-xs font-medium text-white drop-shadow">
              {item.title}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
              title="重做"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
        </div>

        {/* 底部渐变蒙层 */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
      </div>

      {/* 更多菜单 */}
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
          <div className="absolute right-2 top-10 z-40 w-40 overflow-hidden rounded-xl bg-zinc-900/95 backdrop-blur-xl p-1 border border-zinc-800/80 shadow-xl shadow-black/50">
            {moreItems.map((mi) => {
              const Icon = mi.icon;
              return (
                <button
                  key={mi.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (mi.label === '移至回收站') onDelete(item.id);
                    if (mi.label === '收藏' || mi.label === '取消收藏') onToggleFavorite(item.id);
                    setMoreOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                    mi.danger
                      ? 'text-red-400 hover:bg-red-500/10'
                      : 'text-zinc-300 hover:bg-zinc-800/80'
                  }`}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{mi.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
