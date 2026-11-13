# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY . .
RUN test ! -e .env && test ! -d .git && npm run build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --workspace=@incidentbrief/api --workspace=@incidentbrief/contracts --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100
ARG APP_COMMIT=development
ENV APP_COMMIT=$APP_COMMIT
LABEL org.opencontainers.image.title="IncidentBrief" \
      org.opencontainers.image.revision=$APP_COMMIT
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/incidentbrief-entrypoint
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/healthz').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"]
ENTRYPOINT ["/usr/local/bin/incidentbrief-entrypoint"]
CMD ["node", "apps/api/dist/server.js"]
