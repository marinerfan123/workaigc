import { useState, useEffect, useMemo, useCallback } from 'react';
import { logger } from '@/services/client-capabilities';
import {
  Plus,
  Search,
  Image as ImageIcon,
  Video,
  MessageSquare,
  Settings2,
  Trash2,
  Edit3,
  Check,
  X,
  ChevronDown,
  Server,
  Zap,
  Puzzle,
  Loader2,
  HardDriveUpload,
  Database,
  Globe,
  Key,
  FolderOpen,
  RefreshCw,
  UploadCloud,
  Link,
  Eye,
  EyeOff,
  FileText,
  Sparkles,
  Clock,
  Tag,
  Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  PROVIDER_TEMPLATES,
  type ModelType,
  type ProviderType,
  type Resolution,
  type IModelProvider,
  ALL_RESOLUTIONS,
  getEffectiveModelName,
  defaultEstimatedSeconds,
  defaultCategory,
  defaultCommercialUse,
} from '@/data/models';
import { useModelHub } from '@/hooks/useModelHub';
import { groupModelsByModelId } from '@/utils/groupModels';
import { useOssConfig } from '@/hooks/useOssConfig';
import { modelListClient } from '@/services/genericClient';
import { MOCK_MEDIA_LIST } from '@/data/media';
import { apiGetMedia, apiSaveMedia, apiProxyFetch, apiGetSettings, apiSaveSettings, apiSyncProviderModels, stripBlobItems, apiGetProviderStates, apiSetProviderCooldown } from '@/services/api';
import EndpointsTab from './EndpointsTab';
import PairingTab from './PairingTab';
import AsyncAddDialog from './AsyncAddDialog';
import AddModelDialog from './AddModelDialog';

const TYPE_LABELS: Record<ModelType, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
};

const TYPE_COLORS: Record<ModelType, string> = {
  image: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  video: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  text: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  official: '官方',
  relay: '中转站',
  custom: '自定义',
};

const PROVIDER_TYPE_ICONS: Record<ProviderType, typeof Server> = {
  official: Zap,
  relay: Server,
  custom: Puzzle,
};

// ─── 调度状态面板：账号冷热 / 实时共享桶，每 3s 轮询 + 管理员手动强切 ───
function ProviderSchedulerStatus({ providers }: { providers: any[] }) {
  const [states, setStates] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const s = await apiGetProviderStates();
      if (alive) setStates(s || {});
    };
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const toggle = async (id: string, state: string | null) => {
    const key = id + (state ?? 'auto');
    setBusy(key);
    await apiSetProviderCooldown(id, state);
    setStates(await apiGetProviderStates() || {});
    setBusy(null);
  };

  return (
    <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">调度状态 · 账号冷热</h3>
        <span className="text-[10px] text-zinc-500">每 3s 刷新</span>
      </div>
      {providers.length === 0 ? (
        <p className="text-xs text-zinc-500">暂无服务商。</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {providers.map((p) => {
            const st = states[p.id];
            const cold = !!st?.cold;
            const manual = st?.manualState;
            const isUnlimited = st?.capacityModel === 'unlimited' || p.capacityModel === 'unlimited';
            return (
              <div key={p.id} className="rounded-2xl border border-zinc-800 bg-zinc-800/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs font-semibold text-white">{p.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cold ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                    {cold ? '冷' : '热'}
                  </span>
                </div>
                <div className="mt-2 text-[10px] text-zinc-500">
                  {isUnlimited
                    ? '方向B · 无限速'
                    : `B=${st?.bucketUnitsPerMin ?? '?'} 余 ${st?.tokens ?? '?'} · 并发 ${st?.conc ?? 0}`}
                  {manual ? ` · 手动:${manual}` : ''}
                </div>
                <div className="mt-2 flex gap-1.5">
                  {(['cold', 'hot', null] as const).map((s) => {
                    const key = p.id + (s ?? 'auto');
                    const label = s === 'cold' ? '强制冷' : s === 'hot' ? '强制热' : '自动';
                    const cls = s === 'cold'
                      ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                      : s === 'hot'
                        ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                        : 'bg-zinc-700/40 text-zinc-300 hover:bg-zinc-700';
                    return (
                      <button
                        key={key}
                        onClick={() => toggle(p.id, s)}
                        disabled={busy === key}
                        className={`flex-1 rounded-lg py-1 text-[10px] transition-colors disabled:opacity-50 ${cls}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ModelHubPage() {
  const { providers, models, setProviders, setModels, deleteProvider, deleteModel, cleanupOrphanModels, getProviderName } = useModelHub();
  const { config: ossConfig, updateConfig: updateOssConfig, testConnection: testOssConnection, uploadFile: uploadToOss } = useOssConfig();
  const [activeTab, setActiveTab] = useState<'providers' | 'models' | 'endpoints' | 'pairing' | 'storage'>('models');
  const [asyncAddOpen, setAsyncAddOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);

  // OSS 表单状态
  const [ossForm, setOssForm] = useState(ossConfig);
  const [ossTesting, setOssTesting] = useState(false);
  const [ossTestResult, setOssTestResult] = useState<{ success: boolean; message: string; files?: { name: string; size: number; lastModified: string }[] } | null>(null);
  const [showAccessKeyId, setShowAccessKeyId] = useState(false);
  const [showAccessKeySecret, setShowAccessKeySecret] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkUploadProgress, setBulkUploadProgress] = useState({ current: 0, total: 0 });

  // OSS 操作日志
  type IOssLogLevel = 'info' | 'success' | 'error';
  type IOssLogAction = 'test' | 'upload' | 'bulk' | 'backfill';
  interface IOssLogEntry {
    id: string;
    timestamp: number;
    level: IOssLogLevel;
    action: IOssLogAction;
    message: string;
  }
  const [ossLog, setOssLog] = useState<IOssLogEntry[]>([]);
  const addOssLog = (level: IOssLogLevel, action: IOssLogAction, message: string) => {
    setOssLog((prev) => {
      const next = [{ id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now(), level, action, message }, ...prev];
      return next.slice(0, 50); // 最多保留 50 条
    });
  };
  const [typeFilter, setTypeFilter] = useState<ModelType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ReturnType<typeof useModelHub>['providers'][number] | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  // 获取模型列表相关
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<Array<{ id: string; modelId: string; displayName: string; mappingName?: string; type: ModelType; selected: boolean; supportedResolutions: Resolution[]; creditCost?: number }>>([]);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [syncingProviderId, setSyncingProviderId] = useState<string | null>(null);

  // 已保存模型卡的内联编辑（displayName + mappingName + creditCost）
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editMappingName, setEditMappingName] = useState('');
  const [editCreditCost, setEditCreditCost] = useState<number>(0);

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<ProviderType>('official');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formTypes, setFormTypes] = useState<ModelType[]>(['image', 'text']);
  const [formEnabled, setFormEnabled] = useState(true);
  const [formRemark, setFormRemark] = useState('');
  const [formProtocol, setFormProtocol] = useState<'openai-compatible' | 'custom'>('openai-compatible');
  const [showApiKey, setShowApiKey] = useState(false);
  const [formMaxConcurrent, setFormMaxConcurrent] = useState(2);
  // 容量模型与限速（统一共享 B 桶）
  const [formCapacityModel, setFormCapacityModel] = useState<'limited' | 'unlimited'>('limited');
  const [formBucketUnits, setFormBucketUnits] = useState(20);            // B：每账号每 60s 可用单位
  const [formBucketMax, setFormBucketMax] = useState<number | ''>('');   // 粒度上限；''=不限制
  const [formCooldownSec, setFormCooldownSec] = useState(60);            // 整账号冷却（秒）
  const [formOpCosts, setFormOpCosts] = useState<Record<'1k' | '2k' | '4k' | 'video', number>>({ '1k': 1, '2k': 2, '4k': 20, video: 20 });

  // 全局调度设置（最大并发）
  const [maxThreads, setMaxThreads] = useState(10);
  useEffect(() => {
    apiGetSettings().then((s) => { if (s && s.maxThreads) setMaxThreads(Number(s.maxThreads) || 10); }).catch(() => {});
  }, []);
  const saveScheduler = async () => {
    const cur = (await apiGetSettings().catch(() => ({}))) || {};
    await apiSaveSettings({ ...cur, maxThreads: Number(maxThreads) || 10 });
    toast.success('调度设置已保存');
  };

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (typeFilter !== 'all' && m.type !== typeFilter) return false;
      if (searchQuery && !m.displayName.toLowerCase().includes(searchQuery.toLowerCase())
        && !m.modelId.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [models, typeFilter, searchQuery]);

  // 按 model_id 聚合（同 model_id 多供应商 → 一个入口，避免重名）
  const groupedModels = useMemo(() => groupModelsByModelId(filteredModels), [filteredModels]);

  const openAddDialog = () => {
    setEditingProvider(null);
    setFormName('');
    setFormType('official');
    setFormBaseUrl('');
    setFormApiKey('');
    setFormTypes(['image', 'text']);
    setFormEnabled(true);
    setFormRemark('');
    setFormProtocol('openai-compatible');
    setFormMaxConcurrent(2);
    setFormCapacityModel('limited');
    setFormBucketUnits(20);
    setFormBucketMax('');
    setFormCooldownSec(60);
    setFormOpCosts({ '1k': 1, '2k': 2, '4k': 20, video: 20 });
    setShowApiKey(false);
    setProviderDialogOpen(true);
  };

  const openEditDialog = (provider: ReturnType<typeof useModelHub>['providers'][number]) => {
    setEditingProvider(provider);
    setFormName(provider.name);
    setFormType(provider.type);
    setFormBaseUrl(provider.baseUrl);
    setFormApiKey(provider.apiKey);
    setFormTypes([...provider.supportedTypes]);
    setFormEnabled(provider.enabled);
    setFormRemark(provider.remark || '');
    setFormProtocol(provider.protocol || 'openai-compatible');
    setFormMaxConcurrent(provider.maxConcurrent ?? 2);
    // 解析限速配置（兼容新旧格式）
    const rl = (provider.rateLimits || {}) as any;
    if (rl && typeof rl === 'object' && rl.bucket_units_per_min != null && rl.ops) {
      setFormCapacityModel(provider.capacityModel === 'unlimited' ? 'unlimited' : 'limited');
      setFormBucketUnits(Number(rl.bucket_units_per_min) || 20);
      setFormOpCosts({ '1k': rl.ops['1k'] ?? 1, '2k': rl.ops['2k'] ?? 2, '4k': rl.ops['4k'] ?? 20, video: rl.ops['video'] ?? 20 });
    } else if (rl && typeof rl === 'object' && (rl['1k'] != null || rl['2k'] != null || rl['4k'] != null)) {
      // 旧格式 RPM → 折算 B 与成本（仅展示用，后端会重新归一）
      const B = Number(rl['1k']) || 20;
      const cap = (t: string) => (rl[t] != null ? Number(rl[t]) : (t === '1k' ? B : t === '2k' ? B / 2 : 1));
      setFormCapacityModel('limited');
      setFormBucketUnits(B);
      setFormOpCosts({ '1k': 1, '2k': Math.max(1, Math.round(B / cap('2k'))), '4k': Math.max(1, Math.round(B / cap('4k'))), video: Math.max(1, Math.round(B / cap('4k'))) });
    } else {
      setFormCapacityModel(provider.capacityModel === 'unlimited' ? 'unlimited' : 'limited');
      setFormBucketUnits(20);
      setFormOpCosts({ '1k': 1, '2k': 2, '4k': 20, video: 20 });
    }
    setFormBucketMax(provider.bucketMax != null ? Number(provider.bucketMax) : '');
    setFormCooldownSec(Math.round((provider.cooldownMs || 60000) / 1000));
    setShowApiKey(false);
    setProviderDialogOpen(true);
  };

  const handleSaveProvider = () => {
    if (!formName.trim()) {
      toast.error('请输入服务商名称');
      return;
    }
    if (!formBaseUrl.trim()) {
      toast.error('请输入 API Base URL');
      return;
    }

    // 限速配置：方向 A 受限账号 → 新格式 {bucket_units_per_min, ops}；方向 B → 空
    const rateLimits: any = formCapacityModel === 'limited'
      ? {
          bucket_units_per_min: Number(formBucketUnits) || 20,
          ops: { '1k': formOpCosts['1k'], '2k': formOpCosts['2k'], '4k': formOpCosts['4k'], video: formOpCosts['video'] },
        }
      : {};
    const capacityMeta = {
      capacityModel: formCapacityModel,
      bucketMax: formBucketMax === '' ? null : Number(formBucketMax),
      cooldownMs: (Number(formCooldownSec) || 60) * 1000,
    };
    // 设了上限则 B 不得超过（后端同样会校验，此处前端先拦）
    if (formCapacityModel === 'limited' && formBucketMax !== '' && (Number(formBucketUnits) || 20) > Number(formBucketMax)) {
      toast.error(`B(${formBucketUnits}) 超过粒度上限 bucket_max(${formBucketMax})`);
      return;
    }

    if (editingProvider) {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === editingProvider.id
            ? { ...p, name: formName, type: formType, baseUrl: formBaseUrl, apiKey: formApiKey, supportedTypes: formTypes, enabled: formEnabled, remark: formRemark, protocol: formProtocol, maxConcurrent: formMaxConcurrent, rateLimits, ...capacityMeta }
            : p,
        ),
      );
      toast.success('服务商已更新');
    } else {
      const newProvider = {
        // ID 用 Date.now + 随机后缀，避免同毫秒创建时撞 ID
        id: `prov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: formName,
        type: formType,
        baseUrl: formBaseUrl,
        apiKey: formApiKey,
        maxConcurrent: formMaxConcurrent,
        rateLimits,
        ...capacityMeta,
        supportedTypes: formTypes,
        enabled: formEnabled,
        remark: formRemark,
        protocol: formProtocol,
        createdAt: new Date().toISOString(),
      };
      setProviders((prev) => [...prev, newProvider]);
      toast.success('服务商已添加');
    }
    setProviderDialogOpen(false);
  };

  const handleDeleteProvider = (id: string) => {
    // 走 hook 的 deleteProvider（后端单条 DELETE），不能只调 setProviders filter
    // 因为后端 POST /api/providers 是 upsert，无法删除"前端未传但后端存在"的项
    deleteProvider(id);
    toast.success('服务商已删除');
  };

  const handleToggleProvider = (id: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    // 模拟 API 测试
    await new Promise((r) => setTimeout(r, 1200));
    setTestingId(null);
    const provider = providers.find((p) => p.id === id);
    if (provider && provider.enabled) {
      toast.success('连接成功，延迟 128ms');
    } else {
      toast.error('连接失败：服务商未启用');
    }
  };

  const handleAddTemplate = (template: typeof PROVIDER_TEMPLATES[number]) => {
    const exists = providers.some((p) => p.name === template.name);
    if (exists) {
      toast.error('该服务商已存在');
      setTemplateMenuOpen(false);
      return;
    }
    const newProvider = {
      id: `prov-${Date.now()}`,
      name: template.name,
      type: template.type,
      baseUrl: template.baseUrl,
      apiKey: '',
      supportedTypes: template.supportedTypes,
      enabled: template.enabled,
      remark: template.remark,
      protocol: template.protocol || 'openai-compatible',
      createdAt: new Date().toISOString(),
    };
    setProviders((prev) => [...prev, newProvider]);
    setTemplateMenuOpen(false);
    toast.success(`已添加 ${template.name}`);
  };

  const toggleFormType = (t: ModelType) => {
    setFormTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  // 智能识别模型类型
  const detectModelType = useCallback((modelId: string): ModelType => {
    const id = modelId.toLowerCase();
    const imageKeywords = [
      'dall-e', 'dall_e', 'dalle', 'sd-', 'sd_', 'stable-diffusion', 'stable_diffusion',
      'midjourney', 'mj-', 'mj_', 'flux', 'imagen', 'nano-banana', 'nano_banana',
      'sdxl', 'draw', 'paint', 'image', 'img', 'sd3', 'sd 3', 'stable-diffusion-xl',
    ];
    const videoKeywords = [
      'sora', 'runway', 'pika', 'kling', 'veo', 'video', 'mov', 'gen-3', 'gen_3',
      'gen-2', 'gen_2', 'animate', 'luma', 'dream-machine', 'hailuo',
    ];
    for (const kw of imageKeywords) {
      if (id.includes(kw)) return 'image';
    }
    for (const kw of videoKeywords) {
      if (id.includes(kw)) return 'video';
    }
    return 'text';
  }, []);

  // 获取模型列表 —— 走 modelListClient 自动读服务商的自定义 listModels 端点或 OpenAI 默认
  const fetchModels = useCallback(async (
    baseUrl: string,
    apiKey: string,
    protocol: 'openai-compatible' | 'custom' = 'openai-compatible',
    customListModelsPath?: string,
  ) => {
    if (!baseUrl.trim()) {
      toast.error('请先填写 API Base URL');
      return false;
    }
    if (!apiKey.trim()) {
      toast.error('请先填写 API Key');
      return false;
    }

    setFetchingModels(true);
    try {
      const tempProvider: IModelProvider = {
        id: '__temp__',
        name: formName.trim() || '临时',
        type: formType,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        supportedTypes: formTypes,
        enabled: true,
        protocol,
        defaultEndpoint: protocol === 'custom' && customListModelsPath
          ? {
              protocol: 'custom',
              listModels: {
                path: customListModelsPath,
                method: 'GET',
                listFieldPath: 'data',
                listIdFieldPath: 'id',
                listNameFieldPath: 'id',
              },
            }
          : undefined,
        createdAt: new Date().toISOString(),
      };

      const result = await modelListClient.list({ provider: tempProvider });
      if (result.status !== 'success') {
        if (result.error?.includes('401')) toast.error('认证失败：API Key 无效');
        else if (result.error?.includes('404')) toast.error('接口不存在：该服务商可能不支持 /models 接口，可在「自定义协议」Tab 配置端点');
        else if (result.error?.includes('Failed to fetch') || result.error?.includes('CORS') || result.error?.includes('NetworkError')) {
          toast.error('网络错误：跨域限制，请确保服务商 API 支持 CORS 或使用代理');
        } else {
          toast.error(result.error || '获取失败');
        }
        return false;
      }
      if (result.models.length === 0) {
        toast.warning('该服务商返回了空模型列表');
        return false;
      }

      const modelsData = result.models.map((m, index) => {
        const mid = m.id;
        const inferredType = detectModelType(mid);
        return {
          id: `fetched-${Date.now()}-${index}`,
          modelId: mid,
          displayName: m.name || mid,
          type: inferredType,
          selected: true,
          supportedResolutions: (inferredType === 'image' ? ['1k', '2k', '4k'] : []) as Resolution[],
        };
      });

      setFetchedModels(modelsData);
      setModelSearchQuery('');
      setModelSelectOpen(true);
      toast.success(`获取成功，共 ${modelsData.length} 个模型`);
      return true;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error('fetch models failed:', errMsg);
      if (errMsg.includes('CORS') || errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
        toast.error('网络错误：跨域限制，请确保服务商 API 支持 CORS 或使用代理');
      } else {
        toast.error(`获取失败：${errMsg.slice(0, 100)}`);
      }
      return false;
    } finally {
      setFetchingModels(false);
    }
  }, [formName, formType, formTypes]);

  // 模型选择弹窗相关操作
  const toggleModelSelected = (id: string) => {
    setFetchedModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, selected: !m.selected } : m)),
    );
  };

  const toggleAllModels = (selected: boolean) => {
    setFetchedModels((prev) => prev.map((m) => ({ ...m, selected })));
  };

  const updateModelType = (id: string, type: ModelType) => {
    setFetchedModels((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        // 切换为非图片类型时，自动清空分辨率（避免脏数据）
        const nextResolutions: Resolution[] = type === 'image'
          ? (m.supportedResolutions.length > 0 ? m.supportedResolutions : (['1k', '2k', '4k'] as Resolution[]))
          : [];
        return { ...m, type, supportedResolutions: nextResolutions };
      }),
    );
  };

  const updateModelName = (id: string, name: string) => {
    setFetchedModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, displayName: name } : m)),
    );
  };

  /** 更新单个模型的映射名称（前台展示用，dispatch 仍按 model_id 走） */
  const updateModelMappingName = (id: string, name: string) => {
    setFetchedModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, mappingName: name } : m)),
    );
  };
  const updateModelCreditCost = (id: string, cost: number) => {
    setFetchedModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, creditCost: Math.max(0, Math.floor(cost) || 0) } : m)),
    );
  };

  /** 切换单个模型某档分辨率（多选） */
  const toggleModelResolution = (id: string, res: Resolution) => {
    setFetchedModels((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const has = m.supportedResolutions.includes(res);
        return {
          ...m,
          supportedResolutions: has
            ? m.supportedResolutions.filter((x) => x !== res)
            : [...m.supportedResolutions, res],
        };
      }),
    );
  };

  const filteredFetchedModels = useMemo(() => {
    if (!modelSearchQuery) return fetchedModels;
    const q = modelSearchQuery.toLowerCase();
    return fetchedModels.filter(
      (m) => m.modelId.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q) || (m.mappingName || '').toLowerCase().includes(q),
    );
  }, [fetchedModels, modelSearchQuery]);

  const selectedModelCount = useMemo(
    () => fetchedModels.filter((m) => m.selected).length,
    [fetchedModels],
  );

  const allSelected = useMemo(
    () => filteredFetchedModels.length > 0 && filteredFetchedModels.every((m) => m.selected),
    [filteredFetchedModels],
  );

  // 导入选中的模型到当前编辑的服务商
  const importSelectedModels = useCallback(() => {
    const selected = fetchedModels.filter((m) => m.selected);
    if (selected.length === 0) {
      toast.error('请至少选择一个模型');
      return;
    }

// 确定目标服务商 ID（统一通过 helper 创建/获取，避免重复）
  let providerId = editingProvider?.id;
  if (!providerId) {
    // 新增模式：先保存服务商再导入（用 helper 避免与 handleSaveProvider 重复逻辑）
    if (!formName.trim()) {
      toast.error('请先填写服务商名称');
      return;
    }
    if (!formBaseUrl.trim()) {
      toast.error('请先填写 API Base URL');
      return;
    }
    const newProvider = {
      // ID 用 Date.now + 随机后缀，避免同毫秒创建两个 provider 时撞 ID
      id: `prov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: formName,
      type: formType,
      baseUrl: formBaseUrl,
      apiKey: formApiKey,
      supportedTypes: formTypes,
      enabled: formEnabled,
      remark: formRemark,
      protocol: formProtocol,
      createdAt: new Date().toISOString(),
    };
    // 检查是否已经存在同名同 URL 的服务商（避免重复创建）
    const exists = providers.some(
      (p) => p.name === formName.trim() && p.baseUrl.trim() === formBaseUrl.trim(),
    );
    if (exists) {
      // 复用现有 provider，不再新建
      providerId = providers.find(
        (p) => p.name === formName.trim() && p.baseUrl.trim() === formBaseUrl.trim(),
      )!.id;
    } else {
      setProviders((prev) => [...prev, newProvider]);
      providerId = newProvider.id;
      setEditingProvider(newProvider);
    }
  }

    // 过滤掉已存在的模型
    const existingIds = new Set(
      models.filter((m) => m.providerId === providerId).map((m) => m.modelId),
    );
    const newModels = selected
      .filter((m) => !existingIds.has(m.modelId))
      .map((m, i) => ({
        id: `model-${Date.now()}-${i}`,
        modelId: m.modelId,
        displayName: m.displayName,
        mappingName: m.mappingName || '',
        type: m.type,
        providerId: providerId!,
        enabled: true,
        supportedResolutions: m.supportedResolutions,
        creditCost: typeof m.creditCost === 'number' ? m.creditCost : 0,
      }));

    if (newModels.length > 0) {
      setModels((prev) => [...prev, ...newModels]);
      toast.success(`已导入 ${newModels.length} 个模型`);
    } else {
      toast.info('选中的模型均已存在，未重复导入');
    }

    setModelSelectOpen(false);
    setFetchedModels([]);
  }, [fetchedModels, editingProvider, formName, formBaseUrl, formType, formApiKey, formTypes, formEnabled, formRemark, models, setProviders, setModels]);

  // 服务商卡片上的同步模型按钮
  const handleSyncModels = useCallback(async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;

    setSyncingProviderId(providerId);
    try {
      const trimmedBase = provider.baseUrl.trim().replace(/\/+$/, '');
      const url = `${trimmedBase}/models`;

      const syncData = await apiSyncProviderModels(providerId);
      if (!syncData.success) {
        toast.error(`同步失败：${syncData.message || '未知错误'}`);
        return;
      }
      const modelList = syncData.models || [];

      if (!Array.isArray(modelList) || modelList.length === 0) {
        toast.error('未获取到模型列表');
        return;
      }

      const existingIds = new Set(
        models.filter((m) => m.providerId === providerId).map((m) => m.modelId),
      );

      let added = 0;
      const newModels: typeof models = [];
      for (const m of modelList) {
        const mid = m.id || m.model || m.name || '';
        if (!mid || existingIds.has(mid)) continue;
        const name = m.name || m.display_name || m.displayName || mid;
        newModels.push({
          id: `model-${Date.now()}-${added}`,
          modelId: mid,
          displayName: name,
          type: detectModelType(mid),
          providerId,
          enabled: true,
        });
        added++;
      }

      if (added > 0) {
        setModels((prev) => [...prev, ...newModels]);
        toast.success(`同步完成，新增 ${added} 个模型`);
      } else {
        toast.info('已是最新，无新增模型');
      }
    } catch (e) {
      logger.error('sync models failed:', String(e));
      toast.error('同步失败：网络错误或接口不可用');
    } finally {
      setSyncingProviderId(null);
    }
  }, [providers, models, detectModelType, setModels]);

  // OSS 配置相关
  const handleOssChange = (key: keyof typeof ossForm, value: string | boolean) => {
    setOssForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveOssConfig = () => {
    updateOssConfig(ossForm);
    toast.success('OSS 配置已保存');
  };

  const handleTestOssConnection = async () => {
    setOssTesting(true);
    setOssTestResult(null);
    addOssLog('info', 'test', `测试连接：${ossForm.bucket || '未填 Bucket'}`);
    // 先用表单值临时更新（不保存），测试用当前表单值
    const prev = ossConfig;
    updateOssConfig(ossForm);
    try {
      const result = await testOssConnection();
      setOssTestResult(result);
      if (result.success) {
        toast.success(result.message);
        addOssLog('success', 'test', `连接成功：Bucket "${ossForm.bucket}"`);
      } else {
        toast.error(result.message);
        addOssLog('error', 'test', result.message);
      }
    } catch (e) {
      logger.error('OSS test failed:', String(e));
      toast.error('测试连接失败');
      addOssLog('error', 'test', `测试异常：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOssTesting(false);
      // 恢复之前的配置（测试不自动保存）
      updateOssConfig(prev);
    }
  };

  const handleBulkUploadExisting = async () => {
    if (!ossConfig.enabled) {
      toast.error('请先启用 OSS 存储');
      return;
    }
    setBulkUploading(true);
    addOssLog('info', 'bulk', `开始批量上传现有素材到 OSS...`);
    try {
      // 获取真实素材列表（走后端 API，不是 MOCK）
      const allMedia = await apiGetMedia();
      // 只上传未 OSS 且未被删除的素材
      const items = allMedia.filter(
        (m: any) => !m.isDeleted && !m.ossUploaded && m.fullUrl && !m.fullUrl.startsWith('data:') && m.source !== 'mock',
      );
      if (items.length === 0) {
        toast.info('没有需要上传的素材（都已 OSS 持久化或为本地素材）');
        addOssLog('info', 'bulk', '没有需要上传的素材');
        setBulkUploading(false);
        return;
      }
      setBulkUploadProgress({ current: 0, total: items.length });
      toast.info(`开始上传 ${items.length} 个素材到 OSS...`);
      addOssLog('info', 'bulk', `找到 ${items.length} 个待上传素材`);

      let successCount = 0;
      for (let i = 0; i < items.length; i++) {
        setBulkUploadProgress({ current: i + 1, total: items.length });
        const item = items[i] as any;
        try {
          // 下载图片
          // 后端代理下载（绕开浏览器 CORS）
          const proxied = await apiProxyFetch(item.fullUrl);
          if (!proxied.success || !proxied.base64) throw new Error(proxied.message || 'proxy failed');
          const byteChars = atob(proxied.base64);
          const byteArr = new Uint8Array(byteChars.length);
          for (let k = 0; k < byteChars.length; k++) byteArr[k] = byteChars.charCodeAt(k);
          const blob = new Blob([byteArr], { type: proxied.contentType || 'image/jpeg' });
          const file = new File([blob], `${item.id || 'img'}.jpg`, { type: 'image/jpeg' });
          // 上传到 OSS
          const uploadResult = await uploadToOss(file, `${item.id || `img-${Date.now()}`}.jpg`);
          if (uploadResult.success) {
            // 更新 media 记录的 ossUrl 字段
            const updated = { ...item, ossUrl: uploadResult.url, ossObjectKey: uploadResult.objectKey, ossUploaded: true, fullUrl: uploadResult.url, thumbnail: uploadResult.url };
            await apiSaveMedia(stripBlobItems([updated]));
            successCount++;
            addOssLog('success', 'upload', `${item.title || item.id} → ${uploadResult.url.split('/').pop()}`);
          } else {
            logger.warn(`OSS 上传失败: ${item.title || item.id}`);
            addOssLog('error', 'upload', `上传失败：${item.title || item.id}`);
          }
        } catch (e) {
          logger.warn(`上传 ${item.title || item.id} 失败: ${e instanceof Error ? e.message : String(e)}`);
          addOssLog('error', 'upload', `${item.title || item.id}：${e instanceof Error ? e.message : String(e).slice(0, 50)}`);
        }
        // 间隔避免频率限制
        await new Promise((r) => setTimeout(r, 200));
      }
      toast.success(`已上传 ${successCount}/${items.length} 个素材到 OSS`);
      addOssLog('success', 'bulk', `批量完成：${successCount}/${items.length} 成功`);
    } catch (e) {
      toast.error(`批量上传失败：${e instanceof Error ? e.message : String(e).slice(0, 80)}`);
      addOssLog('error', 'bulk', `批量失败：${e instanceof Error ? e.message : String(e).slice(0, 80)}`);
    } finally {
      setBulkUploading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-white">模型 Hub</h1>
          <p className="mt-0.5 text-xs text-zinc-500">管理多服务商模型路由与 API 配置</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab 切换 —— 固定宽度（不被其他按钮挤压） */}
          <div className="flex items-center rounded-full bg-zinc-900 p-1 border border-zinc-800 shrink-0">
            <button
              onClick={() => setActiveTab('models')}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                activeTab === 'models'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              模型列表
            </button>
            <button
              onClick={() => setActiveTab('providers')}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                activeTab === 'providers'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              服务商
            </button>
            <button
              onClick={() => setActiveTab('endpoints')}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                activeTab === 'endpoints'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              自定义协议
            </button>
            <button
              onClick={() => setActiveTab('pairing')}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                activeTab === 'pairing'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              配套关系
            </button>
            <button
              onClick={() => setActiveTab('storage')}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                activeTab === 'storage'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              存储配置
            </button>
          </div>

          {/* 固定右侧：所有 Tab 共用一个「添加」按钮（storage 例外：保存配置） */}
          {/* Tab-专属按钮（如「从模板添加」「异步添加」）已移到内容区内部，避免按钮数变化导致 Tab 错位 */}

          {activeTab !== 'storage' && (
            <button
              onClick={() => {
                if (activeTab === 'models') {
                  if (providers.length === 0) {
                    toast.error('请先到「服务商」Tab 添加服务商');
                    setActiveTab('providers');
                    return;
                  }
                  setAddModelOpen(true);
                } else {
                  openAddDialog();
                }
              }}
              className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold text-black hover:bg-emerald-400 transition-colors shrink-0 whitespace-nowrap"
            >
              <Plus className="size-3.5" />
              <span>
            {activeTab === 'providers' && '添加服务商'}
            {activeTab === 'models' && '添加模型'}
            {(activeTab as string) === 'endpoints' && '添加模型'}
            {(activeTab as string) === 'pairing' && '添加模型'}
            {(activeTab as string) === 'storage' && '存储'}
          </span>
            </button>
          )}
          {activeTab === 'storage' && (
            <button
              onClick={handleSaveOssConfig}
              className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold text-black hover:bg-emerald-400 transition-colors shrink-0 whitespace-nowrap"
            >
              <Check className="size-3.5" />
              保存配置
            </button>
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'storage' ? (
          <div className="mx-auto max-w-3xl space-y-6">
            {/* OSS 操作日志面板 */}
            <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400">
                    <FileText className="size-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">OSS 操作日志</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">最近 {ossLog.length} 条记录（最多保留 50 条）</div>
                  </div>
                </div>
                {ossLog.length > 0 && (
                  <button
                    onClick={() => setOssLog([])}
                    className="rounded-full bg-zinc-800 px-3 py-1 text-[10px] font-semibold text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
                  >
                    清空
                  </button>
                )}
              </div>
              {ossLog.length === 0 ? (
                <div className="rounded-xl bg-zinc-900/40 py-8 text-center text-xs text-zinc-600">
                  暂无日志 · OSS 操作将自动记录在这里
                </div>
              ) : (
                <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl bg-zinc-950/60 p-2">
                  {ossLog.map((log) => {
                    const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
                    const color =
                      log.level === 'success' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                      : log.level === 'error' ? 'text-red-400 bg-red-500/10 border-red-500/20'
                      : 'text-blue-400 bg-blue-500/10 border-blue-500/20';
                    const actionLabel =
                      log.action === 'test' ? '测试'
                      : log.action === 'bulk' ? '批量'
                      : log.action === 'backfill' ? '补传'
                      : '上传';
                    return (
                      <div key={log.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${color}`}>
                        <span className="shrink-0 font-mono text-[10px] opacity-70">{time}</span>
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold bg-black/30">{actionLabel}</span>
                        <span className="flex-1 break-all">{log.message}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 存储类型选择 */}
            <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
                  <Database className="size-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">存储配置</h2>
                  <p className="text-xs text-zinc-500">配置对象存储服务，生成的媒体文件自动上传到云端</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className={`text-xs font-semibold ${ossConfig.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {ossConfig.enabled ? '已启用' : '未启用'}
                  </span>
                  <button
                    onClick={() => handleOssChange('enabled', !ossForm.enabled)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 ${
                      ossForm.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-300 ${
                        ossForm.enabled ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 存储类型 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">存储类型</label>
                <div className="flex items-center gap-2">
                  <button
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500/10 py-2.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30"
                  >
                    <HardDriveUpload className="size-4" />
                    阿里云 OSS
                  </button>
                  <button
                    disabled
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-zinc-800/30 py-2.5 text-xs font-semibold text-zinc-600 border border-zinc-800 cursor-not-allowed"
                  >
                    <Server className="size-4" />
                    腾讯云 COS
                    <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">即将上线</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 接入点信息 */}
            <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Globe className="size-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">接入点信息</h3>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-400">接入点名称</label>
                    <input
                      value={ossForm.accessPointName}
                      onChange={(e) => handleOssChange('accessPointName', e.target.value)}
                      className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-400">地域</label>
                    <input
                      value={ossForm.regionLabel}
                      onChange={(e) => handleOssChange('regionLabel', e.target.value)}
                      className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">Bucket 名称</label>
                  <div className="relative">
                    <FolderOpen className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={ossForm.bucket}
                      onChange={(e) => handleOssChange('bucket', e.target.value)}
                      className="w-full rounded-2xl bg-zinc-800/50 pl-9 pr-4 py-2.5 text-sm text-white border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">外网 Endpoint</label>
                  <input
                    value={ossForm.endpointExternal}
                    onChange={(e) => handleOssChange('endpointExternal', e.target.value)}
                    className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">内网 Endpoint</label>
                  <input
                    value={ossForm.endpointInternal}
                    onChange={(e) => handleOssChange('endpointInternal', e.target.value)}
                    className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            {/* 访问凭证 */}
            <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Key className="size-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">访问凭证</h3>
                <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
                  敏感信息
                </span>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">AccessKey ID</label>
                  <div className="relative">
                    <input
                      type={showAccessKeyId ? 'text' : 'password'}
                      value={ossForm.accessKeyId}
                      onChange={(e) => handleOssChange('accessKeyId', e.target.value)}
                      placeholder="请输入 AccessKey ID"
                      className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 pr-20 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAccessKeyId(!showAccessKeyId)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl px-2 py-1 text-xs text-zinc-500 hover:text-white transition-colors"
                    >
                      {showAccessKeyId ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">AccessKey Secret</label>
                  <div className="relative">
                    <input
                      type={showAccessKeySecret ? 'text' : 'password'}
                      value={ossForm.accessKeySecret}
                      onChange={(e) => handleOssChange('accessKeySecret', e.target.value)}
                      placeholder="请输入 AccessKey Secret"
                      className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 pr-20 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAccessKeySecret(!showAccessKeySecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl px-2 py-1 text-xs text-zinc-500 hover:text-white transition-colors"
                    >
                      {showAccessKeySecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 高级设置 */}
            <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Settings2 className="size-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">高级设置</h3>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">存储路径前缀</label>
                  <div className="relative">
                    <FolderOpen className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={ossForm.pathPrefix}
                      onChange={(e) => handleOssChange('pathPrefix', e.target.value)}
                      placeholder="images/"
                      className="w-full rounded-2xl bg-zinc-800/50 pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-600">生成的文件将上传到此路径下，默认为 images/</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">自定义 CDN 域名（可选）</label>
                  <div className="relative">
                    <Link className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={ossForm.customDomain}
                      onChange={(e) => handleOssChange('customDomain', e.target.value)}
                      placeholder="如 cdn.example.com，不填则使用默认域名"
                      className="w-full rounded-2xl bg-zinc-800/50 pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-600">配置 CDN 加速域名后，访问链接将使用此域名</p>
                </div>
              </div>
            </div>

            {/* 测试连接结果 */}
            {ossTestResult && (
              <div className={`rounded-[1.5rem] border p-5 ${
                ossTestResult.success
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-red-500/5 border-red-500/20'
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                    ossTestResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {ossTestResult.success ? <Check className="size-4" /> : <X className="size-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${ossTestResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                      {ossTestResult.message}
                    </p>
                    {ossTestResult.files && ossTestResult.files.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-zinc-500">Bucket 内容预览（前 {ossTestResult.files.length} 条）：</p>
                        {ossTestResult.files.map((f) => (
                          <div key={f.name} className="flex items-center gap-2 rounded-xl bg-zinc-900/50 px-3 py-2">
                            <FileText className="size-3.5 text-zinc-500" />
                            <span className="flex-1 truncate text-xs text-zinc-400 font-mono">{f.name}</span>
                            <span className="text-[10px] text-zinc-600">{(f.size / 1024).toFixed(1)} KB</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 批量上传进度 */}
            {bulkUploading && (
              <div className="rounded-[1.5rem] border border-emerald-500/20 bg-emerald-500/5 p-5">
                <div className="flex items-center gap-3">
                  <Loader2 className="size-5 animate-spin text-emerald-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-emerald-400">正在上传到 OSS...</p>
                    <p className="text-xs text-zinc-500">{bulkUploadProgress.current} / {bulkUploadProgress.total}</p>
                  </div>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${(bulkUploadProgress.current / Math.max(bulkUploadProgress.total, 1)) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleTestOssConnection}
                disabled={ossTesting}
                className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-white hover:border-zinc-600 transition-colors disabled:opacity-50"
              >
                {ossTesting ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                <span>{ossTesting ? '测试中...' : '测试连接'}</span>
              </button>
              <button
                onClick={handleBulkUploadExisting}
                disabled={bulkUploading || !ossConfig.enabled}
                className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-white hover:border-zinc-600 transition-colors disabled:opacity-50"
              >
                <UploadCloud className="size-3.5" />
                上传现有图片
              </button>
              <button
                onClick={handleSaveOssConfig}
                className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-500 px-5 py-2 text-xs font-bold text-black hover:bg-emerald-400 transition-colors"
              >
                <Check className="size-3.5" />
                保存配置
              </button>
            </div>
          </div>
        ) : activeTab === 'providers' ? (
          <>
            {/* Tab-专属操作：从模板添加（移到这里避免顶部按钮数变化引起错位） */}
            <div className="mb-4 flex items-center justify-end">
              <div className="relative">
                <button
                  onClick={() => setTemplateMenuOpen(!templateMenuOpen)}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-white hover:border-zinc-600 transition-colors"
                >
                  <Plus className="size-3.5" />
                  从模板添加
                  <ChevronDown className="size-3 text-zinc-500" />
                </button>
                {templateMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setTemplateMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1 max-h-80 w-64 overflow-y-auto rounded-2xl bg-zinc-900 border border-zinc-800 p-1.5">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">官方</div>
                      {PROVIDER_TEMPLATES.filter((t) => t.type === 'official').map((t) => (
                        <button
                          key={t.name}
                          onClick={() => handleAddTemplate(t)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-white hover:bg-zinc-800/70 transition-colors"
                        >
                          <Zap className="size-3.5 text-emerald-400" />
                          <span className="flex-1 truncate">{t.name}</span>
                        </button>
                      ))}
                      <div className="mt-1 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">中转站</div>
                      {PROVIDER_TEMPLATES.filter((t) => t.type === 'relay').map((t) => (
                        <button
                          key={t.name}
                          onClick={() => handleAddTemplate(t)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-white hover:bg-zinc-800/70 transition-colors"
                        >
                          <Server className="size-3.5 text-blue-400" />
                          <span className="flex-1 truncate">{t.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 生成调度设置（全局最大并发） */}
            <div className="mb-4 rounded-[1.5rem] border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Server className="size-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">生成调度 · 多供应商负载均衡</h3>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">全局最大并发线程数</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxThreads}
                    onChange={(e) => setMaxThreads(Number(e.target.value) || 1)}
                    className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                  <p className="mt-1 text-[10px] text-zinc-500">
                    所有供应商同时进行的生成请求上限，超过则排队等待空闲令牌。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => saveScheduler()}
                  className="rounded-2xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400 transition-colors"
                >
                  保存调度设置
                </button>
              </div>
            </div>

          {/* 调度状态：账号冷热 / 实时共享桶（每 3s 刷新 + 手动强切） */}
          <ProviderSchedulerStatus providers={providers} />

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {providers.map((provider) => {
              const TypeIcon = PROVIDER_TYPE_ICONS[provider.type];
              const modelCount = models.filter((m) => m.providerId === provider.id && m.enabled).length;
              return (
                <div
                  key={provider.id}
                  className={`group rounded-[1.5rem] border transition-all duration-300 overflow-hidden ${
                    provider.enabled
                      ? 'bg-zinc-900/50 border-zinc-800 hover:border-emerald-500/30'
                      : 'bg-zinc-900/30 border-zinc-800/50 opacity-70'
                  }`}
                >
                  {/* 卡片头部 */}
                  <div className="flex items-start justify-between p-5">
                    <div className="flex items-start gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                        provider.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                      }`}>
                        <TypeIcon className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-white truncate">{provider.name}</h3>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            provider.enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                          }`}>
                            {PROVIDER_TYPE_LABELS[provider.type]}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-zinc-500">{provider.baseUrl}</p>
                      </div>
                    </div>
                    {/* 开关 */}
                    <button
                      onClick={() => handleToggleProvider(provider.id)}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-all duration-300 ${
                        provider.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
                      }`}
                    >
                      <div
className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all duration-300 ${
                        provider.enabled ? 'left-[18px]' : 'left-0.5'
                      }`}
                      />
                    </button>
                  </div>

                  {/* 支持的模型类型 */}
                  <div className="px-5 pb-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {provider.supportedTypes.map((t) => (
                        <span
                          key={t}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TYPE_COLORS[t]}`}
                        >
                          {TYPE_LABELS[t]}
                        </span>
                      ))}
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        (provider.protocol || 'openai-compatible') === 'custom'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      }`}>
                        {(provider.protocol || 'openai-compatible') === 'custom' ? '自定义协议' : 'OpenAI 兼容'}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-600">
                        {modelCount} 个模型
                      </span>
                    </div>
                  </div>

                  {/* 备注 */}
                  {provider.remark && (
                    <div className="px-5 pb-3">
                      <p className="truncate text-xs text-zinc-500">{provider.remark}</p>
                    </div>
                  )}

                  {/* 底部操作 */}
                  <div className="flex items-center gap-1 border-t border-zinc-800/50 px-3 py-2">
                    <button
                      onClick={() => handleTestConnection(provider.id)}
                      disabled={testingId === provider.id || !provider.enabled}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors disabled:opacity-50"
                    >
                      {testingId === provider.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Zap className="size-3.5" />
                      )}
                      <span>测试连接</span>
                    </button>
                    <button
                      onClick={() => handleSyncModels(provider.id)}
                      disabled={syncingProviderId === provider.id || !provider.enabled || !provider.apiKey}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors disabled:opacity-50"
                      title="从服务商同步最新模型列表"
                    >
                      {syncingProviderId === provider.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      <span>同步模型</span>
                    </button>
                    <button
                      onClick={() => openEditDialog(provider)}
                      className="flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors"
                    >
                      <Edit3 className="size-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteProvider(provider.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        ) : (
          <div className="space-y-6">
            {/* 筛选栏 */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索模型..."
                  className="w-full rounded-full bg-zinc-900 pl-9 pr-4 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-800 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
              <div className="flex items-center rounded-full bg-zinc-900 p-1 border border-zinc-800">
                {(['all', 'image', 'video', 'text'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-all duration-200 ${
                      typeFilter === t
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {t === 'all' ? '全部' : TYPE_LABELS[t]}
                  </button>
                ))}
              </div>

              {/* 孤儿模型清理按钮：仅当存在孤儿模型时显示 */}
              {(() => {
                const validProviderIds = new Set(providers.map((p) => p.id));
                const orphans = models.filter((m) => !validProviderIds.has(m.providerId));
                if (orphans.length === 0) return null;
                return (
                  <button
                    onClick={() => {
                      const n = cleanupOrphanModels();
                      toast.success(`已清理 ${n} 个孤儿模型`);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/20 transition-colors shrink-0"
                    title="这些模型的所属服务商已被删除，无法使用"
                  >
                    <Trash2 className="size-3.5" />
                    清理 {orphans.length} 个孤儿模型
                  </button>
                );
              })()}
            </div>

            {/* 按类型分组（图片 / 视频 / 推理） */}
            {(['image', 'video', 'text'] as const).map((type) => {
              const list = groupedModels.filter((g) => g.type === type);
              if (list.length === 0) return null;
              const TypeIcon = type === 'image' ? ImageIcon : type === 'video' ? Video : MessageSquare;
              return (
                <div key={type}>
                  <div className="mb-3 flex items-center gap-2">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${TYPE_COLORS[type]}`}>
                      <TypeIcon className="size-3.5" />
                    </div>
                    <h3 className="text-sm font-bold text-white">
                      {type === 'image' ? '图片生成' : type === 'video' ? '视频生成' : '推理（文本）'}
                    </h3>
                    <span className="text-xs text-zinc-600">{list.length} 个模型</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
{list.map((group) => {
                      const isEditing = editingGroupId === group.modelId;
                      const rep = group.rows[0];
                      return (
                        <div
                          key={group.modelId}
                          className={`group/card relative flex flex-col gap-2 rounded-2xl border p-3.5 transition-all duration-200 ${
                            group.enabled
                              ? 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                              : 'bg-zinc-900/30 border-zinc-800/50 opacity-60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TYPE_COLORS[group.type]}`}>
                                {group.type === 'image' && <ImageIcon className="size-3.5" />}
                                {group.type === 'video' && <Video className="size-3.5" />}
                                {group.type === 'text' && <MessageSquare className="size-3.5" />}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-xs font-bold text-white">
                                  {getEffectiveModelName(group) || group.displayName}
                                  {group.providerCount > 1 && (
                                    <span className="ml-1.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold align-middle">
                                      {group.providerCount}家
                                    </span>
                                  )}
                                  {rep?.mappingName && rep.mappingName.trim() && rep.mappingName !== group.displayName && (
                                    <span
                                      title={`前台映射名：${rep.mappingName}`}
                                      className="ml-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold align-middle"
                                    >
                                      已映射
                                    </span>
                                  )}
                                  {group.creditCost > 0 && (
                                    <span
                                      title={`单次生成消耗 ${group.creditCost} 积分`}
                                      className="ml-1.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold align-middle"
                                    >
                                      {group.creditCost} 积分
                                    </span>
                                  )}
                                </div>
                                <div className="truncate text-[10px] text-zinc-600">{group.modelId}</div>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                onClick={() => {
                                  if (isEditing) {
                                    setEditingGroupId(null);
                                  } else {
                                    setEditingGroupId(group.modelId);
                                    setEditDisplayName(group.displayName || '');
                                    setEditMappingName(rep?.mappingName || '');
                                    setEditCreditCost(typeof rep?.creditCost === 'number' ? rep.creditCost : 0);
                                  }
                                }}
                                title={isEditing ? '取消编辑' : '编辑名称 / 映射名 / 积分'}
                                className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all ${
                                  isEditing
                                    ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-400'
                                    : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-700 hover:text-white'
                                }`}
                              >
                                {isEditing ? <X className="size-3" /> : <Edit3 className="size-3" />}
                              </button>
                              <button
                                onClick={() => {
                                  setModels((prev) =>
                                    prev.map((m) =>
                                      m.modelId === group.modelId ? { ...m, enabled: !group.enabled } : m,
                                    ),
                                  );
                                }}
                                title={group.enabled ? '已启用，点击停用' : '已停用，点击启用'}
                                className={`relative h-5 w-10 shrink-0 rounded-full border transition-all duration-300 ${
                                  group.enabled
                                    ? 'border-emerald-400/60 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.45)]'
                                    : 'border-zinc-700 bg-zinc-800'
                                }`}
                              >
                                <div
                                  className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all duration-300 ${
                                    group.enabled ? 'left-[18px]' : 'left-0.5'
                                  }`}
                                />
                                <span
                                  className={`absolute top-1/2 -translate-y-1/2 text-[8px] font-bold leading-none transition-all duration-300 ${
                                    group.enabled
                                      ? 'left-1 text-emerald-50 opacity-0'
                                      : 'right-1 text-zinc-400 opacity-100'
                                  }`}
                                >
                                  OFF
                                </span>
                                <span
                                  className={`absolute top-1/2 -translate-y-1/2 text-[8px] font-bold leading-none transition-all duration-300 ${
                                    group.enabled
                                      ? 'right-1 text-white opacity-100'
                                      : 'right-1 text-zinc-500 opacity-0'
                                  }`}
                                >
                                  ON
                                </span>
                              </button>
                            </div>
                          </div>
                          {/* 内联编辑面板：displayName + mappingName */}
                          {isEditing && (
                            <div className="rounded-xl border border-emerald-500/30 bg-zinc-900/70 p-2.5 space-y-2">
                              <div>
                                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">显示名称</label>
                                <input
                                  type="text"
                                  value={editDisplayName}
                                  onChange={(e) => setEditDisplayName(e.target.value)}
                                  placeholder={group.modelId}
                                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                                  映射名称（前台展示名，可选）
                                </label>
                                <input
                                  type="text"
                                  value={editMappingName}
                                  onChange={(e) => setEditMappingName(e.target.value)}
                                  placeholder="留空则用显示名称"
                                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                                />
                                <p className="mt-1 text-[10px] text-zinc-500">
                                  前台所有模型展示会优先用此名。分发仍按 model_id，不影响。
                                </p>
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                                  积分消耗（单次生成）
                                </label>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={Number.isFinite(editCreditCost) ? editCreditCost : 0}
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10);
                                      setEditCreditCost(Number.isFinite(v) && v >= 0 ? v : 0);
                                    }}
                                    placeholder="0"
                                    className="w-24 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                                  />
                                  <span className="text-[10px] text-zinc-500">积分 / 张</span>
                                </div>
                                <p className="mt-1 text-[10px] text-zinc-500">
                                  前台下拉和详情会显示此值。同一 modelId 多供应商时，整组同步；提交 N 张请求时实际扣 N × 此值。
                                </p>
                              </div>
                              <div className="flex items-center justify-end gap-1.5 pt-1">
                                <button
                                  onClick={() => setEditingGroupId(null)}
                                  className="rounded-lg px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-white"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={() => {
                                    const newDisplay = editDisplayName.trim() || group.displayName || group.modelId;
                                    const newMapping = editMappingName.trim();
                                    const newCost = Math.max(0, Math.floor(Number(editCreditCost) || 0));
                                    setModels((prev) =>
                                      prev.map((m) =>
                                        m.modelId === group.modelId
                                          ? { ...m, displayName: newDisplay, mappingName: newMapping, creditCost: newCost }
                                          : m,
                                      ),
                                    );
                                    setEditingGroupId(null);
                                  }}
                                  className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-medium text-black hover:bg-emerald-400"
                                >
                                  保存
                                </button>
                              </div>
                            </div>
                          )}
                        {/* 能力 chip */}
                        {group.rows[0]?.capabilities && (
                          <div className="flex flex-wrap items-center gap-1">
                            {group.type === 'image' && group.rows[0].capabilities.asFirstFrame && (
                              <span className="rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold">可作首帧</span>
                            )}
                            {group.type === 'video' && group.rows[0].capabilities.imageInput && (
                              <span className="rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 text-[9px] font-semibold">接受图片输入</span>
                            )}
                            {group.type === 'text' && group.rows[0].capabilities.vision && (
                              <span className="rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 text-[9px] font-semibold">视觉/多模态</span>
                            )}
                            {group.type === 'image' && group.supportedResolutions.length > 0 && (
                              <span className="rounded-full bg-zinc-800/50 text-zinc-400 border border-zinc-700 px-1.5 py-0.5 text-[9px] font-semibold">
                                {group.supportedResolutions.join('/')}
                              </span>
                            )}
                            {group.rows[0]?.endpoint && (
                              <span className="rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold">自定义端点</span>
                            )}
                            {group.rows[0]?.paired?.baseImageModelId && (
                              <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold">已配套首帧</span>
                            )}
                            {group.rows[0]?.paired?.visionModelId && (
                              <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold">已配套视觉</span>
                            )}
                          </div>
                        )}
                        {/* 服务商（多供应商时列出各家；禁用的供应商加删除线） */}
                        <div className="flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
                          {group.providerIds.map((pid) => (
                            <span
                              key={pid}
                              className={`rounded-full border px-1.5 py-0.5 ${
                                group.rows.find((r) => r.providerId === pid)?.enabled
                                  ? 'border-zinc-700 text-zinc-400'
                                  : 'border-zinc-800 text-zinc-600 line-through'
                              }`}
                            >
                              {getProviderName(pid)}
                            </span>
                          ))}
                        </div>
                        {/* ModelHub 改造：耗时 / 分类 / 创作者 / 商用钩选（默认显示，不依赖 hover） */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                          {(() => {
                            // 防御：DB 中 estimated_seconds=0（迁移列未回填）会被 ?? 保留为 0，
                            // 这里统一将「非正数」视为未设置，回退到类型兜底值。
                            const rawSecs = group.estimatedSeconds;
                            const secs =
                              typeof rawSecs === 'number' && rawSecs > 0
                                ? rawSecs
                                : defaultEstimatedSeconds(group.type);
                            return (
                              <span
                                title={`预估生成耗时 ${secs} 秒`}
                                className="inline-flex items-center gap-0.5 rounded-full border border-zinc-800 px-1.5 py-0.5"
                              >
                                <Clock className="size-2.5" />
                                ≈ {secs}s
                              </span>
                            );
                          })()}
                          {(() => {
                            const cat = group.category ?? defaultCategory(group.type);
                            return (
                              <span
                                title="细分类标签"
                                className="inline-flex items-center gap-0.5 rounded-full border border-zinc-800 px-1.5 py-0.5"
                              >
                                <Tag className="size-2.5" />
                                {cat}
                              </span>
                            );
                          })()}
                          {group.creator && group.creator.name && (
                            <span
                              title={group.creator.link ? `创作者：${group.creator.name}` : '创作者'}
                              className="inline-flex items-center gap-1 rounded-full border border-zinc-800 px-1.5 py-0.5"
                            >
                              <span className="flex h-3 w-3 items-center justify-center rounded-full bg-zinc-700 text-[8px] font-bold text-zinc-300">
                                {group.creator.name.slice(0, 1).toUpperCase()}
                              </span>
                              {group.creator.name}
                            </span>
                          )}
                          {(() => {
                            const ok = group.commercialUse ?? defaultCommercialUse(group.type);
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  setModels((prev) =>
                                    prev.map((m) =>
                                      m.modelId === group.modelId
                                        ? { ...m, commercialUse: !(m.commercialUse ?? defaultCommercialUse(m.type)) }
                                        : m,
                                    ),
                                  );
                                }}
                                title={ok ? '允许商用 — 点击切换为不允许' : '不允许商用 — 点击切换为允许'}
                                className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 transition-colors ${
                                  ok
                                    ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
                                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                                }`}
                              >
                                <Briefcase className="size-2.5" />
                                {ok ? '可商用' : '不可商用'}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {groupedModels.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-zinc-900 text-zinc-600">
                  <Settings2 className="size-10" />
                </div>
                <p className="text-sm text-zinc-500">暂无匹配的模型</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 端点 Tab 内容 */}
      {activeTab === 'endpoints' && (
        <div className="flex-1 overflow-y-auto p-6">
          <EndpointsTab
            providers={providers}
            models={models}
            setProviders={setProviders}
            setModels={setModels}
            getProviderName={getProviderName}
          />
        </div>
      )}

      {/* 配套关系 Tab 内容 */}
      {activeTab === 'pairing' && (
        <div className="flex-1 overflow-y-auto p-6">
          <PairingTab
            providers={providers}
            models={models}
            setModels={setModels}
            getProviderName={getProviderName}
          />
        </div>
      )}

      {/* 模型选择弹窗 */}
      {modelSelectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[80vh] rounded-[2rem] bg-zinc-900 border border-zinc-800 flex flex-col overflow-hidden">
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-lg font-bold text-white">选择要导入的模型</h2>
              <button
                onClick={() => {
                  setModelSelectOpen(false);
                  setFetchedModels([]);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* 搜索 + 全选 */}
            <div className="flex items-center gap-3 px-6 py-3 border-b border-zinc-800/50">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="search"
                  value={modelSearchQuery}
                  onChange={(e) => setModelSearchQuery(e.target.value)}
                  placeholder="搜索模型..."
                  className="w-full rounded-full bg-zinc-800/50 pl-9 pr-4 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                <div
                  onClick={() => toggleAllModels(!allSelected)}
                  className={`flex h-4 w-4 items-center justify-center rounded border transition-colors cursor-pointer ${
                    allSelected
                      ? 'bg-emerald-500 border-emerald-500'
                      : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  {allSelected && <Check className="size-3 text-black" />}
                </div>
                全选
              </label>
            </div>

            {/* 模型列表 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {filteredFetchedModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-zinc-800 text-zinc-600">
                    <Search className="size-6" />
                  </div>
                  <p className="text-sm text-zinc-500">未找到匹配的模型</p>
                </div>
              ) : (
                filteredFetchedModels.map((model) => (
                  <div
                    key={model.id}
                    className={`flex items-center gap-3 rounded-2xl border p-3 transition-all duration-200 ${
                      model.selected
                        ? 'bg-emerald-500/5 border-emerald-500/20'
                        : 'bg-zinc-800/30 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    {/* 复选框 */}
                    <div
                      onClick={() => toggleModelSelected(model.id)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border cursor-pointer transition-colors ${
                        model.selected
                          ? 'bg-emerald-500 border-emerald-500'
                          : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
                      }`}
                    >
                      {model.selected && <Check className="size-3.5 text-black" />}
                    </div>

                    {/* 模型信息 */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <input
                        type="text"
                        value={model.displayName}
                        onChange={(e) => updateModelName(model.id, e.target.value)}
                        className="w-full bg-transparent text-sm font-medium text-white placeholder:text-zinc-600 focus:outline-none focus:bg-zinc-800/50 rounded-lg px-2 py-0.5 -mx-2 transition-colors"
                        placeholder="模型名称"
                      />
                      <div className="font-mono text-[11px] text-zinc-500 truncate px-2 -mx-2">
                        {model.modelId}
                      </div>
                      {/* 映射名称：可选，前台展示优先用该名 */}
                      <input
                        type="text"
                        value={model.mappingName || ''}
                        onChange={(e) => updateModelMappingName(model.id, e.target.value)}
                        className="w-full bg-zinc-800/40 text-xs text-emerald-300 placeholder:text-zinc-600 focus:outline-none focus:bg-zinc-800/70 rounded-lg px-2 py-0.5 -mx-2 transition-colors"
                        placeholder="映射名称（前台展示名，可选）"
                      />
                      {/* 积分消耗：单次生成扣多少积分 */}
                      <div className="flex items-center gap-1.5 pt-1 px-2 -mx-2">
                        <span className="text-[10px] text-zinc-500 shrink-0">积分：</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={Number.isFinite(model.creditCost) ? model.creditCost : 0}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            updateModelCreditCost(model.id, Number.isFinite(v) && v >= 0 ? v : 0);
                          }}
                          className="w-20 bg-zinc-800/40 text-xs text-amber-300 placeholder:text-zinc-600 focus:outline-none focus:bg-zinc-800/70 rounded-lg px-2 py-0.5 transition-colors"
                          placeholder="0"
                        />
                        <span className="text-[10px] text-zinc-500">/ 次</span>
                      </div>
                      {/* 分辨率多选：仅图片模型显示 */}
                      {model.type === 'image' && (
                        <div className="flex items-center gap-1 pt-1 px-2 -mx-2 flex-wrap">
                          <span className="text-[10px] text-zinc-500 mr-0.5 shrink-0">分辨率：</span>
                          {ALL_RESOLUTIONS.map((r) => {
                            const active = model.supportedResolutions.includes(r);
                            return (
                              <button
                                key={r}
                                onClick={() => toggleModelResolution(model.id, r)}
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold border transition-colors ${
                                  active
                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                    : 'bg-zinc-800/50 text-zinc-500 border-zinc-700 hover:border-zinc-600 hover:text-white'
                                }`}
                              >
                                {r}
                              </button>
                            );
                          })}
                          {model.supportedResolutions.length === 0 && (
                            <span className="text-[10px] text-amber-400">未选（前台将不显示分辨率选项）</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 类型选择 */}
                    <div className="relative shrink-0">
                      <select
                        value={model.type}
                        onChange={(e) => updateModelType(model.id, e.target.value as ModelType)}
                        className={`appearance-none rounded-full border px-3 py-1 text-[11px] font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${TYPE_COLORS[model.type]}`}
                      >
                        <option value="image">图片</option>
                        <option value="video">视频</option>
                        <option value="text">文本</option>
                      </select>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 底部操作 */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800">
              <span className="text-xs text-zinc-500">
                已选择 <span className="font-bold text-emerald-400">{selectedModelCount}</span> / {fetchedModels.length} 个模型
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setModelSelectOpen(false);
                    setFetchedModels([]);
                  }}
                  className="rounded-full border border-zinc-700 px-5 py-2 text-sm text-white hover:bg-zinc-800/50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={importSelectedModels}
                  disabled={selectedModelCount === 0}
                  className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-black hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  导入选中
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 添加/编辑服务商弹窗 */}
      {providerDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[2rem] bg-zinc-900 border border-zinc-800 p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingProvider ? '编辑服务商' : '添加服务商'}
              </h2>
              <button
                onClick={() => setProviderDialogOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* 服务商名称 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">服务商名称 <span className="text-red-400">*</span></label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="如：OpenAI 官方"
                  className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>

              {/* 类型 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">服务商类型</label>
                <div className="flex items-center gap-2">
                  {(['official', 'relay', 'custom'] as const).map((t) => {
                    const Icon = PROVIDER_TYPE_ICONS[t];
                    return (
                      <button
                        key={t}
                        onClick={() => setFormType(t)}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2 text-xs font-semibold transition-all duration-200 ${
                          formType === t
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:text-white'
                        }`}
                      >
                        <Icon className="size-3.5" />
                        {PROVIDER_TYPE_LABELS[t]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Base URL */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">API Base URL <span className="text-red-400">*</span></label>
                <input
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder="sk-xxxxxxxxxxxxxxxx"
                    className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 pr-20 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl px-2 py-1 text-xs text-zinc-500 hover:text-white transition-colors"
                  >
                    {showApiKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </div>

              {/* 并发线程数 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  并发线程数 <span className="text-zinc-500">（单服务商最大同时生成数）</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={formMaxConcurrent}
                  onChange={(e) => setFormMaxConcurrent(Number(e.target.value) || 1)}
                  className="w-full rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  多供应商同模型时，后台按此上限 + 全局最大并发均衡分配请求。
                </p>
              </div>

              {/* 容量模型 + 统一共享 B 桶限速 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">容量模型</label>
                <div className="flex items-center gap-2">
                  {([['limited', '受限账号（共享 B 桶）'], ['unlimited', '普通付费（无限速）']] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFormCapacityModel(v)}
                      className={`flex-1 rounded-2xl py-2 text-xs font-semibold transition-all duration-200 ${
                        formCapacityModel === v
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {formCapacityModel === 'limited' ? (
                  <div className="mt-3 space-y-3">
                    {/* B 与上限 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[10px] text-zinc-500">B（每账号每分钟单位）</label>
                        <input
                          type="number" min={1} max={100000}
                          value={formBucketUnits}
                          onChange={(e) => setFormBucketUnits(Number(e.target.value) || 1)}
                          className="w-full rounded-xl bg-zinc-800/50 px-3 py-2 text-sm text-white border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] text-zinc-500">粒度上限 bucket_max（留空=不限制）</label>
                        <input
                          type="number" min={1} max={100000}
                          value={formBucketMax}
                          onChange={(e) => setFormBucketMax(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="不限"
                          className="w-full rounded-xl bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                        />
                      </div>
                    </div>
                    {formBucketMax === '' && (
                      <p className="text-[10px] text-amber-400/80">⚠ 未设上限：B 可任意调大，请确认服务商物理限速允许。</p>
                    )}
                    {formBucketMax !== '' && (Number(formBucketUnits) || 20) > Number(formBucketMax) && (
                      <p className="text-[10px] text-red-400">✕ B 超过粒度上限，保存将被拒绝。</p>
                    )}

                    {/* 各操作单位消耗（cost）→ 派生每分钟上限 */}
                    <div>
                      <label className="mb-1 block text-[10px] text-zinc-500">各操作单位消耗（cost，可改；上限 = floor(B/cost)）</label>
                      <div className="grid grid-cols-4 gap-2">
                        {(['1k', '2k', '4k', 'video'] as const).map((t) => {
                          const cost = formOpCosts[t] || 1;
                          const cap = Math.max(0, Math.floor((Number(formBucketUnits) || 20) / (cost || 1)));
                          return (
                            <div key={t}>
                              <div className="mb-1 text-center text-[10px] text-zinc-500">{t}</div>
                              <input
                                type="number" min={1} max={1000}
                                value={cost}
                                onChange={(e) => setFormOpCosts((prev) => ({ ...prev, [t]: Number(e.target.value) || 1 }))}
                                className="w-full rounded-xl bg-zinc-800/50 px-2 py-2 text-center text-sm text-white border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                              />
                              <div className="mt-1 text-center text-[9px] text-emerald-400/80">≤ {cap}/min</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] text-zinc-500">方向 B：按付费计费，无速率限制，仅受并发约束。4k/视频亦无限速。</p>
                )}

                {/* 整账号冷却时长 */}
                <div className="mt-3">
                  <label className="mb-1 block text-[10px] text-zinc-500">整账号冷却时长（秒，默认 60，可调）</label>
                  <input
                    type="number" min={1} max={3600}
                    value={formCooldownSec}
                    onChange={(e) => setFormCooldownSec(Number(e.target.value) || 60)}
                    className="w-full rounded-xl bg-zinc-800/50 px-3 py-2 text-sm text-white border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                  <p className="mt-1 text-[10px] text-zinc-500">拒单（桶空 / 真实 429 / 连续失败）后整账号冷却此时长，到期自动恢复（冷→热）。</p>
                </div>
              </div>

              {/* 协议类型 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">接口协议</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormProtocol('openai-compatible')}
                    className={`flex flex-col items-start gap-0.5 rounded-2xl px-3 py-2 text-left transition-all duration-200 ${
                      formProtocol === 'openai-compatible'
                        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                        : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:text-white'
                    }`}
                  >
                    <span className="text-xs font-semibold">OpenAI 兼容</span>
                    <span className="text-[10px] text-zinc-500">/v1/images/generations 等</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormProtocol('custom')}
                    className={`flex flex-col items-start gap-0.5 rounded-2xl px-3 py-2 text-left transition-all duration-200 ${
                      formProtocol === 'custom'
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:text-white'
                    }`}
                  >
                    <span className="text-xs font-semibold">自定义协议</span>
                    <span className="text-[10px] text-zinc-500">在「自定义协议」Tab 配置端点</span>
                  </button>
                </div>
              </div>

              {/* 获取模型列表 */}
              <div>
                <button
                  type="button"
                  onClick={() => fetchModels(formBaseUrl, formApiKey, formProtocol)}
                  disabled={fetchingModels}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 py-2.5 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fetchingModels ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  <span>{fetchingModels ? '获取中...' : '获取模型列表'}</span>
                </button>
              </div>

              {/* 支持的模型类型 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">支持的模型类型</label>
                <div className="flex items-center gap-2">
                  {(['image', 'video', 'text'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => toggleFormType(t)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2 text-xs font-semibold transition-all duration-200 ${
                        formTypes.includes(t)
                          ? `${TYPE_COLORS[t]} border`
                          : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                      }`}
                    >
                      {formTypes.includes(t) && <Check className="size-3" />}
                      {t === 'image' && <ImageIcon className="size-3.5" />}
                      {t === 'video' && <Video className="size-3.5" />}
                      {t === 'text' && <MessageSquare className="size-3.5" />}
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 启用开关 */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-white">启用该服务商</div>
                  <div className="text-xs text-zinc-500">关闭后该服务商的模型将不会出现在选择器中</div>
                </div>
                <button
                  onClick={() => setFormEnabled(!formEnabled)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 ${
                    formEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-300 ${
                      formEnabled ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* 备注 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">备注</label>
                <textarea
                  value={formRemark}
                  onChange={(e) => setFormRemark(e.target.value)}
                  placeholder="可选，添加备注说明..."
                  rows={2}
                  className="w-full resize-none rounded-2xl bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setProviderDialogOpen(false)}
                className="rounded-full border border-zinc-700 px-5 py-2 text-sm text-white hover:bg-zinc-800/50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveProvider}
                className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-black hover:bg-emerald-400 transition-colors"
              >
                {editingProvider ? '保存修改' : '添加服务商'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 异步添加向导 */}
      <AsyncAddDialog
        open={asyncAddOpen}
        onClose={() => setAsyncAddOpen(false)}
        providers={providers}
        models={models}
        setProviders={setProviders}
        setModels={setModels}
        defaultProviderId={providers[0]?.id}
      />

      {/* 添加模型对话框（选服务商 → 拉取 → 勾选 → 导入） */}
      <AddModelDialog
        open={addModelOpen}
        onClose={() => setAddModelOpen(false)}
        providers={providers}
        models={models}
        setModels={setModels}
      />
    </div>
  );
}
