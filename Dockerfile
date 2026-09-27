# Stage 1: Build the Node application
FROM node:22-bookworm-slim AS node-builder
WORKDIR /app

# Install Python, uv, git, and OpenMP runtime. `uv` builds the venv the runner stage copies in.
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

# Pre-flight gate: the type-check, and nothing that needs the repository's own metadata.
#
# This used to be `npm run lint` plus `npm test`. Both read `.github/workflows/` — `lint` through
# `scripts/check-verify-parity.ts` (which fails closed without it) and the suite through
# `server/tests/verify-parity.test.ts`, which exercises the real repository — while `COPY . .` applies
# `.dockerignore`, which excludes `.github/`. Either one therefore fails a build context, which is a
# property of the context and not of the code. `verify:image` keeps the part that IS about the
# artifact: that the tree this image copied still compiles. `check-verify-parity.ts` enforces the
# rule, so a future edit that puts the gate set back here fails `npm run lint` instead of the deploy.
RUN npm run verify:image

# Build the RaSP SQLite database if the raw CSV is present.
#
# CURRENTLY UNREACHABLE, and deliberately kept: .dockerignore excludes `data/*.csv`, so this condition is
# always false and the image never builds an index. The OCI deployment gets its index from the
# `../data:/app/data` bind mount instead. It stays because it becomes live the moment the CSV is part of
# the build context, and deleting it would break that case silently.
#
# CI never builds this image, so a Dockerfile-only break surfaces on a local build rather than in CI.
# That is the argument for keeping the pre-flight gate above context-safe and cheap, not for dropping it:
# the check it replaced could not pass here at all, so it was reporting the context, not the code.
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
