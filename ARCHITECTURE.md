# TMS Architecture

Transport Management System. This document describes the target architecture and records
the decisions behind it. Where the code does not yet match, the section says so.

## Current state

Both projects are scaffolded, build clean, and have Sentry and file logging wired. Nothing
in the domain is implemented yet.

| Area | State |
| --- | --- |
| Project scaffolding, TypeScript, lint, test runners | done |
| Sentry (backend + frontend) | done |
| Winston file logging, daily rotation, secret redaction | done |
| Health endpoint (`GET /api/health`) | done |
| Authentication: staff 2FA, driver PIN, rotation, lockout, CSRF | done |
| Driver/staff API separation | done — one process, two namespaces, separate keys |
| Admin + Driver frontends | done — one app, two lazy-loaded chunks at `/admin` and `/driver` |
| Roles and permissions schema, seeded | done |
| Permission enforcement (CASL guard on endpoints) | done |
| User management: list, filter, soft delete | done |
| Invitations: email, accept, activation | done |
| Password recovery: staff reset by email, admin-cleared second factor | done |
| Driver creation and PIN management | done |
| Git hooks, CI | not started — repository initialised, hooks unwired |

## System shape

```
                      ┌──────────────────┐        ┌──────────────────┐
                      │  Admin frontend  │        │ Driver frontend  │
                      │  apps/admin      │        │  apps/driver     │
                      │  desktop, MUI    │        │  mobile-first    │
                      └────────┬─────────┘        └────────┬─────────┘
                               │ JWT aud=staff             │ JWT aud=driver
                               ▼                           ▼
                      ┌──────────────────┐        ┌──────────────────┐
                      │    staff-api     │        │    driver-api    │
                      │    :3000         │        │    :3001         │
                      │  full domain     │        │  narrow surface  │
                      └────────┬─────────┘        └────────┬─────────┘
                               └───────────┬───────────────┘
                                           ▼
                                  ┌─────────────────┐
                                  │   PostgreSQL    │
                                  └─────────────────┘
```

Two API processes and two frontend bundles. The split is the central architectural
decision; everything else follows from it.

## 1. Identity and access

### Roles and permissions

Four entities. Permissions are modelled from day one even though only role checks are
enforced initially, so that adding a per-permission check later is a query change rather
than a migration.

| Entity | Purpose |
| --- | --- |
| `User` | email, name, `status`, `roleId`, `totpSecret`, timestamps |
| `Role` | `SUPER_ADMIN`, `ADMIN`, `DRIVER`; `pinLogin` and `isSuperAdmin` flags |
| `Permission` | `action` (`manage`/`create`/`read`/`update`/`delete`) × `subject` (`User`, `Shipment`, `Vehicle`, …) |
| `RolePermission` | join table, the only place a role gains capability |

`@casl/ability` builds an `Ability` per request from the user's role permissions. A
`PermissionsGuard` reads a `@RequirePermission('update', 'Shipment')` decorator and checks
it against that ability. Roles never appear in business logic — only permissions do.

The staff-versus-driver distinction is the role's `pinLogin` flag, never its name: a
`pinLogin` role signs in with a driver code and PIN, has no password or second factor, and
is created rather than invited. Otherwise a role is only a bundle of permissions; nothing in
the code compares a role name.

Admins create and manage all users. There is no self-registration on either API. An
inviter can only hand out a role whose every permission they hold themselves, checked
against their own ability, so only a `manage:all` holder can invite a `SUPER_ADMIN`.

### Authentication

Two flows, deliberately different in strength and in surface.

**Staff (super admin, admin)** — email + password, then a mandatory TOTP
second factor. Password is Argon2 or bcrypt; TOTP secret is encrypted at rest. Success
issues a short-lived access JWT plus a rotating refresh token.

**Drivers** — driver code + numeric PIN, no email, no password, no TOTP. A PIN is weak by
construction, so the compensating controls carry the weight: the PIN is hashed, attempts
are rate-limited and lock the account, the issued token is bound to a device id, its TTL is
short, and it is only ever accepted by the driver API.

The two token families use **different signing secrets and different `aud` claims**. A
driver token presented to the staff API fails signature verification — not an
authorization check that someone might later refactor away.

### Recovering an account

A staff member who has forgotten their password asks for a link at
`POST /api/staff/auth/forgot-password`, which answers identically whether or not the
address has an account, and sets a new one at `POST /api/staff/auth/reset-password`. The
token lives in `auth_tokens` — a generic table carrying a `purpose` enum, so a later flow
adds a member rather than a table — stored as a SHA-256, single-use, and valid for an hour
rather than an invitation's seven days. A reset revokes every staff refresh-token family for
that user, so no session can be renewed; an access token already issued keeps working until
it expires, up to its ten-minute TTL.

**A reset deliberately does not clear TOTP.** Email access alone must never be enough to
take over an account. It follows that an account with no second factor gets no link at all —
the mailbox would be the whole authentication — so `forgot-password` treats it exactly like
an unknown address and an outstanding token stops working the moment the factor is cleared.
Someone who has lost their authenticator instead needs an admin, who clears it with
`DELETE /api/staff/users/:id/two-factor`; that revokes their sessions too, so the next
sign-in goes through enrolment. An account still `INVITED` has never enrolled, so the reset
is refused until the invitation is accepted.

Drivers have no such flow by design: they have no email login, so a forgotten PIN is
handled out of band. The PIN screen points them at their dispatcher, who sets a new PIN
with the existing `PUT /api/staff/drivers/:id/pin`.

## 2. API isolation

> Scope point 5: separate the driver API from the API used by other users.

**Decision: one Nest process, two route namespaces** (`/api/staff`, `/api/driver`) with
separate signing keys, cookie names and cookie paths. Splitting into two processes remains
the target; the module boundaries are kept clean so that split stays mechanical.

The security boundary is cryptographic, not organisational: each audience has its own
access and refresh secret and its own `aud` claim, so a driver token presented to the staff
API fails **signature verification**. That property does not depend on a guard being wired
correctly, which is what makes the single-process form acceptable for now.

The two-process target, for reference:

```
tms-backend/
  apps/
    staff-api/     full domain surface, :3000
    driver-api/    shipments assigned to the caller, status updates, :3001
  libs/
    domain/        entities, repositories
    auth/          guards, strategies, token issuing
    logging/       winston setup
    config/        configuration + validation
```

Why two processes rather than two route prefixes on one app:

- The driver API is the internet-facing, least-trusted surface. A separate process can sit
  in its own network zone with its own ingress rules and its own rate limits.
- A route-prefix split leaves one misconfigured guard between a driver token and the user
  management endpoints. A process split makes that class of mistake impossible — the code
  handling `POST /users` is not loaded in the driver process at all.
- Independent scaling and independent deploy cadence. Driver traffic is high-volume and
  low-variety; staff traffic is the opposite.

Cost of the target: two deployment targets, two Swagger documents, and shared code must
live in `libs/` with real boundaries. Revisit when the driver API is exposed to the public
internet.

### What is implemented

```
src/modules/auth/
  controllers/   staff-auth.controller.ts    /api/staff/auth/*
                 driver-auth.controller.ts   /api/driver/auth/*
  services/      token, cookie, password, totp, lockout,
                 staff-auth, driver-auth
  guards/        staff-jwt, driver-jwt, csrf
  strategies/    passport-jwt, reading the access token from its cookie
  entities/      refresh-token.entity.ts
```

| Flow | Endpoints |
| --- | --- |
| Staff | `POST /api/staff/auth/login` → `2fa/enrol` (first time) → `2fa/verify` → `refresh`, `logout`, `GET me` |
| Driver | `POST /api/driver/auth/login` → `refresh`, `logout`, `GET me` |

**Tokens.** Access ~10 minutes, staff refresh 7 days, driver refresh 30 days. Both are JWTs.
Refresh rotates on every use: the row is revoked and replaced, and the database stores only
a SHA-256 of the token. Replaying a consumed token revokes the whole family, on the
assumption that the only way to hold a consumed token is to have stolen it.

**Cookies.** `HttpOnly`, `Secure` (configurable off for plain-http localhost only),
`SameSite=Strict`. Access cookies are scoped to their namespace and refresh cookies to
`/auth`, so a refresh token is not attached to ordinary API calls. Nothing is ever stored
in `localStorage`.

**CSRF.** Double-submit: a readable per-audience cookie (`tms_staff_csrf`, `tms_driver_csrf`)
must be echoed in an `x-csrf-token` header on state-changing requests, compared with a
timing-safe digest. Hand-rolled rather
than adding a dependency, since `SameSite=Strict` already carries most of the weight. Login
is exempt — there is no session to protect yet.

**The MFA challenge** between the password and the code is a short-lived JWT in its own
cookie, signed with a key derived by HMAC from the staff refresh secret. It is
cryptographically distinct from a session token without needing another env var, and the
token type is asserted on every path.

**Brute force.** Two independent limits: `@nestjs/throttler` caps auth endpoints at 5
requests per minute per IP, and a per-account counter locks the account for 15 minutes after
5 failures. One stops an account being ground down from many addresses, the other stops one
address spraying many accounts. Failures return an identical message whatever the cause, and
unknown identifiers still run a dummy Argon2 verify so response time does not leak
existence.

## 3. Frontend applications

> Scope point 6: dedicated Admin and Driver frontends.

**Decision: one app, two lazy-loaded route trees**, served from one hostname.

```
tms-frontend/src/
  routes/router.tsx   /admin/* and /driver/*, both behind React.lazy
  admin/AdminApp.tsx  own ThemeProvider + descendant <Routes>
  driver/DriverApp.tsx
  shared/             api client, session hooks, themes, RequireSession
```

The deployment target is a single hostname, so a single app is the honest shape. Separate
Vite roots or npm workspaces would add toolchains and a package boundary to model a split
that production will not have.

Code splitting still holds. `React.lazy` puts each tree in its own chunk, so a driver's
phone downloads the driver chunk and never the admin one. The build shows this directly —
`AdminApp-*.js` and `DriverApp-*.js` are separate, and neither contains the other's pages or
endpoint paths. The rule that keeps it true: **`src/admin` and `src/driver` may not import
from each other**; only `src/shared` is common. One cross-boundary import merges the chunks.

**What a shared origin costs, accepted knowingly.** Admin and driver share one origin, so an
XSS in either tree can act as the other within the same browser session — cross-origin
isolation is the one protection this layout gives up. Two mitigations matter more as a
result: a strict Content-Security-Policy (not yet configured, see below) and keeping the
driver tree's dependency surface small. Note that separate ports would not have helped;
cookies ignore ports, so only separate hostnames provide that isolation.

None of the token isolation depends on this. Staff and driver tokens use different signing
keys, different `aud` claims and different cookie paths, so they remain non-interchangeable
on one origin.

The driver tree is dark-themed with 56px minimum hit targets, because it is used on a phone
in a cab. The admin tree is a conventional desktop MUI layout. Each installs its own
`ThemeProvider`; only the query cache and the Sentry boundary are shared.

## 4. User invitations

> Scope point 7: admins invite everyone except drivers; a user is active only after accepting.

```
admin creates user ──▶ User{status: INVITED} + Invitation{tokenHash, expiresAt: +7d}
                  ──▶ email with one-time link
        user opens ──▶ sets password ──▶ enrols TOTP ──▶ User{status: ACTIVE}
```

`User.status` is `INVITED | ACTIVE | SUSPENDED`. Only `ACTIVE` users can authenticate, so
an unaccepted invitation is not a usable account. The invitation stores a **hash** of the
token, never the token; it is single-use and expires.

Drivers are exempt. An admin creates the driver and sets the initial PIN out of band, so
the driver row is `ACTIVE` immediately and no `Invitation` is created.

Mail goes through nodemailer. With no `MAIL_HOST` set, development uses a stream transport
that writes each message as an `.eml` file to `MAIL_DEV_DIR` (`./storage/dev-mail`, kept
outside `logs/` because those files carry live activation tokens). Production refuses to
boot without `MAIL_HOST`: a silently dropped invitation is worse than a crash.

### What is implemented

`POST /api/staff/invitations` issues one, `GET /api/staff/invitations/preview` lets the
accept page name the invitee, and `POST /api/staff/invitations/accept` sets the password.
`POST /api/staff/invitations/:userId/resend` revokes every outstanding link for an `INVITED`
user and mails a fresh one in the same transaction, under the same grant rule as inviting.
The last two are public — they carry a token, not a session, which is also why they have no
CSRF guard and a tighter rate limit instead. Single use is a conditional
`UPDATE ... WHERE acceptedAt IS NULL`, so two concurrent accepts serialise on the row lock
and the loser rolls back.

Permissions are enforced by `PermissionsGuard`, which builds a CASL ability from the
caller's role permissions on every request — so revoking a grant takes effect immediately
rather than when the access token expires. Endpoints declare
`@RequirePermission(action, subject)`; role names never appear in business logic.

Soft delete sets `deletedAt`, soft-deletes the matching `drivers` row in the same
transaction, and revokes refresh tokens for both audiences. TypeORM adds
`deletedAt IS NULL` to the root alias and to joined relations, so a deleted person vanishes
from staff login, driver login and their own pending invitation. An account whose role is
flagged `isSuperAdmin` cannot be deleted by anyone; the service answers 403.

## 5. Driver types

> Scope point 8: truck driver, train driver.

`DriverType` is an enum (`TRUCK`, `TRAIN`) on a `Driver` row that holds a one-to-one
reference to `User`. Type-specific data — licence classes, endorsements, medical
certificate expiry — lives in a `driver_qualification` table keyed by driver and
qualification type, rather than as nullable columns on `Driver`.

The enum drives assignment eligibility: a train driver is not offerable a truck shipment.
Adding a third type must not require a schema change to `Driver`.

## 6. Logging

> Scope point 3: service-level file logging, no `console.log`.

Implemented. Winston via `nest-winston`, configured in `src/config/logger.config.ts`:

- Console transport, human-formatted, for local work.
- `logs/tms-%DATE%.log` — all levels, JSON, daily rotation, gzipped, 14-day retention.
- `logs/tms-error-%DATE%.log` — errors only, so incident triage does not need grep.

Services inject the Nest `Logger` with their class name as context. `console.log` is
banned in application code; it bypasses the transports and so never reaches disk.

Secrets are redacted at the transport. `src/config/redact.format.ts` masks any key matching
password/pin/secret/token/authorization/cookie anywhere in the logged payload, before it
reaches a file. Enforcing it there means a careless log call cannot leak a credential to
disk — but it is a backstop, not a licence to log credential-bearing objects.

Still to add: a correlation-id middleware stamping a request id onto every line, and PII
redaction beyond credentials.

## 7. Error monitoring

> Scope point 4: Sentry. Done.

Backend: `src/instrument.ts` runs before any other import in `main.ts`,
`SentryModule.forRoot()` is first in the root module, `SentryGlobalFilter` is the global
exception filter, profiling enabled.

Frontend: `src/instrument.ts` runs before render, browser tracing is bound to the React
Router v7 data router so transactions are named by matched route, session replay masks all
text, and the axios interceptor reports 5xx and network failures only — 4xx is expected
traffic.

Both are inert without a DSN, which is the normal local state.

## 8. Development environment

> Scope point 2: consistent tooling, Git hooks, agents.

Present: TypeScript, ESLint flat config, Prettier, Jest, Vitest, Playwright, `.env.example`
in both projects, and a git repository at the workspace root. `husky` and `lint-staged` are
installed but the hooks are not yet wired.

To add:

| Tool | Purpose |
| --- | --- |
| husky `pre-commit` | `lint-staged`: ESLint `--fix` and Prettier on staged files |
| husky `commit-msg` + commitlint | conventional commits, so changelogs and versioning are mechanical |
| `docker-compose.yml` | PostgreSQL and MailHog, so a checkout runs with one command |
| `.nvmrc`, `.editorconfig` | pin Node 22.20 and editor behaviour across machines |
| GitHub Actions | lint, typecheck, unit tests, build on push; E2E on PR |

### Proposed Claude Code agents

Placed in `.claude/agents/`. Each exists because the mistake it catches is expensive and
easy to miss in review.

- **`migration-reviewer`** — on any change under `src/database/migrations/`, read the
  generated SQL and flag destructive operations, missing `down()` logic, and column drops
  that need a backfill first. TypeORM generates migrations that happily drop data.
- **`rbac-reviewer`** — on changes to guards, strategies, decorators or anything under
  `modules/auth/`, verify the driver and staff token boundaries still hold and that no
  endpoint lost its `@RequirePermission`. This is the repo's highest-consequence code.
- **`api-contract-sync`** — when a controller or DTO changes, check whether
  `packages/api-client` and the consuming frontend were updated. The two projects have no
  compile-time link, so drift is silent.

### Proposed hooks

- `PreToolUse` on `Bash` — block `npm test`, `jest` or `vitest` invocations that carry
  neither a file path nor a worker cap. An unconstrained run freezes this machine, and a
  hook enforces that where a written rule only reminds.
- `PostToolUse` on `Write`/`Edit` — run Prettier on the touched file, so formatting never
  reaches a diff.

`.claude/settings.json` holds the shared permission allow-list. It was previously named
`.calude/`, so it had never been read.

## 9. Testing

> Scope point 9: unit and E2E.

| Layer | Tool | Location | Boundary |
| --- | --- | --- | --- |
| Backend unit | Jest + ts-jest | `src/**/*.spec.ts` | providers stubbed with `useValue`, no database |
| Backend E2E | Jest + supertest | `test/e2e/*.e2e-spec.ts` | real `AppModule`, real PostgreSQL |
| Frontend unit | Vitest + Testing Library | `tests/unit/` | app api module mocked via `vi.mock` |
| Frontend E2E | Playwright | `tests/e2e/` | real browser, real dev server, real API |

Authentication coverage as built: 41 backend unit tests, 25 backend E2E, 16 frontend unit,
9 Playwright. The E2E suites assert the properties that unit tests cannot — that cookies
really are HttpOnly, that a replayed refresh token really is refused, that a driver token
really is rejected by the staff API, and that no token reaches `localStorage`.

Tests live next to what they cover and follow the existing naming convention.

**Every run must be scoped and worker-capped.** Jest and Vitest default to one worker per
core, and an unconstrained run freezes this machine. Pass a file path or `-t <name>`, plus
`--maxWorkers=2` (Jest), `--no-file-parallelism` (Vitest) or `--workers=1` (Playwright).

Priority coverage once the domain exists: the permission guard, the two authentication
flows, the invitation state machine, and driver-type assignment eligibility.

## Dependency pins

Two non-obvious constraints, recorded so they are not "fixed" by a routine upgrade.

**The backend is on the NestJS 11 CommonJS generation.** The Nest 12 releases of
`@nestjs/config`, `@nestjs/typeorm`, `@nestjs/jwt` and `@nestjs/passport` declare
`"type": "module"` with no CommonJS export. Node 22.20 can `require()` them, but Jest's
sandbox cannot until Node 24.9, so every unit test fails at import. The installed set is
`@nestjs/config@4`, `@nestjs/typeorm@11`, `@nestjs/jwt@11`, `@nestjs/passport@11`,
`nest-winston@1`.

**Sentry caps Nest at 11.** `@sentry/nestjs` declares `@nestjs/core` `^8 || ^9 || ^10 || ^11`.
Moving to Nest 12 means dropping the Sentry Nest integration, which scope point 4 requires.

`otplib` is pinned to `^12` for the same reason: v13 is a rewrite that depends on ESM-only
`@scure/base`, so Jest cannot load the TOTP unit tests. `@nestjs/terminus` was dropped
outright: v12 is ESM-only and v11 would have cascaded `@nestjs/typeorm` and `typeorm` back
down. The health check is hand-rolled instead.

The frontend E2E suite implements TOTP directly on `node:crypto` rather than adding an OTP
dependency to a project that otherwise has no use for one. It is cross-checked against
otplib's output.

Revisit when Sentry ships Nest 12 support **and** the project moves to Node 24.

## Open decisions

1. **An ADMIN can soft-delete the last remaining admin.** Only self-deletion and deleting a
   super admin are blocked today. Not an escalation, but a destructive gap.
2. **Driver device binding.** The design calls for binding a driver token to a device id,
   which assumes a device registration step. Not implemented. Needs a product decision on
   what happens when a driver changes phones.
3. **Lockout feedback.** A locked account currently gets the same "invalid credentials"
   message as a wrong password, which avoids confirming the account exists but is confusing
   for the legitimate user. Revisit once invitations give users a recovery path.
4. **Splitting the API into two processes.** Deferred, not rejected. Do it before the driver
   API is exposed to the public internet.
5. **Refresh token cleanup.** `TokenService.purgeExpired()` exists but nothing calls it. It
   needs a scheduled job once `@nestjs/schedule` is in.
6. **Content-Security-Policy.** Not configured. It matters more than usual because admin and
   driver share an origin, so an XSS in one tree reaches the other's session.

Resolved since the first draft: the API split (one process, two namespaces), the frontend
split (one app, two lazy trees on one hostname), password hashing (Argon2id), and the
refresh token store (PostgreSQL).
