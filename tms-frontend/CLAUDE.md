# tms-frontend

One React 19 + Vite app serving two route trees. Root rules in
[`../CLAUDE.md`](../CLAUDE.md) apply here too.

## Layout

```
index.html
src/
  main.tsx           entry: Sentry boundary + QueryClient + RouterProvider
  instrument.ts      Sentry init, imported first
  routes/router.tsx  root router; lazy-loads the two trees
  admin/             /admin/*  -> /api/staff
    AdminApp.tsx     own ThemeProvider + <Routes>
    api.ts auth.ts pages/ layouts/ components/
  driver/            /driver/* -> /api/driver
    DriverApp.tsx    own ThemeProvider + <Routes>
    api.ts auth.ts pages/ layouts/ components/
  shared/
    api/             client factory, CSRF cookie reader
    auth/            session hooks, shared profile types
    components/      RequireSession, Splash
    theme/           theme (admin), driverTheme (driver)
tests/
  unit/              Vitest + Testing Library
  e2e/               Playwright, real backend, seeded fixtures
```

`AdminApp` and `DriverApp` are reached through `React.lazy`, so each tree builds into its
own chunk and a driver's phone never downloads the admin code. Inside each tree the paths
are relative (`login` resolves to `/admin/login`), because they are descendant `<Routes>`
under the root router's `/admin/*` and `/driver/*`.

**The two trees must not import from each other.** `src/admin` and `src/driver` share only
`src/shared`; a single import across the boundary collapses both chunks into one and undoes
the split. A build makes this visible — check that `dist/assets/DriverApp-*.js` contains no
admin code before assuming it still holds.

The theme lives inside each tree rather than at the root, since admin is light and driver
is dark. Only the QueryClient and the Sentry boundary are shared.

## Authentication

The session is HttpOnly cookies set by the API. The browser cannot read it, so:

- **Never put a token in `localStorage`, `sessionStorage` or a JS variable.** There is
  nothing to store: `withCredentials: true` makes the browser attach the cookies.
- Who is signed in comes from `GET /auth/me` via `useSession()`, not from decoding a token.
- State-changing calls need the CSRF header. The shared client adds it automatically from
  the readable per-audience cookie (`tms_staff_csrf` / `tms_driver_csrf`) — the one cookie
  that is deliberately not HttpOnly. A hand-rolled `fetch` skips that and will get a 403.
- On a 401 the client refreshes once and replays the request. Auth endpoints are excluded,
  so a failed login does not trigger a refresh loop.

Always go through `createApiClient` (`adminApi` / `driverApi`). It is the only place that
knows the base URL, the credentials flag, the CSRF header and the refresh retry.

## State

- **Server state → TanStack Query.** Query keys start with the app scope: `['admin', …]`,
  `['driver', …]`.
- **Client state → Zustand.** UI-only state the server does not own.

Never copy query results into another store.

## Money and time

Amounts arrive from the API as strings and stay strings. Render and format them; never
`parseFloat`, never put one in a `number`, never do arithmetic on one here — monetary
arithmetic is backend-only by convention, which is why this project has no `decimal.js`.
If a screen needs a computed total, the API returns it. Dates arrive as ISO-8601 UTC
strings; format with `date-fns`.

## MUI

System props were removed from layout components; `alignItems`, `justifyContent` and `gap`
go in `sx`, not as direct props. Colours and spacing come from the themes in
`src/shared/theme/` — the driver theme is dark with 56px minimum hit targets because it is
used on a phone, often gloved. Do not hardcode hex values in components.

## TypeScript

Two projects. `tsconfig.app.json` covers `src` and `tests/unit` with browser libs;
`tsconfig.node.json` covers the Vite/Playwright configs and `tests/e2e` with Node types.
An E2E helper that imports `node:crypto` belongs in the second, or it will not compile.
`verbatimModuleSyntax` is on, so type-only imports need `import type`.

## Tests

```bash
npx vitest run tests/unit/LoginPage.test.tsx --no-file-parallelism
npx vitest run -t 'rejects a wrong password' --no-file-parallelism
npx playwright test tests/e2e/admin-auth.spec.ts --workers=1
```

Unit tests mock the tree's api module (`vi.mock('@/admin/api')`) and wrap components in a
`QueryClientProvider` plus `MemoryRouter`.

E2E runs against the real stack: Playwright starts the backend and the dev server, and
`tests/e2e/global-setup.ts` reseeds the fixture accounts by calling the backend's
`seed:e2e` script. Fixture values live in `tests/e2e/fixtures.ts` and must stay in step
with `tms-backend/src/database/seeds/e2e-fixtures.ts`. That file also implements TOTP
directly on `node:crypto` rather than adding an OTP dependency to this project.

Requires PostgreSQL running and `npx playwright install chromium` once.
