/**
 * 测试 data/models.ts - 模型和服务商类型及 Mock 数据
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MOCK_MODELS,
  MOCK_PROVIDERS,
  PROVIDER_TEMPLATES,
} from '../../data/models.ts';
import type { IModelProvider, IAiModel, ModelType } from '../../data/models.ts';

describe('data/models.ts', () => {
  describe('MOCK_MODELS', () => {
    it('should contain at least 10 models', () => {
      assert.ok(MOCK_MODELS.length >= 10);
    });

    it('each model should have required fields', () => {
      for (const model of MOCK_MODELS) {
        assert.ok(typeof model.id === 'string', `Model ${model.id}: missing id`);
        assert.ok(typeof model.modelId === 'string', `Model ${model.id}: missing modelId`);
        assert.ok(
          typeof model.displayName === 'string',
          `Model ${model.id}: missing displayName`
        );
        assert.ok(
          ['image', 'video', 'text'].includes(model.type),
          `Model ${model.id}: invalid type ${model.type}`
        );
        assert.ok(typeof model.providerId === 'string', `Model ${model.id}: missing providerId`);
        assert.ok(typeof model.enabled === 'boolean', `Model ${model.id}: missing enabled`);
      }
    });

    it('should have unique IDs', () => {
      const ids = MOCK_MODELS.map((m) => m.id);
      assert.strictEqual(new Set(ids).size, ids.length);
    });

    it('should have all three model types represented', () => {
      const types = new Set(MOCK_MODELS.map((m) => m.type));
      assert.ok(types.has('image'), 'Should have image models');
      assert.ok(types.has('video'), 'Should have video models');
      assert.ok(types.has('text'), 'Should have text models');
    });

    it('each model should reference a valid provider', () => {
      const providerIds = new Set(MOCK_PROVIDERS.map((p) => p.id));
      for (const model of MOCK_MODELS) {
        assert.ok(
          providerIds.has(model.providerId),
          `Model ${model.id} references unknown provider ${model.providerId}`
        );
      }
    });
  });

  describe('MOCK_PROVIDERS', () => {
    it('should contain at least 5 providers', () => {
      assert.ok(MOCK_PROVIDERS.length >= 5);
    });

    it('each provider should have required fields', () => {
      for (const p of MOCK_PROVIDERS) {
        assert.ok(typeof p.id === 'string', `Provider ${p.id}: missing id`);
        assert.ok(typeof p.name === 'string', `Provider ${p.id}: missing name`);
        assert.ok(
          ['official', 'relay', 'custom'].includes(p.type),
          `Provider ${p.id}: invalid type`
        );
        assert.ok(typeof p.baseUrl === 'string', `Provider ${p.id}: missing baseUrl`);
        assert.ok(Array.isArray(p.supportedTypes), `Provider ${p.id}: missing supportedTypes`);
        assert.ok(typeof p.enabled === 'boolean', `Provider ${p.id}: missing enabled`);
      }
    });

    it('should have unique IDs', () => {
      const ids = MOCK_PROVIDERS.map((p) => p.id);
      assert.strictEqual(new Set(ids).size, ids.length);
    });

    it('should have at least one enabled provider', () => {
      const enabled = MOCK_PROVIDERS.filter((p) => p.enabled);
      assert.ok(enabled.length > 0, 'Should have at least one enabled provider');
    });

    it('should have valid baseUrls', () => {
      for (const p of MOCK_PROVIDERS) {
        assert.ok(
          p.baseUrl.startsWith('http://') || p.baseUrl.startsWith('https://'),
          `Provider ${p.id}: invalid baseUrl`
        );
      }
    });
  });

  describe('PROVIDER_TEMPLATES', () => {
    it('should contain at least 8 templates', () => {
      assert.ok(PROVIDER_TEMPLATES.length >= 8);
    });

    it('each template should have a name and type', () => {
      for (const t of PROVIDER_TEMPLATES) {
        assert.ok(typeof t.name === 'string' && t.name.length > 0);
        assert.ok(['official', 'relay', 'custom'].includes(t.type));
      }
    });

    it('each template should have supportedTypes array', () => {
      for (const t of PROVIDER_TEMPLATES) {
        assert.ok(Array.isArray(t.supportedTypes));
        assert.ok(t.supportedTypes.length > 0);
      }
    });
  });
});
