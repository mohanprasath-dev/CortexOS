# ══════════════════════════════════════════════════════════════════════════════
# CortexOS – Production Docker Image
#
# Multi-stage build:
#   Stage 1: Build frontend (React + Vite)
#   Stage 2: Build backend (TypeScript)
#   Stage 3: Production runtime with Playwright browsers
#
# Auth: Vertex AI via Application Default Credentials (no API keys).
# Target: Google Cloud Run
# Base: Node 20 on Debian (required for Playwright Chromium dependencies)
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Build Frontend ──────────────────────────────────────────────────

FROM node:20-bookworm-slim AS frontend-build

WORKDIR /app/frontend

# Install dependencies first (for Docker layer caching)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build Backend ───────────────────────────────────────────────────

FROM node:20-bookworm-slim AS backend-build

WORKDIR /app/backend

# Install dependencies
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

# Copy source and compile TypeScript
COPY backend/ ./
RUN npx tsc

# ── Stage 3: Production Runtime ──────────────────────────────────────────────

FROM node:20-bookworm-slim AS production

LABEL maintainer="CortexOS Team" \
      description="CortexOS – Real-Time Multimodal Autonomous Workspace Agent" \
      version="1.0.0"

# Install Playwright system dependencies for Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxtst6 \
    fonts-liberation \
    fonts-noto-color-emoji \
    # Sharp native dependencies
    libvips-dev \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend production dependencies
COPY backend/package.json backend/package-lock.json* ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

# Install Playwright browsers (Chromium only)
RUN npx playwright install chromium

# Copy compiled backend
COPY --from=backend-build /app/backend/dist ./dist

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ../frontend/dist

# Create non-root user for security
RUN groupadd --gid 1001 cortexos && \
    useradd --uid 1001 --gid cortexos --shell /bin/bash --create-home cortexos && \
    chown -R cortexos:cortexos /app

USER cortexos

WORKDIR /app/backend

# ── Environment ──────────────────────────────────────────────────────────────

ENV NODE_ENV=production
ENV PORT=8080
ENV WS_PORT=8081
ENV BROWSER_HEADLESS=true

# Cloud Run uses PORT env var
EXPOSE 8080
EXPOSE 8081

# ── Health Check ─────────────────────────────────────────────────────────────

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# ── Start ────────────────────────────────────────────────────────────────────

CMD ["node", "dist/server.js"]
