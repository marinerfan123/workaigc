// EXPORTS: IModelProvider, IAiModel, MOCK_PROVIDERS, MOCK_MODELS, PROVIDER_TEMPLATES

export type ModelType = 'image' | 'video' | 'text';
export type ProviderType = 'official' | 'relay' | 'custom';
export type ProtocolType = 'openai-compatible' | 'custom';

/** 分辨率档位（图片模型专用） */
export type Resolution = '1k' | '2k' | '4k' | '8k';

/** 所有支持的分辨率档位（UI 顺序） */
export const ALL_RESOLUTIONS: Resolution[] = ['1k', '2k', '4k', '8k'];

// ─── 自定义接口配置 ─────────────────────────────────────
/**
 * 单个端点配置。所有路径都相对 baseUrl。
 * bodyTemplate 支持 {{prompt}} {{model}} {{size}} {{n}} {{apiKey}} 等占位符（运行时替换）。
 * 响应字段路径用点号分隔 JSONPath（如 "data.0.url" 表示 data[0].url）。
 */
export interface IEndpoint {
  /** 路径，相对 provider.baseUrl（如 "/v1/images/generations"） */
  path: string;
  /** HTTP 方法（默认 POST） */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 额外请求头（Authorization 由 apiKey 自动处理） */
  headers?: Record<string, string>;
  /** 请求 body 模板（JSON 字符串，支持 {{var}} 占位符）；留空则按协议默认结构 */
  bodyTemplate?: string;
  /** 响应中图片 URL/Base64 数组的字段路径（图片模型） */
  imageFieldPath?: string;
  /** 响应中文本输出的字段路径（推理模型） */
  textFieldPath?: string;
  /** 响应中视频 URL 字段路径（视频模型同步接口） */
  videoFieldPath?: string;
  /** 异步任务 ID 字段路径（视频模型异步 submit 模式） */
  taskIdPath?: string;
  /** 异步任务状态字段路径（如 "data.status"，常见值：succeeded/failed/processing） */
  taskStatusPath?: string;
  /** 异步任务成功的判定值（多个任一即视为成功） */
  taskSuccessValues?: string[];
  /** 异步任务结果 URL 字段路径 */
  taskResultPath?: string;
  /** 错误信息字段路径（用于从响应里提取错误） */
  errorPath?: string;
  /** 列表接口中模型数组的字段路径 */
  listFieldPath?: string;
  /** 列表接口中单条模型的 id 字段路径 */
  listIdFieldPath?: string;
  /** 列表接口中单条模型的显示名字段路径 */
  listNameFieldPath?: string;
}

/** 一个模型（或服务商）完整的接口描述 */
export interface IModelEndpoint {
  /** 协议：openai-compatible（用默认实现）或 custom（用下面的配置覆盖） */
  protocol: ProtocolType;
  /** 是否异步任务（视频模型常用 submit+poll 模式） */
  async?: boolean;
  /** 拉取模型列表 */
  listModels?: IEndpoint;
  /** 生成调用（图片/视频同步 或 视频异步 submit） */
  generate?: IEndpoint;
  /** 异步任务轮询/拉取结果 */
  poll?: IEndpoint;
}

// ─── 模型能力 + 配套关系 ────────────────────────────────
/** 模型能力标志 */
export interface IModelCapabilities {
  /** 视觉/多模态：推理时能看图 */
  vision?: boolean;
  /** 接受图片输入（图生图/视频首帧） */
  imageInput?: boolean;
  /** 可作为其他视频模型的底图/首帧生成源 */
  asFirstFrame?: boolean;
  /** 可作为其他推理模型的视觉输入源 */
  asVisionInput?: boolean;
}

/** 模型配套关系（运行时） */
export interface IModelPaired {
  /** 视频模型 → 底图/首帧生成模型 ID */
  baseImageModelId?: string;
  /** 推理模型 → 视觉输入模型 ID */
  visionModelId?: string;
}

// ─── 主接口 ────────────────────────────────────────────
export interface IModelProvider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  supportedTypes: ModelType[];
  enabled: boolean;
  remark?: string;
  createdAt: string;
  /** 协议类型 */
  protocol?: ProtocolType;
  /** 默认接口配置（所有模型共享；单模型可覆盖） */
  defaultEndpoint?: IModelEndpoint;
}

export interface IAiModel {
  id: string;
  modelId: string; // 模型ID（接口用）
  displayName: string; // 显示名称
  /** 映射名称：用户自定义的对外展示名（前台优先于 displayName 展示）。
   *  为空时前台回退到 displayName。dispatch 仍按 model_id 分发，不依赖此字段。 */
  mappingName?: string;
  type: ModelType;
  providerId: string;
  enabled: boolean;
  /** 该模型支持的分辨率档位（仅 image 模型有意义；空数组 = 不支持分辨率选项） */
  supportedResolutions?: Resolution[];
  /** 能力标志（视觉/图输入/首帧/视觉输入） */
  capabilities?: IModelCapabilities;
  /** 配套关系（运行时使用） */
  paired?: IModelPaired;
  /** 单模型覆盖服务商的接口配置 */
  endpoint?: IModelEndpoint;
}

/**
 * 取模型对外展示名：优先 mappingName（用户自定义映射名），否则 displayName。
 * 前台所有展示场景统一走这个方法，保证「模型映射名称」在 UI 生效。
 */
export function getEffectiveModelName(m: Pick<IAiModel, 'displayName' | 'mappingName'> | undefined | null): string {
  if (!m) return '';
  const mapped = (m.mappingName || '').trim();
  return mapped || (m.displayName || '').trim() || '';
}

// 预置服务商模板
export const PROVIDER_TEMPLATES: Omit<IModelProvider, 'id' | 'createdAt' | 'apiKey'>[] = [
  // 官方
  { name: 'OpenAI 官方', type: 'official', baseUrl: 'https://api.openai.com/v1', supportedTypes: ['image', 'text'], enabled: true, remark: 'OpenAI 官方 API', protocol: 'openai-compatible' },
  { name: 'Google Gemini', type: 'official', baseUrl: 'https://generativelanguage.googleapis.com/v1', supportedTypes: ['image', 'video', 'text'], enabled: true, remark: 'Google Gemini 官方 API', protocol: 'openai-compatible' },
  { name: 'Anthropic', type: 'official', baseUrl: 'https://api.anthropic.com/v1', supportedTypes: ['text'], enabled: true, remark: 'Anthropic Claude 官方 API', protocol: 'openai-compatible' },
  { name: 'Stability AI', type: 'official', baseUrl: 'https://api.stability.ai/v1', supportedTypes: ['image'], enabled: true, remark: 'Stability AI 官方 API', protocol: 'openai-compatible' },
  { name: 'Midjourney', type: 'official', baseUrl: 'https://api.midjourney.com/v1', supportedTypes: ['image'], enabled: true, remark: 'Midjourney 官方 API', protocol: 'custom' },
  { name: 'Runway', type: 'official', baseUrl: 'https://api.runwayml.com/v1', supportedTypes: ['video'], enabled: true, remark: 'Runway 官方 API', protocol: 'custom' },
  { name: 'Pika', type: 'official', baseUrl: 'https://api.pika.art/v1', supportedTypes: ['video'], enabled: true, remark: 'Pika 官方 API', protocol: 'custom' },
  // 国内
  { name: 'DeepSeek', type: 'official', baseUrl: 'https://api.deepseek.com/v1', supportedTypes: ['text', 'image'], enabled: true, remark: '深度求索 DeepSeek 官方 API', protocol: 'openai-compatible' },
  { name: '通义千问', type: 'official', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', supportedTypes: ['image', 'text'], enabled: true, remark: '阿里云通义千问 API', protocol: 'openai-compatible' },
  { name: '智谱 AI', type: 'official', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', supportedTypes: ['image', 'text'], enabled: true, remark: '智谱 AI 开放平台', protocol: 'custom' },
  { name: '豆包', type: 'official', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', supportedTypes: ['image', 'text'], enabled: true, remark: '字节跳动豆包 API', protocol: 'custom' },
  // 中转站
  { name: 'OpenAI 中转站', type: 'relay', baseUrl: 'https://your-relay.com/v1', supportedTypes: ['image', 'text'], enabled: true, remark: 'OpenAI 兼容格式中转站', protocol: 'openai-compatible' },
];

// 预置模型
export const MOCK_MODELS: IAiModel[] = [
  // 图片模型（默认可作为视频首帧源）
  { id: 'm1', modelId: 'dall-e-3', displayName: 'DALL·E 3', type: 'image', providerId: 'p1', enabled: true, supportedResolutions: ['1k', '2k'], capabilities: { asFirstFrame: true } },
  { id: 'm2', modelId: 'stability-sdxl', displayName: 'Stable Diffusion XL', type: 'image', providerId: 'p4', enabled: true, supportedResolutions: ['1k', '2k', '4k'], capabilities: { asFirstFrame: true } },
  { id: 'm3', modelId: 'midjourney-v6', displayName: 'Midjourney v6', type: 'image', providerId: 'p5', enabled: true, supportedResolutions: ['1k', '2k', '4k'], capabilities: { asFirstFrame: true } },
  { id: 'm4', modelId: 'nano-banana-2-lite', displayName: 'Nano Banana 2 Lite', type: 'image', providerId: 'p0', enabled: true, supportedResolutions: ['1k', '2k'], capabilities: { asFirstFrame: true } },
  { id: 'm5', modelId: 'nano-banana-2-pro', displayName: 'Nano Banana 2 Pro', type: 'image', providerId: 'p0', enabled: true, supportedResolutions: ['1k', '2k', '4k', '8k'], capabilities: { asFirstFrame: true } },
  { id: 'm6', modelId: 'imagen-3', displayName: 'Imagen 3', type: 'image', providerId: 'p2', enabled: true, supportedResolutions: ['1k', '2k', '4k'], capabilities: { asFirstFrame: true } },
  { id: 'm7', modelId: 'flux-1-pro', displayName: 'Flux 1 Pro', type: 'image', providerId: 'p4', enabled: true, supportedResolutions: ['1k', '2k', '4k', '8k'], capabilities: { asFirstFrame: true } },
  // 视频模型（支持图片作为首帧）
  { id: 'v1', modelId: 'sora', displayName: 'Sora', type: 'video', providerId: 'p1', enabled: false, supportedResolutions: [], capabilities: { imageInput: true } },
  { id: 'v2', modelId: 'runway-gen3', displayName: 'Runway Gen-3', type: 'video', providerId: 'p6', enabled: true, supportedResolutions: [], capabilities: { imageInput: true } },
  { id: 'v3', modelId: 'pika-1.5', displayName: 'Pika 1.5', type: 'video', providerId: 'p7', enabled: true, supportedResolutions: [], capabilities: { imageInput: true } },
  { id: 'v4', modelId: 'kling', displayName: '可灵 Kling', type: 'video', providerId: 'p10', enabled: true, supportedResolutions: [], capabilities: { imageInput: true } },
  { id: 'v5', modelId: 'veo-2', displayName: 'Veo 2', type: 'video', providerId: 'p2', enabled: false, supportedResolutions: [], capabilities: { imageInput: true } },
  { id: 'v6', modelId: 'hunyuan-video-1.5', displayName: 'HunyuanVideo 1.5', type: 'video', providerId: 'p9', enabled: true, supportedResolutions: [], capabilities: { imageInput: true } },
  // 文本模型（多模态标记）
  { id: 't1', modelId: 'gpt-4o', displayName: 'GPT-4o', type: 'text', providerId: 'p1', enabled: true, supportedResolutions: [], capabilities: { vision: true, asVisionInput: true } },
  { id: 't2', modelId: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet', type: 'text', providerId: 'p3', enabled: true, supportedResolutions: [], capabilities: { vision: true, asVisionInput: true } },
  { id: 't3', modelId: 'gemini-2-pro', displayName: 'Gemini 2 Pro', type: 'text', providerId: 'p2', enabled: true, supportedResolutions: [], capabilities: { vision: true, asVisionInput: true } },
  { id: 't4', modelId: 'deepseek-v3', displayName: 'DeepSeek V3', type: 'text', providerId: 'p8', enabled: true, supportedResolutions: [], capabilities: { asVisionInput: false } },
];

// 预置服务商
export const MOCK_PROVIDERS: IModelProvider[] = [
  {
    id: 'p0',
    name: '内置模型',
    type: 'official',
    baseUrl: 'https://api.internal.local/v1',
    apiKey: '',
    supportedTypes: ['image', 'video'],
    enabled: true,
    remark: '平台内置模型，无需配置',
    protocol: 'openai-compatible',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'p1',
    name: 'OpenAI 官方',
    type: 'official',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-************************',
    supportedTypes: ['image', 'text'],
    enabled: true,
    remark: 'OpenAI 官方 API 服务',
    protocol: 'openai-compatible',
    createdAt: '2025-03-15T10:30:00.000Z',
  },
  {
    id: 'p2',
    name: 'Google Gemini',
    type: 'official',
    baseUrl: 'https://generativelanguage.googleapis.com/v1',
    apiKey: 'AIza***********************',
    supportedTypes: ['image', 'video', 'text'],
    enabled: true,
    remark: 'Google Gemini 系列模型',
    protocol: 'openai-compatible',
    createdAt: '2025-04-02T14:20:00.000Z',
  },
  {
    id: 'p3',
    name: 'Anthropic',
    type: 'official',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-********************',
    supportedTypes: ['text'],
    enabled: true,
    remark: 'Anthropic Claude 官方',
    protocol: 'openai-compatible',
    createdAt: '2025-04-10T09:15:00.000Z',
  },
  {
    id: 'p4',
    name: 'Stability AI',
    type: 'official',
    baseUrl: 'https://api.stability.ai/v1',
    apiKey: 'sk-************************',
    supportedTypes: ['image'],
    enabled: true,
    remark: 'Stable Diffusion / Flux 系列',
    protocol: 'openai-compatible',
    createdAt: '2025-05-01T11:00:00.000Z',
  },
  {
    id: 'p5',
    name: 'Midjourney',
    type: 'official',
    baseUrl: 'https://api.midjourney.com/v1',
    apiKey: '',
    supportedTypes: ['image'],
    enabled: false,
    remark: '待配置 API Key（自定义协议）',
    protocol: 'custom',
    createdAt: '2025-05-20T16:45:00.000Z',
  },
  {
    id: 'p6',
    name: 'Runway',
    type: 'official',
    baseUrl: 'https://api.runwayml.com/v1',
    apiKey: 'key-********************',
    supportedTypes: ['video'],
    enabled: true,
    remark: 'Runway Gen-3 视频生成（异步任务）',
    protocol: 'custom',
    createdAt: '2025-06-01T08:00:00.000Z',
  },
  {
    id: 'p7',
    name: 'Pika',
    type: 'official',
    baseUrl: 'https://api.pika.art/v1',
    apiKey: 'pik-********************',
    supportedTypes: ['video'],
    enabled: true,
    remark: 'Pika 视频生成',
    protocol: 'custom',
    createdAt: '2025-06-10T13:30:00.000Z',
  },
  {
    id: 'p8',
    name: 'DeepSeek',
    type: 'official',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-************************',
    supportedTypes: ['text', 'image'],
    enabled: true,
    remark: '深度求索官方 API',
    protocol: 'openai-compatible',
    createdAt: '2025-06-15T10:00:00.000Z',
  },
  {
    id: 'p9',
    name: '通义千问',
    type: 'official',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'sk-************************',
    supportedTypes: ['image', 'text'],
    enabled: true,
    remark: '阿里云通义千问',
    protocol: 'openai-compatible',
    createdAt: '2025-06-20T15:00:00.000Z',
  },
  {
    id: 'p10',
    name: '快手可灵',
    type: 'official',
    baseUrl: 'https://api.klingai.com/v1',
    apiKey: '',
    supportedTypes: ['video'],
    enabled: false,
    remark: '待配置（异步任务）',
    protocol: 'custom',
    createdAt: '2025-07-01T09:00:00.000Z',
  },
];
