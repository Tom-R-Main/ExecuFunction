# syntax=docker/dockerfile:1

FROM node:20-bullseye AS build
WORKDIR /app

# Copy workspace manifests first for better caching
COPY package.json package-lock.json ./
COPY exf-app/package.json exf-app/package.json

RUN npm ci

# Copy source code
COPY exf-app/ exf-app/

# Build workspace
RUN npm run build --workspace exf-app

# Prune dev dependencies for production image
RUN npm prune --omit=dev

FROM node:20-bullseye-slim
WORKDIR /app
ENV NODE_ENV=production

# Copy package manifests to install runtime deps
COPY package.json package-lock.json ./
COPY exf-app/package.json exf-app/package.json

# Install only production dependencies
RUN npm ci --omit=dev --workspace exf-app

# Copy build artifacts
COPY --from=build /app/exf-app/dist exf-app/dist

EXPOSE 8080
CMD ["node", "exf-app/dist/server.js"]
