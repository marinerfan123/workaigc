// EXPORTS: IOssConfig, DEFAULT_OSS_CONFIG

export interface IOssConfig {
  provider: 'aliyun-oss';
  accessPointName: string;
  endpointExternal: string;
  endpointInternal: string;
  bucket: string;
  region: string;
  regionLabel: string;
  accessKeyId: string;
  accessKeySecret: string;
  pathPrefix: string;
  customDomain: string;
  enabled: boolean;
}

export const DEFAULT_OSS_CONFIG: IOssConfig = {
  provider: 'aliyun-oss',
  accessPointName: 'huabu123',
  endpointExternal:
    'huabu123-1599462421250732.oss-cn-shanghai.oss-accesspoint.aliyuncs.com',
  endpointInternal:
    'huabu123-1599462421250732.oss-cn-shanghai-internal.oss-accesspoint.aliyuncs.com',
  bucket: 'oss-pai-8f7hhyl09yhscjroqw-cn-shanghai',
  region: 'cn-shanghai',
  regionLabel: '华东2（上海）',
  accessKeyId: '',
  accessKeySecret: '',
  pathPrefix: 'images/',
  customDomain: '',
  // ⚠️ OSS 默认开启 —— 关闭后图片无法持久保存（外部 API URL 会过期）
  enabled: true,
};
