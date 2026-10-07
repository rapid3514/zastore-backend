import {
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  get: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@imagekit/nodejs', () => {
  class MockNotFoundError extends Error {}
  class MockImageKit {
    files = { get: sdk.get, delete: sdk.delete };
    helper = { getAuthenticationParameters: vi.fn() };
  }
  return { default: MockImageKit, NotFoundError: MockNotFoundError };
});

import { NotFoundError } from '@imagekit/nodejs';
import { ImageKitService } from './imagekit.service.js';

describe('ImageKitService error safety', () => {
  let service: ImageKitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImageKitService(
      new ConfigService({ IMAGEKIT_PRIVATE_KEY: 'fake-private-key' }),
    );
  });

  it('maps provider not-found without making a real request', async () => {
    sdk.get.mockRejectedValueOnce(new NotFoundError());
    await expect(service.getFile('missing-file')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['lookup', () => service.getFile('file-1'), sdk.get],
    ['delete', () => service.deleteFile('file-1'), sdk.delete],
  ] as const)('sanitizes %s failure logs', async (_operation, action, mock) => {
    const logger = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    mock.mockRejectedValueOnce(
      new Error('fake-private-key bot-token webhook-secret signature-value'),
    );
    let caught: unknown;
    try {
      await action();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    const response =
      caught instanceof ServiceUnavailableException
        ? JSON.stringify(caught.getResponse())
        : '';
    expect(response).not.toContain('fake-private-key');
    expect(response).not.toContain('bot-token');
    expect(response).not.toContain('webhook-secret');
    expect(response).not.toContain('signature-value');
    const logged = JSON.stringify(logger.mock.calls);
    expect(logged).not.toContain('fake-private-key');
    expect(logged).not.toContain('bot-token');
    expect(logged).not.toContain('webhook-secret');
    expect(logged).not.toContain('signature-value');
    logger.mockRestore();
  });
});
