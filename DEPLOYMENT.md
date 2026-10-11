# Production deployment (Oracle Cloud Always Free)

This runbook assumes an Ubuntu ARM64 VM, a public IPv4 address, and a DNS A
record for the backend hostname. Do not use a Quick Tunnel. Do not create a
paid OCI resource when Always Free capacity is unavailable.

## Required external preparation

1. Create or select an Always Free eligible `VM.Standard.A1.Flex` Ubuntu ARM64
   instance. Keep its shape inside the tenancy's displayed Always Free limits.
2. Allow inbound TCP 22 from the operator's fixed IP where possible, plus TCP
   80/443 and UDP 443. Do not allow 3000, 5432, or 6379.
3. Point the production backend hostname at the instance public IP and wait for
   public DNS resolution. Caddy uses that hostname to obtain and renew TLS.
   If no owned domain is available, a dedicated DuckDNS hostname is an
   acceptable zero-cost fallback; do not use a temporary tunnel hostname.
4. Rotate previously exposed Telegram, JWT, database, and ImageKit credentials.
   Store the replacements only in `/opt/zastore-shop/.env.production` with mode
   `600`.

## Server bootstrap

```sh
sudo sh deploy/bootstrap-ubuntu.sh
sudo install -d -o "$USER" -g "$USER" -m 750 /opt/zastore-shop
```

After verifying key-based SSH works in a second session, disable SSH password
authentication in `/etc/ssh/sshd_config.d/99-zastore.conf` and reload SSH. Do
not disable it before the key login has been tested.

## Production environment

Copy `.env.example` to `.env.production`, then replace every provider value and
set at least:

```dotenv
NODE_ENV=production
APP_PUBLIC_URL=https://api.your-real-domain.example
MINI_APP_URL=https://your-real-frontend.example
DATABASE_URL=postgresql://zastore:RANDOM_BASE64URL_PASSWORD@postgres:5432/zastore_shop?schema=public
REDIS_URL=redis://redis:6379
```

Keep `REQUEST_BODY_LIMIT_BYTES=65536`: media files upload directly from the
browser to ImageKit, not through this API. The backend returns short-lived
ImageKit upload authentication and never returns the private key.

```sh
chmod 600 .env.production
docker compose --env-file .env.production config --quiet
```

## First release or update

Take a backup before updating an existing database. The migration job uses
`prisma migrate deploy`; it never resets the database. It blocks pending SQL
that appears destructive when application tables already exist.

```sh
sh deploy/backup-postgres.sh                         # existing installation
git pull --ff-only                                  # when deployed from Git
docker compose --env-file .env.production build --pull migrate backend telegram-webhook
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production wait migrate
curl --fail --show-error --silent https://api.your-real-domain.example/health
docker compose --env-file .env.production --profile operations run --rm telegram-webhook
docker compose --env-file .env.production ps
```

The webhook command runs only after public HTTPS health succeeds. It calls
`setWebhook`, verifies `getWebhookInfo`, and prints URL, pending update count,
and the last Telegram delivery error without printing credentials.

The current `20261010000000_remove_product_menu_active` migration intentionally
converts hidden products to `OUT_OF_STOCK` and then removes the legacy column.
On a populated database, the release guard stops before this migration. Review
the backup and legacy rows on the target server instead of weakening the guard.

## Restart, logs, and migration status

The `20261011000000_bot_appearance` migration creates the singleton background
setting without modifying existing tables or rows. `GET /api/v1/appearance`
returns the public `backgroundUrl` and `updatedAt` (both null before the first
save). Admins can `PATCH /api/v1/appearance` with
`{"background":{"fileId":"IMAGEKIT_FILE_ID","url":"https://ik.imagekit.io/..."}}`.
The server verifies the ImageKit file and uses its authoritative URL. Send
`{"background":null}` to restore the default. Saved backgrounds are protected
from unassigned media cleanup; replacing or resetting the background cleans up
the previous file only when no feature references it.

The `20261011010000_separate_super_admin_appearance` migration preserves the
existing `bot` row and permits an independent `super-admin` row. Only super
admins can GET/PATCH `/api/v1/appearance/super-admin`; regular admins cannot
read or change that background. Super admins cannot PATCH the store endpoint.
The same request and response shape applies to both scopes, and resetting one
scope does not change the other or fall back to its image.

```sh
docker compose --env-file .env.production restart backend caddy
docker compose --env-file .env.production logs --tail=200 backend caddy postgres redis
docker compose --env-file .env.production run --rm migrate
docker compose --env-file .env.production exec redis redis-cli ping
```

## Backups and recovery

Run the backup script daily from root's crontab or a systemd timer. It creates a
mode-`600` custom-format dump and deletes dumps older than 14 days. Put a copy
off the VM; the default directory alone does not protect against boot-volume
loss.

```sh
BACKUP_RETENTION_DAYS=14 sh deploy/backup-postgres.sh
docker compose --env-file .env.production stop backend caddy
RESTORE_CONFIRMED=yes sh deploy/restore-postgres.sh backups/postgres/zastore-TIMESTAMP.dump
docker compose --env-file .env.production up -d backend caddy
```

Restore is destructive and deliberately requires explicit confirmation. Never
delete `postgres_data`, `caddy_data`, or `caddy_config` during routine updates.
