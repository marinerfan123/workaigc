// EXPORTS: IGenerationSettings, DEFAULT_SETTINGS

/** 比例：覆盖常见构图 + 智能(auto) 兜底 */
export type Ratio =
  | 'auto'
  | '1:1' | '1:2' | '2:1'
  | '9:16' | '16:9'
  | '3:4' | '4:3'
  | '3:2' | '2:3'
  | '5:4' | '4:5'
  | '21:9' | '9:21';

/** 图像质量：低/标准/高（传后端即使未启用也安全） */
export type Quality = 'low' | 'standard' | 'high';

export interface IGenerationSettings {
  contentType: 'image' | 'video';
  videoMode?: 'frame' | 'clip';
  ratio: Ratio;
  resolution: '1k' | '2k' | '4k' | '8k';
  quality: Quality;
  model: string;
  count: 1 | 2 | 3 | 4;
  duration?: 4 | 6 | 8 | 10;
}

export const DEFAULT_SETTINGS: IGenerationSettings = {
  contentType: 'image',
  ratio: '16:9',
  resolution: '2k',
  quality: 'standard',
  model: 'Nano Banana 2 Lite',
  count: 1,
};
