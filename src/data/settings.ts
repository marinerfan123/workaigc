// EXPORTS: IGenerationSettings, DEFAULT_SETTINGS

export interface IGenerationSettings {
  contentType: 'image' | 'video';
  videoMode?: 'frame' | 'clip';
  ratio: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  model: string;
  count: 1 | 2 | 3 | 4;
  duration?: 4 | 6 | 8 | 10;
}

export const DEFAULT_SETTINGS: IGenerationSettings = {
  contentType: 'image',
  ratio: '16:9',
  model: 'Nano Banana 2 Lite',
  count: 1,
};
