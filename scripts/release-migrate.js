import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const SUPABASE_DB_URL = 'postgresql://zastore_app.rnloubosxkqbcwtuxllf:ZaStore_Db_2026_SecurePass99@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('render.com') || process.env.DATABASE_URL.includes('dpg-')) {
  process.env.DATABASE_URL = SUPABASE_DB_URL;
}
const databaseUrl = process.env.DATABASE_URL;
let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : undefined;
} catch {
  parsedDatabaseUrl = undefined;
}
if (!parsedDatabaseUrl || parsedDatabaseUrl.protocol !== 'postgresql:') {
  console.error('Migration release failed; DATABASE_URL must be a valid PostgreSQL URL.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  const hasApplicationData = tables.rows.some((row) => row.tablename !== '_prisma_migrations');
  const applied = tables.rows.some((row) => row.tablename === '_prisma_migrations')
    ? new Set((await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map((row) => row.migration_name))
    : new Set();
  const pending = [];
  for (const entry of await readdir('prisma/migrations', { withFileTypes: true })) {
    if (!entry.isDirectory() || applied.has(entry.name)) continue;
    pending.push(entry.name);
    const sql = (await readFile(`prisma/migrations/${entry.name}/migration.sql`, 'utf8')).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (hasApplicationData && /\bDROP\s+(?:TABLE|COLUMN|TYPE)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bALTER\s+COLUMN\s+[^;]+\s+TYPE\b/i.test(sql)) {
      throw new Error('Pending destructive migration requires a reviewed manual release');
    }
  }
  await client.end();
  if (pending.length === 0) {
    console.log('Database schema is already up to date; skipping prisma migrate deploy.');
    process.exitCode = 0;
  } else {
    const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', 'prisma7.config.ts'], { stdio: 'inherit', env: process.env });
    process.exitCode = result.status ?? 1;
  }
} catch {
  await client.end().catch(() => undefined);
  console.error('Migration release failed; application startup is blocked. Review pending migrations and database connectivity.');
  process.exitCode = 1;
}
