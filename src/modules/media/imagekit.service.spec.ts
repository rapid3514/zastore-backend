import { createConfigService } from '../../../test/helpers/config.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageKitService } from './imagekit.service.js';

describe('ImageKitService upload authentication', () => {
  afterEach(() => vi.useRealTimers());

  it('uses the current SDK to create a short-lived one-time signature', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
    const before = Math.floor(Date.now() / 1000);
    const service = new ImageKitService(
      createConfigService({ IMAGEKIT_PRIVATE_KEY: 'private_test_key' }),
    );
    const authentication = service.getUploadAuthentication();

    expect(authentication.token).toMatch(/^[0-9a-f-]{36}$/i);
    expect(authentication.signature).toMatch(/^[0-9a-f]{40}$/i);
    expect(authentication.expire).toBe(before + 5 * 60);
    expect(authentication).not.toHaveProperty('privateKey');
  });
});
