FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install --global pnpm@11.4.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run verify && pnpm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=10000
LABEL org.opencontainers.image.source="https://github.com/T22016AEMC/PitchVision-v4"
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node deploy/server.mjs ./server.mjs
USER node
EXPOSE 10000
CMD ["node", "server.mjs"]
