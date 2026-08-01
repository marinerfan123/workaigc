import { useState } from 'react';
import { Search, ChevronDown, Grid3X3, Image as ImageIcon, Video, Music, User, Upload, FolderUp, Sparkles, MoreHorizontal } from 'lucide-react';
import { MOCK_MEDIA_LIST } from '@/data/media';
import Image from '@/components/ui/image';

interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  onAddToPrompt: (url: string) => void;
}

const CATEGORIES = [
  { key: 'all', label: '全部', icon: Grid3X3 },
  { key: 'image', label: '图片', icon: ImageIcon },
  { key: 'video', label: '视频', icon: Video },
  { key: 'audio', label: '语音', icon: Music },
  { key: 'character', label: '角色', icon: User },
  { key: 'scene', label: '场景', icon: FolderUp },
  { key: 'prop', label: '道具', icon: Sparkles },
  { key: 'other', label: '其他', icon: MoreHorizontal },
  { key: 'upload', label: '上传的内容', icon: Upload },
];

export default function MediaPicker({ open, onClose, onAddToPrompt }: MediaPickerProps) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(MOCK_MEDIA_LIST[0]?.id ?? null);
  const [searchQuery, setSearchQuery] = useState('');

  if (!open) return null;

  const selected = MOCK_MEDIA_LIST.find((m) => m.id === selectedId);
  const filtered = MOCK_MEDIA_LIST.filter((m) => {
    if (m.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      if (activeCategory === 'all') return true;
      if (activeCategory === 'image') return m.type === 'image';
      if (activeCategory === 'video') return m.type === 'video';
      if (activeCategory === 'audio') return false;
      return m.category === activeCategory;
    }
    return false;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative flex h-[70vh] w-[900px] max-w-[90vw] flex-col overflow-hidden rounded-[2rem] bg-zinc-900 border border-zinc-800">
        {/* 顶部 */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-1 text-sm text-white">
            <span>1</span>
            <ChevronDown className="size-4 text-zinc-500" />
          </div>
          <div className="relative flex-1 max-w-md mx-auto">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索资源"
              className="w-full rounded-2xl bg-zinc-800/50 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-800 focus:outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>
          <button className="flex items-center gap-1 rounded-2xl px-4 py-2 text-sm text-white hover:bg-zinc-800/50 transition-colors">
            最近
            <ChevronDown className="size-3.5 text-zinc-500" />
          </button>
        </div>

        {/* 主体三栏 */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧分类 */}
          <div className="w-44 shrink-0 border-r border-zinc-800 p-3 space-y-1">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const active = activeCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className={`flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm transition-all duration-300 ${
                    active
                      ? 'bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20'
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white border border-transparent'
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{cat.label}</span>
                </button>
              );
            })}
            <div className="pt-2 mt-2 border-t border-zinc-800">
              <button className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors">
                <FolderUp className="size-4 shrink-0" />
                <span className="truncate">上传媒体</span>
              </button>
            </div>
          </div>

          {/* 中间列表 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-all duration-300 ${
                  selectedId === item.id ? 'bg-zinc-800/70 border border-emerald-500/30' : 'hover:bg-zinc-800/30 border border-transparent'
                }`}
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                  <Image src={item.thumbnail} alt={item.title} className="h-full w-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-white">{item.title}</div>
                  <div className="text-xs text-zinc-500">图片</div>
                </div>
              </button>
            ))}
          </div>

          {/* 右侧预览 */}
          <div className="w-72 shrink-0 border-l border-zinc-800 p-5 flex flex-col">
            <div className="flex-1 flex items-center justify-center min-h-0">
              {selected ? (
                <div className="relative w-full h-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                  <Image
                    src={selected.fullUrl}
                    alt={selected.title}
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="text-sm text-zinc-500">选择一个资源</div>
              )}
            </div>
            <button
              onClick={() => {
                if (selected) {
                  onAddToPrompt(selected.fullUrl);
                  onClose();
                }
              }}
              disabled={!selected}
              className="mt-5 w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-50 transition-colors"
            >
              添加到提示
            </button>
            <button className="mt-2 w-full rounded-2xl border border-zinc-800 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800/50 transition-colors">
              上传媒体
            </button>
          </div>
        </div>

        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-2xl text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
