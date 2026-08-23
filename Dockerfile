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

# Build RaSP SQLite database if raw CSV is present
RUN if [ -f data/df_rasp_gnomad_clinvar.csv ]; then npm run migrate:rasp; fi

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
# Copy data directory (including any pre-migrated sqlite databases from builder)
COPY --from=node-builder /app/data ./data/
COPY README.md ./

# Mount points for persistent database storage and academic FoldX binary
VOLUME ["/app/data", "/app/tools/foldx"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

CMD ["npm", "run", "start"]
