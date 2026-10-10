# Zastore backend

NestJS, PostgreSQL and Prisma API for the Telegram Mini App. Node.js 22+ is required.

## Development

Copy `.env.example` to `.env`, generate independent JWT secrets, and configure provider credentials when needed. Secrets are never committed. Run local infrastructure with the standalone development configuration:

```sh
npm ci
docker compose -f docker-compose.dev.yml up -d
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

Development `DATABASE_URL` targets `localhost:5432` and `REDIS_URL` targets `localhost:6379`. PostgreSQL initialization derives its user/password/database from the single connection URL; credentials must use unreserved letters, digits, underscore or hyphen. Generate a password with `crypto.randomBytes(48).toString('base64url')`. URL parameters such as `?schema=public` remain supported. Existing database volumes preserve their credentials.

```sh
npm test
npm run test:e2e
npm run lint
npm run build
npm audit --omit=dev
```

## Production release

Use the default `docker-compose.yml`. It explicitly sets production mode for the application and release job, regardless of the local `.env` mode. PostgreSQL and Redis have no published ports and run on an internal network. The backend binds only `127.0.0.1:3000` behind a host HTTPS proxy.

Production `.env` must use `DATABASE_URL` with the `postgres:5432` service hostname and `REDIS_URL=redis://redis:6379`. Set real HTTPS `APP_PUBLIC_URL` and `MINI_APP_URL`; development/placeholder/tunnel public origins are rejected. Set the ImageKit and Telegram credentials required by the schema. Generate three independent random values for access JWT, refresh JWT, and Telegram webhook secret (at least 32 random characters). Use base64url for the webhook secret.

```sh
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs migrate backend
```

The `migration` build target includes Prisma CLI, schema, config, migrations and compiled validation. Its release job validates configuration, checks pending migrations, and runs `prisma migrate deploy`. A failed job prevents the new backend from starting. The separate production target installs only runtime dependencies with optional peer CLI packages omitted and runs as the unprivileged `node` user with a read-only filesystem.

On a populated database, pending SQL that deletes data or drops tables/columns/types is rejected by the automatic release job. Back up the database and review such changes separately in a maintenance release before applying them with `prisma migrate deploy`; never use development migrations in production. Historical migrations can initialize a clean database because no application tables exist. Application validation constraints fail safely if existing data violates new invariants; correct the records after review before retrying. Do not mark a failed migration as applied without investigating it.

## HTTPS proxy and rate limiting

Install the HTTPS certificate/key and include [deploy/nginx.conf](deploy/nginx.conf) in the host nginx `http` context. The supplied proxy handles gzip; application compression is intentionally disabled so responses are compressed once. The proxy overwrites forwarding headers with the actual peer address/protocol. Keep its body size limit aligned with `REQUEST_BODY_LIMIT_BYTES`.

The compose edge network uses `172.30.0.0/24`; only its host gateway `172.30.0.1/32` is trusted as the reverse proxy. If that subnet conflicts with host routing, change both the compose subnet and exact trusted gateway together. For a different deployment topology, configure `TRUST_PROXY_CIDRS` as exact proxy IPs/CIDRs. Never trust all proxies. Direct HTTP API requests in production are rejected before handlers; the local `/health` probe is the sole exception. Refresh cookies are host-only, HTTP-only, secure in production, SameSite=Lax and scoped to the auth API.

Production rate limiting uses the configured shared Redis instance with atomic counters and separate route buckets for authentication (10/min), refresh (20/min), order/payment writes (30/min), public API (120/min), and Telegram webhook (600/min). Health checks bypass request throttling. Redis outages fail protected requests closed with 503; reconnect failure also prevents startup. Development can run with an empty `REDIS_URL` for single-process memory storage. Do not run multiple production instances without the shared store.

## Canonical configuration

Application code reads one typed, validated runtime configuration. Unknown application-prefixed environment names fail startup. Config validation errors list field names, never their values.

`APP_PUBLIC_URL` is the backend origin. `MINI_APP_URL` is the actual Mini App URL, including its path when needed. Set `ADMIN_APP_URL` only for a distinct administrator application. CORS derives those two origins automatically; `CORS_ALLOWED_ORIGINS` contains only additional distinct trusted origins. Duplicating derived origins is rejected. Requests without `Origin` are accepted for native/server integrations; browser requests require exact origin matching. CORS does not replace JWT/role/ownership authorization.

The public webhook URL is always `APP_PUBLIC_URL` plus `/api/v1/telegram/webhook`. After configuring the HTTPS public origin:

```sh
npm run telegram:webhook
```

This registers the secret header with Telegram and never substitutes an unrelated origin. The command is a development/operator setup tool, not part of application startup. Telegram command registration failures are logged without provider credentials.

## Reliability and monitoring

Pending orders are expired by a periodic conditional database update using `ORDER_EXPIRATION_INTERVAL_MS`. The job also catches overdue orders after restart. Notification events are committed with order changes, then delivered by the outbox worker using `OUTBOX_POLL_INTERVAL_MS` and bounded `OUTBOX_MAX_ATTEMPTS`. Known rejected requests can retry with backoff. Telegram has no general idempotency key: timeout/ambiguous outcomes are parked for operator review rather than retried blindly, preventing automatic duplicate messages. Monitor structured worker failure logs and parked/failed outbox rows.

Public catalog responses have a short safe cache; authenticated and private responses and all errors are `private, no-store`. Global body limits, strict CORS, HTTPS checks, Helmet headers, and sensitive-field log redaction are enabled at bootstrap. Product media validation enforces configured byte/dimension/duration limits; product cards consume responsive thumbnail/card URLs rather than originals.

## ImageKit upload policy

Browser upload credentials are intentionally short lived and available only to administrators, but the ImageKit upload API does not cryptographically bind an arbitrary client-supplied `checks` field to its token. Before enabling direct uploads in production, create an ImageKit **Path policy** for the configured `IMAGEKIT_PRODUCT_FOLDER`. The policy must reject files outside that folder and enforce the following provider-side checks: images must be JPEG, PNG, WebP or AVIF and at most `5242880` bytes; videos must be MP4, WebM or QuickTime and at most `157286400` bytes. This is required in addition to the backend's post-upload metadata verification. Do not mark a deployment ready until the policy has been verified in ImageKit with an over-limit upload attempt.

Review the current security implementation report and deployment-specific certificate, backup, monitoring and secret provisioning before exposing the HTTPS endpoint. Production deployment is not performed automatically by this repository change.

## Checkout and catalog API contract

`POST /api/v1/orders` requires an `Idempotency-Key` header containing a UUID. Reuse the same UUID for retries of the same checkout payload. A successful retry returns the existing order; reusing the UUID with different items or delivery details returns HTTP 409. The key is unique per customer. The Mini App stores the UUID and a payload hash for the current tab's retry and removes them after success.

`GET /api/v1/products` returns paginated card data: ID, name, price, cargo price when applicable, availability, category and cover image with responsive variants. It omits full description and media arrays. `GET /api/v1/products/:id` supplies full description and public media with thumbnail, card and detail URLs. Management endpoints keep their detailed editing response. ImageKit file identifiers remain private on public responses.

Product edits use an internal monotonic version. If another editor changes the product first, the API returns HTTP 409 and the client should reload the product. The version is not an additional client input.
