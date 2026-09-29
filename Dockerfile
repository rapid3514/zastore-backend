FROM node:22-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
WORKDIR /app
COPY . .
# Prisma generation is local to the image and does not connect to the database.
ENV DATABASE_URL=postgresql://zastore:build_only@localhost:5432/zastore_shop?schema=public
RUN npm run prisma:generate
RUN npm run build

FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
