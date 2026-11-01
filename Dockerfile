FROM node:22-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000

FROM dependencies AS build
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run prisma:generate && npm run build

# The release job has Prisma CLI; it never serves application requests.
FROM dependencies AS migration
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN node node_modules/@prisma/engines/scripts/postinstall.js && chown -R node:node node_modules/@prisma/engines
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma7.config.ts ./prisma7.config.ts
COPY --from=build /app/scripts ./scripts
# The opt-in webhook operations service executes the TypeScript config parser
# with tsx from this migration/operations image.
COPY --from=build /app/src/config ./src/config
ENV NODE_ENV=production
USER node
CMD ["node", "scripts/release-migrate.js"]

FROM dependencies AS production-dependencies
# Prune in an intermediate filesystem so deleted development packages are not
# retained in a lower layer of the final runtime image.
RUN --mount=type=cache,target=/root/.npm npm prune --omit=dev --omit=peer

FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
