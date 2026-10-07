import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20261003000000_add_product_media_and_telegram_sync/migration.sql',
);
const migration = readFileSync(migrationPath, 'utf8');
const multiMediaMigration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261004000000_add_product_multi_media/migration.sql',
  ),
  'utf8',
);

describe('product media migration safety', () => {
  it('runs tests only under NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('contains no destructive table or data operations', () => {
    for (const sql of [migration, multiMediaMigration]) {
      expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\b/i);
      expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
    }
  });

  it('adds backward-compatible nullable metadata and a safe status default', () => {
    expect(migration).toContain(
      `CREATE TYPE "TelegramProductSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED')`,
    );
    for (const column of [
      'imageFileId',
      'telegramChannelMessageId',
      'telegramPublishedAt',
      'telegramSyncedAt',
    ]) {
      expect(migration).toMatch(
        new RegExp(`ADD COLUMN "${column}" [^,;]+(?=,|;)`),
      );
      const declaration = migration.match(
        new RegExp(`ADD COLUMN "${column}" ([^,;]+)(?=,|;)`),
      )?.[1];
      expect(declaration).not.toMatch(/NOT NULL/i);
    }
    expect(migration).toMatch(
      /"telegramSyncStatus" "TelegramProductSyncStatus" NOT NULL DEFAULT 'PENDING'/,
    );
  });

  it('adds normalized media and Telegram message tables with cascade ownership', () => {
    expect(multiMediaMigration).toContain('CREATE TABLE "ProductMedia"');
    expect(multiMediaMigration).toContain(
      'CREATE TABLE "ProductTelegramMessage"',
    );
    expect(multiMediaMigration).toContain(
      'CREATE UNIQUE INDEX "ProductMedia_productId_fileId_key"',
    );
    expect(multiMediaMigration).toMatch(
      /"ProductMedia_productId_fkey"[\s\S]+ON DELETE CASCADE/,
    );
    expect(multiMediaMigration).toMatch(
      /"ProductTelegramMessage_productId_fkey"[\s\S]+ON DELETE CASCADE/,
    );
  });
});
