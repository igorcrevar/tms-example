# tms-backend

NestJS 11 REST API. TypeScript, CommonJS, PostgreSQL via TypeORM. Root rules in
[`../CLAUDE.md`](../CLAUDE.md) apply here too.

## Layout

```
src/
  main.ts              bootstrap; imports ./instrument FIRST
  instrument.ts        Sentry init — nothing may be imported above it
  app.module.ts        root module wiring
  config/              AppConfig (env, validated once) + cors, logger, db options
  common/              cross-cutting: decorators, dto, filters, guards,
                       interceptors, middleware, pipes, utils
  database/            data-source.ts (CLI only), migrations/, seeds/
  modules/auth/        staff + driver authentication, permissions (CASL)
  modules/invitation/  invite, preview, accept
  modules/mail/        nodemailer transport + templates
  modules/user/        User, Role, Permission entities
  modules/driver/      Driver entity
  modules/<domain>/    one folder per domain module
test/
  e2e/*.e2e-spec.ts    needs a reachable PostgreSQL
  e2e/helpers.ts       app factory, fixture builders, cookie jar
  jest-e2e.json
```

## Authentication

Two namespaces on one process, with a cryptographic boundary between them:

```
/api/staff/auth/*    email -> password -> TOTP    aud: staff
/api/driver/auth/*   driver code -> PIN           aud: driver
```

Each audience signs with its **own** access and refresh secret, so a driver token presented
to the staff API fails signature verification rather than an authorization check that a
later refactor could weaken. `TokenService.secretsFor()` is the only place that maps an
audience to its keys.

Rules when touching anything under `modules/auth/`:

- **Never widen a token's audience.** If a new endpoint needs both, it needs two guards,
  not a shared secret.
- Tokens travel in HttpOnly cookies only — never a response body, never a header.
  `CookieService` owns every `res.cookie` call.
- Refresh tokens rotate on every use. The database stores a SHA-256 of the token, never the
  token. Replaying a consumed token revokes the entire family; do not "fix" that by
  ignoring the replay.
- Authentication failures return one message for every cause, so responses cannot be used
  to discover which accounts exist. Unknown identifiers still run a dummy Argon2 verify so
  the timing matches.
- State-changing auth routes sit behind `CsrfGuard` (double-submit against the readable
  `tms_staff_csrf` / `tms_driver_csrf` cookie of the namespace). Login is exempt: there is
  no session to protect yet.
- Argon2id via `PasswordService` for both passwords and PINs. Never call `argon2` directly.

`app.rateLimitDisabled` exists so E2E can exercise account lockout without tripping the
per-IP limiter. It is ignored when `NODE_ENV=production`; keep it that way.

## CORS

Built in `src/config/cors.config.ts` and applied by `main.ts` and by the E2E test app, so
the policy under test is the policy that ships. Because the session is a cookie, every
browser call is credentialed and the origin list is a security boundary:

- Origins come from `CORS_ORIGINS`, listed in full. `*` throws at boot.
- Production refuses to start with an empty list or a non-`https` origin.
- `allowedHeaders` must keep `x-csrf-token`; without it every state-changing request fails
  preflight and the CSRF guard never even runs.
- Changing this file means updating `src/config/cors.config.spec.ts` and
  `test/e2e/cors.e2e-spec.ts`, which assert the refusals rather than just the happy path.

## Permissions

Endpoints declare `@RequirePermission(action, subject)` and sit behind
`StaffJwtGuard, CsrfGuard, PermissionsGuard` in that order. The guard rebuilds the caller's
CASL ability from their role's permission rows on every request, so a revoked grant applies
immediately. Roles must never appear in business logic — only permissions do. A role
carries two traits: `pinLogin` (PIN sign-in, the absent second factor and the driver row
hang off it, and such a role cannot be invited) and `isSuperAdmin` (its members cannot be
deleted). Inviting into a role is allowed only
when the caller's ability covers every permission of that role — nobody grants what they
do not hold.

The guard is fail-open when a handler carries no decorator, so a new handler under a
guarded controller is reachable by any authenticated staff member until you add one.

## Seeds

```bash
npm run seed        # roles, permissions, and the super admin from SUPER_ADMIN_* env vars
npm run seed:e2e    # fixed accounts for the frontend browser tests
```

`npm run seed` refuses to run without `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`, and
rejects a password under 16 characters or a known placeholder. It is idempotent and never
overwrites an existing super admin. The seeded admin has no authenticator yet and enrols at
first login.

## Module conventions

A domain module owns its own folder under `src/modules/` and contains only what it needs:

```
modules/shipment/
  shipment.module.ts
  shipment.controller.ts        thin: validation, auth, mapping — no business logic
  shipment.service.ts           business logic lives here
  shipment.controller.spec.ts   unit tests sit next to the code
  dto/                          request/response DTOs, class-validator decorated
  entities/                     *.entity.ts — picked up by autoLoadEntities
```

Anything shared by two or more modules moves to `src/common/`, not into a neighbour module.

## Rules

- **Never `console.log`.** Inject the Nest `Logger` with a context
  (`private readonly logger = new Logger(ShipmentService.name)`). Winston routes it to the
  rotating files in `logs/`. See the Logging section below for what to log and at which
  level — it is mandatory, not optional.
- **Never set `synchronize: true`.** Schema changes ship as migrations only.
  `npm run migration:generate -- src/database/migrations/Name`, then review the generated
  SQL by hand before running it.
- `src/database/data-source.ts` is for the TypeORM CLI. The running app builds its options
  from `AppConfig` in `src/config/database.config.ts`. Change both or neither.
- Configuration is one class, `AppConfig` (`src/config/app-config.ts`): built and validated
  once from the environment, provided by `AppModule`, injected everywhere else. Never read
  `process.env` or repeat a default or conversion outside that file; `instrument.ts` and
  `data-source.ts` run before Nest exists and call `AppConfig.load(process.env)` directly.
- Every new env var is a field on `AppConfig` (with its validation, default and conversion)
  and an entry in `.env.example`.
- DTOs carry the validation. The global `ValidationPipe` runs with `whitelist` and
  `forbidNonWhitelisted`, so an undeclared property is a 400, not a silent pass-through.
- **Never log a credential.** `src/config/redact.format.ts` masks keys matching
  password/pin/secret/token/authorization/cookie before anything reaches a transport, but
  that is a backstop — do not log the object in the first place. Log user ids, not emails,
  and never a token, hash or TOTP secret.
- Columns holding secrets (`passwordHash`, `totpSecret`, `pinHash`) are `select: false`.
  Reach them with an explicit `addSelect` in the auth query, not by removing the flag.

## Transactions

An operation that makes more than one database write runs inside a transaction. A single
`INSERT`, `UPDATE` or `DELETE` is already atomic in Postgres — never wrap one in a transaction
of its own.

The boundary is the whole operation, not one method. Deleting a user soft-deletes the user,
soft-deletes its driver row and revokes its sessions: all of it commits or none of it does.
A transaction that closes before the last write leaves exactly the state the rule exists to
prevent — a deleted account whose tokens still work.

Most methods that write just receive `mng: EntityManager` and work through it. They neither
open a transaction nor touch an injected repository, so a single-write method still joins
whatever operation calls it:

```ts
async revokeAllForUser(userId: string, audience: TokenAudience, mng: EntityManager) {
  await mng
    .getRepository(RefreshToken)
    .update({ userId, audience, revokedAt: IsNull() }, { revokedAt: new Date() });
}
```

One place opens the transaction — the service method behind the endpoint — and passes
`manager` to everything it calls:

```ts
await this.dataSource.transaction(async (manager) => {
  await manager.softDelete(Driver, { userId });
  await manager.softDelete(User, { id: userId });
  await this.tokens.revokeAllForUser(userId, TokenAudience.Staff, manager);
});
```

Make it optional (`mng?: EntityManager`, resolving `const repo = mng ? mng.getRepository(X) :
this.xs`) only where a method is genuinely both an entry point of its own and a step inside a
larger operation.

A repository injected with `@InjectRepository` takes its own connection and escapes the
transaction it appears to sit inside. Never reach for one from inside a transaction.

A read belongs inside only when it guards a write. A conditional claim
(`UPDATE ... WHERE usedAt IS NULL`) and the work it authorises are one transaction, or the
single-use guarantee is not one.

## Money and time

The conventions are in [`../CLAUDE.md`](../CLAUDE.md); this is where they live in code.

- `src/common/money/money.ts` is the only monetary arithmetic in the backend. Spread
  `moneyColumn` into `@Column` so every amount is `numeric(38, 18)`, type the property as
  `Money` (a string), and go through `addMoney`, `subtractMoney`, `compareMoney` or
  `applyBasisPoints`. Never `+`, never `parseFloat`, never `number`.
- The pg driver returns `numeric` as a string, so an amount stays a string end to end —
  entity, DTO, JSON. Nothing needs to parse it.
- Fees and margins take `BasisPoints` (an integer). `applyBasisPoints` throws on a
  fractional value rather than silently rounding.
- Date arithmetic and comparison use `date-fns` (`addMilliseconds`, `isAfter`, `isFuture`,
  `fromUnixTime`). `new Date()` for "now" is fine; hand-rolled `getTime()` maths is not.

## Logging

Mandatory for every controller, service and any method that makes a decision worth
explaining. A change that adds behaviour without logging it is incomplete.

Log the **action or decision**, in those words: "Creating driver DRV-0001 on behalf of
<id>", "Revoking every session for user <id>", "Skipping staff logout: the request carried
no refresh token". A line that only restates the method name earns nothing.

- **info** (`this.logger.log`) — something happened: created, updated, deleted, issued,
  revoked, sent, or a branch deliberately not taken.
- **warn** — a decision that denied or degraded something without throwing: an account
  locked, a family revoked after a replay, a fallback transport chosen.
- **error** — something the system could not handle and is not simply rethrowing.

**Never log an exception you are about to throw.** `AllExceptionsFilter`
(`src/common/filters/all-exceptions.filter.ts`) is the outer layer: it logs every thrown
exception once — `warn` for 4xx, `error` with the stack for 5xx — and forwards it to Sentry.
It extends `SentryGlobalFilter`, so Sentry reporting is unchanged. Logging at the throw site
as well produces the same failure twice.

Identify people by UUID. Never an email address, and never a password, PIN, TOTP secret,
token or hash — `src/config/redact.format.ts` masks credential-shaped keys as a backstop,
not as permission.

## Sentry

`src/instrument.ts` must stay the first import in `main.ts` — auto-instrumentation patches
libraries as they load, so anything imported above it is invisible to Sentry.
`SentryModule.forRoot()` is the first entry in `app.module.ts` imports and
`SentryGlobalFilter` is registered as `APP_FILTER`. Without `SENTRY_DSN` the SDK is inert,
which is the normal local state.

## Tests

```bash
npx jest src/modules/auth/services/token.service.spec.ts --maxWorkers=2
npx jest -t 'revokes the whole family' --maxWorkers=2
npx jest --config ./test/jest-e2e.json test/e2e/auth-staff.e2e-spec.ts --maxWorkers=1
```

E2E needs PostgreSQL reachable on the `DB_*` values in `.env`.

Unit tests mock at the provider boundary — `Test.createTestingModule` with `useValue` stubs,
no live database. E2E tests boot the real `AppModule` and do need one.

## Dependency pins

`@nestjs/config@4`, `@nestjs/typeorm@11`, `@nestjs/jwt@11`, `@nestjs/passport@11` and
`nest-winston@1` are held on the CommonJS generation deliberately. Their Nest 12 releases
declare `"type": "module"` with no CJS export; Node 22.20 can `require()` them but Jest's
sandbox cannot, so every unit test fails to load. `@nestjs/terminus` was dropped for the
same reason — the health check is hand-rolled in `src/modules/health/`.
