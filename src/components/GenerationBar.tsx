import { useState, useRef, useEffect, useImperativeHandle, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
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
  Loader2,
  SlidersHorizontal,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { capabilityClient, logger } from '@/services/client-capabilities';
import Image from '@/components/ui/image';
import { IMediaItem, MOCK_MEDIA_LIST } from '@/data/media';
import { useModelHub } from '@/hooks/useModelHub';
import { groupModelsByModelId } from '@/utils/groupModels';
import { useOssConfig } from '@/hooks/useOssConfig';
import { apiProxyFetch, apiGenerate, apiOptimizePrompt, apiGetGenerationStatus, apiListActiveGenerations, apiGetProviderStates, apiGetQueueStatus } from '@/services/api';
import { refreshUser, setAuthModalOpen, useAuth } from '@/services/authStore';
import { ALL_RESOLUTIONS, type Resolution, type IAiModel, getEffectiveModelName } from '@/data/models';
import type { Ratio, Quality } from '@/data/settings';
// 注意：原 probeImageLoad(persistentUrl) 在 OSS 失败分支探测 provider URL，因 CORS 不可靠
// 会把生成成功的图误判为 failed，已在本文件 processResultImages 中移除该探测（信任 server 200）。
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

// 全部可选比例（与 settings.ts 的 Ratio 保持一致；'auto' = 智能比例）
const ALL_RATIOS: Ratio[] = [
  'auto', '1:1', '1:2', '2:1',
  '9:16', '16:9', '3:4', '4:3',
  '3:2', '2:3', '5:4', '4:5',
  '21:9', '9:21',
];

const QUALITY_OPTIONS: { key: Quality; label: string }[] = [
  { key: 'low', label: '低画质' },
  { key: 'standard', label: '标准画质' },
  { key: 'high', label: '高画质' },
];

// 比例显示：auto → "智能"
const formatRatio = (r: Ratio) => (r === 'auto' ? '智能' : r);

/**
 * 把后端/服务商原始错误友好化为中文提示。
 * 重点处理「速率限制（RPM）」类：服务商物理 429 文案（如
 * "resolution rate limit exceeded: 3K tier allows 1 requests per 1 minute(s)"）
 * 直接透传给用户不友好，这里转成「该模型限速 X 张/分钟，请稍后重试」。
 * fallbackRpm 为本站后台配置的限速（如有），用于原始文案解析不到数字时兜底。
 */
function friendlyGenerateError(raw: string, fallbackRpm?: number): string {
  if (!raw) return '生成失败';
  const s = raw.trim();
  if (/rate limit|too many request|请求过于频繁|RPM|requests per 1 minute|429|限流/i.test(s)) {
    const m = s.match(/(\d+)\s*requests?\s*per\s*(\d*)\s*min/i);
    const rpm = m ? Number(m[1]) : (Number.isFinite(fallbackRpm) && (fallbackRpm as number) > 0 ? fallbackRpm as number : 0);
    if (rpm > 0) {
      return `该模型限速 ${rpm} 张/分钟，请稍后重试（或降低同时生成数量、换更高配额的服务商）`;
    }
    return '该服务商触发限流，请稍后重试（或降低同时生成数量）';
  }
  // 其他错误：原样截断，避免超长堆栈
  return s.slice(0, 120);
}

/**
 * 从 apiFetch 抛出的 "API 402: {...}" 错误文本里提取后端返回的 code
 * （NEED_RECHARGE=不支持奖励且充值不足 / INSUFFICIENT=支持奖励但双池皆不足）。
 */
function extractGenerateCode(msg: string): string | undefined {
  const m = msg.match(/^API \d+:\s*(\{[\s\S]*\})\s*$/);
  if (m) { try { const b = JSON.parse(m[1]); return b.code; } catch {} }
  return undefined;
}

/**
 * 余额类拦截的统一文案（限制对话窗口 + pending 失败占位共用）：
 * - NEED_RECHARGE  → 该模型不支持奖励余额，且充值余额不足
 * - INSUFFICIENT   → 支持奖励余额，但奖励余额与充值余额都不足
 * - 其他           → 通用积分不足
 */
function balanceLimitInfo(code: string | undefined): { title: string; message: string; friendly: string } {
  if (code === 'NEED_RECHARGE') {
    return {
      title: '该模型不支持奖励余额',
      message: '当前模型仅可使用充值余额支付，而您的充值余额不足。\n请前往账户充值后再生成。',
      friendly: '该模型不支持奖励余额，且充值余额不足',
    };
  }
  if (code === 'INSUFFICIENT') {
    return {
      title: '积分不足',
      message: '当前模型支持奖励余额：奖励余额与充值余额均不足以支付本次生成。\n请充值，或等待平台奖励到账后再试。',
      friendly: '奖励余额与充值余额均不足',
    };
  }
  return { title: '积分不足', message: '本次生成所需积分不足，请充值后重试。', friendly: '积分不足' };
}


interface IGenerationSettings {
  contentType: 'image' | 'video';
  ratio: Ratio;
  resolution: '1k' | '2k' | '4k' | '8k';
  quality: Quality;
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
  /** 外部（配方 / 变体）触发时，把参考图写回父级 state（变体要把示例缩略图当参考图） */
  onSetReferenceImages?: (urls: string[]) => void;
  generating: boolean;
  setGenerating: (v: boolean) => void;
  prompt: string;
  onPromptChange: (v: string) => void;
  /** 反向提示词（正负向搭配刚需），随生成请求透传 */
  negativePrompt?: string;
  onNegativePromptChange?: (v: string) => void;
  /** 由「用此角色创作」带入的角色 id：生成出的素材会自动归属到该角色，用于角色生成记录聚合 */
  characterId?: string;
}

/** 父级调用 retry() 时用的参数：仅需 prompt + model + ratio（其它用当前 settings） */
export interface RetryPayload {
  prompt: string;
  model: string;
  ratio: string;
}

/** 父级通过 ref 触发「配方预填 / 变体生成」的参数 */
export interface GenerationPayload {
  prompt: string;
  model: string;
  ratio: string;
  /** 变体 / Remix：把示例缩略图当作参考图传入（不传则纯预填配方） */
  referenceImages?: string[];
  /** 是否立即触发生成（默认 true：一键复刻 / 一键变体） */
  auto?: boolean;
}

/** 父级通过 ref 触发重试 / 配方 / 变体的 imperative handle */
export interface GenerationBarHandle {
  retry: (payload: RetryPayload) => void;
  /** 聚焦底部提示词输入框（供空状态「立即创作」CTA 使用） */
  focusInput: () => void;
  /** 配方预填 + 可选变体参考图（T1 配方复用 / T2 变体 Remix） */
  generate: (payload: GenerationPayload) => void;
}

function GenerationBar({
  settings,
  onSettingsChange,
  onPendingCreate,
  onGenerate,
  referenceImages,
  onRemoveReference,
  onAddReference,
  onSetReferenceImages,
  generating,
  setGenerating,
  prompt,
  onPromptChange,
  negativePrompt,
  onNegativePromptChange,
  characterId,
  ref,
}: GenerationBarProps & { ref?: React.Ref<GenerationBarHandle> }) {
  const characterIdRef = useRef(characterId);
  characterIdRef.current = characterId;
  const promptText = prompt ?? '';
  const negativePromptText = negativePrompt ?? '';
  const [agentOpen, setAgentOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  // 优化输出语言：en（英文，生图引擎需要）/ zh（中文，国内工具）/ both（英文主填 + 中文对照）
  const [optLang, setOptLang] = useState<'en' | 'zh' | 'both'>('en');
  // 中英对照模式下展示的中文正向对照（只读预览）
  const [zhPreview, setZhPreview] = useState('');
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  // 尺寸设置弹窗（质量/清晰度/比例 —— 向上弹窗，一次选择）
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── 限制对话窗口：余额/奖励不支持时的拦截弹窗（双池账务核心 UX）──
  const [limitDialog, setLimitDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    reason: '' | 'NEED_RECHARGE' | 'INSUFFICIENT' | 'NO_LOGIN';
  }>({ open: false, title: '', message: '', reason: '' });

  // ── 三个抽屉全部 Portal 到 body，确保永远在最外层，不被卡片 hover/选中盖住 ──
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const agentBtnRef = useRef<HTMLButtonElement>(null);
  const [settingsPos, setSettingsPos] = useState<{ top: number; left: number } | null>(null);
  const [modelPos, setModelPos] = useState<{ top: number; left: number } | null>(null);
  const [agentPos, setAgentPos] = useState<{ top: number; left: number } | null>(null);

  // 滚动/缩放时自动关闭抽屉，避免触发按钮位置变了，portal 的固定坐标还在原处
  useEffect(() => {
    if (!settingsOpen && !modelMenuOpen && !agentOpen) return;
    const onScrollOrResize = () => { setSettingsOpen(false); setModelMenuOpen(false); setAgentOpen(false); };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [settingsOpen, modelMenuOpen, agentOpen]);

  const { providers, models, getProviderName, getDefaultModel } = useModelHub();
  const { config: ossConfig, uploadFile: uploadToOss, buildOssUrl } = useOssConfig();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── 重试 / 配方 / 变体 imperative handle ──
  // 全部走 ref（而非 useEffect 依赖 state），避免父级回调身份变化导致 effect 重跑取消定时器。
  const handleGenerateRef = useRef<(overrides?: { referenceImages?: string[] }) => Promise<void>>(async () => {});
  // 把会被 imperative 方法用到的「最新值 / 回调」放进 ref，确保调用时拿到当前渲染的最新版本
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onPromptChangeRef = useRef(onPromptChange);
  onPromptChangeRef.current = onPromptChange;
  const onSettingsChangeRef = useRef(onSettingsChange);
  onSettingsChangeRef.current = onSettingsChange;
  const onSetReferenceImagesRef = useRef(onSetReferenceImages);
  onSetReferenceImagesRef.current = onSetReferenceImages;

  // ── 持久化：把进行中的 taskId+pending 写入 localStorage，刷新后能恢复 ──
  // 跨页面/刷新后由下方 useEffect 读取并续上轮询
  const PENDING_KEY = '__app_flow_pending_generations__';
  type PersistedTask = {
    taskId: string;
    pendingItems: IMediaItem[];        // 恢复时回插到 mediaList 的占位（按 id 命中替换）
    prompt: string;
    model: string;
    ratio: string;
    resolution: string;
    count: number;
    contentType: 'image' | 'video';
    referenceImages?: string[];
    createdAt: string;
  };
  const loadPersistedTasks = (): PersistedTask[] => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };
  const savePersistedTasks = (arr: PersistedTask[]) => {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); } catch {}
  };
  const appendPersistedTask = (t: PersistedTask) => {
    const arr = loadPersistedTasks();
    arr.push(t);
    savePersistedTasks(arr);
  };
  const removePersistedTask = (taskId: string) => {
    savePersistedTasks(loadPersistedTasks().filter((x) => x.taskId !== taskId));
  };

  // ── 抽取结果处理为可复用函数（初始提交 / 刷新恢复两条路径都走这个）──
  /**
   * 把后端返回的图片 URL 列表逐张：下载 → 上传 OSS（若开启）→ 探活 → 替换 pending。
   * 与同步流程保持完全一致：失败回填 mock；OSS 关闭有 toast 提示。
   */
  const processResultImages = async (
    resultImages: string[],
    pendingIds: string[],
    ctx: { prompt: string; model: string; ratio: string; contentType: 'image' | 'video'; createdAt: number },
  ): Promise<{ success: number; failed: number }> => {
    let success = 0;
    for (let i = 0; i < resultImages.length && i < pendingIds.length; i++) {
      const pendingId = pendingIds[i];
      let ossUrl = '';
      let ossObjectKey = '';
      let ossUploaded = false;
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
        const file = new File([imgBlob], `gen-${ctx.createdAt}-${i}.jpg`, { type: 'image/jpeg' });
        const MAX_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const uploadResult = await uploadToOss(file, `gen-${ctx.createdAt}-${i}.jpg`);
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
          if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 800));
        }
        if (!ossUploaded) {
          logger.warn(`OSS 上传经 ${MAX_ATTEMPTS} 次重试仍失败，回退到模型原始 URL：${resultImages[i].slice(0, 80)}`);
          toast.warning(`图片 ${i + 1} 上传 OSS 失败，已回退使用服务商原始链接（链接可能随时过期）`, { duration: 4000 });
        }
      } else if (!ossConfig.enabled) {
        toast.error('OSS 未开启，请到「模型 Hub → 存储配置」开启', { duration: 5000 });
      }
      const persistentUrl = ossUploaded ? ossUrl : resultImages[i];
      // 不再做 probeImageLoad(provider URL) 探测 —— provider 临时链接没 CORS 头，
      // <img> 加载受 CORS 限制 onload/onerror 不可靠，会把生产已成功的好图误判成 failed。
      // 信任服务端 200（resultImages[i] 已返图 = 生成成功）→ finalItem.status 直接 success，
      // UI 层 useMediaUrlStatus 走 OSS 主路径 / provider 兜底，失效链接由 useImageProbe 友好提示。
      const finalItem: IMediaItem = {
        id: pendingId,
        title: ctx.prompt.slice(0, 20) || '生成结果',
        type: ctx.contentType,
        thumbnail: persistentUrl,
        fullUrl: persistentUrl,
        prompt: ctx.prompt,
        model: ctx.model,
        ratio: ctx.ratio,
        createdAt: new Date().toISOString(),
        isFavorite: false,
        isDeleted: false,
        source: 'user',
        ossUrl,
        ossObjectKey,
        ossUploaded,
        progress: 100,
        characterId: characterIdRef.current,
      };
      // finalItem.status 默认 'success'——server 已返图就是成功。
      // 显示层由 useMediaUrlStatus 处理：OSS 链接直接展示，provider 兜底链接失效时由 useImageProbe 提示。
      onGenerate(finalItem);
      success++;
    }
    return { success, failed: pendingIds.length - success };
  };

  // ── 单个 task 的轮询：完成后调用 processResultImages；中断/失败有兜底 ──
  // pendingItems 用于恢复时回插到 mediaList（首次提交通常 null，因为已经插好了）
  const pollTaskUntilDone = async (
    taskId: string,
    pendingIds: string[],
    ctx: { prompt: string; model: string; ratio: string; contentType: 'image' | 'video'; createdAt: number },
    pendingItemsToRestore: IMediaItem[] | null,
  ): Promise<void> => {
    // 第一次进入轮询：若是恢复路径，先把 pending 占位回插到 mediaList
    if (pendingItemsToRestore && pendingItemsToRestore.length > 0) {
      onPendingCreate(pendingItemsToRestore);
    }
    const MAX_POLLS = 90; // 90 * 2s = 3 分钟
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await apiGetGenerationStatus(taskId);
      if (st.status === 'done' && st.result) {
        const imgs = (st.result.images || []).filter(Boolean);
        if (imgs.length > 0) {
          await processResultImages(imgs, pendingIds, ctx);
          toast.success(`生成完成 · ${imgs.length} 张`, { duration: 2500 });
        } else {
          // 任务完成但无图：按失败处理
          markPendingAsFailed(pendingIds, st.error || '生成结果为空');
        }
        removePersistedTask(taskId);
        return;
      }
      if (st.status === 'failed') {
        markPendingAsFailed(pendingIds, st.error || '生成失败');
        removePersistedTask(taskId);
        return;
      }
      if (st.status === 'not_found') {
        // 后端清掉了（重启/超期），按失败处理
        markPendingAsFailed(pendingIds, '任务已被服务端清理');
        removePersistedTask(taskId);
        return;
      }
      // running/unknown：继续轮询
    }
    // 轮询超时（3 分钟还没完成）
    markPendingAsFailed(pendingIds, '轮询超时（3 分钟未完成），请到「模型 Hub」查看服务商状态');
    removePersistedTask(taskId);
  };

  // 把一组 pendingIds 标为 failed 状态（不删，让用户能看到失败占位以便重试）
  const markPendingAsFailed = (pendingIds: string[], errorMessage: string) => {
    const friendly = friendlyGenerateError(errorMessage, currentRateLimit);
    for (const pid of pendingIds) {
      onGenerate({
        id: pid,
        title: promptText.slice(0, 20) || '生成失败',
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
        status: 'failed',
        errorMessage: friendly,
        failedAt: new Date().toISOString(),
        progress: 100,
        characterId: characterIdRef.current,
      });
    }
  };

  useImperativeHandle(ref, () => ({
    retry: (payload: RetryPayload) => {
      // 直接编排：预填 prompt + model + ratio，延时后触发生成。
      // 不依赖 useEffect，避免父级回调身份变化导致定时器被取消。
      onPromptChangeRef.current(payload.prompt);
      onSettingsChangeRef.current({ ...settingsRef.current, model: payload.model, ratio: payload.ratio });
      setTimeout(() => {
        handleGenerateRef.current();
      }, 120);
    },
    focusInput: () => {
      inputRef.current?.focus();
    },
    generate: (payload: GenerationPayload) => {
      // T1 配方复用：预填 prompt + model + ratio（一键复刻）
      // T2 变体 Remix：额外把示例缩略图当参考图传入 apiGenerate
      onPromptChangeRef.current(payload.prompt);
      onSettingsChangeRef.current({ ...settingsRef.current, model: payload.model, ratio: payload.ratio });
      if (payload.referenceImages && payload.referenceImages.length > 0) {
        onSetReferenceImagesRef.current?.(payload.referenceImages);
      }
      setTimeout(() => {
        // auto=false 时只预填不生成；否则立即生成（一键复刻 / 一键变体）
        handleGenerateRef.current(payload.auto === false ? undefined : { referenceImages: payload.referenceImages });
      }, 120);
    },
  }), []);

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
  // 模型是否支持奖励余额（缺省视为支持）
  const modelSupportsReward = (m?: IAiModel | null) => (m ? m.supportsRewardBalance !== false : false);
  // 模型奖励价（支持奖励时所需奖励积分；缺省回退充值价）
  const modelRewardPrice = (m?: IAiModel | null) =>
    m && typeof m.rewardCreditsRequired === 'number' && m.rewardCreditsRequired > 0
      ? m.rewardCreditsRequired
      : (typeof m?.creditCost === 'number' ? m.creditCost : 0);
  const availableResolutions: Resolution[] =
    settings.contentType === 'image' && currentModel?.supportedResolutions
      ? currentModel.supportedResolutions
      : [];

  // 当前模型所属服务商对「当前分辨率档」配置的每分钟上限（用于 UI 提示 + 错误兜底）
  const currentProvider = currentModel ? providers.find((p) => p.id === currentModel.providerId) : undefined;
  const currentRateLimit = currentProvider ? (() => {
    const rl = (currentProvider.rateLimits || {}) as any;
    const res = settings.contentType === 'video' ? 'video' : (settings.resolution || '1k');
    if (rl && typeof rl === 'object' && rl.bucket_units_per_min != null && rl.ops) {
      const cost = rl.ops[res] ?? 1;
      return Math.max(0, Math.floor((Number(rl.bucket_units_per_min) || 20) / (cost || 1)));
    }
    const v = rl && typeof rl === 'object' ? rl[res] : undefined;
    return typeof v === 'number' ? v : undefined;
  })() : undefined;

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
      <text x="200" y="165" text-anchor="middle" fill="#1e293b" font-size="12" font-family="sans-serif">AI 生成示例 · 本地预览</text>
    </svg>`
  )}`;

  // 后台调度实时反馈：轮询 /api/providers/states 拿各账号冷热/限额/并发。
  // 只在用户已选模型时才挂轮询（无意义的早期请求不浪费），离开页面自动停。
  // —— 触发条件：
  //   - 全平台账号 100% cold → 红色徽章「无可用账号」
  //   - cold 占比 ≥ 50%     → 黄色徽章「可用账号紧张 a/b」
  //   - 否则                 不显示（默认无干扰）
  const [providerStates, setProviderStates] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!currentModel) return;
    let alive = true;
    const load = async () => {
      try {
        const s = await apiGetProviderStates();
        if (alive) setProviderStates(s || {});
      } catch { /* 静默：states 拉取失败不打扰用户 */ }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [currentModel]);

  // 派生"当前模型关联账号 / 全局账号"的可用度
  type Level = 'critical' | 'tight' | 'ok' | 'unknown';
  const availability: { level: Level; label: string; cold: number; total: number } = useMemo(() => {
    const entries = Object.values(providerStates || {});
    const total = entries.length;
    if (total === 0) return { level: 'unknown', label: '', cold: 0, total: 0 };

    // 视角：平台级冷热（states 含所有账号）。当前模型能调度的账号只是子集，
    // 但 GenerationBar 没拿到全 providers，无 providerId→accounts 映射；
    // 平台级"调度池可用度"对"现在能不能跑起来"是更直接的口径。
    const cold = entries.filter((s: any) => !!s?.cold).length;
    const ratio = cold / total;
    if (ratio >= 1) return { level: 'critical', label: `无可用账号（${total}/${total} 冷）`, cold, total };
    if (ratio >= 0.5) return { level: 'tight', label: `可用账号紧张（${total - cold}/${total} 热）`, cold, total };
    return { level: 'ok', label: '', cold, total };
  }, [providerStates, currentModel]);

  // 等待区聚合状态（公开接口，无需 admin）：后台反馈"资源不足"提示的唯一来源。
  // - triggered=true → 所有资源不可用 且 等待区积压 > 阈值（阈值可调，默认 10）→ 红色"资源不足"
  // 当前登录用户的套餐（用于区分会员/非会员的等待区提示与升级 CTA）
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMember = !!user && user.plan && user.plan !== 'free';

  // 优先级高于上面的 availability 徽章（资源不足比"账号紧张"更严重）。
  const [queueStatus, setQueueStatus] = useState<{ waitingAreaSize: number; memberWaiting: number; allResourcesDown: boolean; threshold: number; triggered: boolean }>({
    waitingAreaSize: 0, memberWaiting: 0, allResourcesDown: false, threshold: 10, triggered: false,
  });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await apiGetQueueStatus();
        if (alive) setQueueStatus(s || { waitingAreaSize: 0, allResourcesDown: false, threshold: 10, triggered: false });
      } catch { /* 静默：队列状态拉取失败不打扰用户 */ }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

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

  /**
   * 双池余额前置校验（纯前端预判，后端 402 为安全网）：
   * - 未登录            → NO_LOGIN（弹登录框）
   * - 支持奖励且奖励够   → ok（优先扣奖励）
   * - 支持奖励但奖励不足、充值够 → ok + FALLBACK（回退充值，toast 提示）
   * - 支持奖励但双池不足 → INSUFFICIENT（拦截 + 限制对话窗口）
   * - 不支持奖励：充值够 → ok；充值不足 → NEED_RECHARGE（拦截）
   */
  const checkBalance = (): {
    ok: boolean;
    reason?: 'FALLBACK' | 'NEED_RECHARGE' | 'INSUFFICIENT' | 'NO_LOGIN';
    title?: string;
    message?: string;
  } => {
    if (!user) return { ok: false, reason: 'NO_LOGIN', title: '请先登录', message: '登录后即可使用奖励/充值积分生成作品。' };
    const cost = typeof currentModel?.creditCost === 'number' ? currentModel.creditCost : 0;
    const supportsReward = modelSupportsReward(currentModel);
    const rewardRequired = modelRewardPrice(currentModel);
    const reward = user.rewardCredits || 0;
    const recharge = user.rechargeCredits || 0;
    if (supportsReward) {
      if (reward >= rewardRequired && rewardRequired > 0) return { ok: true };
      if (recharge >= cost && cost > 0) {
        return {
          ok: true,
          reason: 'FALLBACK',
          title: '奖励余额不足，将使用充值余额',
          message: `当前模型支持奖励余额：奖励余额需 ${rewardRequired}，您现有奖励 ${reward} 不足，将自动使用充值余额（${recharge}）抵扣 ${cost} 积分。`,
        };
      }
      return {
        ok: false,
        reason: 'INSUFFICIENT',
        title: '积分不足',
        message: `当前模型支持奖励余额：奖励余额需 ${rewardRequired}，充值余额需 ${cost}。\n您现有 奖励 ${reward} · 充值 ${recharge}，均不足以支付本次生成。`,
      };
    }
    // 不支持奖励：只能走充值
    if (recharge >= cost && cost > 0) return { ok: true };
    return {
      ok: false,
      reason: 'NEED_RECHARGE',
      title: '该模型不支持奖励余额',
      message: `此模型仅可用充值余额支付 ${cost} 积分，您当前充值余额 ${recharge} 不足，请先充值。`,
    };
  };

  const handleGenerate = async (overrides?: { referenceImages?: string[] }) => {
    // 自我注册到 ref（避免在组件顶层读未初始化的 const，绕过 TDZ）
    handleGenerateRef.current = handleGenerate;

    // 变体 Remix：优先用外部传入的参考图（示例缩略图），否则用当前参考图 state
    const effectiveRefs = overrides?.referenceImages?.length
      ? overrides.referenceImages
      : referenceImages;

    if (!promptText.trim()) {
      toast.error('请先输入提示词', { duration: 3000 });
      inputRef.current?.focus();
      return;
    }

    // ── 双池余额前置校验（全局优先扣奖励，不足回退充值，都不够拦截）──
    // 在创建 pending 占位之前拦截，避免产生幽灵占位 / 误走 mock 兜底。
    const bal = checkBalance();
    if (!bal.ok) {
      if (bal.reason === 'NO_LOGIN') {
        setAuthModalOpen(true);
        toast.error('请先登录后再生成', { duration: 4000 });
      } else {
        setLimitDialog({ open: true, title: bal.title || '积分不足', message: bal.message || '', reason: bal.reason as 'NEED_RECHARGE' | 'INSUFFICIENT' });
      }
      return;
    }
    // 奖励不足但充值够（回退充值）：提示但不拦截
    if (bal.reason === 'FALLBACK') {
      toast.info(bal.message || '奖励余额不足，将使用充值余额抵扣', { duration: 3500 });
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
    onNegativePromptChange?.('');
    setZhPreview('');

    toast.info('已提交生成请求', {
      description: `模型 ${currentModelLabel} · ${count} 张 · 服务端按并发均衡分配给供应商`,
      duration: 2500,
    });

    // ── 2) 异步：先提交拿 taskId（不阻塞 UI，刷新也能恢复）──
    (async () => {
      // 幂等键：每次生成请求一个 UUID，防网络抖动双扣（后端必需）。
      // 非安全上下文（如纯 HTTP 局域网 IP）下 crypto.randomUUID 不可用，用降级方案。
      let idempotencyKey: string;
      try {
        idempotencyKey =
          typeof crypto !== 'undefined' && crypto.randomUUID && window.isSecureContext
            ? crypto.randomUUID()
            : 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      } catch {
        idempotencyKey = 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      }
      try {
        const r = await apiGenerate({
          model: settings.model,
          prompt: promptText,
          ratio: settings.ratio,
          resolution: settings.resolution || '1k',
          quality: settings.quality,
          count,
          contentType: settings.contentType,
          referenceImages: effectiveRefs.length > 0 ? effectiveRefs : undefined,
          pendingIds,
          negative: negativePromptText.trim() || undefined,
          idempotencyKey,
        });

        // 失败分支优先处理鉴权/计费类错误（避免误走 mock 兜底）
        if (r.status === 'failed') {
          const err = (r as { error?: string }).error || '';
          if (/401|未登录/.test(err)) {
            // 未登录：打开登录弹窗，不消耗 mock
            setAuthModalOpen(true);
            toast.error('请先登录后再生成', { duration: 4000 });
            return;
          }
          if (/402|积分不足/.test(err) || r.code === 'NEED_RECHARGE' || r.code === 'INSUFFICIENT') {
            // 余额不足：绝不走 mock 兜底（不白送图），弹限制对话窗口并标记失败
            const info = balanceLimitInfo(r.code);
            markPendingAsFailed(pendingIds, info.friendly);
            setLimitDialog({ open: true, title: info.title, message: info.message, reason: (r.code === 'NEED_RECHARGE' ? 'NEED_RECHARGE' : 'INSUFFICIENT') });
            return;
          }
          toast.error(friendlyGenerateError(err, currentRateLimit));
          fillMockItems(pendingIds);
          return;
        }

        // 新异步通道：返回 { status: 'pending', taskId }
        if ('taskId' in r && r.taskId && r.status === 'pending') {
          // 扣费已发生，刷新顶部积分显示
          void refreshUser().catch(() => {});
          // 写 localStorage 持久化，刷新后由下方 useEffect 续上
          appendPersistedTask({
            taskId: r.taskId,
            pendingItems,
            prompt: promptText,
            model: settings.model,
            ratio: settings.ratio,
            resolution: settings.resolution || '1k',
            count,
            contentType: settings.contentType,
            referenceImages: effectiveRefs.length > 0 ? effectiveRefs : undefined,
            createdAt: new Date(now).toISOString(),
          });
          // 在本会话内启动轮询（这条 promise 完了就移除持久化条目）
          await pollTaskUntilDone(
            r.taskId,
            pendingIds,
            { prompt: promptText, model: settings.model, ratio: settings.ratio, contentType: settings.contentType, createdAt: now },
            null,
          );
          return;
        }
        // 老同步通道：直接拿 images 走原流程（兼容 sync=1）
        const resultImages = (r as { images?: string[] }).images || [];
        if (resultImages.length > 0) {
          void refreshUser().catch(() => {});
          await processResultImages(resultImages, pendingIds, {
            prompt: promptText,
            model: settings.model,
            ratio: settings.ratio,
            contentType: settings.contentType,
            createdAt: now,
          });
          toast.success(`生成完成 · ${resultImages.length} 张`, { duration: 2500 });
        } else {
          const firstError = (r as { error?: string }).error || '生成失败：服务商返回异常';
          toast.error(friendlyGenerateError(firstError, currentRateLimit), { duration: 5000 });
          fillMockItems(pendingIds);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        // 网络层 401/402 也能识别（apiFetch 抛 "API 401/402"）
        if (/401|未登录/.test(errMsg)) {
          setAuthModalOpen(true);
          toast.error('请先登录后再生成', { duration: 4000 });
          return;
        }
        if (/402|积分不足/.test(errMsg) || extractGenerateCode(errMsg) === 'NEED_RECHARGE' || extractGenerateCode(errMsg) === 'INSUFFICIENT') {
          // 余额不足（网络层 402）：弹限制对话窗口 + 标记失败，不 mock 兜底
          const code = extractGenerateCode(errMsg);
          const info = balanceLimitInfo(code);
          markPendingAsFailed(pendingIds, info.friendly);
          setLimitDialog({ open: true, title: info.title, message: info.message, reason: (code === 'NEED_RECHARGE' ? 'NEED_RECHARGE' : 'INSUFFICIENT') });
          return;
        }
        toast.error(friendlyGenerateError(errMsg, currentRateLimit), { duration: 5000 });
        logger.error('图片生成异常:', errMsg);
        fillMockItems(pendingIds);
      }
    })();
  };

  // ── 刷新/挂载恢复：双保险 ──
  // 1) localStorage（含完整 pendingItems 元数据）—— 主恢复路径
  // 2) /api/generate/active（服务端权威，含 prompt/model/ratio/createdAt）—— 兜底，
  //    覆盖 localStorage 被清/不可用的情况；只恢复在途(running)任务，避免用过期
  //    provider URL 覆盖已落库的好图。
  useEffect(() => {
    let cancelled = false;
    const localTasks = loadPersistedTasks();
    const localTaskIds = new Set(localTasks.map((t) => t.taskId));

    // 主路径：localStorage（保留到每任务解决后才移除，避免中途崩溃丢任务）
    const recoverLocal = async () => {
      for (const t of localTasks) {
        if (cancelled) return;
        try {
          // 先到后端查这个 task 真实状态（可能在挂载期间已经完成）
          const st = await apiGetGenerationStatus(t.taskId);
          const pendingIds = t.pendingItems.map((p) => p.id);
          const ctx = {
            prompt: t.prompt,
            model: t.model,
            ratio: t.ratio,
            contentType: t.contentType,
            createdAt: new Date(t.createdAt).getTime(),
          };
          if (st.status === 'done' && st.result?.images && st.result.images.length > 0) {
            // 已经完成 → 回插 pending 占位 + 立刻替换为真图（onGenerate 已是 upsert，绝不丢）
            await pollTaskUntilDone(t.taskId, pendingIds, ctx, t.pendingItems);
          } else if (st.status === 'failed') {
            markPendingAsFailed(pendingIds, st.error || '生成失败');
          } else if (st.status === 'not_found') {
            markPendingAsFailed(pendingIds, '任务已被服务端清理（重启或超期）');
          } else {
            // running/unknown：续上轮询
            await pollTaskUntilDone(t.taskId, pendingIds, ctx, t.pendingItems);
          }
        } catch (e) {
          // 恢复失败：标 failed，避免遗留"幽灵 pending"
          markPendingAsFailed(
            t.pendingItems.map((p) => p.id),
            `恢复失败：${e instanceof Error ? e.message : String(e)}`,
          );
        } finally {
          // 解决成功/失败后才从 localStorage 清除（取消挂载则保留，下次再试）
          if (!cancelled) removePersistedTask(t.taskId);
        }
      }
    };

    // 兜底路径：服务端在途任务（localStorage 未覆盖到的）
    const recoverServer = async () => {
      try {
        const { tasks } = await apiListActiveGenerations();
        for (const t of tasks || []) {
          if (cancelled) return;
          if (localTaskIds.has(t.taskId)) continue; // 已由 localStorage 处理
          if (t.status !== 'running') continue; // 只恢复在途；done/failed 已由 localStorage 或已落库处理
          const meta = (t.clientMeta || {}) as Record<string, unknown>;
          const ratio = (typeof meta.ratio === 'string' && meta.ratio) || '1:1';
          const contentType = (t.contentType || 'image') as 'image' | 'video';
          const pendingItems: IMediaItem[] = (t.pendingIds || []).map((id: string, i: number) => ({
            id,
            title: (t.prompt || '').slice(0, 20) || '生成中...',
            type: contentType,
            thumbnail: '',
            fullUrl: '',
            prompt: t.prompt || '',
            model: t.model || '',
            ratio,
            createdAt: new Date(t.createdAt || Date.now()).toISOString(),
            isFavorite: false,
            isDeleted: false,
            source: 'user',
            status: 'pending',
          }));
          if (pendingItems.length === 0) continue;
          const pendingIds = pendingItems.map((p) => p.id);
          const ctx = {
            prompt: t.prompt || '',
            model: t.model || '',
            ratio,
            contentType,
            createdAt: new Date(t.createdAt || Date.now()).getTime(),
          };
          await pollTaskUntilDone(t.taskId, pendingIds, ctx, pendingItems);
        }
      } catch {
        // 服务端恢复失败不阻塞主路径
      }
    };

    void recoverLocal();
    void recoverServer();
    return () => { cancelled = true; };
  // 仅在挂载时跑一次
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI 提示词优化（智能体 skill：调后台启用的 text 推理模型）
  // 替换原飞书 capabilityClient 实现，统一走服务端 /api/agent/optimize-prompt
  const handleOptimize = async () => {
    const trimmed = promptText.trim();
    if (!trimmed) {
      toast.error('请先输入提示词');
      return;
    }
    if (trimmed.length < 60) {
      toast.error('提示词过短，无法优化', {
        description: '请将提示词补充到 60 字以上后再使用 AI 优化',
        duration: 3000,
      });
      return;
    }
    if (optimizing) return;
    setOptimizing(true);
    try {
      const r = await apiOptimizePrompt(promptText, { targetLang: optLang });
      if (r.success && r.positive) {
        onPromptChange(r.positive);
        if (onNegativePromptChange) onNegativePromptChange(r.negative || '');
        setZhPreview(optLang === 'both' ? (r.positiveZh || '') : '');
        const langLabel = optLang === 'zh' ? '中文' : optLang === 'both' ? '中英对照' : '英文';
        if (r.fallback) {
          toast.warning('AI 模型繁忙，已启用兜底翻译', {
            description: r.warning || '当前推理模型不可用，已使用本地关键词兜底。建议稍后重试，或到「模型 Hub」检查 text 模型状态。',
            duration: 5000,
          });
        } else {
          toast.success(`已用「${r.modelUsed || '推理模型'}」优化提示词（${langLabel}）`, { duration: 2500 });
        }
      } else if (r.code === 'NO_REASONING_MODEL') {
        toast.error('未配置文本推理模型', {
          description: '请到「模型 Hub」添加一个 type=text 的模型（需要服务商已配置 API Key）',
          duration: 5000,
        });
      } else {
        toast.error(`优化失败：${r.error || '未知错误'}`);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      toast.error(`优化异常：${errMsg.slice(0, 100)}`);
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
    <div className="px-4 pb-7 pt-3">
      <div className="relative z-30 mx-auto max-w-4xl rounded-3xl bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 shadow-2xl shadow-black/40">
        {/* 顶部：类型切换 + 模型 + 数量（紧凑 pill 行）
            - flex-nowrap + overflow-x-auto：窄屏一行水平滑动，不换行
            - 每个 pill 加 shrink-0 + whitespace-nowrap：防止中文被竖排一字一行 */}
        <div className="flex flex-nowrap items-center justify-between gap-3 overflow-x-auto border-b border-zinc-800/80 px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* 类型切换 — SegmentedControl 风格（一个圆角容器 + 滑动高亮） */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-800/50 p-0.5">
            {(['image', 'video'] as const).map((t) => {
              const active = settings.contentType === t;
              return (
                <button
                  key={t}
                  onClick={() => onSettingsChange({ ...settings, contentType: t })}
                  className={`relative z-10 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 active:scale-95 ${
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

          <div className="flex shrink-0 items-center gap-2">
            {/* 尺寸设置（质量 / 清晰度 / 比例 —— 向上弹窗，一次选择） */}
            <div className="relative">
              <button
                ref={settingsBtnRef}
                onClick={() => {
                  const rect = settingsBtnRef.current?.getBoundingClientRect();
                  if (rect) setSettingsPos({ top: rect.top, left: rect.left + rect.width / 2 });
                  setSettingsOpen((v) => !v);
                }}
                className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-800/50 pl-2.5 pr-2 text-xs text-white hover:bg-zinc-800 transition-colors"
                title="图像质量 / 清晰度 / 比例"
              >
                <SlidersHorizontal className="size-3.5 text-zinc-500" />
                <span className="font-semibold tabular-nums">
                  {(settings.resolution || '1k').toUpperCase()}
                </span>
                <span className="text-zinc-600">·</span>
                <span className="font-medium">{formatRatio(settings.ratio)}</span>
                <ChevronDown
                  className={`size-3 text-zinc-500 transition-transform duration-200 ${settingsOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {settingsOpen && settingsPos && createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm"
                    onClick={() => setSettingsOpen(false)}
                  />
                  <div
                    className="fixed z-[9999] w-80 overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl shadow-black/60"
                    style={{
                      bottom: `${window.innerHeight - settingsPos.top + 8}px`,
                      left: settingsPos.left,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    {/* 图像质量 */}
                    <div className="p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        图像质量
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {QUALITY_OPTIONS.map((q) => (
                          <button
                            key={q.key}
                            onClick={() => onSettingsChange({ ...settings, quality: q.key })}
                            className={`rounded-xl py-2 text-xs font-medium transition-all duration-200 ${
                              settings.quality === q.key
                                ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                                : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'
                            }`}
                          >
                            {q.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-zinc-800" />
                    {/* 清晰度（仅在当前模型有支持时显示） */}
                    {availableResolutions.length > 0 && (
                      <>
                        <div className="p-3">
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            清晰度
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {ALL_RESOLUTIONS.filter((r) => availableResolutions.includes(r)).map((res) => (
                              <button
                                key={res}
                                onClick={() => onSettingsChange({ ...settings, resolution: res })}
                                className={`rounded-xl py-2 text-xs font-medium transition-all duration-200 ${
                                  (settings.resolution || '1k') === res
                                    ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'
                                }`}
                              >
                                {res}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="border-t border-zinc-800" />
                      </>
                    )}
                    {/* 图片尺寸（14 个常见比例 + 智能比例） */}
                    <div className="p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        图片尺寸
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {ALL_RATIOS.map((r) => (
                          <button
                            key={r}
                            onClick={() => onSettingsChange({ ...settings, ratio: r })}
                            className={`rounded-xl py-2 text-xs font-medium transition-all duration-200 ${
                              settings.ratio === r
                                ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                                : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'
                            }`}
                          >
                            {formatRatio(r)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>,
                document.body,
              )}
            </div>

            {/* 模型 */}
            <div className="relative">
              <button
                ref={modelBtnRef}
                onClick={() => {
                  const rect = modelBtnRef.current?.getBoundingClientRect();
                  if (rect) setModelPos({ top: rect.top, left: rect.left + rect.width / 2 });
                  setModelMenuOpen((v) => !v);
                }}
                className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-800/50 pl-2.5 pr-2 text-xs text-white hover:bg-zinc-800 transition-colors"
              >
                <Settings2 className="size-3.5 text-zinc-500" />
                <span className="max-w-[140px] truncate font-medium">
                  {currentModelLabel}
                </span>
                {/* 奖励价徽章：支持奖励余额的模型额外显示（emerald），直观告知"可用奖励积分" */}
                {currentModel && modelSupportsReward(currentModel) && (
                  <span
                    className="shrink-0 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold"
                    title={`支持奖励余额：单次生成需 ${modelRewardPrice(currentModel)} 奖励积分（全局优先扣奖励）`}
                  >
                    奖 {modelRewardPrice(currentModel)}
                  </span>
                )}
                {/* 充值价徽章：始终显示，0 时显示「免费」灰色徽章, >0 时显示 amber 徽章 */}
                {currentModel && typeof currentModel.creditCost === 'number' && currentModel.creditCost > 0 ? (
                  <span className="shrink-0 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold" title="充值价（真钱充值余额抵扣）">
                    {currentModel.creditCost} 积分
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-zinc-700/40 text-zinc-500 border border-zinc-700/50 px-1.5 py-0.5 text-[9px] font-medium">
                    免费
                  </span>
                )}
                {/* 等待区触发的"资源不足"提示（最高优先级）：所有资源不可用 且 等待区积压 > 阈值。
                    - 会员：正面安抚徽章「会员优先调度中」（已享优先出队，无需恐慌）
                    - 非会员：红色脉冲「资源不足 · 等待 N」—— 痛点即付费理由，配套升级 CTA 在按钮外 */}
                {queueStatus.triggered && isMember && (
                  <span
                    className="shrink-0 rounded-full bg-amber-500/15 text-amber-200 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-semibold"
                    title={`后台等待区积压 ${queueStatus.waitingAreaSize} 个请求（阈值 ${queueStatus.threshold}），您作为会员已优先调度`}
                  >
                    会员优先调度中 · 等待 {queueStatus.waitingAreaSize}
                  </span>
                )}
                {queueStatus.triggered && !isMember && (
                  <span
                    className="shrink-0 rounded-full bg-rose-500/20 text-rose-200 border border-rose-500/40 px-1.5 py-0.5 text-[9px] font-semibold animate-pulse"
                    title={`后台等待区积压 ${queueStatus.waitingAreaSize} 个请求（阈值 ${queueStatus.threshold}），所有调度账号均不可用。升级会员可优先调度`}
                  >
                    资源不足 · 等待 {queueStatus.waitingAreaSize}
                  </span>
                )}
                {/* 调度可用度徽章：仅在后端 states 反馈「无可用 / 紧张」时才显示，默认隐藏。
                    - 'critical'：100% 全冷 → 红色
                    - 'tight'  ：≥50% 冷  → 黄色
                    - 'ok'/'unknown'：不显示（用户原本的预期：上来不触发，节流时才提示） */}
                {!queueStatus.triggered && availability.level === 'critical' && (
                  <span
                    className="shrink-0 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 text-[9px] font-semibold animate-pulse"
                    title="后台反馈：所有调度账号都在冷却中，可能暂无可调度账号"
                  >
                    无可用账号
                  </span>
                )}
                {!queueStatus.triggered && availability.level === 'tight' && (
                  <span
                    className="shrink-0 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-semibold"
                    title="后台反馈：可用账号紧张，部分供应商正在冷却"
                  >
                    {availability.label}
                  </span>
                )}
                <ChevronDown className="size-3 text-zinc-500" />
              </button>
              {/* 升级 CTA（仅非会员、且触发资源不足时）：把"资源不足"痛点直接转成付费入口 */}
              {queueStatus.triggered && !isMember && (
                <button
                  type="button"
                  onClick={() => navigate('/account')}
                  className="flex h-7 items-center gap-1 rounded-full bg-rose-500 px-2.5 text-[10px] font-semibold text-white hover:bg-rose-400 transition-colors"
                  title="升级会员，等待区优先调度，资源恢复时优先出队"
                >
                  升级会员免排队
                </button>
              )}
              {modelMenuOpen && modelPos && createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm"
                    onClick={() => { setModelMenuOpen(false); setModelSearch(''); }}
                  />
                  <div
                    className="fixed z-[9999] w-72 overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl"
                    style={{
                      bottom: `${window.innerHeight - modelPos.top + 8}px`,
                      left: modelPos.left,
                      transform: 'translateX(-50%)',
                    }}
                  >
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
                              {/* 奖励价徽章：支持奖励余额的模型显示（emerald） */}
                              {modelSupportsReward(g) && (
                                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                                  active ? 'bg-emerald-400/15 text-emerald-300' : 'bg-emerald-500/10 text-emerald-400'
                                }`} title={`支持奖励余额：需 ${modelRewardPrice(g)} 奖励积分`}>
                                  奖 {modelRewardPrice(g)}
                                </span>
                              )}
                              {/* 充值价徽章：始终显示（0 → 免费灰色, >0 → amber） */}
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
                </>,
                document.body,
              )}
            </div>

            {/* 数量选择 - 单次请求拿 N 张一样的图片 */}
            <div
              className="flex shrink-0 items-center whitespace-nowrap rounded-full bg-zinc-800/50 px-1 py-1"
              title="单次请求返回 N 张图片（不是发 N 次请求）"
            >
              {([1, 2, 3, 4] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onSettingsChange({ ...settings, count: c })}
                  className={`group/count relative z-10 flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold transition-all duration-200 active:scale-95 ${
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

            {/* 双池余额指示：奖励（平台赠送，限定模型，优先扣）+ 充值（真钱，全部可用）；点击前往充值 */}
            {user && (
              <button
                type="button"
                onClick={() => navigate('/account')}
                title="奖励余额（平台赠送/活动发放，限定模型可用，优先扣减）· 充值余额（真钱充值，全部模型可用）。点击前往账户充值"
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-800/50 px-2 py-1 text-[10px] font-semibold tabular-nums hover:bg-zinc-800 transition-colors"
              >
                <span className="text-emerald-400" title="奖励余额">奖励 {user.rewardCredits || 0}</span>
                <span className="text-zinc-600">·</span>
                <span className="text-amber-400" title="充值余额">充值 {user.rechargeCredits || 0}</span>
              </button>
            )}
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
              ref={agentBtnRef}
              type="button"
              onClick={() => {
                const rect = agentBtnRef.current?.getBoundingClientRect();
                if (rect) setAgentPos({ top: rect.top, left: rect.left });
                setAgentOpen((v) => !v);
              }}
              className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white pointer-events-auto transition-colors"
              title="智能体"
            >
              <Sparkles className="size-4" />
            </button>
            {agentOpen && agentPos && createPortal(
              <>
                <div
                  className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm"
                  onClick={() => setAgentOpen(false)}
                />
                <div
                  className="fixed z-[9999] w-72 overflow-hidden rounded-[1.5rem] bg-zinc-950 border border-zinc-800 p-2 shadow-2xl shadow-black/60"
                  style={{
                    bottom: `${window.innerHeight - agentPos.top + 8}px`,
                    left: agentPos.left,
                  }}
                >
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
              </>,
              document.body,
            )}
          </div>

          {/* 文本输入 */}
          <div className="flex-1 min-w-0 relative">
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
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-800">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <span>编辑提示词</span>
                {/* 智能体 skill 入口：用后台推理模型优化当前提示词 */}
                <button
                  type="button"
                  onClick={handleOptimize}
                  disabled={optimizing || promptText.trim().length < 60}
                  className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 to-teal-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-400 hover:from-emerald-500/25 hover:to-teal-500/25 transition-all disabled:cursor-not-allowed disabled:opacity-40"
                  title="调用后台启用的文本推理模型，把当前提示词改写成更适合图像/视频生成的英文结构化描述"
                >
                  {optimizing ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      正在优化…
                    </>
                  ) : (
                    <>
                      <Wand2 className="size-3" />
                      AI 优化提示词
                    </>
                  )}
                </button>
                <span
                  className="ml-1 inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400"
                  title="提示词低于 60 字时无法提交 AI 优化"
                >
                  需 60 字以上
                </span>
              </DialogTitle>
              <DialogDescription className="text-zinc-500">
                在此撰写详细的生成提示词（支持 Enter 直接换行，Shift+Enter 同）。提示词过短会导致优化失败，建议超过 60 字后再点击「AI 优化提示词」。
              </DialogDescription>
            </DialogHeader>

            {/* 优化输出语言选择：让客户选，选一种另一种丢弃；中英对照则两者都给 */}
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">优化语言</span>
              {(['en', 'zh', 'both'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setOptLang(l)}
                  className={
                    'rounded-full px-3 py-1 text-[11px] font-medium transition-colors ' +
                    (optLang === l
                      ? 'bg-emerald-500 text-black'
                      : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800')
                  }
                >
                  {l === 'en' ? '英文' : l === 'zh' ? '中文' : '中英对照'}
                </button>
              ))}
            </div>

            <textarea
              value={promptText}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="您希望创作什么内容？"
              disabled={optimizing}
              className="mt-3 w-full min-h-[260px] resize-none rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500/50 focus:outline-none disabled:opacity-60"
            />

            {/* 负向提示词（正负向搭配刚需）：可选，随生成请求透传 */}
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">负向提示词（反向排除瑕疵，可选）</span>
                {negativePromptText.trim() && (
                  <button
                    type="button"
                    onClick={() => onNegativePromptChange?.('')}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    清空
                  </button>
                )}
              </div>
              <textarea
                value={negativePromptText}
                onChange={(e) => onNegativePromptChange?.(e.target.value)}
                placeholder="例如：watermark, text, logo, blurry, low quality, deformed, extra limbs"
                disabled={optimizing}
                className="w-full min-h-[72px] resize-none rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none disabled:opacity-60"
              />
            </div>

            {/* 中英对照模式下展示中文正向对照（只读预览，生图用上方英文） */}
            {optLang === 'both' && zhPreview && (
              <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="mb-1 text-[11px] text-zinc-400">中文对照（仅供理解，生图使用上方英文）</div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{zhPreview}</p>
              </div>
            )}
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

        {/* ── 限制对话窗口：余额/奖励不支持时的拦截说明 ── */}
        <Dialog open={limitDialog.open} onOpenChange={(o) => setLimitDialog((d) => ({ ...d, open: o }))}>
          <DialogContent className="max-w-md bg-zinc-900 border-zinc-800">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <AlertTriangle className="size-4 text-rose-400" />
                {limitDialog.title || '积分不足'}
              </DialogTitle>
              <DialogDescription className="whitespace-pre-line text-zinc-400">
                {limitDialog.message}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLimitDialog((d) => ({ ...d, open: false }))}
                className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                关闭
              </button>
              {limitDialog.reason === 'NO_LOGIN' ? (
                <button
                  type="button"
                  onClick={() => { setLimitDialog((d) => ({ ...d, open: false })); setAuthModalOpen(true); }}
                  className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 transition-colors"
                >
                  去登录
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setLimitDialog((d) => ({ ...d, open: false })); navigate('/account'); }}
                  className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 transition-colors"
                >
                  去充值
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

GenerationBar.displayName = 'GenerationBar';
export default GenerationBar;
