# LeadDesk

Multi-tenant lead CRM (NestJS + MongoDB). See `docs/decisions.md` for architecture decisions.

```
cp .env.example .env     # fill secrets
docker compose up -d     # mongo replica set, redis, minio, meilisearch
pnpm install
pnpm migrate
pnpm dev:api | dev:worker | dev:ingress
pnpm test                # starts real in-memory MongoDB replica sets; no Docker needed
```
