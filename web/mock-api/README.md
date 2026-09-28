# SNU Archive mock API

An in-memory implementation of the SNU Archive HTTP API (contract
`web/api/openapi.yaml`, v2.0.0-draft) for frontend development. It serves every
operation in the contract under `/api/v1`, with cookie sessions, CSRF, the
contract's error bodies and seeded example data.

This is a standalone package with its own `package.json` and lockfile. It is
not part of the web app's dependencies or build. The only thing it takes from
`web/` is the generated types in `web/app/api/schema.d.ts`.

## Run

Node 24 and pnpm:

```sh
cd web/mock-api
pnpm install
pnpm start        # http://localhost:8787/api/v1
pnpm dev          # same, restarting on changes
pnpm test         # vitest: contract validation + unit tests
pnpm typecheck
```

The catalog comes from the nine term files at the repository root
(`2024-1.json` … `2026-1.json`) and takes about two seconds to build at startup.

### Environment

| Variable          | Default                  | Meaning                                                                                                       |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `8787`                   | Listen port                                                                                                   |
| `APP_ORIGIN`      | `http://localhost:5173`  | The React app. `Origin` must equal it on unsafe methods, and OAuth redirects go there                         |
| `ADMIN_EMAILS`    | `admin@snu.ac.kr`        | Comma-separated env admins. An empty value means none                                                         |
| `MOCK_ORIGIN`     | `http://localhost:$PORT` | Where the browser reaches the mock; `/auth/google` redirects to `$MOCK_ORIGIN/__mock/google`                  |
| `CRON_SECRET`     | `mock-cron-secret`       | Bearer secret for `POST /internal/jobs/{name}`. An empty value unregisters the route (404), as in the backend |
| `EXPORT_MAX_ROWS` | `1000`                   | Above this, log export returns `413 EXPORT_TOO_LARGE`                                                         |
| `CATALOG_DIR`     | repository root          | Directory with the `YYYY-S.json` source files                                                                 |

## Test accounts

| Email                  | Role                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `admin@snu.ac.kr`      | Admin through `ADMIN_EMAILS`                                             |
| `moderator@snu.ac.kr`  | Admin through a database grant (revocable in the console)                |
| `student@snu.ac.kr`    | Student with a profile, favourites, votes, open voting requests, uploads |
| `newbie@snu.ac.kr`     | No profile yet, so the profile banner shows. No favourites               |
| `2024-10001@snu.ac.kr` | Not seeded; signing in creates it, with `suggestedAdmissionYear: 2024`   |

Any other `@snu.ac.kr` address also works and creates a new account.

## Signing in

**Dev login** is always enabled in the mock, so `GET /config` answers
`devLoginEnabled: true`. The backend registers it only in development. It
needs no CSRF token, but `Origin` must equal `APP_ORIGIN`, otherwise
`403 CSRF_INVALID`.

```sh
curl -i -c jar.txt -X POST http://localhost:8787/api/v1/auth/dev-login \
  -H 'content-type: application/json' -H 'origin: http://localhost:5173' \
  -d '{"email":"student@snu.ac.kr"}'
curl -b jar.txt http://localhost:8787/api/v1/me
```

The response sets `snu_session` (HttpOnly, SameSite=Lax, Path=/) and
`snu_csrf` (readable, SameSite=Lax, Path=/). `Secure` is added only when
`APP_ORIGIN` is https.

**Google OAuth emulation.** `GET /api/v1/auth/google` redirects to
`$MOCK_ORIGIN/__mock/google`, a small page listing the test accounts plus
`someone@gmail.com` and a free-form email box. Each link goes to
`$APP_ORIGIN/api/v1/auth/google/callback?mock_email=…`, which is where Google
would send the browser, so the app's `/api/v1` proxy must forward it to the
mock. The callback sets both cookies and redirects to `$APP_ORIGIN/?auth=ok`.
A non-SNU address redirects to `/?auth=forbidden`. A missing `mock_email`, or
`error=…`, redirects to `/?auth=error`.

`GET /auth/google?next=/courses/12` returns there after signing in, as
`$APP_ORIGIN/courses/12?auth=ok`; an existing query string and fragment on
`next` are kept. The mock carries `next` through the chooser page as OAuth
`state`, where the backend uses a signed cookie. A `next` that breaks the
contract's rule (not starting with `/`, a second character of `/` or `\`, any
`\`, control character or space, or a different origin) is ignored, and the
redirect goes to `/`.

**CSRF.** Every `POST`, `PUT`, `PATCH` and `DELETE` that needs a session also
needs `X-CSRF-Token` equal to the `snu_csrf` cookie, and `Origin` equal to
`APP_ORIGIN`. Otherwise it gets `403 CSRF_INVALID`. With curl:

```sh
CSRF=$(awk '$6=="snu_csrf"{print $7}' jar.txt)
curl -b jar.txt -X PATCH http://localhost:8787/api/v1/me \
  -H 'content-type: application/json' -H "x-csrf-token: $CSRF" \
  -H 'origin: http://localhost:5173' -d '{"admissionYear":2022}'
```

The checks run in this order: session (401), CSRF and Origin (403
`CSRF_INVALID`), then admin rights (403 `ADMIN_REQUIRED`).

`POST /auth/logout` ends this session. `POST /me/logout-all`, `DELETE /me`
and revoking a database admin end every session of that user.

## Mock-only endpoints

These sit outside `/api/v1` and need no session or CSRF token.

| Endpoint                | Purpose                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `GET /__mock/health`    | `{ ok, now, currentTerm, courses, users, pendingFaults }`                                |
| `POST /__mock/reset`    | Restores the seed data and clears pending faults. Sessions of seeded accounts stay valid |
| `POST /__mock/faults`   | Makes the next matching request fail once (see below)                                    |
| `GET /__mock/faults`    | Lists pending faults                                                                     |
| `DELETE /__mock/faults` | Clears pending faults                                                                    |
| `GET /__mock/google`    | The fake Google account chooser                                                          |

### Faults

```sh
curl -X POST http://localhost:8787/__mock/faults -H 'content-type: application/json' \
  -d '{"method":"PUT","path":"/sittings/*/vote","status":409,"code":"VOTING_NOT_OPEN"}'
```

| Field     | Required | Meaning                                                                                                                                                                                                                                                                                        |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`    | yes      | Request path, with or without the `/api/v1` prefix. `*` matches within one segment. Query strings are ignored                                                                                                                                                                                  |
| `status`  | yes      | 400–599                                                                                                                                                                                                                                                                                        |
| `code`    | no       | An `ErrorCode` from the contract. Defaults by status: 400 `MALFORMED_REQUEST`, 401 `NOT_AUTHENTICATED`, 403 `CSRF_INVALID`, 404 `NOT_FOUND`, 409 `VOTING_NOT_OPEN`, 413 `FILE_TOO_LARGE`, 415 `FILE_TYPE_REJECTED`, 422 `VALIDATION_FAILED`, 428 `CONFIRMATION_REQUIRED`, otherwise `INTERNAL` |
| `method`  | no       | HTTP method, or `*` (the default)                                                                                                                                                                                                                                                              |
| `message` | no       | Overrides the Korean fallback message                                                                                                                                                                                                                                                          |
| `details` | no       | `error.details`. A 422 without `details` gets `{ "fields": [] }`                                                                                                                                                                                                                               |

Each fault fires once, on the first request that matches it, before
authentication. Faults are checked in the order they were added. The error
body is a normal contract `Error` with `requestId` and an `X-Request-ID`
header.

## Seed data

The seed is deterministic, but its times are relative to the current time, so
open voting stays open. The current term follows the contract's rule in
Asia/Seoul: Mar–Jun is 1, Jul–Aug is 2, Sep–Dec is 3, and Jan–Feb is the
previous year's 4.

- **Courses:** twelve real catalog courses (미적분학 1, 대학영어 1,
  프로그래밍방법론, 선형대수학, 경제원론 1, 물리학 1, …). One of them is left
  with no sittings, so its course page is empty.
- **Sittings:** 20 across the current and the three previous regular terms,
  including numbered kinds (퀴즈 3, 1차/2차 시험, 과제 2).
  - Open for voting: one closing in 3 days, one closing within 24 hours, and
    one open-ended.
  - Closed: some by an admin, some by a passed deadline.
  - Never opened: several, with open voting requests.
- **Votes and statistics:** 107 votes with spread distributions, and 22
  statistics, including partial and note-only rows, one hidden row and one
  transcribed row.
- **Voting requests:** open, fulfilled, rejected and cancelled requests. The
  student has open requests on two sittings.
- **Uploads:** three pending (real PNG and PDF bytes), one approved (linked to
  its statistic) and one rejected.
- **Comments:** 40. The first course has 26, which is more than one page. Some
  are by a deleted account, so their `author` is null.
- **Users:** 23, with varied colleges and admission years. One is scrubbed.
- **Activity log:** about 300 entries, enough for several pages.
- **Console data:** two catalog imports (failed, then succeeded), four archive
  runs (one failed), and three jobs (`upload-gc` disabled).

## Behaviour notes

The mock follows the contract. Where the contract leaves something open, the
mock decides as follows:

- **Validation.** Shape errors are `400 MALFORMED_REQUEST`: unparseable JSON,
  a wrong JSON type, an unknown property where the schema sets
  `additionalProperties: false`, or a bad `date-time`. Rule errors are
  `422 VALIDATION_FAILED` with `FieldError`s. As the contract says, the field
  is `""` for a body-level error (`NOTHING_SUBMITTED`, an empty PATCH, an
  empty log filter) and for a multi-field one (`QUARTILES_OUT_OF_ORDER`, and
  `VALUE_OUT_OF_RANGE` on statistics), reported once.
  `VALUE_ABOVE_MAX_SCORE` stays on each offending field.
- **Precedence** where several checks fail: session (401), then CSRF/Origin
  (403), then admin rights (403), then an unknown id in the path (404), then
  a malformed body (400), then the rest.
  `uploadReport` answers 413, then 415, then 422; `adminApproveReport` answers
  404, then 409, then 422.
- **Comment bylines** follow the contract (`김철수` → `김*수`, `남궁민수` →
  `남**수`, `김수` → `김*`). An account with no display name is masked from its
  email local part, which the contract does not cover.
- **Favourites order.** `PUT /me/favorites/order` stores positions; a new pin
  goes in front of all of them. `DELETE /me` deletes the favourites and leaves
  open voting requests open.
- **Log export.** JSON, JSONL, CSV and XLSX are real files. **Parquet is a
  placeholder** (`PAR1` magic around a text note) and is not readable.
- **Jobs.** `retention` and `archive` delete log rows in memory; `archive`
  also adds an archive run. `upload-gc` has nothing to collect.
- **State** lives in memory only and is lost on restart.

## Tests

`pnpm test` runs two files:

- `test/unit.test.ts` covers catalog identity and search, term boundaries,
  statistic rules, byline masking, the sign-in `next` rule and file sniffing.
- `test/contract.test.ts` calls every operation in the contract against the
  Hono app in-process, covering happy paths and the documented errors. Every
  response is checked against `../api/openapi.yaml`: the status must be
  declared, the media type declared, bodies schema-valid, 204 and 302 bodies
  empty, and `error.requestId` must equal `X-Request-ID`. The last tests fail
  if any `operationId` was never called, or if an operation that declares an
  error status never returned one.

Validation uses [openapi-backend](https://github.com/openapistack/openapi-backend)
for routing and response-schema selection, with three fixes for OpenAPI 3.1:

- Its OpenAPI 3.0 document check is swapped for
  `@seriousme/openapi-schema-validator`.
- Its draft-07 Ajv is swapped for Ajv 2020-12 with `ajv-formats`.
- Status and media-type checks are added.

`web/api/openapi.yaml` is an uncommitted symlink into the go-backend worktree.
When it is missing, the contract tests are skipped with a notice that says how
to restore it. `OPENAPI_SPEC=path/to/openapi.yaml pnpm test` points them at
another copy.
