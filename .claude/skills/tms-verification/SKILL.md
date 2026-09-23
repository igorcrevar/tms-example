---
name: tms-verification
description: How to verify a change in this repo without freezing the machine — the scoped test commands, worker caps, and the order to run checks in for tms-backend and tms-frontend. Load before running any test, lint, typecheck or build command here.
---

# Verifying a change

## The hazard

**Never run a test suite unscoped.** Jest and Vitest default to one worker per core, and an
unconstrained run locks up this Ubuntu machine. Every invocation needs two things: a scope
(a file path or `-t <name>`) and a worker cap.

`npm test` is never acceptable, however small the suite looks.

Only one agent may run tests at a time. If you are reviewing rather than authoring, you do
not run them at all — the author does, and reports the result.

## Order

Cheapest signal first; do not ask for review until all four pass.

1. Typecheck
2. Lint
3. The tests covering what you changed
4. Build, if you touched config, entry points or dependencies

## tms-backend

```bash
npx tsc --noEmit
npx eslint "{src,test}/**/*.ts"
npx jest src/modules/auth/services/token.service.spec.ts --maxWorkers=2
npx jest -t 'revokes the whole family' --maxWorkers=2
npx nest build
```

E2E needs PostgreSQL reachable on the `DB_*` values in `.env`; it runs natively on this
machine, not in Docker:

```bash
npx jest --config ./test/jest-e2e.json test/e2e/auth-staff.e2e-spec.ts --maxWorkers=1
```

Schema changes are migrations, never `synchronize`. Generate, then read the SQL before
running it — TypeORM will happily emit a destructive statement:

```bash
npm run migration:generate -- src/database/migrations/Name
npm run migration:run
```

## tms-frontend

```bash
npx tsc -b
npx eslint .
npx vitest run tests/unit/LoginPage.test.tsx --no-file-parallelism
npx vitest run -t 'rejects a wrong password' --no-file-parallelism
npm run build
```

Playwright starts the backend and the dev server itself and reseeds its fixtures:

```bash
npx playwright test tests/e2e/admin-auth.spec.ts --workers=1
```

## Reporting

Report what you ran and what happened, including failures. A check you skipped is a check
you say you skipped.
