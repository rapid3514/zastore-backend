import https from 'node:https';
import { afterAll, expect } from 'vitest';

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Tests must run with NODE_ENV=test');
}

const forbiddenHosts = new Set([
  'api.imagekit.io',
  'upload.imagekit.io',
  'ik.imagekit.io',
  'api.telegram.org',
]);
const forbiddenAttempts: string[] = [];

const originalFetch = globalThis.fetch;
if (originalFetch) {
  globalThis.fetch = (async (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    if (forbiddenHosts.has(url.hostname)) {
      forbiddenAttempts.push(url.hostname);
      throw new Error(`External service blocked in tests: ${url.hostname}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

const originalHttpsRequest = https.request;
Object.defineProperty(https, 'request', {
  configurable: true,
  writable: true,
  value: ((...args: Parameters<typeof https.request>) => {
    const target = args[0];
    const hostname =
      typeof target === 'string' || target instanceof URL
        ? new URL(target).hostname
        : target.hostname;
    if (hostname && forbiddenHosts.has(hostname)) {
      forbiddenAttempts.push(hostname);
      throw new Error(`External service blocked in tests: ${hostname}`);
    }
    return originalHttpsRequest(...args);
  }) as typeof https.request,
});

afterAll(() => {
  expect(forbiddenAttempts).toEqual([]);
  if (originalFetch) globalThis.fetch = originalFetch;
  Object.defineProperty(https, 'request', {
    configurable: true,
    writable: true,
    value: originalHttpsRequest,
  });
});
