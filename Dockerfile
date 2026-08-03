# Stage 1: Build the Node application
FROM node:22-bookworm-slim AS node-builder
WORKDIR /app

# Install Python and uv for running tests in the builder stage
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

COPY package*.json ./
RUN npm ci

# Copy tools configuration and sync python environment for tests
COPY tools/pyproject.toml tools/uv.lock ./tools/
RUN uv sync --project tools --no-dev

COPY . .

# Run verification gates
RUN npm run lint
RUN npm test

RUN npm run build

# Stage 2: Production release
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Install Python and curl for health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# Copy package files
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built code from builder stage
COPY --from=node-builder /app/dist ./dist
# Copy raw assets and sidecar scripts
COPY tools/ ./tools/
# Copy python virtual environment from builder stage
COPY --from=node-builder /app/tools/.venv ./tools/.venv
COPY data ./data/
COPY README.md ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

CMD ["npm", "run", "start"]
