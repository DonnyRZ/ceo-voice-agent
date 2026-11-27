FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=127.0.0.1 API_PORT=3000
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/backend/db/migrations ./build/backend/db/migrations
COPY --from=build --chown=node:node /app/frontend/dist ./build/frontend/dist
COPY --chown=node:node infra/deploy/database.mjs ./ops/database.mjs
RUN mkdir .voice-pilot && chown node:node .voice-pilot
USER node
HEALTHCHECK --interval=10s --timeout=4s --start-period=15s --retries=6 \
  CMD node -e 'fetch(`http://127.0.0.1:${process.env.API_PORT}/api/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["node", "build/backend/server.js"]
