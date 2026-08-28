# Finance Manager — Backend

NestJS REST API for a personal multi-wallet finance tracker (PKR/USD). Runs as a single
serverless function on Vercel, backed by Neon Postgres through Prisma. The frontend lives in a
separate repository ([MY_FINANCE_MANAGER_FRONTEND](https://github.com/SarhanKhan-dev/MY_FINANCE_MANAGER_FRONTEND))
and talks to this API only — it never touches the database.

## Stack

- NestJS 11 (TypeScript, modules + dependency injection throughout)
- Prisma with Neon Postgres — pooled connection at runtime, direct connection for migrations
- JWT auth (Bearer tokens), roles `SUPERADMIN` and `USER`
- OpenAPI generated from code at `/docs` (`/docs-json` for the frontend's typed client)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in. `DATABASE_URL` must be Neon's pooled
   (pgbouncer) connection string; `DIRECT_URL` the unpooled one.
3. `npx prisma migrate dev` — applies migrations to the database.
4. `npm run seed` — creates the superadmin account from `SUPERADMIN_EMAIL` /
   `SUPERADMIN_PASSWORD` with default wallets, categories, and settings. Safe to re-run.
5. `npm run start:dev` — API on `http://localhost:3001`, docs on `/docs`.

## Deployment (Vercel)

- The app is exported as one serverless handler from `api/index.ts`; `vercel.json` rewrites all
  routes to it. The Nest app is created once per instance and reused across invocations.
- Set every variable from `.env.example` in the Vercel project settings. `.env` files are
  git-ignored and must never be committed.
- Run migrations from a trusted machine with `npx prisma migrate deploy` (uses `DIRECT_URL`).
- Scheduled work will be Vercel Cron hitting protected `/jobs/*` endpoints with the
  `x-cron-secret` header — added in a later build, along with the cron entries in `vercel.json`.

## Architecture

- `src/common` — guards (`JwtAuthGuard`, `RolesGuard`), decorators (`@CurrentUser`, `@Roles`,
  `@Public`), and the global exception filter. `JwtAuthGuard` runs globally; public routes opt
  out with `@Public()`.
- `src/prisma` — the single `PrismaService` injected everywhere.
- `src/events` — append-only event log writer used by every feature module.
- Feature modules (`auth`, `users`, `settings`, more per build) each follow the same shape:
  thin controller → service with all logic → `dto/` with class-validator classes.
- Every query is scoped to the authenticated user's id. The superadmin manages accounts only —
  no endpoint returns another user's financial data.

## Accounts

Public registration is disabled. The superadmin creates users (`POST /admin/users`), which
seeds their default wallets, categories, and settings and issues a **set-password link**
(single use, expires in 7 days; password resets issue a 24-hour link). The user opens the link
and chooses their password via `POST /auth/set-password` — there are no temporary passwords.
Links are returned in the admin response until email sending lands, after which they are
emailed automatically. Users then complete onboarding (`POST /settings/onboarding`) by choosing
their monthly cap and the day their budget cycle starts.
