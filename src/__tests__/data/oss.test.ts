/**
 * 测试 data/oss.ts - OSS 配置类型和默认配置
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_OSS_CONFIG } from '../../data/oss.ts';
import type { IOssConfig } from '../../data/oss.ts';

describe('data/oss.ts', () => {
  describe('DEFAULT_OSS_CONFIG', () => {
    it('should have provider "aliyun-oss"', () => {
      assert.strictEqual(DEFAULT_OSS_CONFIG.provider, 'aliyun-oss');
    });

    it('should have required string fields', () => {
      const fields = [
        'accessPointName',
        'endpointExternal',
        'endpointInternal',
        'bucket',
        'region',
        'regionLabel',
      ] as const;
      for (const field of fields) {
        assert.ok(
          typeof DEFAULT_OSS_CONFIG[field] === 'string',
          `Field "${field}" should be a string`
        );
        assert.ok(DEFAULT_OSS_CONFIG[field].length > 0, `Field "${field}" should not be empty`);
      }
    });

    it('should have empty access keys by default', () => {
      assert.strictEqual(DEFAULT_OSS_CONFIG.accessKeyId, '');
      assert.strictEqual(DEFAULT_OSS_CONFIG.accessKeySecret, '');
    });

    it('should have pathPrefix "images/"', () => {
      assert.strictEqual(DEFAULT_OSS_CONFIG.pathPrefix, 'images/');
    });

    it('should have enabled as false by default', () => {
      assert.strictEqual(DEFAULT_OSS_CONFIG.enabled, false);
    });

    it('should have region "cn-shanghai"', () => {
      assert.strictEqual(DEFAULT_OSS_CONFIG.region, 'cn-shanghai');
    });

    it('should have valid endpoint URLs', () => {
      assert.ok(DEFAULT_OSS_CONFIG.endpointExternal.includes('oss-cn-shanghai'));
      assert.ok(DEFAULT_OSS_CONFIG.endpointInternal.includes('-internal'));
    });
  });

  describe('IOssConfig type', () => {
    it('should allow complete config object', () => {
      const config: IOssConfig = {
        provider: 'aliyun-oss',
        accessPointName: 'test',
        endpointExternal: 'https://test.oss-cn-shanghai.aliyuncs.com',
        endpointInternal: 'https://test.oss-cn-shanghai-internal.aliyuncs.com',
        bucket: 'test-bucket',
        region: 'cn-shanghai',
        regionLabel: '华东2（上海）',
        accessKeyId: 'test-key',
        accessKeySecret: 'test-secret',
        pathPrefix: 'uploads/',
        customDomain: '',
        enabled: true,
      };
      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.provider, 'aliyun-oss');
    });
  });
});
