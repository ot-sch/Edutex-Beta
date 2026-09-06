# RC5 pins both the readable Node release and its complete multi-platform manifest digest. Changing
# either value is a reviewed supply-chain change that invalidates the CDK asset/source approval.
FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS build
WORKDIR /workspace
COPY package.json package-lock.json* .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY infra ./infra
RUN npm ci --ignore-scripts
# The root build invokes the allowlisted, link-resistant output cleaner before compilation. This
# makes a reused BuildKit context produce the same no-source-map runtime tree as a clean CI context.
RUN npm run build
RUN npm rebuild sharp
RUN npm prune --omit=dev

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    AUTH_WEB_ROOT=/app/apps/auth-web/dist \
    PORTAL_WEB_ROOT=/app/apps/portal-web/dist
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 edutex \
  && useradd --system --uid 10001 --gid edutex --home-dir /nonexistent --shell /usr/sbin/nologin edutex
WORKDIR /app
COPY --from=build --chown=edutex:edutex /workspace/node_modules ./node_modules
COPY --from=build --chown=edutex:edutex /workspace/packages/contracts ./packages/contracts
COPY --from=build --chown=edutex:edutex /workspace/packages/database ./packages/database
COPY --from=build --chown=edutex:edutex /workspace/apps/api ./apps/api
COPY --from=build --chown=edutex:edutex /workspace/apps/auth-web/dist ./apps/auth-web/dist
COPY --from=build --chown=edutex:edutex /workspace/apps/portal-web/dist ./apps/portal-web/dist
COPY --from=build --chown=edutex:edutex /workspace/apps/technician-web/dist ./apps/technician-web/dist
COPY --from=build --chown=edutex:edutex /workspace/scripts/package.json ./scripts/package.json
COPY --from=build --chown=edutex:edutex /workspace/scripts/dist ./scripts/dist
COPY --chown=edutex:edutex certificates/rds-global-bundle.pem ./certificates/rds-global-bundle.pem
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD ["curl", "--fail", "--silent", "http://127.0.0.1:8080/health/live"]
CMD ["node", "apps/api/dist/server.js"]
