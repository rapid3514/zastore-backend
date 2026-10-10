# Production security and deployment verification

Date: 2026-10-08. Scope: `zastore-shop` backend and the connected `shop-front` UI. This is a code and isolated-test assessment, **not a deployment to the live service**. Existing containers, their database and secrets were not changed. The live deployment retains the old configuration until an operator performs the release.

## FIXED

| ID | Implementation | Verification |
| --- | --- | --- |
| SEC-01 | `src/modules/work-hours/work-hours.service.ts`, DTO/service validation and migration checks: bounded deadline search and controlled closed-store 4xx. | `test/order-work-hours-security.e2e-spec.ts`, work-hours unit tests, concurrent `/health`. |
| SEC-02 | `Dockerfile`, `docker-compose.yml`, `src/config/env.schema.ts`, auth controller and HTTPS middleware: forced production mode, validated HTTPS public URLs, secure host-only refresh cookie, exact proxy protocol handling. | Config, auth and HTTP-security tests; compose inspection. |
| SEC-03 | Production compose uses private data network, no PostgreSQL/Redis host ports, loopback-only backend bind. `docker-compose.dev.yml` retains local development ports. | `test/http-security.e2e-spec.ts` static production compose assertion and `docker compose config --quiet`. |
| SEC-04 | `src/config/configuration.ts`, `scripts/start-tunnel.js`: webhook URL derives from `APP_PUBLIC_URL` and fixed relative path, with origin/HTTPS validation. | `src/config/env.schema.spec.ts`, Telegram webhook tests. |
| SEC-05 | `src/modules/auth/auth.repository.ts`, auth service and refresh-family migration: atomically consume a hashed session, create one child, revoke family on replay or logout. | Parallel refresh unit/e2e and `test/auth-postgres.integration.ts`. |
| SEC-06 | Typed env validation and JWT service/strategy enforce independent strong secrets, HS256, issuer, audience, expiry and access/refresh purpose. | Env/JWT unit tests, auth e2e. |
| SEC-07 | Order DTO/service and DB checks bound item count, quantity, duplicate aggregation, monetary precision and total. Client price is ignored. | Orders unit/e2e negative tests. |
| SEC-08 | Order repository advisory transaction lock, request hash, per-user UUID uniqueness and order/outbox atomic commit; frontend reuses key on retry. | Orders e2e and real-DB parallel checkout integration. |
| SEC-09 | Payment repository locks owned order, explicitly whitelists payable states and retains one payment per order. | Payment unit/e2e and real-DB concurrent/cancelled/expired tests. |
| SEC-10 | Exact CIDR proxy trust, strict forwarded-protocol handling and Redis-backed route-specific throttling. | Proxy, auth, webhook and HTTP-security tests. |
| DEP-01 | `package.json`/lock use patched compatible dependencies, remove unused runtime modules, retain Prisma 7.10 architecture. | `npm audit --omit=dev`: 0 vulnerabilities. |
| DEP-02 | Separate non-root migration image with prepared Prisma engine and guarded `prisma migrate deploy` job gate backend startup; migration files/config included. | 20 migrations applied to isolated PostgreSQL 17, second run idempotent, destructive pending SQL rejected on populated guard DB; compose config test. |
| DEP-03 | Interval-driven pending-order expiry with DB row claims and catch-up after restart. | Worker tests and real-DB dual-worker claim test. |
| PERF-01 | ImageKit metadata and MIME validation, image 5 MiB/6000px, video 15 MiB/60s, responsive image variants; frontend enforces matching upload limits. | Media unit/e2e and image-variant tests. |
| PERF-02 | Public list card projection, cover variant, pagination and trigram indexes; detail retains full media. Proxy owns gzip compression and public catalog gets short cache. | Products unit/e2e and frontend build. |
| PERF-04 | Transactional outbox makes order response independent of Telegram; worker retries bounded failures and quarantines ambiguous delivery. | Worker unit tests, order API tests and real-DB outbox claims. |
| CONFIG/CORS | `src/config/*`, `.env.example`, scripts and docs use a single validated config. CORS compares normalized exact origins; Mini App origin is derived. | Env, HTTP-security and CORS tests. |
| ERRORS/HEADERS/BODY | Redacting logger, sanitized 500 response, Helmet, conditional HSTS and bounded JSON body. | HTTP-security API tests. |
| CONCURRENCY/AUTHZ | Conditional order/admin/product writes, product version and row-lock protection, owner/role/blocked-user checks. | Product/admin/auth tests and real-DB product integration. |
| FRONTEND | `shop-front` consumes compact catalog DTO and ImageKit variants, persists checkout retry key, lazy-loads routes and removes expensive mobile blur/background imagery. | Frontend lint and production build. |

## ENV CLEANUP

| OLD ENV | NEW/CANONICAL ENV | STATUS |
| --- | --- | --- |
| `BACKEND_PUBLIC_URL` | `APP_PUBLIC_URL` | Removed from active config |
| `CORS_ORIGINS` | Derive Mini App/admin origins; `CORS_ALLOWED_ORIGINS` only for extra origins | Removed from active config |
| `DATABASE_URL_DOCKER` | `DATABASE_URL` using Compose service hostname in production | Removed |
| `REDIS_URL_DOCKER` | `REDIS_URL` using Compose service hostname in production | Removed |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` as deploy input | One `DATABASE_URL`; PostgreSQL entrypoint derives its required internal variables | Removed from `.env.example`/Compose input |
| `TELEGRAM_SHOP_URL` | `MINI_APP_URL` | Removed |
| `IMAGEKIT_MAX_IMAGE_BYTES` | `MEDIA_MAX_IMAGE_BYTES` | Removed |
| `BOT_TOKEN` local alias | `TELEGRAM_BOT_TOKEN` | Removed |

`APP_PUBLIC_URL` (backend) and `MINI_APP_URL` (frontend) deliberately remain separate. `ADMIN_APP_URL` is only for a distinct admin UI. `.env.example` is the canonical full template. Never copy development example URLs or secrets into production.

## DATABASE MIGRATIONS

- `20261007000000_replace_product_availability_boolean`: three-state availability.
- `20261007010000_add_product_cargo_price`: mandatory cargo amount for 14-day availability.
- `20261007030000_order_security_outbox`: checkout idempotency, value checks, payment constraint and notification outbox.
- `20261007050000_product_search_indexes`: PostgreSQL catalog search indexes.
- `20261007060000_catalog_constraints`: product price/media invariants.
- `20261008000100_refresh_session_families`: token family and parent relationship.
- `20261008010000_product_optimistic_version`: lost-update protection.

Existing data must be backed up and checked for new constraints before live migration. The release guard rejects pending destructive SQL on a populated database; it does not automatically repair conflicting legacy rows.

## TEST RESULTS

- Unit: 358 passed.
- API/e2e: 129 passed.
- PostgreSQL integration: 12 passed against isolated PostgreSQL 17, including real concurrent checkout/refresh/payment/expiry/outbox/product operations.
- Backend lint, TypeScript, Nest build, Prisma generate: passed.
- Frontend lint and production build: passed; main JS chunk 85.25 KiB gzip, customer pages route-split.
- Migrations: 20/20 applied successfully by the actual non-root production release image on a clean isolated DB; second run had no pending migrations. A populated guard-test DB correctly blocked pending destructive SQL.
- Production dependency audit: 0 vulnerabilities.
- Docker Compose production config, production and migration image builds: passed. Isolated runtime: `/health` 200 with PostgreSQL/Redis, direct HTTP 400 with `private, no-store`, trusted HTTPS-proxy catalog 200, attacker origin 403. Production image defaults to `NODE_ENV=production`, runs as `node` and excludes Prisma CLI.

2026-10-09 continuation: all 358 unit and 129 API/e2e tests passed again; backend lint and Nest build passed again. `.env` is ignored and untracked, no deprecated env alias was found in active repository files, and the frontend auth/API code does not write tokens to browser storage. The isolated PostgreSQL port `127.0.0.1:55433` was closed, so the 12 real-DB tests were not repeated; their last successful run was 2026-10-08. Host ports 3000, 5432 and 55433 had no listening socket at this check.

## REMAINING RISKS

1. **Live deployment is still insecure until released.** The running old container still has `NODE_ENV=development` and PostgreSQL published on public `5432`. The code change does not reconfigure existing containers. Rotate any weak/current secrets and deploy the new Compose stack behind a valid HTTPS proxy after backup and migration review. The pending availability migration drops the old boolean column, so the release guard deliberately blocks an automatic upgrade of a populated older database until that change is reviewed and handled in a maintenance step.
2. Telegram provides no general exactly-once send idempotency key. A timeout after accepted delivery is ambiguous; the worker parks it as `UNCERTAIN` for operator review instead of automatically risking duplicate sends. Monitor `FAILED` and `UNCERTAIN` rows.
3. ImageKit direct-upload credentials and assets must be monitored for abuse/storage cost. The backend verifies metadata before attachment, but an administrator may upload to the provider before backend-side validation.
4. No real low-end phone/device or public-network load benchmark was available. Route splitting, compressed card images and removal of expensive effects were verified in code/build; measured device performance remains to be checked on target hardware.
5. TLS certificates, DNS, firewall, backups, secret rotation, Redis persistence policy and production monitoring require operator setup outside the repository. No live user data or provider endpoint was used during tests.
6. Cleanup of the disposable Docker test containers could not be confirmed. The automatic approval reviewer rejected `docker stop` because its usage limit was reached; that command did not execute. The checked host ports were closed on 2026-10-09. When Docker access is available, inspect and remove only `zastore-security-20261008-backend`, `zastore-security-20261008-redis` and `zastore-security-20261008-pg` if they still exist. Their test databases and fake credentials are disposable.
