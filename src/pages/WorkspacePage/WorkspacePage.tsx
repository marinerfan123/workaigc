import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import TopBar from '@/components/TopBar';
import FilterBar from '@/components/FilterBar';
import FilterPanel from '@/components/FilterPanel';
import SettingsPanel from '@/components/SettingsPanel';
import MediaCard from '@/components/MediaCard';
import DetailPanel from '@/components/DetailPanel';
import GenerationBar, { type GenerationBarHandle } from '@/components/GenerationBar';
import MediaPicker from '@/components/MediaPicker';
import ImageViewer from '@/components/ImageViewer';
import Image from '@/components/ui/image';
import { IMediaItem, MOCK_MEDIA_LIST } from '@/data/media';
import { useModelHub } from '@/hooks/useModelHub';
import { useOssConfig } from '@/hooks/useOssConfig';
import { apiGetMedia, apiSaveMedia, apiDeleteMedia, apiGetSettings, apiSaveSettings, apiProxyFetch, ensureApi, stripBlobItems } from '@/services/api';

interface IGenerationSettings {
  contentType: 'image' | 'video';
  ratio: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  resolution: '1k' | '2k' | '4k' | '8k';
  model: string;
  count: 1 | 2 | 3 | 4;
}

const DEFAULT_SETTINGS: IGenerationSettings = {
  contentType: 'image',
  ratio: '16:9',
  resolution: '1k',
  model: '', // 初次加载由 GenerationBar 的 useEffect 自动选第一个可用后台模型；没有则保持空显示"无"
  count: 1,
};

export default function WorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const generationBarRef = useRef<GenerationBarHandle>(null);
  const [mediaList, setMediaList] = useState<IMediaItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'batch'>('grid');
  const [gridSize, setGridSize] = useState<'S' | 'M' | 'L'>('M');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortMode, setSortMode] = useState<'newest' | 'oldest'>('newest');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settings, setSettings] = useState<IGenerationSettings>(DEFAULT_SETTINGS);
  const [prompt, setPrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const { getDefaultModel, models } = useModelHub();
  const { config: ossConfig, uploadFile: uploadToOss } = useOssConfig();

  // 初始化数据（唯一来源：后端 API）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: IMediaItem[] = [];
      const ok = await ensureApi();
      if (ok) {
        try { list = await apiGetMedia(); } catch { list = []; }
      }
      const validItems = stripBlobItems(list); // 过滤 blob 临时项
      // 不要再 fallback 到 MOCK——避免 mock 数据被自动写回 PG
      const finalList = validItems;
      if (cancelled) return;
      setMediaList(finalList);
      // 不再自动把 MOCK 写回后端
    })();

    (async () => {
      let parsed: any = null;
      const ok = await ensureApi();
      if (ok) {
        try { parsed = await apiGetSettings(); } catch { parsed = null; }
      }
      if (parsed && Object.keys(parsed).length > 0) {
        // 确保 count 是数字且在合法范围内
        const validCounts: number[] = [1, 2, 3, 4];
        const countNum = Number(parsed.count);
        const validCount = (validCounts.includes(countNum) ? countNum : 1) as 1 | 2 | 3 | 4;
        // 确保模型在可用列表中，否则用默认
        const defaultModel = getDefaultModel(parsed.contentType || 'image');
        if (defaultModel && !parsed.model) {
          parsed.model = defaultModel;
        }
        setSettings({ ...DEFAULT_SETTINGS, ...parsed, count: validCount });
      } else {
        const defaultModel = getDefaultModel('image');
        if (defaultModel) {
          setSettings((s) => ({ ...s, model: defaultModel }));
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // 接收 LibraryPage 跳转过来的 retry 请求：用原 prompt+model+ratio 重新生成，并清掉旧的 failed item
  useEffect(() => {
    const state = (location.state as { retryItem?: IMediaItem } | null) || null;
    const item = state?.retryItem;
    if (!item) return;
    // 1. 删掉旧失败项（避免列表里残留）
    setMediaList((prev) => prev.filter((m) => m.id !== item.id));
    // 2. 通知 GenerationBar 重新生成
    setTimeout(() => {
      generationBarRef.current?.retry({
        prompt: item.prompt,
        model: item.model,
        ratio: item.ratio,
      });
      // 3. 清掉 navigate state，避免重复触发
      navigate(location.pathname, { replace: true, state: null });
    }, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换模型时校验分辨率：新模型若不支持当前 resolution，自动选第一个支持的
  const handleSettingsChange = (next: IGenerationSettings) => {
    if (next.model !== settings.model) {
      const newModel = models.find((m) => m.displayName === next.model);
      const supported = newModel?.supportedResolutions || [];
      if (next.contentType !== 'image' || supported.length === 0) {
        // 视频/文本/空支持列表 → 保留默认 1k 但前端按钮组不显示
        next = { ...next, resolution: '1k' };
      } else if (!supported.includes(next.resolution)) {
        next = { ...next, resolution: supported[0] };
      }
    }
    setSettings(next);
  };

  // 持久化（写回后端）—— 跳过 pending 状态（生成中不持久化，等真图回来再写）
  useEffect(() => {
    const persistable = stripBlobItems(mediaList).filter((m) => m.status !== 'pending');
    if (persistable.length > 0) {
      apiSaveMedia(persistable);
    }
  }, [mediaList]);

  // pending 超时保护：60s 未被替换视为任务失败，自动删除并 toast 提醒
  const pendingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const ids = mediaList.filter((m) => m.status === 'pending').map((m) => m.id);
    // 新增的 pending：注册 60s 超时
    for (const id of ids) {
      if (!pendingTimeoutRef.current.has(id)) {
        pendingTimeoutRef.current.set(id, setTimeout(() => {
          // 超时：删除该 pending 并提示
          setMediaList((prev) => prev.filter((m) => m.id !== id));
          pendingTimeoutRef.current.delete(id);
          toast.error('生成超时，已自动取消', { duration: 4000 });
        }, 60000));
      }
    }
    // 不再 pending 的：清掉 timeout
    for (const [id, tid] of pendingTimeoutRef.current.entries()) {
      if (!ids.includes(id)) {
        clearTimeout(tid);
        pendingTimeoutRef.current.delete(id);
      }
    }
  }, [mediaList]);
  useEffect(() => () => {
    // 卸载时清空所有 timeout
    for (const tid of pendingTimeoutRef.current.values()) clearTimeout(tid);
    pendingTimeoutRef.current.clear();
  }, []);

  // 后台补传遗漏素材: 每次刷新/登录时自动尝试补传之前 OSS 失败的图片
  // 关键约束: 跳过当前选中的 item + pending 卡片, 避免抢用户正在看的图 (右栏会瞬间裂图)
  const backfillRef = useRef(false);
  useEffect(() => {
    if (backfillRef.current) return;
    if (!ossConfig.enabled || mediaList.length === 0) return;
    const needsUpload = mediaList.filter(
      (m) => m.id !== selectedId && !m.ossUploaded && !m.isDeleted && m.source !== 'mock' && m.status !== 'pending' && m.fullUrl && !m.fullUrl.startsWith('data:'),
    );
    if (needsUpload.length === 0) return;
    backfillRef.current = true;
    let cancelled = false;
    (async () => {
      // 延迟 3 秒启动，不阻塞首屏渲染
      await new Promise((r) => setTimeout(r, 3000));
      for (const item of needsUpload) {
        if (cancelled) break;
        try {
          // 后端代理下载（绕开浏览器 CORS）
          const proxied = await apiProxyFetch(item.fullUrl!);
          if (!proxied.success || !proxied.base64) throw new Error(proxied.message || 'proxy failed');
          const byteChars = atob(proxied.base64);
          const byteArr = new Uint8Array(byteChars.length);
          for (let k = 0; k < byteChars.length; k++) byteArr[k] = byteChars.charCodeAt(k);
          const blob = new Blob([byteArr], { type: proxied.contentType || 'image/jpeg' });
          const file = new File([blob], `${item.id}.jpg`, { type: 'image/jpeg' });
          const result = await uploadToOss(file, `${item.id}.jpg`);
          if (result.success) {
            const updated = { ...item, ossUrl: result.url, ossObjectKey: result.objectKey, ossUploaded: true, fullUrl: result.url, thumbnail: result.url } as IMediaItem;
            setMediaList((prev) => prev.map((m) => (m.id === item.id ? updated : m)));
            // 立即持久化该条
            apiSaveMedia(stripBlobItems([updated]));
          }
          // 间隔 500ms 避免速率限制
          await new Promise((r) => setTimeout(r, 500));
        } catch {
          // 静默跳过补传失败（后台任务不弹 toast）
        }
      }
    })();
    return () => { cancelled = true; };
  }, [mediaList, ossConfig.enabled]);

  useEffect(() => {
    apiSaveSettings(settings);
  }, [settings]);

  const filtered = useMemo(() => {
    const list = mediaList.filter(
      (m) => !m.isDeleted && m.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
    // 排序：最新在前（默认）或最早在前
    return [...list].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sortMode === 'newest' ? tb - ta : ta - tb;
    });
  }, [mediaList, searchQuery, sortMode]);

  const selectedItem = useMemo(
    () => mediaList.find((m) => m.id === selectedId) ?? null,
    [mediaList, selectedId],
  );

  // 提交瞬间立即插入 N 个 pending 占位 → 让用户立刻看到进度卡片
  const handlePendingCreate = (items: IMediaItem[]) => {
    setMediaList((prev) => [...items, ...prev]);
    setSelectedId(items[0]?.id ?? null);
  };

  // 后端真正返图后：找到对应 pending id 替换为真图（pending → success/failed）
  const handleGenerate = (item: IMediaItem) => {
    setMediaList((prev) => prev.map((m) => (m.id === item.id ? item : m)));
  };

  const handleToggleFavorite = (id: string) => {
    setMediaList((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isFavorite: !m.isFavorite } : m)),
    );
  };

  const handleDelete = (id: string) => {
    // 硬删除：调 DELETE /api/media/:id，PG 直接 DELETE FROM media
    setMediaList((prev) => prev.filter((m) => m.id !== id));
    apiDeleteMedia(id).catch((e) => console.warn('delete media failed:', e));
    if (selectedId === id) setSelectedId(null);
  };

  const handleAddReference = (url: string) => {
    if (!referenceImages.includes(url)) {
      setReferenceImages((prev) => [...prev, url]);
    }
  };

  const handleOpenViewer = (index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  };

  const handleCloseViewer = () => {
    setViewerOpen(false);
  };

  const handleViewerIndexChange = (index: number) => {
    setViewerIndex(index);
  };

  const handleUsePrompt = (promptText: string) => {
    setPrompt(promptText);
  };

  const handleRemoveReference = (url: string) => {
    setReferenceImages((prev) => prev.filter((u) => u !== url));
  };

  const gridCols = gridSize === 'S' ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' :
    gridSize === 'M' ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4' :
    'grid-cols-2 md:grid-cols-3';

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onSettingsOpen={() => setSettingsOpen(true)}
        onMediaPickerOpen={() => setPickerOpen(true)}
      />

      <div className="flex flex-1 min-h-0">
        {/* 中间主区 */}
        <div className="flex flex-1 flex-col min-w-0">
          <FilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            gridSize={gridSize}
            onGridSizeChange={setGridSize}
            filterOpen={filterOpen}
            onToggleFilter={() => setFilterOpen(!filterOpen)}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
          />

          <div className="relative flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-4 pb-4">
            {filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-20">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-zinc-900 text-zinc-600">
                  <svg className="size-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm text-zinc-500">暂无作品，输入提示词开始创作</p>
              </div>
            ) : viewMode === 'batch' ? (
              <div className="space-y-2">
                {filtered.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    onDoubleClick={() => handleOpenViewer(index)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-2 text-left transition-all duration-200 ${
                      selectedId === item.id
                        ? 'bg-emerald-500/10 border-emerald-500/40'
                        : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-zinc-950">
                      <Image src={item.thumbnail} alt={item.title} className="h-full w-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-white">{item.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                        <span className="truncate">{item.model || '—'}</span>
                        <span>·</span>
                        <span>{item.ratio || '—'}</span>
                        <span>·</span>
                        <span>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.isFavorite && <span className="text-emerald-400">★</span>}
                      {item.ossUploaded && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">OSS</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className={`grid gap-3 ${gridCols}`}>
                {filtered.map((item, index) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    onSelect={(it) => setSelectedId(it.id)}
                    onOpenViewer={() => handleOpenViewer(index)}
                    onToggleFavorite={handleToggleFavorite}
                    onDelete={handleDelete}
                    gridSize={gridSize}
                  />
                ))}
              </div>
            )}

            {/* 浮动设置面板 */}
            <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

            {/* 浮动筛选面板 */}
            <FilterPanel
              open={filterOpen}
              onClose={() => setFilterOpen(false)}
              resultCount={filtered.length}
            />
          </div>

          <GenerationBar
            ref={generationBarRef}
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onPendingCreate={handlePendingCreate}
            onGenerate={handleGenerate}
            referenceImages={referenceImages}
            onRemoveReference={handleRemoveReference}
            onAddReference={() => setPickerOpen(true)}
            generating={generating}
            setGenerating={setGenerating}
            prompt={prompt}
            onPromptChange={setPrompt}
          />
        </div>

        {/* 右侧详情面板 */}
        <DetailPanel
          item={selectedItem}
          onToggleFavorite={handleToggleFavorite}
          onDelete={handleDelete}
          onClose={() => setSelectedId(null)}
          onUsePrompt={handleUsePrompt}
          onUpdate={(updated) => {
            setMediaList((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
            apiSaveMedia(stripBlobItems([updated]));
          }}
        />
      </div>

      {/* 媒体选择器弹窗 */}
      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAddToPrompt={handleAddReference}
      />

      {/* 图片查看器（灯箱） */}
      {viewerOpen && (
        <ImageViewer
          items={filtered}
          currentIndex={viewerIndex}
          onClose={handleCloseViewer}
          onIndexChange={handleViewerIndexChange}
        />
      )}
    </div>
  );
}
