# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.27.0
ENV CI=true

# Install dependencies first so this layer is cached until manifests change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/games/package.json packages/games/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Production-only node_modules for the server.
RUN pnpm --filter @apr/server deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production
# Same relative layout as the repo: the server finds ./drizzle and ../web/dist from here.
WORKDIR /app/apps/server
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist /app/apps/web/dist
# Shown in play reports so a problem can be tied to the code that was running.
ARG GIT_SHA=unknown
ENV BUILD_VERSION=$GIT_SHA
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
