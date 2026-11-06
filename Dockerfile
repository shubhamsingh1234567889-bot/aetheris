# Production multi-stage image: builds the Vite frontend + compiles the Express API,
# then ships only runtime dependencies, running as a non-root user.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/package*.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/dist-server ./dist-server
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/healthz" >/dev/null || exit 1
CMD ["node", "dist-server/server/index.js"]
