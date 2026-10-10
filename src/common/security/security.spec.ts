import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createConfigService } from '../../../test/helpers/config.js';
import { isTrustedOrigin } from './http-security.js';
import { RateLimitStorage } from './rate-limit.storage.js';
import { redactLogValue } from './redacting-logger.js';

describe('security configuration regressions', () => {
  it('allows only exact trusted origins and explicitly allows server-to-server requests', () => {
    expect(isTrustedOrigin('https://trusted.zastore.uz', ['https://trusted.zastore.uz'])).toBe(true);
    expect(isTrustedOrigin(undefined, ['https://trusted.zastore.uz'])).toBe(true);
    for (const origin of ['https://attacker.com', 'https://trusted.zastore.uz.attacker.com', 'https://trusted.zastore.uz/path', 'null']) expect(isTrustedOrigin(origin, ['https://trusted.zastore.uz'])).toBe(false);
  });
  it('redacts nested secrets, credentials, JWTs, and authorization values', () => {
    const value = redactLogValue({ headers: { authorization: 'Bearer unsafe', cookie: 'session=x' }, refreshToken: 'raw', nested: { privateKey: 'key', safe: 'value' }, error: new Error('postgresql://u:p@host/db private-credential'), text: 'Bearer opaque eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature' }, ['private-credential']);
    const output = JSON.stringify(value);
    expect(output).not.toMatch(/unsafe|session=x|private-credential|eyJ|u:p@host|"raw"|"key"/);
    expect(output).toContain('"safe":"value"');
  });
  it('enforces a finite limit in development without leaking to another route', async () => {
    const storage = new RateLimitStorage(createConfigService());
    const requests = await Promise.all(Array.from({ length: 3 }, () => storage.increment('auth-ip', 60_000, 2, 60_000, 'default')));
    expect(requests.filter((result) => result.isBlocked)).toHaveLength(1);
    expect((await storage.increment('webhook-ip', 60_000, 600, 60_000, 'default')).isBlocked).toBe(false);
    await storage.onModuleDestroy();
  });
  it('keeps PostgreSQL and Redis private and forces production mode before backend startup', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8');
    const database = compose.slice(compose.indexOf('  postgres:'), compose.indexOf('  redis:'));
    const redis = compose.slice(compose.indexOf('  redis:'), compose.indexOf('  migrate:'));
    expect(database).not.toContain('ports:');
    expect(redis).not.toContain('ports:');
    expect(compose).toContain('internal: true');
    expect(compose).toContain('127.0.0.1:3000:3000');
    expect(compose).toContain('NODE_ENV: production');
    expect(compose).toContain('condition: service_completed_successfully');
  });
  it('keeps migration CLI out of runtime and includes migration artifacts in release stage', () => {
    const dockerfile = readFileSync('Dockerfile', 'utf8');
    expect(dockerfile).toContain('FROM dependencies AS migration');
    expect(dockerfile).toContain('COPY --from=build /app/prisma ./prisma');
    expect(dockerfile).toContain('COPY --from=build /app/prisma7.config.ts ./prisma7.config.ts');
    expect(dockerfile).toContain('scripts/release-migrate.js');
    expect(dockerfile).toContain('npm ci --omit=dev --omit=peer');
    expect(readFileSync('scripts/release-migrate.js', 'utf8')).toContain("'migrate', 'deploy'");
  });
});
