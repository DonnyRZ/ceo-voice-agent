FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=127.0.0.1 API_PORT=3000
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node build ./build
COPY --chown=node:node backend/db/migrations ./build/backend/db/migrations
COPY --chown=node:node frontend/dist ./build/frontend/dist
COPY --chown=node:node infra/deploy/database.mjs ./ops/database.mjs
RUN mkdir .voice-pilot && chown node:node .voice-pilot
USER node
HEALTHCHECK --interval=10s --timeout=4s --start-period=15s --retries=6 \
  CMD node -e 'fetch(`http://127.0.0.1:${process.env.API_PORT}/api/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["node", "build/backend/server.js"]
