# Web app (Next.js). API_URL is baked in at build time because Next resolves rewrites during `next build`.
# Build from the repo root: docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:3000 -t leaddesk-web .
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
ARG API_URL
ENV API_URL=$API_URL
RUN pnpm install --frozen-lockfile --filter @leaddesk/web... && pnpm --filter @leaddesk/web build

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@leaddesk/web", "start"]
