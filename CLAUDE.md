# TMS

Transport Management System. Two projects, one repo:

| Path | Stack | Notes |
| --- | --- | --- |
| [`tms-backend/`](tms-backend/) | NestJS 11, TypeScript, CommonJS, PostgreSQL | REST API, two namespaces: `/api/staff` and `/api/driver` |
| [`tms-frontend/`](tms-frontend/) | React 19, Vite, TypeScript, ESM | one app, two lazy trees: `/admin/*`, `/driver/*` |

Each project has its own `CLAUDE.md` with stack-specific rules — read it before working in
that directory. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before changing anything that
crosses the two, touches auth, or adds a module.

## Comments

- **2–3 physical lines max; 4 only when the logic genuinely cannot be explained more concisely.**
- **Prefer 1 line.** Comments should be concise and focused.
- **Never expand an existing comment.** Leave it as-is or shorten it.
- Comment **why**, not **what**. Do not restate the code or explain obvious behavior.
- Do not add changelog/history noise, TODO-style notes, or comments such as `// added X` describing the current edit.
- **Do not reference, describe, or explain old/replaced code or previous implementations.** Comments must describe only the current implementation.
- If an explanation cannot fit within 4 lines, **shorten it or omit the comment** rather than writing a longer block.
- Match the comment density of the surrounding file. **Most code should have no comments.**

## Code style

- Follow the existing file: naming, imports, error handling, formatting. Do not
  introduce a new pattern where one already exists in the repo.
- TypeScript everywhere; avoid `any` — prefer a real type or `unknown` with a guard.
- Never reformat or reorganize untouched code in a diff.
- Don't add dependencies without asking.

## Project Instructions

- Update `CLAUDE.md` when new project-level requirements, conventions, or architectural decisions are introduced that should apply to future work.
- Keep `CLAUDE.md` concise and avoid duplicating existing documentation.
- Update existing instructions instead of creating conflicting or duplicate rules.

## Default Agent

- Always use @coder for implementation, modification, and refactoring tasks unless explicitly instructed otherwise.

## Money, time and identifiers

- Amounts, prices and margins: `numeric(38, 18)` in Postgres, `string` in TypeScript and every DTO, arithmetic via `decimal.js` in the backend only. Never `number`, never `parseFloat`. Basis points are `integer`.
- Time: `timestamptz` in Postgres, UTC everywhere, ISO-8601 strings in the API, `date-fns` in code. Never `moment`, never store local time.
- Primary keys are UUIDs. Human-facing case references are a separate `reference` column.

## CORS

- The session is a cookie, so every browser request is credentialed. `CORS_ORIGINS` is a
  security control, not configuration convenience: an entry there can act as a signed-in
  user.
- Origins are listed explicitly. `*` is rejected at boot — browsers refuse it alongside
  credentials anyway, and a permissive fallback would defeat the cookie session.
- In production the app refuses to start with an empty origin list or any non-`https`
  origin.
- `x-csrf-token` must stay in `allowedHeaders`. Drop it and every write from the browser
  fails preflight.
- Options are built in `tms-backend/src/config/cors.config.ts`, used by both `main.ts` and
  the E2E test app, so tests exercise the real policy.

## Tests

- **Never run a full test suite unconstrained** — Jest/Vitest at full parallelism freezes
  this Ubuntu machine. Always scope: a single file, `-t <name>`, and a worker cap
  (`--maxWorkers=2` / `--no-file-parallelism`).
- Add or update tests next to the code they cover, following the repo's existing
  naming convention.

## Working style

- Short answers. No summaries of what I can read in the diff, no restating the request.
- Ask before destructive operations: DB resets, migrations against a live DB, force pushes.
- Never commit or push. Committing is a human action. Reviews never start on their own:
  `/review [commit]` runs `code-review` and `security-review` on one commit (default `HEAD`)
  when a human asks for it.

## Commands

Run from the project directory, never from the repo root.

```bash
# backend
npm run start:dev                                   # watch mode, port 3000
npm run build && npm run lint
npm run migration:generate -- src/database/migrations/AddThing
npm run migration:run
npm run seed                                        # roles + super admin from SUPER_ADMIN_*
npx jest src/modules/auth/services/token.service.spec.ts --maxWorkers=2
npx jest --config ./test/jest-e2e.json test/e2e/auth-staff.e2e-spec.ts --maxWorkers=1

# frontend
npm run dev                                         # port 5173, /admin and /driver
npm run build && npm run lint
npx vitest run tests/unit/LoginPage.test.tsx --no-file-parallelism
npx playwright test tests/e2e/admin-auth.spec.ts --workers=1
```

PostgreSQL runs natively on this machine, not in Docker. The `tms` database is on
`localhost:5432`; credentials are in `tms-backend/.env`.

## Dependency constraints

Two pins exist for reasons that are not obvious from `package.json`. Do not "upgrade" past
them without reading [`ARCHITECTURE.md`](ARCHITECTURE.md#dependency-pins).

- The backend is on the **NestJS 11 CommonJS generation**. The Nest 12 releases of
  `@nestjs/config`, `@nestjs/typeorm`, `@nestjs/jwt` and `@nestjs/passport` are ESM-only,
  which Jest cannot load on Node 22.
- `otplib` is pinned to `^12` for the same reason: v13 depends on ESM-only `@scure/base`.
- `@sentry/nestjs` supports `@nestjs/core` up to `^11`, so Nest 12 would drop Sentry.

## Security invariants

These hold across both projects. Breaking one is a security regression, not a refactor.

- Session tokens live in HttpOnly cookies. Never `localStorage`, never a response body.
- Staff and driver tokens are signed with different secrets and carry different `aud`
  claims. They are not interchangeable and must never share a key.
- Passwords and PINs are Argon2id, hashed only through `PasswordService`.
- Credentials are never logged. Winston redacts them as a backstop; do not rely on it.
- Nothing is hardcoded: JWT secrets and the super-admin credentials come from the
  environment, and the app refuses to boot without them.
- CORS names its allowed origins explicitly and never uses `*`; see the CORS section.

## Environment

- Node 22.20 (`.nvmrc`), npm 10.
- Copy `.env.example` to `.env` in each project. Never commit `.env`.
- `komande.txt` at the repo root is Igor's scratch file. Ignore it; it is not project content.
