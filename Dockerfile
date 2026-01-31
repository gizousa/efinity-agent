FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# Create startup script (enables token-only auth for cloud deployments)
RUN printf '#!/bin/bash\nset -e\nSTATE_DIR=${OPENCLAW_STATE_DIR:-$HOME/.openclaw}\nmkdir -p "$STATE_DIR"\nCONFIG_FILE="$STATE_DIR/openclaw.json"\nif [ ! -f "$CONFIG_FILE" ]; then\n  echo '\''{"gateway":{"controlUi":{"allowInsecureAuth":true},"auth":{"mode":"token"}}}'\'' > "$CONFIG_FILE"\nfi\nexec node dist/index.js gateway --allow-unconfigured --port ${PORT:-10000} --bind lan\n' > /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Security hardening: Run as non-root user
USER node

CMD ["/app/docker-entrypoint.sh"]
