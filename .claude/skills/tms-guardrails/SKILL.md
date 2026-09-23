---
name: tms-guardrails
description: The deliberate decisions in this repo that look like defects but are not, and the invariants a change must never weaken. Load before reviewing code here, and before "fixing" an outdated-looking dependency, a hand-rolled utility, or anything touching auth, cookies, CORS or logging.
---

# Guardrails

Two lists. The first stops you raising a finding that is already settled. The second is what
a finding should be about.

Rules themselves live in `CLAUDE.md` (root and per project) and `ARCHITECTURE.md`. Read
those; this skill is the reviewer's-eye view of them.

## Deliberate — do not flag, do not "fix"

Each of these looks wrong at a glance and is documented in `CLAUDE.md`:

- **The NestJS 11 / CommonJS dependency pins.** `@nestjs/config@4`, `@nestjs/typeorm@11`,
  `@nestjs/jwt@11`, `@nestjs/passport@11`, `nest-winston@1`, `otplib@12`. Their newer
  releases are ESM-only, which Jest cannot load on Node 22, and `@sentry/nestjs` caps
  `@nestjs/core` at `^11`. "Upgrade this" is wrong here.
- **The hand-rolled health check**, in place of `@nestjs/terminus` — v12 is ESM-only and v11
  would cascade `typeorm` back down.
- **The hand-rolled CSRF double-submit**, in place of a CSRF package.
- **TOTP implemented on `node:crypto`** in the frontend E2E fixtures, rather than an OTP
  dependency in a project with no other use for one. It is cross-checked against otplib.
- **`app.rateLimitDisabled`** — a test seam, inert when `NODE_ENV=production`.
- **Uniform "invalid credentials" messages**, including for a locked account. Distinguishing
  them would let a caller enumerate accounts.
- **Comment density.** Most code here has no comments by design. Do not ask for more.
- **One backend process serving `/api/staff` and `/api/driver`**, and one frontend app
  serving `/admin` and `/driver`. Both are recorded decisions in `ARCHITECTURE.md`.

## Invariants — weakening one is a BLOCKER

**Security.** Staff and driver tokens use different secrets and different `aud` claims;
never share a key or widen an audience. Tokens live only in HttpOnly cookies, set only by
`CookieService` — never a response body, a header, or `localStorage`. Refresh tokens rotate,
are stored only as SHA-256, and a replay revokes the whole family. `CsrfGuard` stays on
state-changing routes and `x-csrf-token` stays in the CORS `allowedHeaders`. CORS lists
explicit origins, never `*` with credentials, https-only in production. Passwords and PINs
go through `PasswordService` (Argon2id) and nothing else. `select: false` columns stay that
way. No credential — password, PIN, TOTP secret, token or hash — reaches a log or a
response. Secrets come from the environment; nothing is hardcoded.

**Data.** Money is `numeric(38, 18)` in Postgres and a `string` everywhere in TypeScript,
with arithmetic only through `src/common/money/money.ts`. A monetary `number` or a
`parseFloat` on an amount is always a blocker. Basis points are integers. Timestamps are
`timestamptz`, UTC, ISO-8601 over the API, manipulated with `date-fns`. Primary keys are
UUIDs, with human-facing references in their own column.

**Structure.** A domain module owns its folder under `src/modules/`; shared code moves to
`src/common`, never into a neighbour. In the frontend, `src/admin` and `src/driver` must not
import from each other — one cross-boundary import merges the two lazy chunks and undoes the
split. No dependency is added without asking the user first.

## Operational facts

- The git repository is at the workspace root, on branch `main`. The author identifies a
  change with `git status --porcelain` or `git diff --name-only`. Reviewers have no shell,
  so a change is still **handed to them** as paths — and the diff text where it is small
  enough to paste — rather than as a command for them to run.
- PostgreSQL runs **natively** on this machine, not in Docker. The `tms` database is on
  `localhost:5432` with credentials in `tms-backend/.env`.
