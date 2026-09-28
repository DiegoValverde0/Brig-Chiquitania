# syntax=docker/dockerfile:1
# Multi-stage build: la imagen final solo contiene dist/ y dependencias de producción
# (objetivo: VPS con 1 GB de RAM).

# --- Etapa 1: dependencias completas (incluye devDependencies para compilar) ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Etapa 2: compilación TypeScript y poda de devDependencies ---
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# --- Etapa 3: runtime mínimo ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=256
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
