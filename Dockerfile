FROM node:22-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

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
ENV NODE_ENV=production
USER node
CMD ["node", "scripts/release-migrate.js"]

FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Prisma CLI is an optional peer and is only needed by the migration artifact.
RUN npm ci --omit=dev --omit=peer && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
