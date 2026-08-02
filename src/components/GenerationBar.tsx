import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { probeImageLoad } from '@/utils/imageProbe';
import {
  ArrowUp,
  Plus,
  Sparkles,
  Wand2,
  X,
  Music,
  ChevronDown,
  Palette,
  User,
  Bot,
  Volume2,
  VolumeX,
  Mic,
  Camera,
  PenTool,
  Copy,
  Settings2,
  Search,
  Maximize2,
} from 'lucide-react';
import { toast } from 'sonner';
import { capabilityClient, logger } from '@/services/client-capabilities';
import Image from '@/components/ui/image';
import { IMediaItem, MOCK_MEDIA_LIST } from '@/data/media';
import { useModelHub } from '@/hooks/useModelHub';
import { groupModelsByModelId } from '@/utils/groupModels';
import { useOssConfig } from '@/hooks/useOssConfig';
import { apiProxyFetch, apiGenerate } from '@/services/api';
import { ALL_RESOLUTIONS, type Resolution, getEffectiveModelName } from '@/data/models';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface IGenerationSettings {
  contentType: 'image' | 'video';
  ratio: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  resolution: '1k' | '2k' | '4k' | '8k';
  model: string;
  count: 1 | 2 | 3 | 4;
  duration?: 4 | 6 | 8 | 10;
}

interface GenerationBarProps {
  settings: IGenerationSettings;
  onSettingsChange: (s: IGenerationSettings) => void;
  /** 提交瞬间立刻回调：父级应立即在 mediaList 插入这些 pending 占位 */
  onPendingCreate: (items: IMediaItem[]) => void;
  /** 后端真正返图后回调：用真图替换对应 pending（按 id 匹配） */
  onGenerate: (item: IMediaItem) => void;
  referenceImages: string[];
  onRemoveReference: (url: string) => void;
  onAddReference: () => void;
  generating: boolean;
  setGenerating: (v: boolean) => void;
  prompt: string;
  onPromptChange: (v: string) => void;
}

/** 父级调用 retry() 时用的参数：仅需 prompt + model + ratio（其它用当前 settings） */
export interface RetryPayload {
  prompt: string;
  model: string;
  ratio: string;
}

/** 父级通过 ref 触发重试的 imperative handle */
export interface GenerationBarHandle {
  retry: (payload: RetryPayload) => void;
}

function GenerationBar({
  settings,
  onSettingsChange,
  onPendingCreate,
  onGenerate,
  referenceImages,
  onRemoveReference,
  onAddReference,
  generating,
  setGenerating,
  prompt,
  onPromptChange,
  ref,
}: GenerationBarProps & { ref?: React.Ref<GenerationBarHandle> }) {
  const promptText = prompt ?? '';
  const [agentOpen, setAgentOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const { providers, models, getProviderName, getDefaultModel } = useModelHub();
  const { config: ossConfig, uploadFile: uploadToOss, buildOssUrl } = useOssConfig();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── 重试 imperative handle：父级通过 ref.current.retry({prompt,model,ratio}) 触发 ──
  const pendingRetryRef = useRef<RetryPayload | null>(null);
  const retryingRef = useRef(false);
  // 锁住 handleGenerate 最新引用（避免 useEffect 闭包陷阱）
  // 注意：handleGenerate 自身在本组件下方声明，不能在组件顶层提前读它（TDZ）。
  // 改在 handleGenerate 函数体首行自我注册到 ref.current。
  const handleGenerateRef = useRef<() => Promise<void>>(async () => {});

  useImperativeHandle(ref, () => ({
    retry: (payload: RetryPayload) => {
      pendingRetryRef.current = payload;
    },
  }), []);

  useEffect(() => {
    const payload = pendingRetryRef.current;
    if (!payload) return;
    if (retryingRef.current) return;
    retryingRef.current = true;
    pendingRetryRef.current = null;
    // 1. 写 prompt
    onPromptChange(payload.prompt);
    // 2. 更新 settings（model+ratio）
    onSettingsChange({ ...settings, model: payload.model, ratio: payload.ratio });
    // 3. 等 React state 完成更新后调 handleGenerate
    const tid = setTimeout(() => {
      handleGenerateRef.current().finally(() => {
        // 给后端分发、OSS 上传、UI 状态重置留时间，再释放锁
        setTimeout(() => { retryingRef.current = false; }, 300);
      });
    }, 80);
    return () => clearTimeout(tid);
  }, [settings, onPromptChange, onSettingsChange]);

  // 类型切换 + 模型列表变化时，自动校准默认模型
  useEffect(() => {
    const exists = models.some(
      (m) => m.displayName === settings.model && m.type === settings.contentType,
    );
    if (exists) return;
    // 当前模型不可用（被删除/禁用/类型不匹配）→ 切到第一个可用的后台模型
    const defaultModel = getDefaultModel(settings.contentType);
    if (defaultModel) {
      onSettingsChange({ ...settings, model: defaultModel });
    }
  }, [settings.contentType, settings.model, models]);

  const agents = [
    { icon: Wand2, label: '提示词优化', desc: '将简单描述优化为详细的古风人像提示词', key: 'optimize' },
    { icon: Palette, label: '风格迁移', desc: '将参考图风格应用到新生成中', key: 'style' },
    { icon: User, label: '角色一致性', desc: '保持角色面部特征一致', key: 'consistency' },
    { icon: Music, label: '配乐生成', desc: '为视频生成匹配的古风配乐', key: 'music' },
  ];

  // 按生成类型过滤可用模型（排除内置占位 p0）
  const availableModels = models.filter((m) => {
    const provider = providers.find((p) => p.id === m.providerId);
    if (!provider || !provider.enabled || !m.enabled) return false;
    if (provider.id === 'p0') return false; // 排除内置占位（无真实 API）
    if (settings.contentType === 'image' && m.type !== 'image') return false;
    if (settings.contentType === 'video' && m.type !== 'video') return false;
    if (modelSearch && !m.displayName.toLowerCase().includes(modelSearch.toLowerCase())
      && !getEffectiveModelName(m).toLowerCase().includes(modelSearch.toLowerCase())
      && !m.modelId.toLowerCase().includes(modelSearch.toLowerCase())) return false;
    return true;
  });

  // 按 model_id 聚合（同 model_id 多供应商 → 一个入口，避免重名）
  const groupedModels = groupModelsByModelId(availableModels);

  // 当前选中模型（按 dispatch 存储键 displayName 匹配）
  const currentModel = models.find((m) => m.displayName === settings.model);
  // 顶栏展示名：优先映射名
  const currentModelLabel = getEffectiveModelName(currentModel) || settings.model || '无';
  const availableResolutions: Resolution[] =
    settings.contentType === 'image' && currentModel?.supportedResolutions
      ? currentModel.supportedResolutions
      : [];

  // 本地 dev 降级用占位图：避免 MOCK_MEDIA_LIST 的平台专有路径 404
  const LOCAL_PLACEHOLDER_SVG = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/>
        </linearGradient>
      </defs>
      <rect width="400" height="300" fill="url(#bg)" rx="12"/>
      <text x="200" y="135" text-anchor="middle" fill="#334155" font-size="16" font-family="sans-serif">本地占位</text>
      <text x="200" y="165" text-anchor="middle" fill="#1e293b" font-size="12" font-family="sans-serif">AI 生成需飞书平台环境</text>
    </svg>`
  )}`;

  // 降级：用本地 mock 数据填充生成结果（平台能力不可用时）
  // 注意：mock items 用传入的 pendingIds —— 这样父级 onGenerate 按 id 替换能命中 pending
  const fillMockItems = (pendingIds: string[]) => {
    const pool = MOCK_MEDIA_LIST.length > 0 ? MOCK_MEDIA_LIST : [];
    const now = Date.now();
    pendingIds.forEach((id, i) => {
      const base = pool.length > 0 ? pool[(now + i) % pool.length] : null;
      const thumbnail = import.meta.env.DEV ? LOCAL_PLACEHOLDER_SVG : (base?.thumbnail || '');
      const fullUrl = import.meta.env.DEV ? LOCAL_PLACEHOLDER_SVG : (base?.fullUrl || '');
      const item: IMediaItem = {
        id,
        title: promptText.slice(0, 20) || '本地降级示例',
        type: 'image',
        thumbnail,
        fullUrl,
        prompt: promptText,
        model: settings.model,
        ratio: settings.ratio,
        createdAt: new Date().toISOString(),
        isFavorite: false,
        isDeleted: false,
        source: 'mock',
      };
      // 错峰 100ms，避免一次性触发大重渲染
      setTimeout(() => onGenerate(item), i * 100);
    });
  };

  const handleGenerate = async () => {
    // 自我注册到 ref（避免在组件顶层读未初始化的 const，绕过 TDZ）
    handleGenerateRef.current = handleGenerate;

    if (!promptText.trim()) {
      toast.error('请先输入提示词', { duration: 3000 });
      inputRef.current?.focus();
      return;
    }

    // ── 立即释放按钮：用户可以继续编辑 prompt 或立刻再次提交 ──
    setGenerating(false);

    const count = Math.max(1, Math.min(4, Number(settings.count) || 1));
    const now = Date.now();

    // ── 1) 立刻构造 N 个 pending 占位，调 onPendingCreate 插入 mediaList ──
    const pendingItems: IMediaItem[] = [];
    for (let i = 0; i < count; i++) {
      pendingItems.push({
        id: `gen-pending-${now}-${i}`,
        title: promptText.slice(0, 20) || '生成中...',
        type: settings.contentType,
        thumbnail: '',
        fullUrl: '',
        prompt: promptText,
        model: settings.model,
        ratio: settings.ratio,
        createdAt: new Date().toISOString(),
        isFavorite: false,
        isDeleted: false,
        source: 'user',
        status: 'pending',
      });
    }
    onPendingCreate(pendingItems);
    const pendingIds = pendingItems.map((p) => p.id);

    // 清空输入框，让用户立刻可以输入下一个 prompt
    onPromptChange('');

    toast.info('已提交生成请求', {
      description: `模型 ${currentModelLabel} · ${count} 张 · 服务端按并发均衡分配给供应商`,
      duration: 2500,
    });

    // ── 2) 后台异步跑生成/上传/探测 —— 不阻塞 UI，按完成顺序逐张替换 pending ──
    (async () => {
      try {
        const genResult = await apiGenerate({
          model: settings.model,
          prompt: promptText,
          ratio: settings.ratio,
          resolution: settings.resolution || '1k',
          count,
          contentType: settings.contentType,
        });
        const resultImages = Array.isArray(genResult.images) ? genResult.images.filter(Boolean) : [];

        if (resultImages.length > 0) {
          for (let i = 0; i < resultImages.length && i < pendingIds.length; i++) {
            const pendingId = pendingIds[i];
            let ossUrl = '';
            let ossObjectKey = '';
            let ossUploaded = false;

            // OSS 上传（保持原逻辑）
            let imgBlob: Blob | null = null;
            try {
              if (resultImages[i].startsWith('data:')) {
                imgBlob = await (await fetch(resultImages[i])).blob();
              } else {
                const proxied = await apiProxyFetch(resultImages[i]);
                if (proxied.success && proxied.base64) {
                  const byteChars = atob(proxied.base64);
                  const byteArr = new Uint8Array(byteChars.length);
                  for (let k = 0; k < byteChars.length; k++) byteArr[k] = byteChars.charCodeAt(k);
                  imgBlob = new Blob([byteArr], { type: proxied.contentType || 'image/jpeg' });
                } else {
                  logger.warn(`代理下载失败：${proxied.message}`);
                }
              }
            } catch (e) {
              logger.warn(`图片下载失败：${e instanceof Error ? e.message : String(e)}`);
            }

            if (ossConfig.enabled && imgBlob) {
              const file = new File([imgBlob], `gen-${now}-${i}.jpg`, { type: 'image/jpeg' });
              const MAX_ATTEMPTS = 3;
              for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                  const uploadResult = await uploadToOss(file, `gen-${now}-${i}.jpg`);
                  if (uploadResult.success && uploadResult.url) {
                    ossUrl = uploadResult.url;
                    ossObjectKey = uploadResult.objectKey;
                    ossUploaded = true;
                    logger.info(`OSS 上传成功（第 ${attempt}/${MAX_ATTEMPTS} 次）：${ossUrl}`);
                    break;
                  }
                } catch (e) {
                  logger.warn(`OSS 上传异常（第 ${attempt}/${MAX_ATTEMPTS} 次）：${e instanceof Error ? e.message : String(e)}`);
                }
                if (attempt < MAX_ATTEMPTS) {
                  await new Promise((r) => setTimeout(r, 800));
                }
              }
              if (!ossUploaded) {
                logger.warn(`OSS 上传经 ${MAX_ATTEMPTS} 次重试仍失败，回退到模型原始 URL：${resultImages[i].slice(0, 80)}`);
                toast.warning(`图片 ${i + 1} 上传 OSS 失败，已回退使用服务商原始链接（链接可能随时过期）`, { duration: 4000 });
              }
            } else if (!ossConfig.enabled) {
              toast.error('OSS 未开启，请到「模型 Hub → 存储配置」开启', { duration: 5000 });
            }

            const persistentUrl = ossUploaded ? ossUrl : resultImages[i];
            const probe = await probeImageLoad(persistentUrl);

            const finalItem: IMediaItem = {
              id: pendingId,
              title: promptText.slice(0, 20) || '生成结果',
              type: settings.contentType,
              thumbnail: persistentUrl,
              fullUrl: persistentUrl,
              prompt: promptText,
              model: settings.model,
              ratio: settings.ratio,
              createdAt: new Date().toISOString(),
              isFavorite: false,
              isDeleted: false,
              source: 'user',
              ossUrl,
              ossObjectKey,
              ossUploaded,
              progress: 100,
            };
            if (!probe.ok) {
              finalItem.status = 'failed';
              finalItem.errorMessage = probe.error || '图片链接已失效';
              finalItem.failedAt = new Date().toISOString();
            }
            // 通知父级按 id 替换 pending → 真图
            onGenerate(finalItem);
          }
          const successCount = resultImages.length;
          const failCount = count - successCount;
          if (failCount > 0) {
            toast.warning(`生成成功 ${successCount} 张 / ${failCount} 张未返回`, { duration: 4000 });
          } else {
            toast.success(`生成完成 · ${successCount} 张`, { duration: 2500 });
          }
          logger.info(`图片生成成功（服务端分发），共 ${successCount} 张`);
        } else {
          const firstError = genResult.error || '生成失败：服务商返回异常';
          toast.error(firstError, { duration: 5000 });
          logger.warn(`生成失败 → 降级 mock：${firstError}`);
          fillMockItems(pendingIds);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        toast.error(`生成异常：${errMsg || '未知错误'}`, { duration: 5000 });
        logger.error('图片生成异常:', errMsg);
        fillMockItems(pendingIds);
      }
    })();
  };

  const handleOptimize = async () => {
    if (!promptText.trim()) return;
    setOptimizing(true);
    try {
      logger.info('开始优化提示词:', promptText.slice(0, 50));
      const stream = capabilityClient
        .load('ancient_style_portrait_prompt_optimizer_1')
        .callStream('textGenerate', {
          simple_description: promptText,
          additional_requirements: '古风人像，电影级光影，东方古典审美',
        });
      let full = '';
      for await (const chunk of stream) {
        const piece = (chunk as { content?: string })?.content;
        if (piece) {
          full += piece;
          onPromptChange(full);
        }
      }
      logger.info('提示词优化完成');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      toast.error(`优化失败：${errMsg || '服务暂不可用'}`);
      logger.error('提示词优化失败:', errMsg);
    } finally {
      setOptimizing(false);
    }
  };

  /** 风格迁移：基于参考图，将目标风格应用到新生成中 */
  const handleStyleTransfer = async () => {
    if (referenceImages.length === 0) {
      toast.warning('请先添加参考图（点击 + 按钮上传），再使用风格迁移');
      return;
    }
    setOptimizing(true);
    try {
      logger.info('调用风格迁移能力，参考图数:', referenceImages.length);
      await capabilityClient
        .load('ancient_style_portrait_style_transfer_1')
        .call('imageToImage', {
          prompt: promptText,
          referenceImages,
          target_style: '古风',
        });
      toast.success('风格迁移已应用，开始生成');
      logger.info('风格迁移能力调用成功');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // dev 模式降级：参考图会在生成时通过 API 一起传入
      toast.warning(
        `风格迁移能力暂不可用（${errMsg.slice(0, 60)}）\n参考图将在生成时自动应用`,
        { duration: 5000 },
      );
      logger.warn('风格迁移能力调用失败：', errMsg);
    } finally {
      setOptimizing(false);
    }
  };

  /** 角色一致性：基于参考图保持角色面部特征 */
  const handleCharacterConsistency = async () => {
    if (referenceImages.length === 0) {
      toast.warning('请先添加角色参考图，再使用角色一致性');
      return;
    }
    setOptimizing(true);
    try {
      logger.info('调用角色一致性能力，参考图数:', referenceImages.length);
      await capabilityClient
        .load('ancient_style_portrait_character_consistency_1')
        .call('imageToImage', {
          prompt: promptText,
          referenceImages,
        });
      toast.success('角色一致性已应用，开始生成');
      logger.info('角色一致性能力调用成功');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      toast.warning(
        `角色一致性能力暂不可用（${errMsg.slice(0, 60)}）\n参考图将在生成时自动应用`,
        { duration: 5000 },
      );
      logger.warn('角色一致性能力调用失败：', errMsg);
    } finally {
      setOptimizing(false);
    }
  };

  /** 配乐生成：为视频生成匹配的古风配乐描述/音频 */
  const handleMusicGeneration = async () => {
    if (settings.contentType !== 'video') {
      toast.warning('配乐生成仅适用于视频模式，请先切换到"视频"');
      return;
    }
    setOptimizing(true);
    try {
      logger.info('调用配乐生成能力');
      const result = await capabilityClient
        .load('ancient_style_portrait_music_generation_1')
        .call('textGenerate', {
          prompt: promptText,
          style: '古风',
          duration: settings.duration,
        });
      toast.success('配乐生成能力已调用');
      logger.info('配乐生成能力调用成功', result);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      toast.warning(`配乐生成能力暂不可用（${errMsg.slice(0, 60)}）`, {
        duration: 5000,
      });
      logger.warn('配乐生成能力调用失败：', errMsg);
    } finally {
      setOptimizing(false);
    }
  };

  /** 根据 agent.key 路由到对应 handler */
  const runAgent = (key: string) => {
    switch (key) {
      case 'optimize': void handleOptimize(); break;
      case 'style': void handleStyleTransfer(); break;
      case 'consistency': void handleCharacterConsistency(); break;
      case 'music': void handleMusicGeneration(); break;
    }
  };

  const toggleContentType = () => {
    onSettingsChange({
      ...settings,
      contentType: settings.contentType === 'image' ? 'video' : 'image',
    });
  };

  return (
    <div className="px-4 pb-6 pt-2">
      <div className="relative z-30 mx-auto max-w-3xl rounded-3xl bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 shadow-2xl shadow-black/40">
        {/* 顶部：类型切换 + 模型 + 数量（紧凑 pill 行） */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-4 py-2.5">
          {/* 类型切换 — SegmentedControl 风格（一个圆角容器 + 滑动高亮） */}
          <div className="flex items-center gap-0.5 rounded-full bg-zinc-800/50 p-0.5">
            {(['image', 'video'] as const).map((t) => {
              const active = settings.contentType === t;
              return (
                <button
                  key={t}
                  onClick={() => onSettingsChange({ ...settings, contentType: t })}
                  className={`relative z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 active:scale-95 ${
                    active
                      ? 'bg-zinc-900 text-emerald-400 shadow-sm shadow-black/40'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {t === 'image' ? (
                    // 图片 → 圆点
                    <svg viewBox="0 0 12 12" className="size-3" fill="currentColor" aria-hidden="true">
                      <circle cx="6" cy="6" r="3.5" />
                    </svg>
                  ) : (
                    // 视频 → 方块
                    <svg viewBox="0 0 12 12" className="size-3" fill="currentColor" aria-hidden="true">
                      <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
                    </svg>
                  )}
                  {t === 'image' ? '图片' : '视频'}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {/* 分辨率选择（仅在当前模型有支持时显示） */}
            {availableResolutions.length > 0 && (
              <div className="flex items-center rounded-full bg-zinc-800/50 px-1 py-1">
                {ALL_RESOLUTIONS.filter((r) => availableResolutions.includes(r)).map((res) => (
                  <button
                    key={res}
                    onClick={() => onSettingsChange({ ...settings, resolution: res })}
                    className={`rounded-full px-2 py-1 text-[10px] font-bold transition-all duration-300 ${
                      (settings.resolution || '1k') === res
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'text-zinc-500 hover:text-white'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            )}

            {/* 比例选择 */}
            <div className="flex items-center rounded-full bg-zinc-800/50 px-1 py-1">
              {(['16:9', '4:3', '1:1', '3:4', '9:16'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => onSettingsChange({ ...settings, ratio: r })}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition-all duration-300 ${
                    settings.ratio === r
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            {/* 模型 */}
            <div className="relative">
              <button
                onClick={() => setModelMenuOpen(!modelMenuOpen)}
                className="flex h-7 items-center gap-1.5 rounded-full bg-zinc-800/50 pl-2.5 pr-2 text-xs text-white hover:bg-zinc-800 transition-colors"
              >
                <Settings2 className="size-3.5 text-zinc-500" />
                <span className="max-w-[140px] truncate font-medium">
                  {currentModelLabel}
                </span>
                {/* 积分位置：始终显示，0 时显示「免费」灰色徽章, >0 时显示 amber 徽章 */}
                {currentModel && typeof currentModel.creditCost === 'number' && currentModel.creditCost > 0 ? (
                  <span className="shrink-0 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold">
                    {currentModel.creditCost} 积分
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-zinc-700/40 text-zinc-500 border border-zinc-700/50 px-1.5 py-0.5 text-[9px] font-medium">
                    免费
                  </span>
                )}
                <ChevronDown className="size-3 text-zinc-500" />
              </button>
              {modelMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
                    onClick={() => { setModelMenuOpen(false); setModelSearch(''); }}
                  />
                  {/* 下拉弹出：相对触发按钮水平居中 (left-1/2 + -translate-x-1/2) + bottom-full = 按钮正上方居中 */}
                  <div className="absolute left-1/2 bottom-full z-40 mb-1 w-72 -translate-x-1/2 overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl">
                    {/* 搜索框 */}
                    <div className="border-b border-zinc-800 p-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                        <input
                          type="text"
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          placeholder="搜索模型..."
                          autoFocus
                          className="w-full rounded-xl bg-zinc-800/50 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                        />
                      </div>
                    </div>

                    {/* 模型列表 */}
                    <div className="max-h-72 overflow-y-auto p-1.5">
                      {groupedModels.length === 0 ? (
                        <div className="py-6 text-center text-xs text-zinc-600">
                          暂无可用模型
                        </div>
                      ) : (
                        groupedModels.map((g) => {
                          const active = settings.model === g.displayName;
                          return (
                            <button
                              key={g.modelId}
                              onClick={() => {
                                onSettingsChange({ ...settings, model: g.displayName });
                                setModelMenuOpen(false);
                                setModelSearch('');
                              }}
                              className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-all duration-200 ${
                                active
                                  ? 'bg-emerald-500/10 text-emerald-400 font-medium'
                                  : 'text-zinc-300 hover:bg-zinc-800/50'
                              }`}
                            >
                              <span className="flex-1 truncate">{getEffectiveModelName(g) || g.displayName}</span>
                              {/* 积分位置：始终显示（0 → 免费灰色, >0 → amber） */}
                              {typeof g.creditCost === 'number' && g.creditCost > 0 ? (
                                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                                  active
                                    ? 'bg-amber-400/15 text-amber-300'
                                    : 'bg-amber-500/10 text-amber-400'
                                }`}>
                                  {g.creditCost} 积分
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-full bg-zinc-800 text-zinc-500 px-1.5 py-0.5 text-[9px] font-medium">
                                  免费
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 数量选择 - 单次请求拿 N 张一样的图片 */}
            <div
              className="flex items-center rounded-full bg-zinc-800/50 px-1 py-1"
              title="单次请求返回 N 张图片（不是发 N 次请求）"
            >
              {([1, 2, 3, 4] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onSettingsChange({ ...settings, count: c })}
                  className={`group/count relative z-10 flex items-center gap-0.5 rounded-full px-2.5 py-1 text-[10px] font-bold transition-all duration-200 active:scale-95 ${
                    settings.count === c
                      ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/30'
                      : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  <Copy className={`size-3 ${settings.count === c ? 'opacity-90' : 'opacity-60'}`} />
                  {c}
                </button>
              ))}
              {/* 鼠标悬停显示说明气泡 */}
              <div className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-900 border border-zinc-700 px-2.5 py-1 text-[10px] font-medium text-zinc-300 opacity-0 group-hover/count:opacity-100 transition-opacity">
                <span className="text-emerald-400">并发 {settings.count} 次</span> 独立请求
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rotate-45 bg-zinc-900 border-r border-b border-zinc-700" />
              </div>
            </div>
          </div>
        </div>

        {/* 参考图缩略图行 */}
        {referenceImages.length > 0 && (
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
            {referenceImages.map((url) => (
              <div key={url} className="relative">
                <div className="h-12 w-12 overflow-hidden rounded-xl border border-zinc-800">
                  <Image src={url} alt="参考图" className="h-full w-full object-cover" />
                </div>
                <button
                  onClick={() => onRemoveReference(url)}
                  className="!absolute -right-1.5 -top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <button
              onClick={onAddReference}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-zinc-700 text-zinc-500 hover:border-emerald-500/50 hover:text-emerald-400 transition-colors"
            >
              <Plus className="size-4" />
            </button>
          </div>
        )}

        {/* 输入区 */}
        <div className="flex items-end gap-2 px-4 py-3">
          {/* 智能体按钮 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAgentOpen(!agentOpen)}
              className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white pointer-events-auto transition-colors"
              title="智能体"
            >
              <Sparkles className="size-4" />
            </button>
            {agentOpen && (
              <>
                <div
                  className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
                  onClick={() => setAgentOpen(false)}
                />
                <div className="absolute bottom-full left-0 z-[999] mb-2 w-72 overflow-hidden rounded-[1.5rem] bg-zinc-950 border border-zinc-800 p-2 shadow-2xl shadow-black/60">
                  {agents.map((a) => {
                    const Icon = a.icon;
                    return (
                      <button
                        key={a.key}
                        disabled={optimizing}
                        onClick={() => {
                          runAgent(a.key);
                          setAgentOpen(false);
                        }}
                        className="flex w-full items-start gap-3 rounded-2xl p-3 text-left hover:bg-zinc-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                          <Icon className="size-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white">{a.label}</div>
                          <div className="text-xs text-zinc-500">{a.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* 文本输入 */}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={promptText}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="您希望创作什么内容？"
              rows={1}
              className="w-full resize-none bg-transparent py-2 pr-8 text-sm text-white placeholder:text-zinc-500 focus:outline-none max-h-32 [&::-webkit-resizer]:hidden"
              style={{ minHeight: '40px', resize: 'none' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
            <button
              type="button"
              onClick={() => setPromptEditorOpen(true)}
              title="展开编辑器"
              className="absolute right-1 bottom-1 z-10 flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>

          {/* 右侧按钮组 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAddReference}
              className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-white pointer-events-auto transition-colors"
              title="添加图片"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!promptText.trim()}
              className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 pointer-events-auto transition-all duration-200"
              title="生成（提交后立即释放，可连续提交）"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>

        {/* 全屏编辑提示词弹窗 */}
        <Dialog open={promptEditorOpen} onOpenChange={setPromptEditorOpen}>
          <DialogContent className="max-w-3xl bg-zinc-900 border-zinc-800">
            <DialogHeader>
              <DialogTitle className="text-white">编辑提示词</DialogTitle>
              <DialogDescription className="text-zinc-500">
                在此撰写详细的生成提示词（支持 Enter 直接换行，Shift+Enter 同）
              </DialogDescription>
            </DialogHeader>
            <textarea
              value={promptText}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="您希望创作什么内容？"
              autoFocus
              className="mt-3 w-full min-h-[320px] resize-none rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500/50 focus:outline-none"
            />
            <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
              <span>{promptText.length} 字符</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPromptEditorOpen(false)}
                  className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => setPromptEditorOpen(false)}
                  className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 transition-colors"
                >
                  完成
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

const GenerationBarForwarded = forwardRef<GenerationBarHandle, GenerationBarProps>(GenerationBar);
GenerationBarForwarded.displayName = 'GenerationBar';
export default GenerationBarForwarded;
