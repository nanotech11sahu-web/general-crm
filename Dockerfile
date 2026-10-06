# One image, three roles: docker run -e ROLE=api|worker|ingress ...  (spec: "one API image run in two modes" + a tiny ingress entrypoint)
# The services are compiled to plain CommonJS at build time (scripts/build-dist.cjs, SWC with decorator metadata) and run with
# `node -r scripts/use-dist.cjs <service>/dist/main.js`: no TypeScript toolchain at runtime. Dev dependencies are installed because the build needs them.
# NOT built or run in the authoring sandbox: build it in CI before first deploy (see docs/runbook.md#deploying).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/webhook-ingress/package.json apps/webhook-ingress/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/crypto/package.json packages/crypto/
COPY packages/shared/package.json packages/shared/
COPY packages/domain/package.json packages/domain/
COPY packages/platform/package.json packages/platform/
COPY packages/connectors/core/package.json packages/connectors/core/
COPY packages/connectors/registry/package.json packages/connectors/registry/
COPY packages/connectors/meta-leadads/package.json packages/connectors/meta-leadads/
COPY packages/connectors/google-sheets/package.json packages/connectors/google-sheets/
COPY packages/connectors/whatsapp-cloud/package.json packages/connectors/whatsapp-cloud/
COPY packages/connectors/sms-msg91/package.json packages/connectors/sms-msg91/
COPY packages/connectors/telephony-exotel/package.json packages/connectors/telephony-exotel/
COPY packages/connectors/ai-groq/package.json packages/connectors/ai-groq/
RUN pnpm install --frozen-lockfile --prod=false --filter '!@leaddesk/web'

FROM deps AS app
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY apps/webhook-ingress apps/webhook-ingress
COPY scripts scripts
RUN node scripts/build-dist.cjs
USER node
ENV ROLE=api PORT=3000
EXPOSE 3000 3100 9464
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.ROLE==='worker'?9464:process.env.PORT)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
# api -> :3000, ingress -> PORT (default 3100), worker -> :9464 (health/metrics only); `migrate` runs the database migrations and exits
CMD ["sh", "-c", "D=/app/scripts/use-dist.cjs; case \"$ROLE\" in api) cd apps/api && exec node -r $D dist/main.js;; worker) cd apps/worker && exec node -r $D dist/main.js;; ingress) cd apps/webhook-ingress && PORT=${PORT:-3100} exec node -r $D dist/main.js;; migrate) cd packages/db && exec node -r $D dist/migrate-cli.js up;; *) echo unknown ROLE $ROLE; exit 2;; esac"]
