import { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  User,
  Trash2,
  Edit3,
  Download,
  Sparkles,
  Image as ImageIcon,
} from 'lucide-react';
import TopBar from '@/components/TopBar';
import Image from '@/components/ui/image';
import { ICharacter, MOCK_CHARACTERS } from '@/data/characters';
import { apiGetCharacters, apiSaveCharacters, ensureApi } from '@/services/api';

export default function CharactersPage() {
  const [characters, setCharacters] = useState<ICharacter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: ICharacter[] = [];
      const ok = await ensureApi();
      if (ok) {
        try { list = await apiGetCharacters(); } catch { list = []; }
      }
      const final = list.length > 0 ? list : MOCK_CHARACTERS;
      if (cancelled) return;
      setCharacters(final);
      // 空数据时把 MOCK 写回后端，保证所有设备一致
      if (ok && list.length === 0) { try { apiSaveCharacters(final); } catch {} }
      if (final.length > 0) setSelectedId(final[0].id);
    })();
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(
    () => characters.find((c) => c.id === selectedId) ?? null,
    [characters, selectedId],
  );

  const handleCreate = () => {
    if (!newName.trim()) return;
    const newChar: ICharacter = {
      id: `char-${Date.now()}`,
      name: newName,
      avatar: characters[0]?.avatar || '',
      description: newDesc || '新建角色',
      referenceImages: characters[0]?.referenceImages || [],
      baseModel: 'Nano Banana 2 Lite',
      createdAt: new Date().toISOString(),
      source: 'user',
    };
    const next = [newChar, ...characters];
    setCharacters(next);
    apiSaveCharacters(next);
    setSelectedId(newChar.id);
    setCreateOpen(false);
    setNewName('');
    setNewDesc('');
  };

  const handleDelete = (id: string) => {
    const next = characters.filter((c) => c.id !== id);
    setCharacters(next);
    apiSaveCharacters(next);
    if (selectedId === id) {
      setSelectedId(next[0]?.id ?? null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar onSettingsOpen={() => {}} onMediaPickerOpen={() => {}} />

      <div className="flex flex-1 min-h-0">
        {/* 左侧角色列表 */}
        <aside className="w-64 shrink-0 border-r border-zinc-800 bg-black flex flex-col">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-bold text-white">角色管理</h2>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {characters.map((char) => (
              <button
                key={char.id}
                onClick={() => setSelectedId(char.id)}
                className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-all duration-300 ${
                  selectedId === char.id
                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                    : 'hover:bg-zinc-800/50 border border-transparent'
                }`}
              >
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 border-zinc-800">
                  {char.avatar ? (
                    <Image src={char.avatar} alt={char.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-zinc-500">
                      <User className="size-5" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-white">{char.name}</div>
                  <div className="truncate text-xs text-zinc-500">{char.baseModel}</div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* 右侧角色详情 */}
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <div className="mx-auto max-w-4xl p-8">
              {/* 头部 */}
              <div className="mb-8 flex items-start justify-between">
                <div className="flex items-center gap-5">
                  <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border-4 border-emerald-500/30">
                    {selected.avatar ? (
                      <Image src={selected.avatar} alt={selected.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-zinc-500">
                        <User className="size-10" />
                      </div>
                    )}
                    {/* 翡翠光晕 */}
                    <div className="pointer-events-none absolute -top-4 -right-4 h-12 w-12 bg-emerald-500/20 blur-[24px] rounded-full" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-black tracking-tight text-white">{selected.name}</h1>
                    <p className="mt-1 text-sm text-zinc-500">基础模型：{selected.baseModel}</p>
                    <p className="text-xs text-zinc-600">
                      创建于 {new Date(selected.createdAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-800/50 transition-colors">
                    <Edit3 className="size-4" />
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(selected.id)}
                    className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="size-4" />
                    删除
                  </button>
                  <button className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 transition-colors">
                    <Sparkles className="size-4" />
                    用此角色创作
                  </button>
                </div>
              </div>

              {/* 角色描述 */}
              <div className="mb-8 rounded-[2rem] bg-zinc-900 border border-zinc-800 p-6 relative overflow-hidden">
                <div className="pointer-events-none absolute -top-10 right-0 h-32 w-32 bg-emerald-500/10 blur-[60px] rounded-full" />
                <h3 className="mb-3 text-sm font-bold text-white">角色描述</h3>
                <p className="text-sm leading-relaxed text-zinc-300">{selected.description}</p>
              </div>

              {/* 参考图 */}
              <div className="mb-8">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">参考形象图</h3>
                  <button className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                    <Plus className="size-3.5" />
                    添加参考图
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {selected.referenceImages.map((img, i) => (
                    <div
                      key={i}
                      className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 transition-all duration-300 hover:border-zinc-700"
                    >
                      <Image src={img} alt={`参考图 ${i + 1}`} className="h-full w-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <button className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-black">
                          <Download className="size-3.5" />
                          下载
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 生成记录 */}
              <div>
                <h3 className="mb-4 text-sm font-bold text-white">生成记录</h3>
                <div className="rounded-[2rem] bg-zinc-900 border border-zinc-800 p-6">
                  <div className="flex items-center gap-4 text-center">
                    <div className="flex-1">
                      <div className="text-3xl font-black text-white">12</div>
                      <div className="mt-1 text-xs text-zinc-500">总生成次数</div>
                    </div>
                    <div className="h-10 w-px bg-zinc-800" />
                    <div className="flex-1">
                      <div className="text-3xl font-black text-emerald-400">8</div>
                      <div className="mt-1 text-xs text-zinc-500">收藏作品</div>
                    </div>
                    <div className="h-10 w-px bg-zinc-800" />
                    <div className="flex-1">
                      <div className="text-3xl font-black text-white">95%</div>
                      <div className="mt-1 text-xs text-zinc-500">相似度</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center py-20">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-zinc-900 text-zinc-600">
                <User className="size-10" />
              </div>
              <p className="text-sm text-zinc-500 mb-4">暂无角色</p>
              <button
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 transition-colors"
              >
                <Plus className="size-4" />
                创建角色
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 新建角色弹窗 */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[2rem] bg-zinc-900 border border-zinc-800 p-6">
            <h3 className="mb-5 text-lg font-bold text-white">创建新角色</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">角色名称</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="输入角色名称"
                  className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-800 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">角色描述</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="描述角色的外貌、气质、服饰特点..."
                  rows={4}
                  className="w-full resize-none rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-800 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">参考图</label>
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-zinc-700 text-zinc-500 hover:border-emerald-500/50 hover:text-emerald-400 transition-colors cursor-pointer">
                    <ImageIcon className="size-5" />
                  </div>
                  <span className="text-xs text-zinc-500">点击上传参考图（可选）</span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setCreateOpen(false)}
                className="rounded-full border border-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-800/50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-black hover:bg-emerald-400 transition-colors"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
