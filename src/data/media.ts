// EXPORTS: IMediaItem, MOCK_MEDIA_LIST

export interface IMediaItem {
  id: string;
  title: string;
  type: 'image' | 'video';
  thumbnail: string;
  fullUrl: string;
  prompt: string;
  model: string;
  ratio: string;
  createdAt: string;
  isFavorite: boolean;
  isDeleted: boolean;
  source: 'mock' | 'user';
  category?: 'image' | 'character' | 'scene' | 'prop' | 'other' | 'upload';
  ossUrl?: string; // OSS 访问链接
  ossObjectKey?: string; // OSS 对象路径
  ossUploaded?: boolean; // 是否已上传到 OSS
  status?: 'success' | 'failed'; // 媒体状态：成功 / 失败（默认 success 兼容历史数据）
  errorMessage?: string; // 失败原因（仅 failed 时有值）
  failedAt?: string; // 失败时间（ISO）
}

const HANFU_PROMPT = `电影级 8K 超写实人像，东方古典顶级美人，极致舒展的东方骨相，流畅柔和的鹅蛋脸，面部线条圆润无锐角，皮肉贴合度极佳，饱满又不失清隽感。远山黛弯眉舒展自然，不带生硬棱角；桃花眼眼尾微微上扬，饱满卧蚕衬得眼波柔润，深棕褐色瞳孔如浸了水墨的琥珀，澄澈又含朦胧柔光，纤长卷翘的睫毛根根分明，眼周晕着淡淡的粉调，眼尾自带天然红晕。鼻梁秀挺、山根过渡自然，鼻头小巧圆润，海鸥线精致清晰；饱满 M 唇，唇珠莹润，唇角噙着一抹极淡的浅笑，唇色是原生豆沙红，水润透亮。下颌线流畅柔和，脖颈纤细修长，肩线平展舒展，头肩比例优越。`;

export const MOCK_MEDIA_LIST: IMediaItem[] = [
  {
    id: '1',
    title: 'Woman in Hanfu portrait',
    type: 'image',
    thumbnail: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr7ceouew_ve_miaoda',
    fullUrl: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr7ceouew_ve_miaoda',
    prompt: HANFU_PROMPT + '灰蓝色交领汉服，珍珠耳饰项链，中式木格窗背景，竹影，柔和自然光。',
    model: 'Nano Banana Pro',
    ratio: '4:3',
    createdAt: '2026-07-30T10:23:00Z',
    isFavorite: false,
    isDeleted: false,
    source: 'mock',
    category: 'image',
  },
  {
    id: '2',
    title: 'Oriental classical beauty',
    type: 'image',
    thumbnail: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr6mdrgcu_ve_miaoda',
    fullUrl: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr6mdrgcu_ve_miaoda',
    prompt: HANFU_PROMPT + '烟青色暗纹广袖汉服，珍珠璎珞项圈，中式书房背景，古籍书架，暖光侧影，衣身暗纹若隐若现。',
    model: 'Nano Banana 2',
    ratio: '4:3',
    createdAt: '2026-07-30T09:15:00Z',
    isFavorite: true,
    isDeleted: false,
    source: 'mock',
    category: 'image',
  },
  {
    id: '3',
    title: 'Hanfu with folding fan',
    type: 'image',
    thumbnail: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr2aw5iju_ve_miaoda',
    fullUrl: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr2aw5iju_ve_miaoda',
    prompt: HANFU_PROMPT + '手持折扇，灰蓝汉服，珍珠耳坠，中式窗格竹影背景，清冷光影，气质温婉端庄。',
    model: 'Nano Banana 2 Lite',
    ratio: '3:4',
    createdAt: '2026-07-29T16:42:00Z',
    isFavorite: false,
    isDeleted: false,
    source: 'mock',
    category: 'character',
  },
  {
    id: '4',
    title: 'Eastern beauty dancing rhythm',
    type: 'image',
    thumbnail: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr2igusfu_ve_miaoda',
    fullUrl: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr2igusfu_ve_miaoda',
    prompt: HANFU_PROMPT + '酒红色汉服广袖飘舞，中式庭院古建筑背景，舞动姿态，衣袂翻飞，动感自然真实。',
    model: 'Nano Banana Pro',
    ratio: '16:9',
    createdAt: '2026-07-29T14:08:00Z',
    isFavorite: false,
    isDeleted: false,
    source: 'mock',
    category: 'scene',
  },
  {
    id: '5',
    title: 'Bamboo garden serenity',
    type: 'image',
    thumbnail: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr6tuocks_ve_miaoda',
    fullUrl: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr6tuocks_ve_miaoda',
    prompt: HANFU_PROMPT + '素色交领汉服，竹林窗边背景，晨光斜照，静谧雅致，氛围清雅有禅意。',
    model: 'Nano Banana 2',
    ratio: '4:3',
    createdAt: '2026-07-28T11:30:00Z',
    isFavorite: true,
    isDeleted: false,
    source: 'mock',
    category: 'image',
  },
  {
    id: '6',
    title: 'Garden elegance portrait',
    type: 'image',
    thumbnail: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr7f44cbw_ve_miaoda',
    fullUrl: '/spark/app/app_17b6nt94h30/runtime/api/v1/storage/object/bucket_aadknriz7eihs_static/static%2Faadknr7f44cbw_ve_miaoda',
    prompt: HANFU_PROMPT + '深蓝色对襟汉服，珍珠发饰，中式园林背景，假山流水，意境悠远，气质雍容华贵。',
    model: 'Nano Banana 2 Lite',
    ratio: '9:16',
    createdAt: '2026-07-28T08:55:00Z',
    isFavorite: false,
    isDeleted: false,
    source: 'mock',
    category: 'character',
  },
];
