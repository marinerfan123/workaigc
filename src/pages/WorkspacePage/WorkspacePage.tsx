import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
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
import { ICharacter } from '@/data/characters';
import { useModelHub, getModelDisplayNameByDisplayName, getModelCreditCostByDisplayName } from '@/hooks/useModelHub';
import { useOssConfig, dataUrlToFile } from '@/hooks/useOssConfig';
import { useMediaUrlStatus } from '@/hooks/useMediaUrl';
import { apiGetMedia, apiSaveMedia, apiDeleteMedia, apiGetSettings, apiSaveSettings, apiProxyFetch, ensureApi, stripBlobItems, apiGetReferenceStyles } from '@/services/api';
import type { Ratio, Quality } from '@/data/settings';
import type { ReferenceStyle } from '@/services/api';

interface IGenerationSettings {
  contentType: 'image' | 'video';
  ratio: Ratio;
  resolution: '1k' | '2k' | '4k' | '8k';
  quality: Quality;
  model: string;
  count: 1 | 2 | 3 | 4;
  duration?: 4 | 6 | 8 | 10;
}

const DEFAULT_SETTINGS: IGenerationSettings = {
  contentType: 'image',
  ratio: '16:9',
  resolution: '2k',
  quality: 'standard',
  model: '', // 初次加载由 GenerationBar 的 useEffect 自动选第一个可用后台模型；没有则保持空显示"无"
  count: 1,
  duration: 6,
};

function WsThumb({ item }: { item: IMediaItem }) {
  // 媒体 URL 同步解析：OSS 主路径 → provider 兜底（无浏览器本地存储）
  const mediaUrl = useMediaUrlStatus(item);
  const url = mediaUrl.url;
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-zinc-950">
      {url ? (
        <Image src={url} alt={item.title} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-600" title="图片已失效">⚠</div>
      )}
    </div>
  );
}

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
  const [negativePrompt, setNegativePrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<ICharacter | null>(null);

  // 参考图上限：视频通常只能带 1 张参考；图片最多 4 张，避免用户/后端误解
  const MAX_REF_IMAGES = useMemo(() => (settings.contentType === 'video' ? 1 : 4), [settings.contentType]);

  const setReferenceImagesCapped = useCallback(
    (urls: string[]) => {
      const next = urls.slice(0, MAX_REF_IMAGES);
      if (next.length < urls.length) {
        toast.info(`当前模式最多 ${MAX_REF_IMAGES} 张参考图，已自动截取前 ${next.length} 张`);
      }
      setReferenceImages(next);
    },
    [MAX_REF_IMAGES],
  );
  const [generating, setGenerating] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const { getDefaultModel, models } = useModelHub();
  const { config: ossConfig, uploadFile: uploadToOss } = useOssConfig();

  // 强制推行的参考样式（工作台示例墙：仅 is_promoted 的样式出现在这里）
  const [promotedStyles, setPromotedStyles] = useState<ReferenceStyle[]>([]);

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

  // 拉取「强制推行」的参考样式，作为工作台示例墙的精选内容
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiGetReferenceStyles({ promoted: true, limit: 24 });
        if (!cancelled) setPromotedStyles(r.items || []);
      } catch {
        // 推广样式加载失败不应阻断主流程
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 接收 LibraryPage 跳转过来的 retry 请求：用原 prompt+model+ratio 重新生成，并清掉旧的 failed item
  // 以及 CharactersPage「用此角色创作」：把角色描述当 prompt、参考图当参考图，预填后自动生成一次
  const characterFiredRef = useRef(false);
  useEffect(() => {
    const state = (location.state as { retryItem?: IMediaItem; character?: ICharacter } | null) || null;
    const item = state?.retryItem;
    const character = state?.character;
    if (!item && !character) return;
    // 1. 删掉旧失败项（避免列表里残留）
    if (item) {
      setMediaList((prev) => prev.filter((m) => m.id !== item.id));
    }
    // 2. 用此角色创作：预填 prompt + 参考图 + 模型，并自动生成一次（仅触发一次）
    if (character && !characterFiredRef.current) {
      characterFiredRef.current = true;
      setActiveCharacter(character);
      if (character.description) setPrompt(character.description);
      if (character.referenceImages?.length) setReferenceImagesCapped(character.referenceImages);
      setTimeout(() => {
        generationBarRef.current?.generate({
          prompt: character.description,
          model: character.baseModel || settings.model,
          referenceImages: character.referenceImages || [],
          auto: true,
        });
        // 3. 清掉 navigate state，避免重复触发
        navigate(location.pathname, { replace: true, state: null });
      }, 80);
      return;
    }
    // 3. 通知 GenerationBar 重新生成（retry 路径）
    setTimeout(() => {
      if (item) {
        generationBarRef.current?.retry({
          prompt: item.prompt,
          model: item.model,
          ratio: item.ratio,
        });
      }
      // 清掉 navigate state，避免重复触发
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

  // 注意：pending 占位的生命周期（超时/失败标记）由 GenerationBar 的轮询统一持有
  // （其 pollTaskUntilDone 在 3 分钟无结果时标记 failed，不会直接删除占位导致真图丢失）。
  // 这里不再做 60s 硬删除——否则慢生成（排队/限流 >60s）完成前占位被删，
  // 后端 done 时 onGenerate 按 id 找不到占位会静默丢图（但积分已 commit）。

  // 后台补传遗漏素材: 每次刷新/登录时自动尝试补传之前 OSS 失败的图片
  // 关键约束: 跳过当前选中的 item + pending 卡片, 避免抢用户正在看的图 (右栏会瞬间裂图)
  const backfillRef = useRef(false);
  useEffect(() => {
    if (backfillRef.current) return;
    if (!ossConfig.enabled || mediaList.length === 0) return;
    const needsUpload = mediaList.filter(
      (m) => m.id !== selectedId && !m.ossUploaded && !m.isDeleted && m.source !== 'mock' && m.status !== 'pending' && m.fullUrl,
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
          let file: File;
          if (item.fullUrl!.startsWith('data:')) {
            // data: 图已在本页，直接 base64 转 File（不依赖后端代理）
            file = dataUrlToFile(item.fullUrl!, `${item.id}.jpg`);
          } else {
            // 后端代理下载（绕开浏览器 CORS）
            const proxied = await apiProxyFetch(item.fullUrl!);
            if (!proxied.success || !proxied.base64) throw new Error(proxied.message || 'proxy failed');
            const byteChars = atob(proxied.base64);
            const byteArr = new Uint8Array(byteChars.length);
            for (let k = 0; k < byteChars.length; k++) byteArr[k] = byteChars.charCodeAt(k);
            const blob = new Blob([byteArr], { type: proxied.contentType || 'image/jpeg' });
            file = new File([blob], `${item.id}.jpg`, { type: 'image/jpeg' });
          }
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
  // 关键容错（修复"钱扣了图丢了"）：若占位因超时/刷新未恢复而缺失，直接插入，绝不静默丢弃——
  // 因为后端 done 时已 commit 积分，丢图等于白扣钱。
  const handleGenerate = (item: IMediaItem) => {
    setMediaList((prev) => {
      const idx = prev.findIndex((m) => m.id === item.id);
      if (idx >= 0) {
        const existing = prev[idx];
        // 防御：已落库的好图（OSS 已上传永久链接）不被一次失败的恢复覆盖成过期 provider URL
        const merged =
          existing.ossUploaded && !item.ossUploaded
            ? {
                ...item,
                thumbnail: existing.thumbnail,
                fullUrl: existing.fullUrl,
                ossUrl: existing.ossUrl,
                ossObjectKey: existing.ossObjectKey,
                ossUploaded: existing.ossUploaded,
              }
            : item;
        const next = prev.slice();
        next[idx] = merged;
        return next;
      }
      // 占位不存在 → 直接前置插入（pending 被误删/刷新丢失的恢复路径）
      return [item, ...prev];
    });
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
    if (referenceImages.length >= MAX_REF_IMAGES) {
      toast.info(`当前最多可添加 ${MAX_REF_IMAGES} 张参考图，请先移除后再添加`);
      return;
    }
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

  // ── 示例库高级玩法 ──
  // T1 配方复用：用示例的 prompt + model + ratio 一键预填并立即生成（复刻）
  const handleUseRecipe = (item: IMediaItem) => {
    generationBarRef.current?.generate({
      prompt: item.prompt,
      model: item.model,
      ratio: item.ratio,
      auto: true,
    });
    setViewerOpen(false); // 关闭灯箱，让用户看到生成进度
  };
  // T2 变体 Remix：把示例缩略图当参考图，生成同源变体
  const handleRemix = (item: IMediaItem) => {
    const refUrl = item.fullUrl || item.thumbnail;
    generationBarRef.current?.generate({
      prompt: item.prompt,
      model: item.model,
      ratio: item.ratio,
      referenceImages: refUrl ? [refUrl] : [],
      auto: true,
    });
    setViewerOpen(false);
  };

  // T3 推广样式一键创作：把推广样式当参考图 + 归因到样式设计者（用于分成）
  const handleUsePromotedStyle = (style: ReferenceStyle) => {
    generationBarRef.current?.generate({
      prompt: style.prompt || '',
      model: style.modelId || settings.model,
      ratio: style.ratio || settings.ratio,
      referenceImages: style.previewUrl ? [style.previewUrl] : [],
      referenceStyle: style,
      auto: true,
    });
  };

  const gridCols = gridSize === 'S' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' :
    gridSize === 'M' ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' :
    'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

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

          <div className="relative flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-5 pb-6 pt-3">
            {/* 精选推广样式墙：仅「强制推行」的参考样式出现在这里 */}
            {promotedStyles.length > 0 && (
              <section className="mb-7">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500/20 to-emerald-500/10 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30">
                    <Sparkles className="size-3.5" /> 精选推广样式
                  </span>
                  <span className="text-xs text-zinc-500">由社区设计者创作，点按即可一键生成并给设计者分成</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {promotedStyles.map((style) => (
                    <div
                      key={style.id}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/[0.06] to-zinc-900/40 transition-all duration-200 hover:border-amber-500/40"
                    >
                      <div className="relative aspect-square w-full overflow-hidden bg-zinc-950">
                        {style.previewUrl ? (
                          <Image src={style.previewUrl} alt={style.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-zinc-600">
                            <Sparkles className="size-8" />
                          </div>
                        )}
                        <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-black">
                          推广
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col p-2.5">
                        <p className="truncate text-xs font-medium text-zinc-200">{style.name || '未命名样式'}</p>
                        <p className="mt-0.5 truncate text-[10px] text-zinc-500">by {style.userDisplayName || style.userEmail || '匿名设计者'}</p>
                        <button
                          onClick={() => handleUsePromotedStyle(style)}
                          className="mt-2 inline-flex items-center justify-center gap-1 rounded-lg bg-amber-500/90 px-2 py-1.5 text-[11px] font-semibold text-black transition-all duration-200 hover:bg-amber-400 active:scale-95"
                        >
                          <Sparkles className="size-3" /> 用此样式创作
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {filtered.length === 0 ? (
              searchQuery ? (
                <div className="flex h-full flex-col items-center justify-center py-20">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[2rem] bg-zinc-900 text-zinc-600">
                    <Search className="size-7" />
                  </div>
                  <p className="text-sm text-zinc-500">未找到匹配「{searchQuery}」的作品</p>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center py-20 px-6">
                  <div className="relative mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-gradient-to-br from-emerald-500/15 to-teal-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                    <Sparkles className="size-10" />
                    <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-emerald-500/10 blur-2xl animate-pulse" />
                  </div>
                  <h2 className="text-lg font-semibold text-white">开始你的古风创作</h2>
                  <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-zinc-500">
                    在下方输入提示词，选择模型与画面比例，即可生成古风人像。支持参考图与多种智能体能力。
                  </p>
                  <button
                    onClick={() => generationBarRef.current?.focusInput()}
                    className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 active:scale-95 transition-all duration-200"
                  >
                    <Sparkles className="size-4" /> 立即创作
                  </button>
                </div>
              )
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
                    <WsThumb item={item} />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-white">{item.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                        <span className="truncate">{getModelDisplayNameByDisplayName(item.model) || item.model || '—'}</span>
                        {(() => {
                          const cost = getModelCreditCostByDisplayName(item.model);
                          return cost > 0 ? (
                            <span className="shrink-0 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold">
                              {cost} 积分
                            </span>
                          ) : null;
                        })()}
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
                    onAddAsReference={handleAddReference}
                    onUseRecipe={handleUseRecipe}
                    onRemix={handleRemix}
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

          <div className="relative z-40 px-5 pb-6">
            {/* 顶部渐隐：让悬浮生成栏在视觉上「锚定」于作品区，而非漂浮 */}
            <div className="pointer-events-none absolute -top-12 left-0 right-0 h-12 bg-gradient-to-t from-black via-black/70 to-transparent" />
            <GenerationBar
              ref={generationBarRef}
              settings={settings}
              onSettingsChange={handleSettingsChange}
              onPendingCreate={handlePendingCreate}
              onGenerate={handleGenerate}
              referenceImages={referenceImages}
              onRemoveReference={handleRemoveReference}
              onAddReference={() => setPickerOpen(true)}
              onSetReferenceImages={setReferenceImagesCapped}
              generating={generating}
              setGenerating={setGenerating}
              prompt={prompt}
              onPromptChange={setPrompt}
              negativePrompt={negativePrompt}
              onNegativePromptChange={setNegativePrompt}
              characterId={activeCharacter?.id}
            />
          </div>
        </div>

        {/* 右侧详情面板 */}
        <DetailPanel
          item={selectedItem}
          onToggleFavorite={handleToggleFavorite}
          onDelete={handleDelete}
          onClose={() => setSelectedId(null)}
          onUsePrompt={handleUsePrompt}
          onAddAsReference={handleAddReference}
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
        onAddAsReference={handleAddReference}
        referenceImages={referenceImages}
        maxReferenceImages={MAX_REF_IMAGES}
      />

      {/* 图片查看器（灯箱） */}
      {viewerOpen && (
        <ImageViewer
          items={filtered}
          currentIndex={viewerIndex}
          onClose={handleCloseViewer}
          onIndexChange={handleViewerIndexChange}
          onUseRecipe={handleUseRecipe}
          onRemix={handleRemix}
          allowSubmitReferenceStyle={true}
        />
      )}
    </div>
  );
}
