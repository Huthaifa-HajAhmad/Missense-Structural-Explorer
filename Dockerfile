# Stage 1: Build the Node application
FROM node:22-bookworm-slim AS node-builder
WORKDIR /app

# Install Python, uv, git, and OpenMP runtime for running tests in the builder stage
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy tools configuration and sync python environment for tests
COPY tools/pyproject.toml tools/uv.lock ./tools/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --project tools --no-dev

COPY . .

# Run verification gates
RUN npm run lint
RUN npm test

# Build the RaSP SQLite database if the raw CSV is present.
#
# CURRENTLY UNREACHABLE, and deliberately kept: .dockerignore excludes `data/*.csv`, so this condition is
# always false and the image never builds an index. The OCI deployment gets its index from the
# `../data:/app/data` bind mount instead. It stays because it becomes live the moment the CSV is part of
# the build context, and deleting it would break that case silently.
#
# CI never builds this image, so the gates below (`npm run lint`, `npm test`) run only on a local or
# deploy-time build — a Dockerfile-only break surfaces at deploy rather than in CI.
RUN if [ -f data/df_rasp_gnomad_clinvar.csv ]; then npm run migrate:rasp; fi

RUN npm run build

# Stage 2: Production release
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Install Python, git, libgomp1, procps, and curl for health check and ML sidecar runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    git \
    libgomp1 \
    procps \
    curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV NODE_ENV=production
ENV PORT=3000
ENV OMP_NUM_THREADS=2
ENV TORCH_NUM_THREADS=2

# Copy package files
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Copy built code from builder stage
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/server/services/alphagenome/protos ./server/services/alphagenome/protos
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
