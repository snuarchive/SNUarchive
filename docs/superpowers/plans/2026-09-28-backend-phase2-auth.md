# 백엔드 2단계(인증·사용자) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google 로그인(PKCE·nonce), 서명 쿠키 세션(사용하면 연장, 최대 30일), 개발 로그인, 관리자 판정, `/me` 조회·수정·탈퇴, 모든 기기 로그아웃, 그리고 개발 시드 명령의 첫 부분(계정)을 만든다.

**Architecture:**
- `internal/session`: 쿠키 서명·검증과 만료 규칙. HTTP를 모른다.
- `internal/google`: OAuth 코드 흐름과 ID 토큰 검증. `go-oidc`에 고정 엔드포인트를 쓰므로 기동할 때 네트워크를 쓰지 않는다.
- `internal/auth`: 계정 도메인. Google sub로 찾고, 재발급된 주소를 처리하고, 프로필·탈퇴·에포크를 다룬다. sqlc 쿼리 `db/queries/users.sql`를 쓴다.
- `internal/httpapi`: 쿠키 발급(`cookies.go`), `next` 검증(`next.go`), 계정 라우트(`accounts.go`)로 계약과 도메인을 잇는다.
- 테스트는 `internal/testutil/fakegoogle`(토큰·키 엔드포인트 대역)과 pgtest로 로그인 흐름을 처음부터 끝까지 돌린다.

**Tech Stack:** 1단계와 같음 + `github.com/coreos/go-oidc/v3` v3.21.0, `golang.org/x/oauth2` v0.37.0, `github.com/go-jose/go-jose/v4` v4.1.4(테스트용 서명).

**Spec:** `docs/superpowers/specs/2026-09-27-go-backend-design.md` (§2 결정 표, §4.2 사용자, §5.1 인증, §6 설정, §9 2단계). API 계약: `docs/api/openapi.yaml` (`/auth/*`, `/me`, `/me/logout-all`). 남은 항목: `docs/backend/open-items.md` (O6, O24, O27). 사용자 결정(2026-09-28)은 Task 1이 설계서 §2에 옮긴다.

**이 계획의 코드는 시제품으로 검증했다.** 2026-09-28에 `feature/go-backend`(2abad62) 위에서 이 계획의 모든 코드를 작성해 `make check`(sqlc diff, vet, staticcheck, 전체 테스트)와 Redocly lint를 통과시킨 뒤, 시제품은 지우고 계획만 커밋했다. 같은 날 PR #1에 d7a77ec(리뷰 반영: 프록시 신뢰, JSON 디코딩, 스키마)가 더해진 뒤 패치를 d7a77ec에 다시 대 보았고, 달라진 `open-items.md` 패치(Task 9)만 새로 만들었다. 그 사이 PR #1이 바뀌었다면 패치의 문맥이 어긋날 수 있다. 그때는 의미를 유지한 채 맞춰 적용하고, 의미가 달라지는 충돌은 아래 "도중 결정 규칙"을 따른다.

## Global Constraints

- **시작 조건:** PR #1이 main에 병합된 뒤 시작한다. 작업 브랜치는 `feature/backend-auth`, 워크트리는 `/home/toxiclemon/Working/SCSC/SNUarchive/.worktrees/backend-auth`이다. 이 브랜치는 계획 커밋만 가진 채 `feature/go-backend` 위에 만들어져 있으므로, 시작 전에 `git rebase --onto main feature/go-backend feature/backend-auth`로 main 위에 옮긴다(PR #1이 squash 병합됐어도 계획 커밋 하나만 옮겨진다).
- 메인 체크아웃(`/home/toxiclemon/Working/SCSC/SNUarchive`)은 읽지도 쓰지도 않는다.
- 커밋 메시지에 `Co-Authored-By` 줄을 **절대 넣지 않는다.** push하지 않는다.
- 실제 `.env` 파일(`deploy/.env` 등 `.env.example`을 제외한 모든 `.env*`)은 만들지도, 읽지도, 옮기지도 않는다. 읽기 가드가 거부하면 우회하지 말고(임시 파일 + `mv`, `git show`/`cat-file` 등) 보고한다.
- 모듈 경로 `github.com/snuarchive/snuarchive`, `go 1.27`, PostgreSQL 18(`postgres:18`).
- 쿠키 이름은 계약과 프론트가 쓰는 그대로: `snu_session`(HttpOnly), `snu_csrf`(읽기 가능), OAuth state는 `snu_oauth`(경로 `/api/v1/auth/google`).
- 세션: `SESSION_TTL` 기본 `168h`, `SESSION_MAX_AGE` 기본 `720h`. 남은 시간이 TTL의 절반 아래면 연장하되 `로그인 시각 + SESSION_MAX_AGE`를 넘지 않는다.
- 로그인 실패 리다이렉트는 정확히 `/?auth=cancelled`(`error=access_denied`), `/?auth=forbidden`(검증된 snu.ac.kr Workspace 계정이 아님), `/?auth=error`(그 밖). 성공은 `next`(또는 `/`)에 `auth=ok`를 덧붙인다.
- 계정은 Google `sub`로 찾는다. 표시 이름은 **계정을 만들 때만** 저장한다.
- 에러 응답은 `{"error":{"code","message","requestId","details"}}`. 필수 필드 누락·null은 `422 REQUIRED`, `400 MALFORMED_REQUEST`는 JSON 구문·모르는 필드·타입 불일치만.
- 쓰기 경로의 활동 로그는 도메인 변경과 같은 트랜잭션, 로그인 로그는 best-effort(실패해도 로그인 성공).
- 테스트: DB 테스트는 `-short`면 건너뛰고, 아니면 Docker가 없을 때 실패한다. 테스트마다 템플릿 DB를 복제한다.
- 린트: `go vet ./...`, `go tool staticcheck ./...`(쓰지 않는 비공개 함수가 있으면 실패하므로, 함수를 쓰는 코드와 같은 태스크에서 추가한다). 매 태스크 끝에 `make check`.
- **도중 결정 규칙:** 이 계획에 없는 결정(스키마·API·보안·동작)이 필요해지면 임의로 정하지 않는다. `docs/backend/open-items.md`에 새 `O` 번호 행(무엇을·왜·무엇이 막히는지·선택지, 상태 `열림`)으로 기록하고, 그 부분만 건너뛰고, 보고할 때 명시한다.
- 파일 인코딩 UTF-8. 주석은 코드가 스스로 말하지 않는 이유만 적는다.

## 파일 구조

```
db/migrations/00002_google_sub.sql     users.google_sub, users_live_ck·users_scrubbed_ck 교체
db/queries/users.sql                   sqlc: 계정 조회·생성·로그인 기록·프로필·스크럽·에포크·활동 로그
internal/db/dbq/users.sql.go           sqlc 생성 (직접 수정 금지)
internal/db/errors.go                  새 제약 2개 분류
internal/config/config.go              SESSION_MAX_AGE
internal/session/codec.go              용도별 HMAC 서명·검증, 키 교체
internal/session/policy.go             세션 내용, 연장·상한 규칙
internal/google/google.go              OAuth 코드 흐름(PKCE, nonce, hd) + ID 토큰 검증
internal/testutil/fakegoogle/          토큰·키 엔드포인트 대역, 테스트용 ID 토큰 서명
internal/auth/auth.go                  계정 서비스
internal/httpapi/cookies.go            세션·CSRF·state 쿠키
internal/httpapi/next.go               로그인 후 돌아갈 경로 검증, auth=ok 덧붙이기
internal/httpapi/accounts.go           /auth/*, /me, /me/logout-all
internal/httpapi/server.go             Deps에 Accounts, Google, Now
internal/devseed/devseed.go            개발 데이터 초기화·적재(2단계: 계정)
cmd/snuarchive/main.go                 serve 연결, dev seed 명령
```

---

### Task 1: 사용자 결정을 설계서와 계약에 반영

**Files:**
- Modify: `docs/superpowers/specs/2026-09-27-go-backend-design.md` (§2 결정 표, §4.2, §5.1, §6)
- Modify: `docs/api/openapi.yaml` (`startGoogleLogin`, `googleLoginCallback`, `securitySchemes.sessionCookie`)

**Interfaces:**
- Consumes: 없음
- Produces: 이후 태스크가 따르는 문서상 규칙. 계약에 `/?auth=cancelled`가 생긴다.

- [ ] **Step 1: 패치 적용**

다음 패치를 적용한다(`git apply`로 적용하거나, 문맥이 어긋나면 같은 내용을 손으로 반영).

```diff
diff --git a/docs/api/openapi.yaml b/docs/api/openapi.yaml
index a743d5b..d35d27e 100644
--- a/docs/api/openapi.yaml
+++ b/docs/api/openapi.yaml
@@ -93,7 +93,8 @@ paths:
       summary: Begin Google sign-in
       description: |
         A browser navigation, not an XHR target. Sets a signed, short-lived
-        state cookie and redirects to Google with `hd=snu.ac.kr`.
+        state cookie (`snu_oauth`, path `/api/v1/auth/google`) and redirects to
+        Google with `hd=snu.ac.kr`, a PKCE (S256) challenge and a nonce.
 
         `next` is kept in the signed state cookie; after a successful callback
         the browser is sent there (still with `auth=ok` appended) instead of
@@ -128,8 +129,17 @@ paths:
         as a query parameter — any existing query string and fragment on
         `next` are preserved).
 
-        Failures redirect rather than render: `/?auth=forbidden` for a
-        non-SNU account, `/?auth=error` otherwise. The client owns the message.
+        Failures redirect rather than render: `/?auth=cancelled` when the user
+        declined on Google's page (`error=access_denied`), `/?auth=forbidden`
+        for an account that is not a verified `@snu.ac.kr` member of the
+        `snu.ac.kr` Workspace, `/?auth=error` otherwise. The client owns the
+        message.
+
+        Accounts are keyed by Google's subject id. When a school address has
+        been reissued, its new holder gets a new account; the previous holder
+        keeps theirs and gets their current address back at their next
+        sign-in. The display name is stored when the account is created and
+        not overwritten later.
       security: []
       parameters:
         - { name: code,  in: query, schema: { type: string } }
@@ -1817,9 +1827,12 @@ components:
       in: cookie
       name: snu_session
       description: |
-        HttpOnly, Secure, SameSite=Lax. HMAC-signed `{uid, exp, ep}`; the
-        server also checks the account is live and `ep` equals its session
-        epoch.
+        HttpOnly, SameSite=Lax, Secure when the app origin is https.
+        HMAC-signed `{uid, exp, ep, at}`; the server also checks the account
+        is live and `ep` equals its session epoch. Sliding: once less than half
+        of `SESSION_TTL` is left, a response carries a renewed cookie, never
+        lasting past `SESSION_MAX_AGE` from sign-in. A request with a cookie
+        that no longer works gets `401` and the cookies cleared.
     csrfToken:
       type: apiKey
       in: header
diff --git a/docs/superpowers/specs/2026-09-27-go-backend-design.md b/docs/superpowers/specs/2026-09-27-go-backend-design.md
index 58eb249..9035f03 100644
--- a/docs/superpowers/specs/2026-09-27-go-backend-design.md
+++ b/docs/superpowers/specs/2026-09-27-go-backend-design.md
@@ -26,7 +26,11 @@ API 세부(경로, 스키마, 에러 코드)는 그 파일이 기준이고, 이
 | DB | PostgreSQL 18(개발·테스트·VM). Supabase 호환은 O11 확인 전까지 18 전용 기능 최소화 |
 | 배포 | 주: 학교/동아리 VM에서 docker compose. 대체: Vercel(Go 함수) + Supabase |
 | 스토리지 | `STORAGE_DRIVER=fs\|s3` (s3는 MinIO·Supabase Storage·R2·S3 공용) |
-| 세션 | HMAC 서명 쿠키(`user_id`, 만료, `session_epoch`), 키 교체 지원 |
+| 세션 | HMAC 서명 쿠키(`uid`, `exp`, `ep`, 로그인 시각 `at`), 키 교체 지원. 사용하면 연장: 남은 시간이 `SESSION_TTL`의 절반 아래면 요청 때 다시 발급하되 로그인 후 `SESSION_MAX_AGE`(기본 30일)를 넘지 않는다(2026-09-28 사용자 결정) |
+| 사용자 식별 | Google `sub`(`users.google_sub`, UNIQUE). 이메일은 로그인 때마다 갱신. 재발급된 학교 주소의 새 주인은 이전 계정을 이어받지 않는다(5.1). dev-login은 sub 없이 이메일로 찾는다(2026-09-28 사용자 결정) |
+| OAuth 구현 | `golang.org/x/oauth2` + `github.com/coreos/go-oidc/v3`, PKCE(S256)와 nonce. 엔드포인트는 고정값(디스커버리 없음)(2026-09-28 사용자 결정) |
+| 표시 이름 | Google 프로필 이름(대개 실명)을 계정을 만들 때만 저장. 이후 로그인은 덮어쓰지 않는다(2026-09-28 사용자 결정) |
+| 로그인 취소 | Google 동의 화면에서 취소(`error=access_denied`)하면 `/?auth=cancelled`(2026-09-28 사용자 결정) |
 | 관리자 | `ADMIN_EMAILS`(env, API로 회수 불가) **또는** `users.is_admin`(DB, 콘솔로 부여·회수) |
 | 개발 로그인 | `APP_ENV=development` + `DEV_LOGIN_ENABLED=true`일 때만. production에서 켜면 기동 실패 |
 | API | 제안서 `openapi.yaml` 기반 수정. `/api/v1`, 에러 코드, 키셋 커서 |
@@ -151,8 +155,10 @@ db/migrations/         goose SQL
 
 ### 4.2 사용자
 - `colleges(name PK, sort_order, is_active)` 시드.
-- `users(id, email, display_name, is_admin, college FK NULL, admission_year, last_ip inet NULL, session_epoch int DEFAULT 0, created_at, last_seen_at, deleted_at)`
-  - 스크럽 CHECK: `deleted_at`이 있으면 `email`, `display_name`, `college`, `admission_year`, `last_ip`가 NULL이고 `is_admin`은 false.
+- `users(id, email, display_name, is_admin, college FK NULL, admission_year, last_ip inet NULL, session_epoch int DEFAULT 0, created_at, last_seen_at, deleted_at, google_sub UNIQUE NULL)`
+  - `google_sub`는 마이그레이션 00002에서 추가한다.
+  - 살아 있는 계정은 이메일이나 sub 중 하나가 있어야 한다(`users_live_ck`). 재발급된 주소를 새 주인에게 넘긴 계정은 sub만 남고, 다음 로그인 때 현재 주소를 다시 받는다.
+  - 스크럽 CHECK: `deleted_at`이 있으면 `email`, `google_sub`, `display_name`, `college`, `admission_year`, `last_ip`가 NULL이고 `is_admin`은 false.
   - 탈퇴 시 `session_epoch`를 올린다. 기여 행의 `nickname`과 활동 로그는 유지한다.
 - 관리자 판정: `is_admin OR email ∈ ADMIN_EMAILS`. env 관리자는 콘솔에 `source: env`로 표시하고 회수 API는 409다. "마지막 관리자" 판단에 env 관리자도 세되, 로그인한 적 없는(계정이 없는) env 주소는 세지 않는다. 대시보드 `users.admins`도 같다.
 - 관리자가 아닌 계정의 회수는 404 `NOT_FOUND`.
@@ -220,22 +226,31 @@ db/migrations/         goose SQL
 ## 5. 동작
 
 ### 5.1 인증
-- `GET /auth/google` → state 쿠키(서명, 10분) → Google(`hd=snu.ac.kr`, `openid email profile`).
+- `GET /auth/google` → state 쿠키(`snu_oauth`, 서명, 10분, 경로 `/api/v1/auth/google`) → Google(`hd=snu.ac.kr`, `openid email profile`, PKCE S256, nonce).
+  - state 쿠키에는 state, nonce, PKCE 검증값, `next`, 만료가 들어간다. 콜백은 성공·실패와 관계없이 이 쿠키를 지운다.
   - `next`(선택): 다음을 모두 만족해야 state 쿠키에 담는다 — `/`로 시작, 두 번째 글자가 `/`나
     `\`가 아님, 어디에도 `\`를 포함하지 않음, 제어문자나 공백(U+0000–U+001F, U+007F, space)을
     포함하지 않음, 앱 출처를 기준으로 URL로 파싱했을 때 결과가 다시 앱 출처가 됨(스킴도 호스트도
     없음). 그 밖의 값은 무시한다.
 - `GET /auth/google/callback`
-  - state 검증 → 토큰 교환 → id_token 검증(서명, iss, aud, exp) → `email_verified`와 `@snu.ac.kr` 확인.
-  - 사용자 upsert. `last_seen_at`, `last_ip`를 갱신하고 env 관리자 표시를 붙인다.
+  - `error=access_denied`(사용자가 취소) → `/?auth=cancelled`. 다른 `error` → `/?auth=error`.
+  - state 검증 → 토큰 교환(PKCE 검증값) → id_token 검증(서명, iss, aud, exp, nonce) → `email_verified`, `hd=snu.ac.kr`, `@snu.ac.kr` 확인. 셋 중 하나라도 아니면 `/?auth=forbidden`.
+  - 사용자 찾기(한 트랜잭션, sub·이메일별 advisory lock):
+    - sub가 있는 계정: 이메일을 현재 값으로 갱신한다. 그 이메일을 다른 계정이 갖고 있으면, 그 계정은 재발급 전의 주인이므로 이메일을 내놓는다(sub는 유지).
+    - sub가 없고, 이메일이 sub 없는 계정(dev-login·가져오기로 만든 계정)의 것: 그 계정에 sub를 붙인다.
+    - sub가 없고, 이메일이 다른 sub의 계정 것: 그 계정이 이메일을 내놓고 새 계정을 만든다.
+    - sub가 있는 계정의 새 이메일을 sub 없는 계정이 갖고 있으면 자동으로 합칠 수 없으므로 `/?auth=error`로 끝내고 오류 로그를 남긴다.
+  - `last_seen_at`, `last_ip`를 갱신하고 env 관리자 표시를 붙인다. 표시 이름은 계정을 만들 때만 저장한다.
   - `login` 로그(ip 포함)를 남긴다.
   - 세션 쿠키와 CSRF 쿠키를 설정하고 `/?auth=ok`(state에 `next`가 있으면 그 경로로, 쿼리
     파라미터로 `auth=ok`를 덧붙이되 기존 쿼리와 프래그먼트는 유지)로 리다이렉트한다. 실패 시
     SNU 외 계정은 `/?auth=forbidden`, 그 밖은 `/?auth=error`(현행과 같은 값).
 - 세션 쿠키 `snu_session`: `base64url(payload).sig`
-  - payload = `{uid, exp, ep}`
+  - payload = `{uid, exp, ep, at}`(`at`은 로그인 시각, 갱신해도 유지). HMAC에 쿠키 용도(`session`, `oauth-state`)를 함께 넣어 한 쿠키를 다른 용도로 쓸 수 없게 한다.
   - `SESSION_KEYS`의 첫 키로 서명하고 모든 키로 검증한다.
-  - 요청마다 `users`를 조회해 `deleted_at IS NULL`이고 `session_epoch = ep`인지 확인한다. `last_seen_at`은 최대 10분에 한 번만 갱신한다.
+  - 요청마다 `users`를 조회해 `deleted_at IS NULL`이고 `session_epoch = ep`이며 이메일이 있는지 확인한다. 이메일을 내놓은 계정은 다시 로그인해야 한다. `last_seen_at`은 최대 10분에 한 번만 갱신한다.
+  - 연장: 남은 시간이 `SESSION_TTL`의 절반 아래면 응답에 새 쿠키를 싣는다. 만료는 `min(지금 + SESSION_TTL, at + SESSION_MAX_AGE)`.
+  - 쿠키 속성: `HttpOnly`, `SameSite=Lax`, 경로 `/`. `Secure`는 `APP_ORIGIN`이 https일 때. 쓸 수 없게 된 세션 쿠키로 요청하면 401과 함께 쿠키를 지운다.
 - CSRF: `snu_csrf` 쿠키(읽기 가능)와 `X-CSRF-Token` 헤더를 비교한다(unsafe 메서드). `Origin` 헤더가 `APP_ORIGIN`과 다르면 거부한다.
   - 예외: `POST /auth/dev-login`은 `Origin`만 검사하고 CSRF 토큰은 요구하지 않는다(세션이 아직 없음).
   - 예외: `POST /auth/logout`도 `Origin`만 검사하고, 세션이 없거나 무효여도 204로 쿠키를 지운다. 위조된 로그아웃이 할 수 있는 일은 로그아웃뿐이다.
@@ -345,7 +360,8 @@ db/migrations/         goose SQL
 | `DB_MAX_CONNS` | 10 (Vercel 권장 2) | |
 | `DB_POOLER_MODE` | false | true면 pgx simple protocol, 문장 캐시 끔(Supabase 트랜잭션 풀러) |
 | `SESSION_KEYS` | – | 필수. 쉼표 구분 base64(32바이트 이상). 첫 키로 서명 |
-| `SESSION_TTL` | 168h | |
+| `SESSION_TTL` | 168h | 쿠키 한 장의 수명. 절반 아래로 남으면 연장 |
+| `SESSION_MAX_AGE` | 720h | 로그인 후 최대 수명. 연장해도 넘지 않는다. `SESSION_TTL`보다 짧으면 기동 실패 |
 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | – | 필수(dev-login만 쓸 때는 제외) |
 | `ADMIN_EMAILS` | – | 쉼표 구분 |
 | `DEV_LOGIN_ENABLED` | false | production이면 기동 실패 |
```

- [ ] **Step 2: 계약 검증**

Run: `npx -y @redocly/cli@latest lint docs/api/openapi.yaml`
Expected: `Your API description is valid.` (경고 수는 적용 전과 같아야 한다)

Run: `go test ./internal/httpapi/ -run 'Contract|Envelope|Config'`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-09-27-go-backend-design.md docs/api/openapi.yaml
git commit -m "Record the phase 2 decisions in the spec and contract

Accounts are keyed by Google sub; sessions slide within SESSION_MAX_AGE;
sign-in uses PKCE and a nonce; the display name is stored once; a
declined consent screen redirects to /?auth=cancelled."
```

---

### Task 2: 스키마 00002 (`google_sub`)

**Files:**
- Create: `db/migrations/00002_google_sub.sql`
- Modify: `internal/db/errors.go` (제약 2개 분류)
- Modify: `internal/db/migrate_test.go`, `internal/db/schema_test.go`, `cmd/snuarchive/main_test.go` (마이그레이션이 둘이 된 것 반영, 새 규칙 테스트)
- Regenerate: `internal/db/dbq/models.go` (`User.GoogleSub`)

**Interfaces:**
- Consumes: 1단계 스키마 `db/migrations/00001_init.sql`의 `users`
- Produces: `users.google_sub text UNIQUE NULL`, 제약 `users_google_sub_u`, `users_google_sub_ck`, 바뀐 `users_live_ck`(이메일 또는 sub), `users_scrubbed_ck`(sub도 비워야 함). `dbq.User.GoogleSub *string`.

- [ ] **Step 1: 실패하는 테스트 작성**

`internal/db/schema_test.go`의 `TestOneOpenVotingRequestPerUser` 앞에 추가:

```go
// A live account needs an email or a Google sub (it can lose its email to a
// reissued address); a scrubbed one must have dropped its sub as well.
func TestGoogleSubRules(t *testing.T) {
	pool := pgtest.New(t)
	ctx := context.Background()
	id := scalar[int64](t, pool, `INSERT INTO users (email, google_sub) VALUES ('a@snu.ac.kr', '1001') RETURNING id`)
	mustExec(t, pool, `UPDATE users SET email = NULL WHERE id = $1`, id)

	_, err := pool.Exec(ctx, `INSERT INTO users (email, google_sub) VALUES ('b@snu.ac.kr', '1001')`)
	if got := constraintOf(t, err); got != "users_google_sub_u" {
		t.Fatalf("duplicate sub: constraint = %q", got)
	}
	_, err = pool.Exec(ctx, `INSERT INTO users (email, google_sub) VALUES ('c@snu.ac.kr', 'has space')`)
	if got := constraintOf(t, err); got != "users_google_sub_ck" {
		t.Fatalf("malformed sub: constraint = %q", got)
	}
	_, err = pool.Exec(ctx, `UPDATE users SET google_sub = NULL WHERE id = $1`, id)
	if got := constraintOf(t, err); got != "users_live_ck" {
		t.Fatalf("live row with neither email nor sub: constraint = %q", got)
	}
	_, err = pool.Exec(ctx, `UPDATE users SET deleted_at = now() WHERE id = $1`, id)
	if got := constraintOf(t, err); got != "users_scrubbed_ck" {
		t.Fatalf("scrub keeping the sub: constraint = %q", got)
	}
	mustExec(t, pool, `UPDATE users SET google_sub = NULL, deleted_at = now() WHERE id = $1`, id)
}
```

`internal/db/migrate_test.go`를 다음 패치대로 바꾼다(마이그레이션 두 개를 가정하고, 00002를 되돌릴 때 sub만 남은 계정이 스크럽되는지 확인):

```diff
diff --git a/internal/db/migrate_test.go b/internal/db/migrate_test.go
index 65d654f..411d284 100644
--- a/internal/db/migrate_test.go
+++ b/internal/db/migrate_test.go
@@ -36,18 +36,20 @@ func TestMigrationsUpDownUp(t *testing.T) {
 	defer m.Close()
 
 	res, err := m.Up(ctx)
-	if err != nil || len(res) != 1 {
+	if err != nil || len(res) != 2 {
 		t.Fatalf("up: %d results, %v", len(res), err)
 	}
 	if n := publicTables(t, url); n != 21 {
 		t.Fatalf("after up: %d tables, want 21", n)
 	}
 	status, err := m.Status(ctx)
-	if err != nil || len(status) != 1 || status[0].State != "applied" {
+	if err != nil || len(status) != 2 || status[0].State != "applied" || status[1].State != "applied" {
 		t.Fatalf("status = %+v, %v", status, err)
 	}
-	if _, err := m.Down(ctx); err != nil {
-		t.Fatalf("down: %v", err)
+	for range 2 {
+		if _, err := m.Down(ctx); err != nil {
+			t.Fatalf("down: %v", err)
+		}
 	}
 	if n := publicTables(t, url); n != 0 {
 		t.Fatalf("after down: %d tables left", n)
@@ -57,6 +59,46 @@ func TestMigrationsUpDownUp(t *testing.T) {
 	}
 }
 
+// Rolling back 00002 must not fail on an account that only its Google sub
+// kept alive: the old rules need an email on every live row, so such a row
+// is scrubbed. Deleting it would break the rows that reference it.
+func TestGoogleSubDownScrubsSubOnlyAccounts(t *testing.T) {
+	ctx := context.Background()
+	url := pgtest.NewEmptyDatabase(t)
+	m, err := db.NewMigrator(url)
+	if err != nil {
+		t.Fatal(err)
+	}
+	defer m.Close()
+	if _, err := m.Up(ctx); err != nil {
+		t.Fatal(err)
+	}
+	conn, err := pgx.Connect(ctx, url)
+	if err != nil {
+		t.Fatal(err)
+	}
+	defer conn.Close(ctx)
+	var id int64
+	if err := conn.QueryRow(ctx,
+		`INSERT INTO users (google_sub, display_name) VALUES ('108', '김철수') RETURNING id`).Scan(&id); err != nil {
+		t.Fatal(err)
+	}
+	if _, err := conn.Exec(ctx, `INSERT INTO activity_logs (user_id, action) VALUES ($1, 'login')`, id); err != nil {
+		t.Fatal(err)
+	}
+	if _, err := m.Down(ctx); err != nil {
+		t.Fatalf("down 00002: %v", err)
+	}
+	var deleted bool
+	var name *string
+	if err := conn.QueryRow(ctx, `SELECT deleted_at IS NOT NULL, display_name FROM users WHERE id = $1`, id).Scan(&deleted, &name); err != nil {
+		t.Fatal(err)
+	}
+	if !deleted || name != nil {
+		t.Fatalf("sub-only account after down: deleted=%v name=%v", deleted, name)
+	}
+}
+
 func TestOpenInPoolerMode(t *testing.T) {
 	ctx := context.Background()
 	pool, err := db.Open(ctx, db.Options{URL: pgtest.NewDatabase(t), MaxConns: 2, PoolerMode: true})
```

`cmd/snuarchive/main_test.go`의 `TestMigrateDownWithoutYesRefusesToRollBack`에서 되돌릴 대상 이름을 바꾼다:

```go
	if code != 1 || !strings.Contains(stderr, "00002_google_sub.sql") || !strings.Contains(stderr, "--yes") {
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `go test ./internal/db/ -run 'TestGoogleSubRules|TestMigrationsUpDownUp|TestGoogleSubDown'`
Expected: FAIL (`google_sub` 열이 없음, 마이그레이션 수 1)

- [ ] **Step 3: 마이그레이션 작성**

`db/migrations/00002_google_sub.sql`:

```sql
-- +goose Up

-- Accounts are keyed by Google's stable subject id, not by email: a school
-- address can be reissued, and the new holder must not inherit the old
-- account. A live account may lose its email to such a holder; it keeps its
-- sub and gets its current email back at its next sign-in. Rows made by dev
-- login have no sub and always keep their email.
ALTER TABLE users ADD COLUMN google_sub text;
ALTER TABLE users ADD CONSTRAINT users_google_sub_u UNIQUE (google_sub);
ALTER TABLE users ADD CONSTRAINT users_google_sub_ck CHECK (google_sub IS NULL OR google_sub ~ '^[0-9A-Za-z_-]{1,255}$');

ALTER TABLE users DROP CONSTRAINT users_live_ck;
ALTER TABLE users ADD CONSTRAINT users_live_ck
  CHECK (deleted_at IS NOT NULL OR email IS NOT NULL OR google_sub IS NOT NULL);

ALTER TABLE users DROP CONSTRAINT users_scrubbed_ck;
ALTER TABLE users ADD CONSTRAINT users_scrubbed_ck CHECK (
  deleted_at IS NULL
  OR (email IS NULL AND google_sub IS NULL AND display_name IS NULL AND college IS NULL
      AND admission_year IS NULL AND last_ip IS NULL AND is_admin = false)
);

-- +goose Down

ALTER TABLE users DROP CONSTRAINT users_scrubbed_ck;
ALTER TABLE users DROP CONSTRAINT users_live_ck;

-- A row only its sub kept alive cannot satisfy the old rules; it is scrubbed
-- rather than deleted, because contributions and logs still reference it.
UPDATE users
SET deleted_at = now(), display_name = NULL, college = NULL, admission_year = NULL,
    last_ip = NULL, is_admin = false
WHERE deleted_at IS NULL AND email IS NULL;

ALTER TABLE users ADD CONSTRAINT users_live_ck CHECK (deleted_at IS NOT NULL OR email IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT users_scrubbed_ck CHECK (
  deleted_at IS NULL
  OR (email IS NULL AND display_name IS NULL AND college IS NULL
      AND admission_year IS NULL AND last_ip IS NULL AND is_admin = false)
);

ALTER TABLE users DROP CONSTRAINT users_google_sub_ck;
ALTER TABLE users DROP CONSTRAINT users_google_sub_u;
ALTER TABLE users DROP COLUMN google_sub;
```

`internal/db/errors.go`의 `constraintRules`에 두 줄을 추가한다(`users_epoch_ck` 다음, `users_email_u` 다음):

```diff
diff --git a/internal/db/errors.go b/internal/db/errors.go
index c111b48..64a1aeb 100644
--- a/internal/db/errors.go
+++ b/internal/db/errors.go
@@ -42,6 +42,7 @@ var constraintRules = map[string]rule{
 	"users_scrubbed_ck":             internalInvariant,
 	"users_admission_year_ck":       field("admissionYear", apperr.InvalidAdmissionYear),
 	"users_epoch_ck":                internalInvariant,
+	"users_google_sub_ck":           internalInvariant,
 	"assessment_kinds_max_ck":       internalInvariant,
 	"assessment_kinds_fmt_ck":       internalInvariant,
 	"exam_sittings_semester_ck":     field("semester", apperr.InvalidTerm),
@@ -103,6 +104,7 @@ var constraintRules = map[string]rule{
 	"catalog_sections_u":           internalInvariant,
 	"colleges_order_u":             internalInvariant,
 	"users_email_u":                internalInvariant,
+	"users_google_sub_u":           internalInvariant,
 	"assessment_kinds_code_u":      internalInvariant,
 	"assessment_kinds_label_u":     internalInvariant,
 	"assessment_kinds_order_u":     internalInvariant,
```

모델 재생성:

Run: `go tool sqlc generate`
Expected: `internal/db/dbq/models.go`의 `User`에 `GoogleSub *string`이 생긴다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `go test ./internal/db/ ./cmd/...`
Expected: PASS (`TestEveryConstraintIsClassified` 포함)

Run: `make check`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add db/migrations/00002_google_sub.sql internal/db/errors.go internal/db/dbq/models.go \
  internal/db/migrate_test.go internal/db/schema_test.go cmd/snuarchive/main_test.go
git commit -m "Key accounts by Google sub (migration 00002)

A live account needs an email or a sub, so one that hands a reissued
address to its new holder survives; a scrubbed account drops its sub.
Rolling back scrubs accounts only their sub kept alive."
```

---

### Task 3: `SESSION_MAX_AGE`

**Files:**
- Modify: `internal/config/config.go`, `internal/config/config_test.go`

**Interfaces:**
- Consumes: 없음
- Produces: `config.Session.MaxAge time.Duration`(기본 `720h`). `SESSION_MAX_AGE < SESSION_TTL`이면 기동 실패(`SESSION_MAX_AGE must not be shorter than SESSION_TTL`).

- [ ] **Step 1: 실패하는 테스트 작성**

`internal/config/config_test.go`에 다음을 반영한다(기본값 표에 한 줄, 오류 표에 한 줄):

```diff
diff --git a/internal/config/config_test.go b/internal/config/config_test.go
index 5044692..9a00529 100644
--- a/internal/config/config_test.go
+++ b/internal/config/config_test.go
@@ -56,6 +56,7 @@ func TestDefaults(t *testing.T) {
 		{"db max conns", c.DB.MaxConns, int32(10)},
 		{"pooler", c.DB.PoolerMode, false},
 		{"session ttl", c.Session.TTL, 168 * time.Hour},
+		{"session max age", c.Session.MaxAge, 720 * time.Hour},
 		{"storage", c.Storage.Driver, "fs"},
 		{"fs root", c.Storage.FSRoot, "/data/uploads"},
 		{"upload max", c.Upload.MaxBytes, int64(3 << 20)},
@@ -119,6 +120,7 @@ func TestErrors(t *testing.T) {
 		{"bad proxy", with(minimal(), "TRUSTED_PROXIES", "nope"), `TRUSTED_PROXIES entry "nope" is not an IP address or CIDR`},
 		{"bad log level", with(minimal(), "LOG_LEVEL", "loud"), "LOG_LEVEL must be debug, info, warn or error"},
 		{"bad duration", with(minimal(), "SESSION_TTL", "-1h"), "SESSION_TTL must be a positive duration"},
+		{"max age below ttl", with(minimal(), "SESSION_TTL", "48h", "SESSION_MAX_AGE", "24h"), "SESSION_MAX_AGE must not be shorter than SESSION_TTL"},
 		{"bad env", with(minimal(), "APP_ENV", "staging"), "APP_ENV must be one of development, production"},
 	}
 	for _, tc := range cases {
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `go test ./internal/config/`
Expected: FAIL (`c.Session.MaxAge undefined`)

- [ ] **Step 3: 구현**

```diff
diff --git a/internal/config/config.go b/internal/config/config.go
index d81c651..4db9837 100644
--- a/internal/config/config.go
+++ b/internal/config/config.go
@@ -56,8 +56,9 @@ type DB struct {
 }
 
 type Session struct {
-	Keys [][]byte // first signs, all verify
-	TTL  time.Duration
+	Keys   [][]byte // first signs, all verify
+	TTL    time.Duration
+	MaxAge time.Duration // hard cap from sign-in; renewals never pass it
 }
 
 type Google struct {
@@ -151,8 +152,12 @@ func Load(lookup LookupFunc) (*Config, []string, error) {
 		PoolerMode: p.boolean("DB_POOLER_MODE", false),
 	}
 	c.Session = Session{
-		Keys: p.sessionKeys("SESSION_KEYS"),
-		TTL:  p.duration("SESSION_TTL", 168*time.Hour),
+		Keys:   p.sessionKeys("SESSION_KEYS"),
+		TTL:    p.duration("SESSION_TTL", 168*time.Hour),
+		MaxAge: p.duration("SESSION_MAX_AGE", 720*time.Hour),
+	}
+	if c.Session.MaxAge < c.Session.TTL {
+		p.fail("SESSION_MAX_AGE", "must not be shorter than SESSION_TTL")
 	}
 
 	c.DevLoginEnabled = p.boolean("DEV_LOGIN_ENABLED", false)
```

- [ ] **Step 4: 통과 확인**

Run: `go test ./internal/config/ && make check`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "Add SESSION_MAX_AGE, the hard cap on a session's life"
```

---

### Task 4: `internal/session` (쿠키 서명과 만료 규칙)

**Files:**
- Create: `internal/session/codec.go`, `internal/session/policy.go`
- Test: `internal/session/session_test.go`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `session.ErrInvalid error`
  - `session.NewCodec(keys [][]byte) *session.Codec`
  - `(*Codec).Seal(purpose string, v any) (string, error)` — 키가 없으면 오류
  - `(*Codec).Open(purpose, token string, v any) error` — 신뢰할 수 없으면 `ErrInvalid`
  - `session.Session{UID int64 "uid"; Epoch int32 "ep"; AuthAt int64 "at"; Exp int64 "exp"}` (유닉스 초)
  - `session.Policy{TTL, MaxAge time.Duration}` 와 `New(uid int64, epoch int32, now time.Time) Session`, `Valid(s Session, now time.Time) bool`, `Renew(s Session, now time.Time) (Session, bool)`

- [ ] **Step 1: 실패하는 테스트 작성**

`internal/session/session_test.go`:

```go
package session_test

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/session"
)

var (
	keyA = bytes.Repeat([]byte("a"), 32)
	keyB = bytes.Repeat([]byte("b"), 32)
)

type payload struct {
	N int `json:"n"`
}

func TestSealOpenRoundTrip(t *testing.T) {
	c := session.NewCodec([][]byte{keyA})
	tok, err := c.Seal("session", payload{N: 7})
	if err != nil {
		t.Fatal(err)
	}
	var got payload
	if err := c.Open("session", tok, &got); err != nil || got.N != 7 {
		t.Fatalf("open = %+v, %v", got, err)
	}
}

func TestKeyRotation(t *testing.T) {
	old := session.NewCodec([][]byte{keyA})
	tok, _ := old.Seal("session", payload{N: 1})
	var got payload
	if err := session.NewCodec([][]byte{keyB, keyA}).Open("session", tok, &got); err != nil {
		t.Fatalf("a token from the old key must open while the old key is listed: %v", err)
	}
	if err := session.NewCodec([][]byte{keyB}).Open("session", tok, &got); !errors.Is(err, session.ErrInvalid) {
		t.Fatalf("a retired key must not verify: %v", err)
	}
}

func TestRejectsTampering(t *testing.T) {
	c := session.NewCodec([][]byte{keyA})
	tok, _ := c.Seal("session", payload{N: 1})
	forged, _ := session.NewCodec([][]byte{keyA}).Seal("session", payload{N: 2})
	payloadPart, _, _ := strings.Cut(forged, ".")
	_, sig, _ := strings.Cut(tok, ".")
	var got payload
	for name, bad := range map[string]string{
		"swapped payload":   payloadPart + "." + sig,
		"no separator":      strings.ReplaceAll(tok, ".", ""),
		"garbage signature": payloadPart + ".!!!",
		"empty":             "",
	} {
		if err := c.Open("session", bad, &got); !errors.Is(err, session.ErrInvalid) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if err := c.Open("oauth-state", tok, &got); !errors.Is(err, session.ErrInvalid) {
		t.Fatalf("a session token must not open as another purpose: %v", err)
	}
}

func TestSealNeedsAKey(t *testing.T) {
	if _, err := session.NewCodec(nil).Seal("session", payload{}); err == nil {
		t.Fatal("sealing without a key must fail")
	}
}

func TestPolicy(t *testing.T) {
	p := session.Policy{TTL: 7 * 24 * time.Hour, MaxAge: 30 * 24 * time.Hour}
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	s := p.New(42, 3, start)
	if s.UID != 42 || s.Epoch != 3 || s.AuthAt != start.Unix() || s.Exp != start.Add(p.TTL).Unix() {
		t.Fatalf("new = %+v", s)
	}

	// More than half left: no renewal.
	if _, renewed := p.Renew(s, start.Add(3*24*time.Hour)); renewed {
		t.Fatal("renewed with more than half of the TTL left")
	}
	// Less than half left: renewed to a full TTL from now.
	at := start.Add(4 * 24 * time.Hour)
	r, renewed := p.Renew(s, at)
	if !renewed || r.Exp != at.Add(p.TTL).Unix() || r.AuthAt != s.AuthAt {
		t.Fatalf("renew = %+v, %v", r, renewed)
	}
	// Expired: invalid and not renewed.
	if p.Valid(s, start.Add(p.TTL)) {
		t.Fatal("valid at its expiry")
	}
	if _, renewed := p.Renew(s, start.Add(p.TTL+time.Second)); renewed {
		t.Fatal("renewed an expired session")
	}

	// Renewals stop at MaxAge from sign-in.
	late := start.Add(27 * 24 * time.Hour)
	s.Exp = late.Add(time.Hour).Unix()
	r, renewed = p.Renew(s, late)
	if !renewed || r.Exp != start.Add(p.MaxAge).Unix() {
		t.Fatalf("capped renew = %+v, %v", r, renewed)
	}
	if p.Valid(r, start.Add(p.MaxAge)) {
		t.Fatal("valid at the cap")
	}
	// Already at the cap: nothing to extend.
	if _, renewed := p.Renew(r, start.Add(p.MaxAge-time.Hour)); renewed {
		t.Fatal("renewed past the cap")
	}
}

// A cookie issued while MaxAge was longer stops at the current cap.
func TestPolicyShorterCapApplies(t *testing.T) {
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	long := session.Policy{TTL: 7 * 24 * time.Hour, MaxAge: 90 * 24 * time.Hour}
	s := long.New(1, 0, start)
	s.Exp = start.Add(60 * 24 * time.Hour).Unix()
	short := session.Policy{TTL: 7 * 24 * time.Hour, MaxAge: 30 * 24 * time.Hour}
	if short.Valid(s, start.Add(31*24*time.Hour)) {
		t.Fatal("a cookie from a longer cap must stop at the current one")
	}
}
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `go test ./internal/session/`
Expected: FAIL (패키지에 비테스트 Go 파일이 없음)

- [ ] **Step 3: 구현**

`internal/session/codec.go`:

```go
// Package session signs the cookies the server hands out and decides when a
// session expires or is renewed.
package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

// ErrInvalid covers every token that cannot be trusted: malformed, signed
// with an unknown key, signed for another purpose, or not the expected JSON.
var ErrInvalid = errors.New("session: invalid token")

var b64 = base64.RawURLEncoding

// Codec signs small JSON payloads with HMAC-SHA256. The first key signs and
// every key verifies, so a new key is rolled out by putting it first and an
// old one retired by removing it once its tokens have expired.
type Codec struct {
	keys [][]byte
}

func NewCodec(keys [][]byte) *Codec { return &Codec{keys: keys} }

// Seal returns base64url(json(v)) + "." + base64url(mac). The purpose is
// part of the MAC, so a token sealed for one cookie never opens as another.
func (c *Codec) Seal(purpose string, v any) (string, error) {
	if len(c.keys) == 0 {
		return "", errors.New("session: no signing key")
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	payload := b64.EncodeToString(raw)
	return payload + "." + b64.EncodeToString(mac(c.keys[0], purpose, payload)), nil
}

// Open verifies token for purpose and decodes its payload into v.
func (c *Codec) Open(purpose, token string, v any) error {
	payload, sig, ok := strings.Cut(token, ".")
	if !ok {
		return ErrInvalid
	}
	got, err := b64.DecodeString(sig)
	if err != nil {
		return ErrInvalid
	}
	valid := false
	for _, k := range c.keys {
		if hmac.Equal(got, mac(k, purpose, payload)) {
			valid = true
			break
		}
	}
	if !valid {
		return ErrInvalid
	}
	raw, err := b64.DecodeString(payload)
	if err != nil {
		return ErrInvalid
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return ErrInvalid
	}
	return nil
}

func mac(key []byte, purpose, payload string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(purpose))
	h.Write([]byte{0})
	h.Write([]byte(payload))
	return h.Sum(nil)
}
```

`internal/session/policy.go`:

```go
package session

import "time"

// Session is the signed content of the snu_session cookie. Times are Unix
// seconds to keep the cookie short.
type Session struct {
	UID    int64 `json:"uid"`
	Epoch  int32 `json:"ep"`
	AuthAt int64 `json:"at"`  // sign-in time; renewals keep it
	Exp    int64 `json:"exp"` // this cookie's expiry
}

// Policy is sliding expiry with a hard cap: a session lasts TTL, is renewed
// for another TTL once less than half remains, and never outlives MaxAge
// from sign-in.
type Policy struct {
	TTL    time.Duration
	MaxAge time.Duration
}

// New starts a session at now.
func (p Policy) New(uid int64, epoch int32, now time.Time) Session {
	s := Session{UID: uid, Epoch: epoch, AuthAt: now.Unix()}
	s.Exp = p.expiry(s, now)
	return s
}

// Valid reports whether s is still usable at now. The cap is checked on its
// own so a cookie minted under a longer MaxAge stops at the current one.
func (p Policy) Valid(s Session, now time.Time) bool {
	t := now.Unix()
	return t < s.Exp && t < s.AuthAt+int64(p.MaxAge/time.Second)
}

// Renew returns s with a later expiry when less than half of TTL remains,
// and false when s should be left as it is.
func (p Policy) Renew(s Session, now time.Time) (Session, bool) {
	if !p.Valid(s, now) || time.Duration(s.Exp-now.Unix())*time.Second >= p.TTL/2 {
		return s, false
	}
	exp := p.expiry(s, now)
	if exp <= s.Exp {
		return s, false
	}
	s.Exp = exp
	return s, true
}

func (p Policy) expiry(s Session, now time.Time) int64 {
	return min(now.Add(p.TTL).Unix(), s.AuthAt+int64(p.MaxAge/time.Second))
}
```

- [ ] **Step 4: 통과 확인**

Run: `go test ./internal/session/ && make check`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add internal/session
git commit -m "Add the session package: purpose-bound HMAC tokens and sliding expiry"
```

---

### Task 5: `internal/google`와 테스트용 대역 `fakegoogle`

**Files:**
- Create: `internal/google/google.go`, `internal/testutil/fakegoogle/fakegoogle.go`
- Test: `internal/google/google_test.go`
- Modify: `go.mod`, `go.sum`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `google.Options{ClientID, ClientSecret, RedirectURL string; Issuer, AuthURL, TokenURL, JWKSURL string; HTTPClient *http.Client}` (빈 엔드포인트는 Google 값)
  - `google.New(ctx context.Context, o google.Options) *google.Client`
  - `(*Client).AuthCodeURL(state, nonce, verifier string) string` — `hd=snu.ac.kr`, S256 challenge, nonce, `openid email profile`
  - `(*Client).Exchange(ctx context.Context, code, verifier, nonce string) (google.Identity, error)` — 서명·iss·aud·exp(go-oidc)와 nonce 검증
  - `google.Identity{Subject, Email string; EmailVerified bool; HostedDomain, Name string}`, 상수 `google.HostedDomain = "snu.ac.kr"`
  - `fakegoogle.New(t testing.TB) *fakegoogle.Server`, `(*Server).Options(redirectURL string) google.Options`, `(*Server).Grant(code, challenge string, c fakegoogle.Claims)`, `fakegoogle.ClientID`, `fakegoogle.Claims{Subject, Email string; EmailVerified bool; HostedDomain, Name, Nonce, Issuer, Audience string; Expiry time.Time}`

- [ ] **Step 1: 의존성 추가**

Run: `go get github.com/coreos/go-oidc/v3@v3.21.0 golang.org/x/oauth2@v0.37.0 github.com/go-jose/go-jose/v4@v4.1.4`

`golang.org/x/oauth2/google`은 GCP 메타데이터 의존성을 끌고 오므로 쓰지 않는다(엔드포인트는 상수로 둔다).

- [ ] **Step 2: 실패하는 테스트 작성**

`internal/testutil/fakegoogle/fakegoogle.go` (테스트 도구이므로 먼저 만든다):

```go
// Package fakegoogle is a stand-in for Google's token and key endpoints, so
// the sign-in flow can be tested end to end without network access. The
// authorization page itself is a browser step; tests read the state, nonce
// and PKCE challenge from the redirect URL and call Grant with them.
package fakegoogle

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"

	"github.com/snuarchive/snuarchive/internal/google"
)

const ClientID = "test-client"

// Claims describe the ID token a code will be exchanged for. Zero values get
// working defaults: this server as issuer, ClientID as audience, an hour of
// validity.
type Claims struct {
	Subject       string
	Email         string
	EmailVerified bool
	HostedDomain  string
	Name          string
	Nonce         string
	Issuer        string
	Audience      string
	Expiry        time.Time
}

type grant struct {
	challenge string
	claims    Claims
}

type Server struct {
	*httptest.Server
	key    *rsa.PrivateKey
	mu     sync.Mutex
	grants map[string]grant
}

func New(t testing.TB) *Server {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{key: key, grants: map[string]grant{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /certs", s.certs)
	mux.HandleFunc("POST /token", s.token)
	s.Server = httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s
}

// Options points a google.Client at this server.
func (s *Server) Options(redirectURL string) google.Options {
	return google.Options{
		ClientID:     ClientID,
		ClientSecret: "test-secret",
		RedirectURL:  redirectURL,
		Issuer:       s.URL,
		AuthURL:      s.URL + "/auth",
		TokenURL:     s.URL + "/token",
		JWKSURL:      s.URL + "/certs",
		HTTPClient:   s.Client(),
	}
}

// Grant makes code exchangeable once, by the verifier whose S256 challenge
// is challenge, for an ID token carrying c.
func (s *Server) Grant(code, challenge string, c Claims) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.grants[code] = grant{challenge: challenge, claims: c}
}

func (s *Server) certs(w http.ResponseWriter, _ *http.Request) {
	set := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &s.key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(set)
}

func (s *Server) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	g, ok := s.grants[r.PostForm.Get("code")]
	delete(s.grants, r.PostForm.Get("code"))
	s.mu.Unlock()
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if !ok || base64.RawURLEncoding.EncodeToString(sum[:]) != g.challenge {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	idToken, err := s.sign(g.claims)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": "at", "token_type": "Bearer", "expires_in": 3600, "id_token": idToken,
	})
}

func (s *Server) sign(c Claims) (string, error) {
	if c.Issuer == "" {
		c.Issuer = s.URL
	}
	if c.Audience == "" {
		c.Audience = ClientID
	}
	if c.Expiry.IsZero() {
		c.Expiry = time.Now().Add(time.Hour)
	}
	body, err := json.Marshal(map[string]any{
		"iss": c.Issuer, "aud": c.Audience, "sub": c.Subject,
		"iat": time.Now().Unix(), "exp": c.Expiry.Unix(), "nonce": c.Nonce,
		"email": c.Email, "email_verified": c.EmailVerified, "hd": c.HostedDomain, "name": c.Name,
	})
	if err != nil {
		return "", err
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: s.key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"))
	if err != nil {
		return "", err
	}
	obj, err := signer.Sign(body)
	if err != nil {
		return "", err
	}
	return obj.CompactSerialize()
}
```

`internal/google/google_test.go`:

```go
package google_test

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/testutil/fakegoogle"
)

// begin returns the client, the fake server and the challenge the client
// put in its authorization URL.
func begin(t *testing.T) (*google.Client, *fakegoogle.Server, string, string) {
	t.Helper()
	fake := fakegoogle.New(t)
	c := google.New(context.Background(), fake.Options("http://app.test/api/v1/auth/google/callback"))
	verifier := oauth2.GenerateVerifier()
	u, err := url.Parse(c.AuthCodeURL("st", "n-1", verifier))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if q.Get("hd") != "snu.ac.kr" || q.Get("nonce") != "n-1" || q.Get("state") != "st" ||
		q.Get("code_challenge_method") != "S256" || !strings.Contains(q.Get("scope"), "openid") {
		t.Fatalf("auth url = %s", u)
	}
	return c, fake, verifier, q.Get("code_challenge")
}

func TestExchangeReturnsVerifiedIdentity(t *testing.T) {
	c, fake, verifier, challenge := begin(t)
	fake.Grant("code-1", challenge, fakegoogle.Claims{
		Subject: "1001", Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr", Name: "김철수", Nonce: "n-1",
	})
	id, err := c.Exchange(context.Background(), "code-1", verifier, "n-1")
	if err != nil {
		t.Fatal(err)
	}
	want := google.Identity{Subject: "1001", Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr", Name: "김철수"}
	if id != want {
		t.Fatalf("identity = %+v", id)
	}
}

func TestExchangeRejects(t *testing.T) {
	good := fakegoogle.Claims{Subject: "1001", Email: "kim@snu.ac.kr", EmailVerified: true, Nonce: "n-1"}
	cases := []struct {
		name     string
		claims   func(fakegoogle.Claims) fakegoogle.Claims
		verifier func(string) string
		nonce    string
	}{
		{"wrong nonce", func(c fakegoogle.Claims) fakegoogle.Claims { c.Nonce = "other"; return c }, nil, "n-1"},
		{"wrong audience", func(c fakegoogle.Claims) fakegoogle.Claims { c.Audience = "someone-else"; return c }, nil, "n-1"},
		{"wrong issuer", func(c fakegoogle.Claims) fakegoogle.Claims { c.Issuer = "https://evil.example"; return c }, nil, "n-1"},
		{"expired", func(c fakegoogle.Claims) fakegoogle.Claims { c.Expiry = time.Now().Add(-time.Hour); return c }, nil, "n-1"},
		{"wrong verifier", nil, func(string) string { return oauth2.GenerateVerifier() }, "n-1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, fake, verifier, challenge := begin(t)
			claims := good
			if tc.claims != nil {
				claims = tc.claims(claims)
			}
			fake.Grant("code-1", challenge, claims)
			if tc.verifier != nil {
				verifier = tc.verifier(verifier)
			}
			if _, err := c.Exchange(context.Background(), "code-1", verifier, tc.nonce); err == nil {
				t.Fatal("exchange must fail")
			}
		})
	}
}
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `go test ./internal/google/`
Expected: FAIL (`google.New` 등이 없음)

- [ ] **Step 4: 구현**

`internal/google/google.go`:

```go
// Package google runs the OAuth authorization-code flow against Google with
// PKCE and a nonce, and verifies the returned ID token.
package google

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// Google's published endpoints. They are fixed rather than discovered so
// that starting the server needs no network round trip.
const (
	Issuer   = "https://accounts.google.com"
	AuthURL  = "https://accounts.google.com/o/oauth2/v2/auth"
	TokenURL = "https://oauth2.googleapis.com/token"
	JWKSURL  = "https://www.googleapis.com/oauth2/v3/certs"
)

// HostedDomain is the Workspace domain accounts must belong to.
const HostedDomain = "snu.ac.kr"

type Options struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string

	// Overridable for tests; empty means Google's.
	Issuer, AuthURL, TokenURL, JWKSURL string
	HTTPClient                         *http.Client
}

// Identity is what a verified ID token says about the account.
type Identity struct {
	Subject       string
	Email         string
	EmailVerified bool
	HostedDomain  string
	Name          string
}

type Client struct {
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
	http     *http.Client
}

func New(ctx context.Context, o Options) *Client {
	def := func(v, d string) string {
		if v == "" {
			return d
		}
		return v
	}
	hc := o.HTTPClient
	if hc == nil {
		hc = http.DefaultClient
	}
	keys := oidc.NewRemoteKeySet(oidc.ClientContext(ctx, hc), def(o.JWKSURL, JWKSURL))
	return &Client{
		oauth: oauth2.Config{
			ClientID:     o.ClientID,
			ClientSecret: o.ClientSecret,
			RedirectURL:  o.RedirectURL,
			Endpoint: oauth2.Endpoint{
				AuthURL:   def(o.AuthURL, AuthURL),
				TokenURL:  def(o.TokenURL, TokenURL),
				AuthStyle: oauth2.AuthStyleInParams,
			},
			Scopes: []string{oidc.ScopeOpenID, "email", "profile"},
		},
		verifier: oidc.NewVerifier(def(o.Issuer, Issuer), keys, &oidc.Config{ClientID: o.ClientID}),
		http:     hc,
	}
}

// AuthCodeURL is where the browser goes to sign in. hd only preselects the
// school domain on Google's page; the token's hd claim is what is trusted.
func (c *Client) AuthCodeURL(state, nonce, verifier string) string {
	return c.oauth.AuthCodeURL(state,
		oauth2.S256ChallengeOption(verifier),
		oidc.Nonce(nonce),
		oauth2.SetAuthURLParam("hd", HostedDomain),
	)
}

var errNonce = errors.New("google: nonce mismatch")

// Exchange trades the code for tokens and verifies the ID token: signature,
// issuer, audience and expiry (go-oidc), then the nonce from this sign-in.
func (c *Client) Exchange(ctx context.Context, code, verifier, nonce string) (Identity, error) {
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.http)
	tok, err := c.oauth.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return Identity{}, fmt.Errorf("google: exchange: %w", err)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" {
		return Identity{}, errors.New("google: no id_token in the token response")
	}
	idt, err := c.verifier.Verify(ctx, raw)
	if err != nil {
		return Identity{}, fmt.Errorf("google: verify id_token: %w", err)
	}
	if idt.Nonce != nonce {
		return Identity{}, errNonce
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		HD            string `json:"hd"`
		Name          string `json:"name"`
	}
	if err := idt.Claims(&claims); err != nil {
		return Identity{}, fmt.Errorf("google: claims: %w", err)
	}
	return Identity{
		Subject:       idt.Subject,
		Email:         claims.Email,
		EmailVerified: claims.EmailVerified,
		HostedDomain:  claims.HD,
		Name:          claims.Name,
	}, nil
}
```

- [ ] **Step 5: 통과 확인**

Run: `go mod tidy && go test ./internal/google/ && make check`
Expected: PASS. 잘못된 nonce·audience·issuer·만료·PKCE 검증값이 모두 거부된다.

- [ ] **Step 6: 커밋**

```bash
git add go.mod go.sum internal/google internal/testutil/fakegoogle
git commit -m "Add the Google sign-in client (PKCE, nonce, fixed endpoints) and a fake for tests"
```

---

### Task 6: 계정 쿼리와 `internal/auth`

**Files:**
- Create: `db/queries/users.sql`, `internal/auth/auth.go`
- Regenerate: `internal/db/dbq/users.sql.go`
- Test: `internal/auth/auth_test.go`

**Interfaces:**
- Consumes: `dbq.User.GoogleSub`(Task 2), `google.Identity`, `google.HostedDomain`(Task 5), `optional.Field`(1단계), `db.MapError`, `apperr`
- Produces:
  - `auth.User{ID int64; Email string; DisplayName *string; IsAdmin bool; College *string; AdmissionYear *int; SessionEpoch int32}`
  - `auth.Identity{Subject, Email, Name string}`, `auth.FromGoogle(g google.Identity) (auth.Identity, bool)`, `auth.ValidEmail(email string) bool`, `auth.SuggestedAdmissionYear(email string, now time.Time) *int`
  - `auth.ProfileUpdate{College optional.Field[string] "college"; AdmissionYear optional.Field[int] "admissionYear"}` (HTTP 본문을 그대로 받는다)
  - `auth.NewService(pool *pgxpool.Pool, adminEmails []string, log *slog.Logger) *auth.Service`와 메서드 `SignInGoogle(ctx, Identity, netip.Addr) (User, error)`, `SignInDev(ctx, email string, name *string, ip netip.Addr) (User, error)`, `Authenticate(ctx, uid int64, epoch int32) (User, error)`, `UpdateProfile(ctx, uid int64, p ProfileUpdate, ip netip.Addr) (User, error)`, `DeleteAccount(ctx, uid int64, ip netip.Addr) error`, `LogoutAll(ctx, uid int64, ip netip.Addr) error`
  - 인증 실패는 `apperr` 코드 `NOT_AUTHENTICATED`

- [ ] **Step 1: 쿼리 작성과 생성**

`db/queries/users.sql`:

```sql
-- name: LockSignIn :exec
-- Serialises sign-ins that could touch the same rows (same sub or email).
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(key)::text, 7201));

-- name: GetLiveUserBySub :one
SELECT * FROM users WHERE google_sub = $1 AND deleted_at IS NULL FOR UPDATE;

-- name: GetLiveUserByEmail :one
SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL FOR UPDATE;

-- name: GetLiveUser :one
SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL;

-- name: InsertUser :one
INSERT INTO users (email, google_sub, display_name, last_ip, last_seen_at)
VALUES (sqlc.arg(email), sqlc.narg(google_sub), sqlc.narg(display_name), sqlc.narg(last_ip), now())
RETURNING *;

-- name: RecordSignIn :one
-- The display name is kept as first stored; only a missing sub is filled in.
UPDATE users
SET email = sqlc.arg(email),
    google_sub = COALESCE(google_sub, sqlc.narg(google_sub)),
    last_ip = sqlc.narg(last_ip),
    last_seen_at = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ReleaseEmail :exec
UPDATE users SET email = NULL WHERE id = $1;

-- name: TouchLastSeen :exec
UPDATE users SET last_seen_at = now()
WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '10 minutes');

-- name: UpdateProfile :one
UPDATE users
SET college = CASE WHEN sqlc.arg(set_college)::boolean THEN sqlc.narg(college) ELSE college END,
    admission_year = CASE WHEN sqlc.arg(set_admission_year)::boolean THEN sqlc.narg(admission_year) ELSE admission_year END
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: BumpSessionEpoch :one
UPDATE users SET session_epoch = session_epoch + 1
WHERE id = $1 AND deleted_at IS NULL
RETURNING session_epoch;

-- name: ScrubUser :execrows
UPDATE users
SET email = NULL, google_sub = NULL, display_name = NULL, college = NULL,
    admission_year = NULL, last_ip = NULL, is_admin = false,
    deleted_at = now(), session_epoch = session_epoch + 1
WHERE id = $1 AND deleted_at IS NULL;

-- name: DeleteUserFavorites :exec
DELETE FROM favorites WHERE user_id = $1;

-- name: IsActiveCollege :one
SELECT EXISTS (SELECT 1 FROM colleges WHERE name = $1 AND is_active);

-- name: InsertActivityLog :exec
INSERT INTO activity_logs (user_id, action, metadata, ip)
VALUES (sqlc.narg(user_id), sqlc.arg(action), sqlc.arg(metadata), sqlc.narg(ip));
```

Run: `go tool sqlc generate`
Expected: `internal/db/dbq/users.sql.go`가 생긴다. `inet`은 `*netip.Addr`, `InsertUserParams.Email`은 `*string`, `UpdateProfileParams`는 `SetCollege bool, College *string, SetAdmissionYear bool, AdmissionYear *int16, ID int64`.

- [ ] **Step 2: 실패하는 테스트 작성**

`internal/auth/auth_test.go`:

```go
package auth_test

import (
	"context"
	"log/slog"
	"net/netip"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/auth"
	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/optional"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

var ip = netip.MustParseAddr("198.51.100.7")

func newService(t *testing.T, admins ...string) (*auth.Service, *pgxpool.Pool) {
	t.Helper()
	pool := pgtest.New(t)
	return auth.NewService(pool, admins, slog.New(slog.DiscardHandler)), pool
}

func scalar[T any](t *testing.T, pool *pgxpool.Pool, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("query %q: %v", sql, err)
	}
	return v
}

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func code(err error) apperr.Code {
	if e, ok := apperr.As(err); ok {
		return e.Code
	}
	return ""
}

func TestFromGoogle(t *testing.T) {
	ok := google.Identity{Subject: "1", Email: "Kim@SNU.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr", Name: " 김철수 "}
	id, accepted := auth.FromGoogle(ok)
	if !accepted || id != (auth.Identity{Subject: "1", Email: "kim@snu.ac.kr", Name: "김철수"}) {
		t.Fatalf("got %+v %v", id, accepted)
	}
	for name, g := range map[string]google.Identity{
		"unverified":        {Subject: "1", Email: "kim@snu.ac.kr", HostedDomain: "snu.ac.kr"},
		"personal account":  {Subject: "1", Email: "kim@gmail.com", EmailVerified: true},
		"no hd claim":       {Subject: "1", Email: "kim@snu.ac.kr", EmailVerified: true},
		"other workspace":   {Subject: "1", Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "example.com"},
		"subdomain address": {Subject: "1", Email: "kim@cse.snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr"},
		"no subject":        {Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr"},
	} {
		if _, accepted := auth.FromGoogle(g); accepted {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestSuggestedAdmissionYear(t *testing.T) {
	now := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	for email, want := range map[string]int{"2021-12345@snu.ac.kr": 2021, "1998-10001@snu.ac.kr": 1998} {
		if got := auth.SuggestedAdmissionYear(email, now); got == nil || *got != want {
			t.Errorf("%s: %v", email, got)
		}
	}
	for _, email := range []string{"kim@snu.ac.kr", "2031-12345@snu.ac.kr", "2021-123@snu.ac.kr", "x2021-12345@snu.ac.kr"} {
		if got := auth.SuggestedAdmissionYear(email, now); got != nil {
			t.Errorf("%s: %d", email, *got)
		}
	}
}

func TestSignInGoogleCreatesThenKeepsTheFirstName(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "김철수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "kim@snu.ac.kr" || u.DisplayName == nil || *u.DisplayName != "김철수" || u.IsAdmin {
		t.Fatalf("user = %+v", u)
	}
	again, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "Kim Chulsoo"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != u.ID || *again.DisplayName != "김철수" {
		t.Fatalf("second sign-in = %+v", again)
	}
	if got := scalar[string](t, pool, `SELECT host(last_ip) FROM users WHERE id = $1`, u.ID); got != ip.String() {
		t.Fatalf("last_ip = %s", got)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM activity_logs WHERE user_id = $1 AND action = 'login' AND metadata->>'provider' = 'google' AND ip IS NOT NULL`, u.ID); n != 2 {
		t.Fatalf("login entries = %d", n)
	}
}

// A reissued address goes to its new holder; the previous holder keeps its
// account (by sub) and gets its current address back when it signs in.
func TestSignInGoogleReissuedEmail(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	old, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "김철수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, pool, `UPDATE users SET is_admin = true WHERE id = $1`, old.ID)

	newcomer, err := s.SignInGoogle(ctx, auth.Identity{Subject: "2002", Email: "kim@snu.ac.kr", Name: "김민수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if newcomer.ID == old.ID || newcomer.IsAdmin || *newcomer.DisplayName != "김민수" {
		t.Fatalf("the new holder must get a fresh account: %+v", newcomer)
	}
	if email := scalar[*string](t, pool, `SELECT email FROM users WHERE id = $1`, old.ID); email != nil {
		t.Fatalf("the old account still holds %s", *email)
	}
	if _, err := s.Authenticate(ctx, old.ID, old.SessionEpoch); code(err) != apperr.NotAuthenticated {
		t.Fatalf("an account without an address must sign in again: %v", err)
	}

	back, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "chulsoo.kim@snu.ac.kr"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if back.ID != old.ID || back.Email != "chulsoo.kim@snu.ac.kr" || !back.IsAdmin {
		t.Fatalf("returning account = %+v", back)
	}
}

// A first Google sign-in claims the account dev login (or an import) made.
func TestSignInGoogleClaimsAnAccountWithoutSub(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	dev, err := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "김철수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if u.ID != dev.ID || u.DisplayName != nil {
		t.Fatalf("claimed = %+v (the name is only stored at creation)", u)
	}
	if sub := scalar[string](t, pool, `SELECT google_sub FROM users WHERE id = $1`, u.ID); sub != "1001" {
		t.Fatalf("sub = %s", sub)
	}
}

func TestSignInGoogleRefusesToTakeAnAddressFromAnAccountWithoutSub(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	if _, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr"}, ip); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SignInDev(ctx, "kim2@snu.ac.kr", nil, ip); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim2@snu.ac.kr"}, ip); err == nil {
		t.Fatal("two accounts would share an address")
	}
}

func TestAdminFromEnvOrDB(t *testing.T) {
	s, pool := newService(t, "boss@snu.ac.kr")
	ctx := context.Background()
	boss, err := s.SignInDev(ctx, "boss@snu.ac.kr", nil, ip)
	if err != nil || !boss.IsAdmin {
		t.Fatalf("env admin = %+v, %v", boss, err)
	}
	u, _ := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)
	mustExec(t, pool, `UPDATE users SET is_admin = true WHERE id = $1`, u.ID)
	if got, err := s.Authenticate(ctx, u.ID, u.SessionEpoch); err != nil || !got.IsAdmin {
		t.Fatalf("db admin = %+v, %v", got, err)
	}
}

func TestAuthenticate(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, _ := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)
	mustExec(t, pool, `UPDATE users SET last_seen_at = now() - interval '1 hour' WHERE id = $1`, u.ID)
	if _, err := s.Authenticate(ctx, u.ID, u.SessionEpoch); err != nil {
		t.Fatal(err)
	}
	if fresh := scalar[bool](t, pool, `SELECT last_seen_at > now() - interval '1 minute' FROM users WHERE id = $1`, u.ID); !fresh {
		t.Fatal("last_seen_at not refreshed")
	}
	if _, err := s.Authenticate(ctx, u.ID, u.SessionEpoch+1); code(err) != apperr.NotAuthenticated {
		t.Fatalf("wrong epoch: %v", err)
	}
	if _, err := s.Authenticate(ctx, 999999, 0); code(err) != apperr.NotAuthenticated {
		t.Fatalf("unknown user: %v", err)
	}
}

func TestUpdateProfile(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, _ := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)

	got, err := s.UpdateProfile(ctx, u.ID, auth.ProfileUpdate{
		College: optional.Of("공과대학"), AdmissionYear: optional.Of(2021),
	}, ip)
	if err != nil || got.College == nil || *got.College != "공과대학" || got.AdmissionYear == nil || *got.AdmissionYear != 2021 {
		t.Fatalf("set: %+v %v", got, err)
	}
	got, err = s.UpdateProfile(ctx, u.ID, auth.ProfileUpdate{College: optional.Null[string]()}, ip)
	if err != nil || got.College != nil || got.AdmissionYear == nil {
		t.Fatalf("clear college only: %+v %v", got, err)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM activity_logs WHERE user_id = $1 AND action = 'profile_update'`, u.ID); n != 2 {
		t.Fatalf("profile_update entries = %d", n)
	}

	mustExec(t, pool, `UPDATE colleges SET is_active = false WHERE name = '미술대학'`)
	cases := map[string]struct {
		p    auth.ProfileUpdate
		want apperr.FieldError
	}{
		"nothing":         {auth.ProfileUpdate{}, apperr.FieldError{Field: "", Code: apperr.Required}},
		"unknown college": {auth.ProfileUpdate{College: optional.Of("없는대학")}, apperr.FieldError{Field: "college", Code: apperr.InvalidCollege}},
		"retired college": {auth.ProfileUpdate{College: optional.Of("미술대학")}, apperr.FieldError{Field: "college", Code: apperr.InvalidCollege}},
		"year too early":  {auth.ProfileUpdate{AdmissionYear: optional.Of(1979)}, apperr.FieldError{Field: "admissionYear", Code: apperr.InvalidAdmissionYear}},
		"two digits":      {auth.ProfileUpdate{AdmissionYear: optional.Of(21)}, apperr.FieldError{Field: "admissionYear", Code: apperr.InvalidAdmissionYear}},
	}
	for name, tc := range cases {
		_, err := s.UpdateProfile(ctx, u.ID, tc.p, ip)
		e, ok := apperr.As(err)
		if !ok || e.Code != apperr.ValidationFailed || len(e.Fields) != 1 || e.Fields[0] != tc.want {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestDeleteAccount(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, _ := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "김철수"}, ip)
	inst := scalar[int32](t, pool, `INSERT INTO instructors (name) VALUES ('홍길동') RETURNING id`)
	course := scalar[int64](t, pool, `INSERT INTO courses (title, instructor_id, identity_key, search_text) VALUES ('자료구조', $1, 'k1', 'x') RETURNING id`, inst)
	mustExec(t, pool, `INSERT INTO favorites (user_id, course_id, position) VALUES ($1, $2, 0)`, u.ID, course)

	if err := s.DeleteAccount(ctx, u.ID, ip); err != nil {
		t.Fatal(err)
	}
	if scrubbed := scalar[bool](t, pool, `
		SELECT deleted_at IS NOT NULL AND email IS NULL AND google_sub IS NULL AND display_name IS NULL AND session_epoch = 1
		FROM users WHERE id = $1`, u.ID); !scrubbed {
		t.Fatal("account not scrubbed")
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM favorites WHERE user_id = $1`, u.ID); n != 0 {
		t.Fatalf("favorites left: %d", n)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM activity_logs WHERE user_id = $1 AND action = 'account_delete'`, u.ID); n != 1 {
		t.Fatalf("account_delete entries = %d", n)
	}
	if _, err := s.Authenticate(ctx, u.ID, 1); code(err) != apperr.NotAuthenticated {
		t.Fatalf("deleted account authenticated: %v", err)
	}
	if err := s.DeleteAccount(ctx, u.ID, ip); code(err) != apperr.NotAuthenticated {
		t.Fatalf("second delete: %v", err)
	}
	again, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr"}, ip)
	if err != nil || again.ID == u.ID {
		t.Fatalf("signing in again must make a new account: %+v %v", again, err)
	}
}

func TestLogoutAll(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, _ := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)
	if err := s.LogoutAll(ctx, u.ID, ip); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, u.ID, u.SessionEpoch); code(err) != apperr.NotAuthenticated {
		t.Fatalf("old epoch still valid: %v", err)
	}
	if _, err := s.Authenticate(ctx, u.ID, u.SessionEpoch+1); err != nil {
		t.Fatalf("new epoch: %v", err)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM activity_logs WHERE user_id = $1 AND action = 'logout_all'`, u.ID); n != 1 {
		t.Fatalf("logout_all entries = %d", n)
	}
}
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `go test ./internal/auth/`
Expected: FAIL (패키지가 없음)

- [ ] **Step 4: 구현**

`internal/auth/auth.go`:

```go
// Package auth owns accounts: signing in, checking a session against the
// account, the voluntary profile, and ending sessions or the account.
package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/netip"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/db"
	"github.com/snuarchive/snuarchive/internal/db/dbq"
	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/optional"
)

const emailDomain = "@snu.ac.kr"

// User is a live account as the rest of the server sees it.
type User struct {
	ID            int64
	Email         string
	DisplayName   *string
	IsAdmin       bool // DB flag or ADMIN_EMAILS
	College       *string
	AdmissionYear *int
	SessionEpoch  int32
}

// Identity is a verified Google account allowed to sign in.
type Identity struct {
	Subject string
	Email   string // lower-case, @snu.ac.kr
	Name    string
}

// FromGoogle accepts only verified @snu.ac.kr accounts of the snu.ac.kr
// Workspace. The hd claim is what proves Workspace membership; the hd
// parameter on the sign-in page is only a hint.
func FromGoogle(g google.Identity) (Identity, bool) {
	email := strings.ToLower(strings.TrimSpace(g.Email))
	if !g.EmailVerified || g.HostedDomain != google.HostedDomain || !ValidEmail(email) || g.Subject == "" {
		return Identity{}, false
	}
	return Identity{Subject: g.Subject, Email: email, Name: strings.TrimSpace(g.Name)}, true
}

// ValidEmail reports whether email is a lower-case school address.
func ValidEmail(email string) bool {
	local, ok := strings.CutSuffix(email, emailDomain)
	return ok && local != "" && !strings.Contains(local, "@") && email == strings.ToLower(email)
}

var studentID = regexp.MustCompile(`^((?:19|20)\d{2})-\d{5}$`)

// SuggestedAdmissionYear guesses the admission year from a student-number
// style local part (2021-12345@snu.ac.kr), for pre-filling the profile.
func SuggestedAdmissionYear(email string, now time.Time) *int {
	local, _, _ := strings.Cut(email, "@")
	m := studentID.FindStringSubmatch(local)
	if m == nil {
		return nil
	}
	y, _ := strconv.Atoi(m[1])
	if y < 1980 || y > now.Year() {
		return nil
	}
	return &y
}

// Profile changes: an absent field is left alone, null clears it.
type ProfileUpdate struct {
	College       optional.Field[string] `json:"college"`
	AdmissionYear optional.Field[int]    `json:"admissionYear"`
}

type Service struct {
	pool   *pgxpool.Pool
	admins []string
	log    *slog.Logger
}

func NewService(pool *pgxpool.Pool, adminEmails []string, log *slog.Logger) *Service {
	return &Service{pool: pool, admins: adminEmails, log: log}
}

func unauthenticated() error { return apperr.New(apperr.NotAuthenticated) }

// errEmailHeld: the address belongs to a row with no Google sub (made by
// dev login or a data import) while this Google account already has a row
// of its own. The two cannot be merged automatically.
var errEmailHeld = errors.New("auth: email held by an account without a Google sub")

// SignInGoogle finds the account by Google sub, or links or creates one.
//   - A known sub: its email is brought up to date. If another account
//     holds that email, the other account is a previous holder of a
//     reissued address and gives it up (it keeps its own sub).
//   - An unknown sub whose email belongs to an account without a sub: that
//     account is claimed (a first Google sign-in after dev login or import).
//   - An unknown sub whose email belongs to another sub: the address was
//     reissued; the old account gives it up and a new account is made.
//
// The display name is stored only when the account is created.
func (s *Service) SignInGoogle(ctx context.Context, id Identity, ip netip.Addr) (User, error) {
	var out dbq.User
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		for _, k := range []string{"sub:" + id.Subject, "email:" + id.Email} {
			if err := q.LockSignIn(ctx, k); err != nil {
				return err
			}
		}
		ipp := addrPtr(ip)
		bySub, err := q.GetLiveUserBySub(ctx, &id.Subject)
		switch {
		case err == nil:
			if bySub.Email == nil || *bySub.Email != id.Email {
				if err := releaseEmail(ctx, q, id.Email, bySub.ID); err != nil {
					return err
				}
			}
			out, err = q.RecordSignIn(ctx, dbq.RecordSignInParams{ID: bySub.ID, Email: &id.Email, GoogleSub: &id.Subject, LastIp: ipp})
			return err
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		byEmail, err := q.GetLiveUserByEmail(ctx, &id.Email)
		switch {
		case err == nil && byEmail.GoogleSub == nil:
			out, err = q.RecordSignIn(ctx, dbq.RecordSignInParams{ID: byEmail.ID, Email: &id.Email, GoogleSub: &id.Subject, LastIp: ipp})
			return err
		case err == nil:
			if err := q.ReleaseEmail(ctx, byEmail.ID); err != nil {
				return err
			}
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		out, err = q.InsertUser(ctx, dbq.InsertUserParams{Email: &id.Email, GoogleSub: &id.Subject, DisplayName: nonEmpty(id.Name), LastIp: ipp})
		return err
	})
	if err != nil {
		return User{}, err
	}
	s.logBestEffort(ctx, out.ID, dbq.ActivityActionLogin, `{"provider":"google"}`, ip)
	return s.toUser(out), nil
}

// releaseEmail takes email away from any live account other than keep. Only
// an account with a Google sub can give it up; it gets its current address
// back the next time it signs in.
func releaseEmail(ctx context.Context, q *dbq.Queries, email string, keep int64) error {
	holder, err := q.GetLiveUserByEmail(ctx, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if holder.ID == keep {
		return nil
	}
	if holder.GoogleSub == nil {
		return errEmailHeld
	}
	return q.ReleaseEmail(ctx, holder.ID)
}

// SignInDev signs in by email alone (development only; the HTTP layer
// refuses the route otherwise). It never touches a Google sub.
func (s *Service) SignInDev(ctx context.Context, email string, name *string, ip netip.Addr) (User, error) {
	var out dbq.User
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := q.LockSignIn(ctx, "email:"+email); err != nil {
			return err
		}
		existing, err := q.GetLiveUserByEmail(ctx, &email)
		switch {
		case err == nil:
			out, err = q.RecordSignIn(ctx, dbq.RecordSignInParams{ID: existing.ID, Email: &email, LastIp: addrPtr(ip)})
			return err
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		out, err = q.InsertUser(ctx, dbq.InsertUserParams{Email: &email, DisplayName: name, LastIp: addrPtr(ip)})
		return err
	})
	if err != nil {
		return User{}, err
	}
	s.logBestEffort(ctx, out.ID, dbq.ActivityActionLogin, `{"provider":"dev"}`, ip)
	return s.toUser(out), nil
}

// Authenticate checks a session's account: live, same epoch, and holding an
// email (an account that gave its address up must sign in again to get its
// current one). last_seen_at is refreshed at most every ten minutes.
func (s *Service) Authenticate(ctx context.Context, uid int64, epoch int32) (User, error) {
	q := dbq.New(s.pool)
	u, err := q.GetLiveUser(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, unauthenticated()
	}
	if err != nil {
		return User{}, err
	}
	if u.SessionEpoch != epoch || u.Email == nil {
		return User{}, unauthenticated()
	}
	if err := q.TouchLastSeen(ctx, uid); err != nil {
		s.log.WarnContext(ctx, "touch last_seen_at", "user_id", uid, "err", err)
	}
	return s.toUser(u), nil
}

// UpdateProfile applies the voluntary profile fields.
func (s *Service) UpdateProfile(ctx context.Context, uid int64, p ProfileUpdate, ip netip.Addr) (User, error) {
	if !p.College.Set && !p.AdmissionYear.Set {
		return User{}, apperr.Validation(apperr.FieldError{Field: "", Code: apperr.Required})
	}
	var fields []apperr.FieldError
	var changed []string
	if p.College.Set {
		changed = append(changed, "college")
		if !p.College.Null {
			ok, err := dbq.New(s.pool).IsActiveCollege(ctx, p.College.Value)
			if err != nil {
				return User{}, err
			}
			if !ok {
				fields = append(fields, apperr.FieldError{Field: "college", Code: apperr.InvalidCollege})
			}
		}
	}
	var year *int16
	if p.AdmissionYear.Set {
		changed = append(changed, "admissionYear")
		if !p.AdmissionYear.Null {
			if y := p.AdmissionYear.Value; y < 1980 || y > 2100 {
				fields = append(fields, apperr.FieldError{Field: "admissionYear", Code: apperr.InvalidAdmissionYear})
			} else {
				v := int16(y)
				year = &v
			}
		}
	}
	if len(fields) > 0 {
		return User{}, apperr.Validation(fields...)
	}
	var out dbq.User
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		var err error
		out, err = q.UpdateProfile(ctx, dbq.UpdateProfileParams{
			ID: uid, SetCollege: p.College.Set, College: p.College.Ptr(),
			SetAdmissionYear: p.AdmissionYear.Set, AdmissionYear: year,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return unauthenticated()
		}
		if err != nil {
			return db.MapError(err)
		}
		return q.InsertActivityLog(ctx, activity(uid, dbq.ActivityActionProfileUpdate, fieldsMeta(changed), ip))
	})
	if err != nil {
		return User{}, err
	}
	return s.toUser(out), nil
}

// DeleteAccount scrubs the account: identity and profile are cleared, the
// sessions end, favourites go; contributions, open voting requests and the
// activity log stay.
func (s *Service) DeleteAccount(ctx context.Context, uid int64, ip netip.Addr) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		n, err := q.ScrubUser(ctx, uid)
		if err != nil {
			return err
		}
		if n == 0 {
			return unauthenticated()
		}
		if err := q.DeleteUserFavorites(ctx, uid); err != nil {
			return err
		}
		return q.InsertActivityLog(ctx, activity(uid, dbq.ActivityActionAccountDelete, `{}`, ip))
	})
}

// LogoutAll ends every session of the account by moving its epoch.
func (s *Service) LogoutAll(ctx context.Context, uid int64, ip netip.Addr) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if _, err := q.BumpSessionEpoch(ctx, uid); errors.Is(err, pgx.ErrNoRows) {
			return unauthenticated()
		} else if err != nil {
			return err
		}
		return q.InsertActivityLog(ctx, activity(uid, dbq.ActivityActionLogoutAll, `{}`, ip))
	})
}

// logBestEffort records a sign-in outside the sign-in transaction: a log
// failure must not stop someone signing in (design spec §7).
func (s *Service) logBestEffort(ctx context.Context, uid int64, action dbq.ActivityAction, meta string, ip netip.Addr) {
	if err := dbq.New(s.pool).InsertActivityLog(ctx, activity(uid, action, meta, ip)); err != nil {
		s.log.WarnContext(ctx, "activity log", "action", action, "user_id", uid, "err", err)
	}
}

func activity(uid int64, action dbq.ActivityAction, meta string, ip netip.Addr) dbq.InsertActivityLogParams {
	return dbq.InsertActivityLogParams{UserID: &uid, Action: action, Metadata: []byte(meta), Ip: addrPtr(ip)}
}

func fieldsMeta(fields []string) string {
	quoted := make([]string, len(fields))
	for i, f := range fields {
		quoted[i] = strconv.Quote(f)
	}
	return `{"fields":[` + strings.Join(quoted, ",") + `]}`
}

func (s *Service) toUser(u dbq.User) User {
	out := User{
		ID:           u.ID,
		DisplayName:  u.DisplayName,
		College:      u.College,
		SessionEpoch: u.SessionEpoch,
	}
	if u.Email != nil {
		out.Email = *u.Email
	}
	out.IsAdmin = u.IsAdmin || (out.Email != "" && slices.Contains(s.admins, out.Email))
	if u.AdmissionYear != nil {
		y := int(*u.AdmissionYear)
		out.AdmissionYear = &y
	}
	return out
}

func addrPtr(ip netip.Addr) *netip.Addr {
	if !ip.IsValid() {
		return nil
	}
	return &ip
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
```

- [ ] **Step 5: 통과 확인**

Run: `go test ./internal/auth/ && make check`
Expected: PASS. 확인되는 동작:
- 새 계정과 재로그인(이름은 처음 값 유지)
- 재발급된 주소는 새 주인에게 새 계정으로 가고, 이전 주인은 sub로 계정을 유지하다가 로그인 때 현재 주소를 되찾음
- dev-login으로 만든 계정은 첫 Google 로그인이 이어받음
- sub 없는 계정이 가진 주소로 바꾸려는 로그인은 거부
- 관리자: env 또는 DB
- 세션 확인, 프로필 검증, 탈퇴 스크럽, 모든 기기 로그아웃

- [ ] **Step 6: 커밋**

```bash
git add db/queries/users.sql internal/db/dbq/users.sql.go internal/auth
git commit -m "Add the account service: sign-in by Google sub, profile, deletion, logout-all"
```

---

### Task 7: HTTP 계정 라우트

**Files:**
- Create: `internal/httpapi/cookies.go`, `internal/httpapi/next.go`, `internal/httpapi/accounts.go`
- Modify: `internal/httpapi/server.go` (Deps와 라우트 등록)
- Test: `internal/httpapi/next_test.go`, `internal/httpapi/accounts_test.go`

**Interfaces:**
- Consumes: `session.*`(Task 4), `google.Identity`(Task 5), `auth.*`(Task 6), `calendar.CurrentTerm`, `calendar.Location`, 1단계의 `router.handle`, `originOnly()`, `decodeJSON`, `writeError`, `writeJSON`, `ClientIP`, `RequestID`, `devLoginEnabled`, `CSRFCookie`
- Produces:
  - `httpapi.Accounts` 인터페이스(auth.Service의 6개 메서드), `httpapi.GoogleSignIn` 인터페이스(`AuthCodeURL`, `Exchange`)
  - `httpapi.Deps`에 `Accounts Accounts`, `Google GoogleSignIn`(nil이면 Google 경로가 `/?auth=error`), `Now func() time.Time`(nil이면 `time.Now`)
  - `httpapi.SessionCookie = "snu_session"`
  - 라우트:
    - `GET /api/v1/auth/google`, `GET /api/v1/auth/google/callback`
    - `POST /api/v1/auth/logout` (Origin만)
    - `POST /api/v1/auth/dev-login` (개발 모드에서만 등록, Origin만)
    - `GET|PATCH|DELETE /api/v1/me`, `POST /api/v1/me/logout-all`

동작 요약(구현이 지켜야 할 것):
- 인증이 필요한 라우트는 세션 쿠키 → `Accounts.Authenticate` 순으로 확인한다. 실패하면 401이고, 쓸 수 없게 된 세션 쿠키는 지운다.
- 남은 시간이 TTL의 절반 아래면 응답에 새 세션 쿠키를 싣는다.
- `GET /me`는 `snu_csrf`가 없을 때만 새로 준다.
- `DELETE /me`는 인증을 확인한 뒤 `X-Confirm-Delete: true`를 요구한다(없으면 428).

- [ ] **Step 1: 실패하는 테스트 작성**

`internal/httpapi/next_test.go` (같은 패키지 `httpapi`):

```go
package httpapi

import (
	"strings"
	"testing"
)

func TestSafeNext(t *testing.T) {
	const app = "https://archive.example.com"
	for _, ok := range []string{
		"/", "/courses/12", "/courses/12?tab=stats", "/search?q=%EB%AF%B8%EC%A0%81%EB%B6%84", "/a#b", "/%2F%2Fevil",
	} {
		if got, accepted := safeNext(ok, app); !accepted || got != ok {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{
		"", "courses", "//evil.example", "/\\evil.example", "/x\\y", "https://evil.example/",
		"/\t/evil.example", "/a b", "/a\x00", "/a\x7f", "/" + strings.Repeat("a", 2048),
	} {
		if _, accepted := safeNext(bad, app); accepted {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestWithAuthOK(t *testing.T) {
	for in, want := range map[string]string{
		"/":                "/?auth=ok",
		"/courses/12":      "/courses/12?auth=ok",
		"/search?q=x":      "/search?q=x&auth=ok",
		"/search?q=x#top":  "/search?q=x&auth=ok#top",
		"/a#b":             "/a?auth=ok#b",
		"/search?":         "/search?auth=ok",
		"/search?q=x&":     "/search?q=x&auth=ok",
		"/p?q=%20#frag?x=": "/p?q=%20&auth=ok#frag?x=",
	} {
		if got := withAuthOK(in); got != want {
			t.Errorf("withAuthOK(%q) = %q, want %q", in, got, want)
		}
	}
}
```

`internal/httpapi/accounts_test.go` (외부 패키지 `httpapi_test`, 계약 검증기로 요청·응답을 모두 검사):

```go
package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/auth"
	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/httpapi"
	"github.com/snuarchive/snuarchive/internal/testutil/contract"
	"github.com/snuarchive/snuarchive/internal/testutil/fakegoogle"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

const appOrigin = "http://localhost"

type env struct {
	srv  *httpapi.Server
	fake *fakegoogle.Server
	spec *contract.Spec
	now  time.Time
}

type envOption func(*config.Config)

func withDevLogin(c *config.Config) { c.Env, c.DevLoginEnabled = config.Development, true }

func newEnv(t *testing.T, opts ...envOption) *env {
	t.Helper()
	pool := pgtest.New(t)
	cfg := &config.Config{
		Env:       config.Production,
		AppOrigin: appOrigin,
		Session: config.Session{
			Keys: [][]byte{bytes.Repeat([]byte("k"), 32)},
			TTL:  7 * 24 * time.Hour, MaxAge: 30 * 24 * time.Hour,
		},
	}
	for _, o := range opts {
		o(cfg)
	}
	e := &env{fake: fakegoogle.New(t), spec: contract.Load(t), now: time.Now()}
	log := slog.New(slog.DiscardHandler)
	e.srv = httpapi.New(httpapi.Deps{
		Config:   cfg,
		Logger:   log,
		DB:       pool,
		Accounts: auth.NewService(pool, []string{"boss@snu.ac.kr"}, log),
		Google:   google.New(context.Background(), e.fake.Options(appOrigin+"/api/v1/auth/google/callback")),
		Now:      func() time.Time { return e.now },
	})
	return e
}

// cookies turns a response's Set-Cookie headers into a name → cookie map.
func cookies(rec *httptest.ResponseRecorder) map[string]*http.Cookie {
	out := map[string]*http.Cookie{}
	for _, c := range rec.Result().Cookies() {
		out[c.Name] = c
	}
	return out
}

func header(cs ...*http.Cookie) http.Header {
	h := http.Header{}
	for _, c := range cs {
		if c != nil {
			h.Add("Cookie", c.Name+"="+c.Value)
		}
	}
	return h
}

func unsafeHeader(session, csrf *http.Cookie) http.Header {
	h := header(session, csrf)
	h.Set("Origin", appOrigin)
	h.Set("Content-Type", "application/json")
	if csrf != nil {
		h.Set("X-CSRF-Token", csrf.Value)
	}
	return h
}

// signIn runs the whole Google flow for claims and returns the callback
// response. Claims.Nonce is filled from the authorization URL.
func (e *env) signIn(t *testing.T, next string, c fakegoogle.Claims) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/v1/auth/google"
	if next != "" {
		path += "?next=" + url.QueryEscape(next)
	}
	start := e.spec.Do(t, e.srv, http.MethodGet, path, nil, nil)
	if start.Code != http.StatusFound {
		t.Fatalf("start: %d", start.Code)
	}
	loc, _ := url.Parse(start.Header().Get("Location"))
	q := loc.Query()
	state := cookies(start)["snu_oauth"]
	if state == nil || state.Path != "/api/v1/auth/google" || !state.HttpOnly {
		t.Fatalf("state cookie = %+v", state)
	}
	c.Nonce = q.Get("nonce")
	e.fake.Grant("code-1", q.Get("code_challenge"), c)
	cb := "/api/v1/auth/google/callback?code=code-1&state=" + url.QueryEscape(q.Get("state"))
	return e.spec.Do(t, e.srv, http.MethodGet, cb, nil, header(state))
}

var kim = fakegoogle.Claims{Subject: "1001", Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr", Name: "김철수"}

func TestGoogleSignInFlow(t *testing.T) {
	e := newEnv(t)
	rec := e.signIn(t, "/courses/12?tab=stats#top", kim)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != appOrigin+"/courses/12?tab=stats&auth=ok#top" {
		t.Fatalf("callback: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	cs := cookies(rec)
	sess, csrf := cs["snu_session"], cs["snu_csrf"]
	if sess == nil || !sess.HttpOnly || sess.SameSite != http.SameSiteLaxMode || sess.Path != "/" {
		t.Fatalf("session cookie = %+v", sess)
	}
	if csrf == nil || csrf.HttpOnly || csrf.Value == "" {
		t.Fatalf("csrf cookie = %+v", csrf)
	}
	if st := cs["snu_oauth"]; st == nil || st.MaxAge >= 0 {
		t.Fatalf("state cookie must be deleted: %+v", st)
	}

	me := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf))
	var body struct {
		Email       string  `json:"email"`
		DisplayName *string `json:"displayName"`
		IsAdmin     bool    `json:"isAdmin"`
		Calendar    struct {
			Timezone string `json:"timezone"`
		} `json:"calendar"`
	}
	if err := json.Unmarshal(me.Body.Bytes(), &body); err != nil || me.Code != 200 {
		t.Fatalf("me: %d %s", me.Code, me.Body.String())
	}
	if body.Email != "kim@snu.ac.kr" || body.DisplayName == nil || *body.DisplayName != "김철수" || body.IsAdmin || body.Calendar.Timezone != "Asia/Seoul" {
		t.Fatalf("me = %s", me.Body.String())
	}
}

func TestGoogleCallbackOutcomes(t *testing.T) {
	cases := []struct {
		name   string
		next   string
		claims fakegoogle.Claims
		want   string
	}{
		{"no next", "", kim, "/?auth=ok"},
		{"unsafe next ignored", "//evil.example", kim, "/?auth=ok"},
		{"personal account", "", fakegoogle.Claims{Subject: "9", Email: "kim@gmail.com", EmailVerified: true}, "/?auth=forbidden"},
		{"unverified", "", fakegoogle.Claims{Subject: "9", Email: "kim@snu.ac.kr", HostedDomain: "snu.ac.kr"}, "/?auth=forbidden"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			rec := e.signIn(t, tc.next, tc.claims)
			if got := rec.Header().Get("Location"); got != appOrigin+tc.want {
				t.Fatalf("Location = %s", got)
			}
		})
	}
}

func TestGoogleCallbackFailures(t *testing.T) {
	e := newEnv(t)
	start := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/auth/google", nil, nil)
	state := cookies(start)["snu_oauth"]
	loc, _ := url.Parse(start.Header().Get("Location"))
	realState := loc.Query().Get("state")

	cases := []struct {
		name, query string
		cookie      *http.Cookie
		want        string
	}{
		{"declined", "error=access_denied&state=" + realState, state, "/?auth=cancelled"},
		{"provider error", "error=server_error&state=" + realState, state, "/?auth=error"},
		{"state mismatch", "code=c&state=forged", state, "/?auth=error"},
		{"no state cookie", "code=c&state=" + realState, nil, "/?auth=error"},
		{"unknown code", "code=nope&state=" + realState, state, "/?auth=error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/auth/google/callback?"+tc.query, nil, header(tc.cookie))
			if got := rec.Header().Get("Location"); rec.Code != http.StatusFound || got != appOrigin+tc.want {
				t.Fatalf("%d %s", rec.Code, got)
			}
			if _, ok := cookies(rec)["snu_session"]; ok {
				t.Fatal("a failed callback must not start a session")
			}
		})
	}
}

// devSignIn signs in through dev login and returns the two cookies.
func (e *env) devSignIn(t *testing.T, email string) (*http.Cookie, *http.Cookie) {
	t.Helper()
	body := []byte(`{"email":"` + email + `","displayName":"개발자"}`)
	h := http.Header{"Origin": {appOrigin}, "Content-Type": {"application/json"}}
	rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/dev-login", body, h)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("dev login: %d %s", rec.Code, rec.Body.String())
	}
	cs := cookies(rec)
	return cs["snu_session"], cs["snu_csrf"]
}

func TestDevLogin(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "Boss@SNU.ac.kr")
	me := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf))
	if !strings.Contains(me.Body.String(), `"isAdmin":true`) || !strings.Contains(me.Body.String(), `"email":"boss@snu.ac.kr"`) {
		t.Fatalf("me = %s", me.Body.String())
	}

	h := http.Header{"Origin": {appOrigin}, "Content-Type": {"application/json"}}
	if rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/dev-login", []byte(`{"email":"kim@gmail.com"}`), h); rec.Code != 422 ||
		!strings.Contains(rec.Body.String(), `"code":"INVALID_EMAIL"`) {
		t.Fatalf("non-snu email: %d %s", rec.Code, rec.Body.String())
	}
	h.Set("Origin", "https://evil.example")
	if rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/dev-login", []byte(`{"email":"kim@snu.ac.kr"}`), h); rec.Code != 403 {
		t.Fatalf("foreign origin: %d", rec.Code)
	}
}

func TestDevLoginIsAbsentOutsideDevelopment(t *testing.T) {
	e := newEnv(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/dev-login", strings.NewReader(`{"email":"kim@snu.ac.kr"}`))
	req.Header.Set("Origin", appOrigin)
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestMeNeedsAWorkingSession(t *testing.T) {
	e := newEnv(t, withDevLogin)
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, nil); rec.Code != 401 {
		t.Fatalf("no cookie: %d", rec.Code)
	}
	forged := &http.Cookie{Name: "snu_session", Value: "eyJ1aWQiOjF9.AAAA"}
	rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(forged))
	if rec.Code != 401 || cookies(rec)["snu_session"] == nil || cookies(rec)["snu_session"].MaxAge >= 0 {
		t.Fatalf("forged cookie: %d, must be cleared", rec.Code)
	}
}

func TestMeReissuesAMissingCSRFCookie(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess)); cookies(rec)["snu_csrf"] == nil {
		t.Fatal("csrf cookie not re-issued")
	}
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf)); cookies(rec)["snu_csrf"] != nil {
		t.Fatal("an existing csrf cookie must be left alone")
	}
}

func TestSessionRenewal(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf)); cookies(rec)["snu_session"] != nil {
		t.Fatal("renewed a fresh session")
	}
	e.now = e.now.Add(4 * 24 * time.Hour)
	rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf))
	renewed := cookies(rec)["snu_session"]
	if rec.Code != 200 || renewed == nil || renewed.MaxAge != int((7*24*time.Hour)/time.Second) {
		t.Fatalf("renewal: %d %+v", rec.Code, renewed)
	}
	e.now = e.now.Add(5 * 24 * time.Hour) // day 9: the first cookie ended on day 7, the renewed one runs to day 11
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf)); rec.Code != 401 {
		t.Fatalf("the old cookie outlived its expiry: %d", rec.Code)
	}
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(renewed, csrf)); rec.Code != 200 {
		t.Fatalf("the renewed cookie: %d", rec.Code)
	}
}

func TestUpdateMe(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	rec := e.spec.Do(t, e.srv, http.MethodPatch, "/api/v1/me", []byte(`{"college":"공과대학","admissionYear":2021}`), unsafeHeader(sess, csrf))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"college":"공과대학"`) {
		t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.spec.Do(t, e.srv, http.MethodPatch, "/api/v1/me", []byte(`{"college":null}`), unsafeHeader(sess, csrf))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"college":null`) || !strings.Contains(rec.Body.String(), `"admissionYear":2021`) {
		t.Fatalf("clear college: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.spec.Do(t, e.srv, http.MethodPatch, "/api/v1/me", []byte(`{"college":"없는대학"}`), unsafeHeader(sess, csrf))
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), `"code":"INVALID_COLLEGE"`) {
		t.Fatalf("bad college: %d %s", rec.Code, rec.Body.String())
	}
	h := unsafeHeader(sess, csrf)
	h.Del("X-CSRF-Token")
	if rec := e.spec.Do(t, e.srv, http.MethodPatch, "/api/v1/me", []byte(`{"college":null}`), h); rec.Code != 403 {
		t.Fatalf("without csrf token: %d", rec.Code)
	}
}

func TestDeleteMe(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	// The contract marks the header required, so this request goes straight
	// to the server instead of through the contract check.
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/me", nil)
	req.Header = unsafeHeader(sess, csrf)
	unconfirmed := httptest.NewRecorder()
	e.srv.ServeHTTP(unconfirmed, req)
	if unconfirmed.Code != 428 {
		t.Fatalf("without confirmation: %d", unconfirmed.Code)
	}
	h := unsafeHeader(sess, csrf)
	h.Set("X-Confirm-Delete", "true")
	rec := e.spec.Do(t, e.srv, http.MethodDelete, "/api/v1/me", nil, h)
	if rec.Code != 204 || cookies(rec)["snu_session"].MaxAge >= 0 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf)); rec.Code != 401 {
		t.Fatalf("session survived deletion: %d", rec.Code)
	}
}

func TestLogoutAllAndLogout(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	other, _ := e.devSignIn(t, "kim@snu.ac.kr")
	if rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/me/logout-all", nil, unsafeHeader(sess, csrf)); rec.Code != 204 {
		t.Fatalf("logout-all: %d", rec.Code)
	}
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(other)); rec.Code != 401 {
		t.Fatalf("another device survived logout-all: %d", rec.Code)
	}

	rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/logout", nil, http.Header{"Origin": {appOrigin}})
	if rec.Code != 204 || cookies(rec)["snu_session"] == nil || cookies(rec)["snu_csrf"] == nil {
		t.Fatalf("logout without a session: %d", rec.Code)
	}
	if rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/logout", nil, http.Header{"Origin": {"https://evil.example"}}); rec.Code != 403 {
		t.Fatalf("logout from a foreign origin: %d", rec.Code)
	}
}
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `go test ./internal/httpapi/`
Expected: FAIL (`safeNext`, `httpapi.Deps.Accounts` 등이 없음)

- [ ] **Step 3: 구현**

`internal/httpapi/cookies.go`:

```go
package httpapi

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"github.com/snuarchive/snuarchive/internal/session"
)

const (
	SessionCookie = "snu_session"
	stateCookie   = "snu_oauth"
	statePath     = apiPrefix + "/auth/google" // covers the callback, nothing else

	sessionPurpose = "session"
	statePurpose   = "oauth-state"
	stateTTL       = 10 * time.Minute
)

// cookieJar issues and reads the server's cookies. Secure follows the app
// origin, so plain-http development still works.
type cookieJar struct {
	codec  *session.Codec
	policy session.Policy
	secure bool
}

func newCookieJar(keys [][]byte, policy session.Policy, appOrigin string) cookieJar {
	return cookieJar{
		codec:  session.NewCodec(keys),
		policy: policy,
		secure: strings.HasPrefix(appOrigin, "https://"),
	}
}

func (j cookieJar) cookie(name, value, path string, maxAge int, httpOnly bool) *http.Cookie {
	return &http.Cookie{
		Name: name, Value: value, Path: path, MaxAge: maxAge,
		HttpOnly: httpOnly, Secure: j.secure, SameSite: http.SameSiteLaxMode,
	}
}

func (j cookieJar) setSession(w http.ResponseWriter, s session.Session, now time.Time) error {
	tok, err := j.codec.Seal(sessionPurpose, s)
	if err != nil {
		return err
	}
	http.SetCookie(w, j.cookie(SessionCookie, tok, "/", int(s.Exp-now.Unix()), true))
	return nil
}

// readSession returns the session cookie's content if it is authentic and
// not expired. Whether the account still accepts it is the caller's check.
func (j cookieJar) readSession(r *http.Request, now time.Time) (session.Session, bool) {
	c, err := r.Cookie(SessionCookie)
	if err != nil {
		return session.Session{}, false
	}
	var s session.Session
	if j.codec.Open(sessionPurpose, c.Value, &s) != nil || !j.policy.Valid(s, now) {
		return session.Session{}, false
	}
	return s, true
}

// setCSRF issues a new double-submit token, readable by scripts. It lives
// as long as a session can.
func (j cookieJar) setCSRF(w http.ResponseWriter) {
	http.SetCookie(w, j.cookie(CSRFCookie, randomToken(), "/", int(j.policy.MaxAge/time.Second), false))
}

// clear removes the session and CSRF cookies.
func (j cookieJar) clear(w http.ResponseWriter) {
	http.SetCookie(w, j.cookie(SessionCookie, "", "/", -1, true))
	http.SetCookie(w, j.cookie(CSRFCookie, "", "/", -1, false))
}

// oauthState travels in a signed cookie from /auth/google to the callback.
type oauthState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"` // PKCE code verifier
	Next     string `json:"x,omitempty"`
	Exp      int64  `json:"e"`
}

func (j cookieJar) setState(w http.ResponseWriter, st oauthState) error {
	tok, err := j.codec.Seal(statePurpose, st)
	if err != nil {
		return err
	}
	http.SetCookie(w, j.cookie(stateCookie, tok, statePath, int(stateTTL/time.Second), true))
	return nil
}

// takeState reads the state cookie and always deletes it: a state is good
// for one callback.
func (j cookieJar) takeState(w http.ResponseWriter, r *http.Request, now time.Time) (oauthState, bool) {
	http.SetCookie(w, j.cookie(stateCookie, "", statePath, -1, true))
	c, err := r.Cookie(stateCookie)
	if err != nil {
		return oauthState{}, false
	}
	var st oauthState
	if j.codec.Open(statePurpose, c.Value, &st) != nil || now.Unix() >= st.Exp {
		return oauthState{}, false
	}
	return st, true
}

// randomToken returns 32 random bytes as base64url: 43 characters, which is
// also a valid PKCE code verifier (RFC 7636 §4.1).
func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
```

`internal/httpapi/next.go`:

```go
package httpapi

import (
	"net/url"
	"strings"
)

const maxNextLength = 2048

// safeNext accepts a same-origin path to return to after signing in (design
// spec §5.1): it starts with "/", its second character is not "/" or "\",
// it has no "\" anywhere, no control characters, DEL or spaces, and resolved
// against the app origin it stays on that origin. Anything else is refused,
// which closes the open-redirect forms browsers accept ("//evil",
// "/\evil", "/\t/evil").
func safeNext(next, appOrigin string) (string, bool) {
	if next == "" || len(next) > maxNextLength || next[0] != '/' {
		return "", false
	}
	if len(next) > 1 && (next[1] == '/' || next[1] == '\\') {
		return "", false
	}
	for _, r := range next {
		if r == '\\' || r <= 0x20 || r == 0x7f {
			return "", false
		}
	}
	base, err := url.Parse(appOrigin + "/")
	if err != nil {
		return "", false
	}
	u, err := base.Parse(next)
	if err != nil || u.Scheme != base.Scheme || u.Host != base.Host {
		return "", false
	}
	return next, true
}

// withAuthOK adds auth=ok to the query of a path from safeNext, keeping the
// existing query and fragment as written.
func withAuthOK(next string) string {
	pathQuery, fragment, hasFragment := strings.Cut(next, "#")
	sep := "?"
	if strings.Contains(pathQuery, "?") {
		sep = "&"
		if strings.HasSuffix(pathQuery, "?") || strings.HasSuffix(pathQuery, "&") {
			sep = ""
		}
	}
	out := pathQuery + sep + "auth=ok"
	if hasFragment {
		out += "#" + fragment
	}
	return out
}
```

`internal/httpapi/accounts.go`:

```go
package httpapi

import (
	"context"
	"crypto/subtle"
	"net/http"
	"net/netip"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/auth"
	"github.com/snuarchive/snuarchive/internal/calendar"
	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/session"
)

// Accounts is the part of auth.Service the HTTP layer uses.
type Accounts interface {
	SignInGoogle(ctx context.Context, id auth.Identity, ip netip.Addr) (auth.User, error)
	SignInDev(ctx context.Context, email string, name *string, ip netip.Addr) (auth.User, error)
	Authenticate(ctx context.Context, uid int64, epoch int32) (auth.User, error)
	UpdateProfile(ctx context.Context, uid int64, p auth.ProfileUpdate, ip netip.Addr) (auth.User, error)
	DeleteAccount(ctx context.Context, uid int64, ip netip.Addr) error
	LogoutAll(ctx context.Context, uid int64, ip netip.Addr) error
}

// GoogleSignIn is the part of google.Client the HTTP layer uses.
type GoogleSignIn interface {
	AuthCodeURL(state, nonce, verifier string) string
	Exchange(ctx context.Context, code, verifier, nonce string) (google.Identity, error)
}

const displayNameMaxLength = 120

type accountAPI struct {
	d   Deps
	jar cookieJar
	now func() time.Time
}

func newAccountAPI(d Deps) *accountAPI {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	policy := session.Policy{TTL: d.Config.Session.TTL, MaxAge: d.Config.Session.MaxAge}
	return &accountAPI{d: d, jar: newCookieJar(d.Config.Session.Keys, policy, d.Config.AppOrigin), now: now}
}

func (a *accountAPI) register(rt *router) {
	rt.handle(http.MethodGet, apiPrefix+"/auth/google", http.HandlerFunc(a.startGoogle))
	rt.handle(http.MethodGet, apiPrefix+"/auth/google/callback", http.HandlerFunc(a.googleCallback))
	rt.handle(http.MethodPost, apiPrefix+"/auth/logout", http.HandlerFunc(a.logout), originOnly())
	if devLoginEnabled(a.d.Config) {
		rt.handle(http.MethodPost, apiPrefix+"/auth/dev-login", http.HandlerFunc(a.devLogin), originOnly())
	}
	rt.handle(http.MethodGet, apiPrefix+"/me", a.authed(a.getMe))
	rt.handle(http.MethodPatch, apiPrefix+"/me", a.authed(a.updateMe))
	rt.handle(http.MethodDelete, apiPrefix+"/me", a.authed(a.deleteMe))
	rt.handle(http.MethodPost, apiPrefix+"/me/logout-all", a.authed(a.logoutAll))
}

// authed resolves the session to a live account, renewing the cookie when
// it is past half its lifetime. A cookie that no longer works is cleared.
func (a *accountAPI) authed(next func(http.ResponseWriter, *http.Request, auth.User)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		now := a.now()
		s, ok := a.jar.readSession(r, now)
		if !ok {
			if _, err := r.Cookie(SessionCookie); err == nil {
				a.jar.clear(w)
			}
			writeError(w, r, a.d.Logger, apperr.New(apperr.NotAuthenticated))
			return
		}
		u, err := a.d.Accounts.Authenticate(r.Context(), s.UID, s.Epoch)
		if err != nil {
			if e, ok := apperr.As(err); ok && e.Code == apperr.NotAuthenticated {
				a.jar.clear(w)
			}
			writeError(w, r, a.d.Logger, err)
			return
		}
		if renewed, ok := a.jar.policy.Renew(s, now); ok {
			if err := a.jar.setSession(w, renewed, now); err != nil {
				writeError(w, r, a.d.Logger, err)
				return
			}
		}
		next(w, r, u)
	})
}

// startSession sets both cookies for a fresh sign-in.
func (a *accountAPI) startSession(w http.ResponseWriter, u auth.User) error {
	now := a.now()
	if err := a.jar.setSession(w, a.jar.policy.New(u.ID, u.SessionEpoch, now), now); err != nil {
		return err
	}
	a.jar.setCSRF(w)
	return nil
}

func (a *accountAPI) redirect(w http.ResponseWriter, r *http.Request, path string) {
	http.Redirect(w, r, a.d.Config.AppOrigin+path, http.StatusFound)
}

func (a *accountAPI) startGoogle(w http.ResponseWriter, r *http.Request) {
	if a.d.Google == nil {
		a.d.Logger.WarnContext(r.Context(), "google sign-in is not configured")
		a.redirect(w, r, "/?auth=error")
		return
	}
	next, _ := safeNext(r.URL.Query().Get("next"), a.d.Config.AppOrigin)
	st := oauthState{
		State: randomToken(), Nonce: randomToken(), Verifier: randomToken(),
		Next: next, Exp: a.now().Add(stateTTL).Unix(),
	}
	if err := a.jar.setState(w, st); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	http.Redirect(w, r, a.d.Google.AuthCodeURL(st.State, st.Nonce, st.Verifier), http.StatusFound)
}

// googleCallback always ends in a redirect: failures go to /?auth=cancelled
// (the user declined on Google's page), /?auth=forbidden (not a verified
// snu.ac.kr account) or /?auth=error (anything else).
func (a *accountAPI) googleCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	st, haveState := a.jar.takeState(w, r, a.now())
	if e := q.Get("error"); e != "" {
		if e == "access_denied" {
			a.redirect(w, r, "/?auth=cancelled")
		} else {
			a.d.Logger.WarnContext(ctx, "google sign-in failed", "error", e)
			a.redirect(w, r, "/?auth=error")
		}
		return
	}
	if !haveState || subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(st.State)) != 1 {
		a.d.Logger.WarnContext(ctx, "google callback without a matching state")
		a.redirect(w, r, "/?auth=error")
		return
	}
	if a.d.Google == nil {
		a.redirect(w, r, "/?auth=error")
		return
	}
	g, err := a.d.Google.Exchange(ctx, q.Get("code"), st.Verifier, st.Nonce)
	if err != nil {
		a.d.Logger.WarnContext(ctx, "google token exchange", "err", err)
		a.redirect(w, r, "/?auth=error")
		return
	}
	id, ok := auth.FromGoogle(g)
	if !ok {
		a.redirect(w, r, "/?auth=forbidden")
		return
	}
	u, err := a.d.Accounts.SignInGoogle(ctx, id, ClientIP(ctx))
	if err != nil {
		a.d.Logger.ErrorContext(ctx, "google sign-in", "err", err, "request_id", RequestID(ctx))
		a.redirect(w, r, "/?auth=error")
		return
	}
	if err := a.startSession(w, u); err != nil {
		a.d.Logger.ErrorContext(ctx, "start session", "err", err, "request_id", RequestID(ctx))
		a.redirect(w, r, "/?auth=error")
		return
	}
	next := st.Next
	if next == "" {
		next = "/"
	}
	a.redirect(w, r, withAuthOK(next))
}

func (a *accountAPI) logout(w http.ResponseWriter, _ *http.Request) {
	a.jar.clear(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *accountAPI) devLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email       *string `json:"email"`
		DisplayName *string `json:"displayName"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	if body.Email == nil {
		writeError(w, r, a.d.Logger, apperr.Validation(apperr.FieldError{Field: "email", Code: apperr.Required}))
		return
	}
	email := strings.ToLower(strings.TrimSpace(*body.Email))
	if !auth.ValidEmail(email) {
		writeError(w, r, a.d.Logger, apperr.Validation(apperr.FieldError{Field: "email", Code: apperr.InvalidEmail}))
		return
	}
	var name *string
	if body.DisplayName != nil {
		if n := strings.TrimSpace(*body.DisplayName); n != "" {
			if utf8.RuneCountInString(n) > displayNameMaxLength {
				writeError(w, r, a.d.Logger, apperr.Validation(apperr.FieldError{Field: "displayName", Code: apperr.TooLong}))
				return
			}
			name = &n
		}
	}
	u, err := a.d.Accounts.SignInDev(r.Context(), email, name, ClientIP(r.Context()))
	if err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	if err := a.startSession(w, u); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type termJSON struct {
	Year     int `json:"year"`
	Semester int `json:"semester"`
}

type meJSON struct {
	ID                     int64   `json:"id"`
	Email                  string  `json:"email"`
	DisplayName            *string `json:"displayName"`
	IsAdmin                bool    `json:"isAdmin"`
	College                *string `json:"college"`
	AdmissionYear          *int    `json:"admissionYear"`
	SuggestedAdmissionYear *int    `json:"suggestedAdmissionYear"`
	Calendar               struct {
		CurrentTerm termJSON `json:"currentTerm"`
		Timezone    string   `json:"timezone"`
	} `json:"calendar"`
}

func (a *accountAPI) toMeJSON(u auth.User) meJSON {
	now := a.now()
	out := meJSON{
		ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, IsAdmin: u.IsAdmin,
		College: u.College, AdmissionYear: u.AdmissionYear,
		SuggestedAdmissionYear: auth.SuggestedAdmissionYear(u.Email, now),
	}
	term := calendar.CurrentTerm(now)
	out.Calendar.CurrentTerm = termJSON{Year: term.Year, Semester: term.Semester}
	out.Calendar.Timezone = calendar.Location().String()
	return out
}

// getMe also re-issues a missing CSRF cookie, so a client that lost it
// recovers without signing in again.
func (a *accountAPI) getMe(w http.ResponseWriter, r *http.Request, u auth.User) {
	if c, err := r.Cookie(CSRFCookie); err != nil || c.Value == "" {
		a.jar.setCSRF(w)
	}
	writeJSON(w, http.StatusOK, a.toMeJSON(u))
}

func (a *accountAPI) updateMe(w http.ResponseWriter, r *http.Request, u auth.User) {
	var p auth.ProfileUpdate
	if err := decodeJSON(r, &p); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	updated, err := a.d.Accounts.UpdateProfile(r.Context(), u.ID, p, ClientIP(r.Context()))
	if err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	writeJSON(w, http.StatusOK, a.toMeJSON(updated))
}

func (a *accountAPI) deleteMe(w http.ResponseWriter, r *http.Request, u auth.User) {
	if r.Header.Get("X-Confirm-Delete") != "true" {
		writeError(w, r, a.d.Logger, apperr.New(apperr.ConfirmationRequired))
		return
	}
	if err := a.d.Accounts.DeleteAccount(r.Context(), u.ID, ClientIP(r.Context())); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	a.jar.clear(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *accountAPI) logoutAll(w http.ResponseWriter, r *http.Request, u auth.User) {
	if err := a.d.Accounts.LogoutAll(r.Context(), u.ID, ClientIP(r.Context())); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	a.jar.clear(w)
	w.WriteHeader(http.StatusNoContent)
}
```

`internal/httpapi/server.go`:

```diff
diff --git a/internal/httpapi/server.go b/internal/httpapi/server.go
index 4eb112e..bb972d7 100644
--- a/internal/httpapi/server.go
+++ b/internal/httpapi/server.go
@@ -7,6 +7,7 @@ import (
 	"log/slog"
 	"net/http"
 	"slices"
+	"time"
 
 	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
 
@@ -25,10 +26,13 @@ type ConfigSource interface {
 }
 
 type Deps struct {
-	Config  *config.Config
-	Logger  *slog.Logger
-	DB      Pinger
-	RefData ConfigSource
+	Config   *config.Config
+	Logger   *slog.Logger
+	DB       Pinger
+	RefData  ConfigSource
+	Accounts Accounts
+	Google   GoogleSignIn     // nil when only dev login is configured
+	Now      func() time.Time // nil means time.Now
 }
 
 type Route struct {
@@ -51,6 +55,7 @@ func New(d Deps) *Server {
 	rt.handle(http.MethodGet, "/healthz", http.HandlerFunc(healthz))
 	rt.handle(http.MethodGet, "/readyz", readyz(d.DB))
 	rt.handle(http.MethodGet, apiPrefix+"/config", getConfig(d))
+	newAccountAPI(d).register(rt)
 
 	var h http.Handler = rt.mux
 	h = withRecover(d.Logger)(h)
```

- [ ] **Step 4: 통과 확인**

Run: `go test ./internal/httpapi/ && make check`
Expected: PASS. 기존 `TestEveryAPIRouteIsInTheContract`(빈 Config로 서버 생성)도 그대로 통과한다(O24).

- [ ] **Step 5: 커밋**

```bash
git add internal/httpapi
git commit -m "Serve sign-in, sessions and /me

Google sign-in with a signed one-shot state cookie, dev login in
development, sliding session cookies, CSRF cookie re-issue on GET /me,
profile updates, account deletion and logout on every device."
```

---

### Task 8: 서버 연결과 `dev seed` 명령

**Files:**
- Create: `internal/devseed/devseed.go`
- Test: `internal/devseed/devseed_test.go`
- Modify: `cmd/snuarchive/main.go`, `cmd/snuarchive/main_test.go`

**Interfaces:**
- Consumes: `auth.NewService`, `google.New`, `httpapi.Deps`, `db.Open`
- Produces:
  - `devseed.Seed(ctx context.Context, pool *pgxpool.Pool) error`와 상수 `devseed.AdminEmail`, `StudentEmail`, `NewbieEmail`, `ModeratorEmail`. 이후 단계는 `Seed`에 자기 테이블 적재를 더한다(O27).
  - CLI `snuarchive dev seed`. `APP_ENV`와 `DATABASE_URL`만 읽고, `APP_ENV=development`가 아니면 거부한다(종료 코드 1).

- [ ] **Step 1: 실패하는 테스트 작성**

`internal/devseed/devseed_test.go`:

```go
package devseed_test

import (
	"context"
	"testing"

	"github.com/snuarchive/snuarchive/internal/devseed"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

func TestSeedIsRepeatable(t *testing.T) {
	pool := pgtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO users (email) VALUES ('leftover@snu.ac.kr')`); err != nil {
		t.Fatal(err)
	}
	for run := range 2 {
		if err := devseed.Seed(ctx, pool); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
		var users, logins int
		var studentID int64
		var newbieProfile, moderatorAdmin bool
		err := pool.QueryRow(ctx, `
			SELECT (SELECT count(*) FROM users),
			       (SELECT count(*) FROM activity_logs WHERE action = 'login'),
			       (SELECT id FROM users WHERE email = $1),
			       (SELECT college IS NOT NULL OR admission_year IS NOT NULL FROM users WHERE email = $2),
			       (SELECT is_admin FROM users WHERE email = $3)`,
			devseed.StudentEmail, devseed.NewbieEmail, devseed.ModeratorEmail,
		).Scan(&users, &logins, &studentID, &newbieProfile, &moderatorAdmin)
		if err != nil {
			t.Fatal(err)
		}
		if users != 4 || logins != 24 || studentID != 2 || newbieProfile || !moderatorAdmin {
			t.Fatalf("run %d: users=%d logins=%d student=%d newbieProfile=%v moderatorAdmin=%v",
				run, users, logins, studentID, newbieProfile, moderatorAdmin)
		}
	}
}
```

`cmd/snuarchive/main_test.go`의 `TestServeRejectsBadConfig` 앞에 추가:

```go
func TestDevSeed(t *testing.T) {
	ctx := context.Background()
	url := pgtest.NewDatabase(t)
	if code, _, stderr := runCLI(ctx, env(map[string]string{"DATABASE_URL": url}), "dev", "seed"); code != 1 || !strings.Contains(stderr, "APP_ENV must be development") {
		t.Fatalf("without APP_ENV: %d %q", code, stderr)
	}
	prod := env(map[string]string{"DATABASE_URL": url, "APP_ENV": "production"})
	if code, _, _ := runCLI(ctx, prod, "dev", "seed"); code != 1 {
		t.Fatalf("production: %d", code)
	}
	dev := env(map[string]string{"DATABASE_URL": url, "APP_ENV": "development"})
	if code, stdout, stderr := runCLI(ctx, dev, "dev", "seed"); code != 0 || !strings.Contains(stdout, "seeded") {
		t.Fatalf("seed: %d %q %q", code, stdout, stderr)
	}
	if code, _, _ := runCLI(ctx, dev, "dev", "sow"); code != 2 {
		t.Fatalf("bad subcommand: %d", code)
	}
}
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `go test ./internal/devseed/ ./cmd/...`
Expected: FAIL (`devseed` 패키지가 없음, `dev` 명령이 unknown)

- [ ] **Step 3: 구현**

`internal/devseed/devseed.go`:

```go
// Package devseed resets a development database to a known state for manual
// testing and the frontend's end-to-end runs (open item O27). Each backend
// phase adds the rows its own tables need; reference data seeded by the
// migrations (colleges, assessment kinds) is left alone.
package devseed

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Accounts made by Seed. admin@ is an administrator only through
// ADMIN_EMAILS, as in production; moderator@ is one through the database.
const (
	AdminEmail     = "admin@snu.ac.kr"
	StudentEmail   = "student@snu.ac.kr"
	NewbieEmail    = "newbie@snu.ac.kr"
	ModeratorEmail = "moderator@snu.ac.kr"
)

// reset empties every table rows are seeded into. CASCADE reaches the tables
// that reference users (contributions, votes, favourites, the activity
// log); RESTART IDENTITY makes ids repeat from run to run.
const reset = `TRUNCATE users RESTART IDENTITY CASCADE`

// Seed resets and reloads the development data in one transaction. Times are
// relative to now so "recent" stays recent whenever it runs.
func Seed(ctx context.Context, pool *pgxpool.Pool) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, reset); err != nil {
			return err
		}
		return seedAccounts(ctx, tx)
	})
}

func seedAccounts(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO users (email, display_name, is_admin, college, admission_year, last_ip, created_at, last_seen_at) VALUES
		  ($1, '관리자',   false, NULL,       NULL, '127.0.0.1', now() - interval '400 days', now() - interval '1 hour'),
		  ($2, '김학생',   false, '공과대학', 2022, '127.0.0.1', now() - interval '200 days', now() - interval '2 hours'),
		  ($3, '새내기',   false, NULL,       NULL, '127.0.0.1', now() - interval '1 day',    now() - interval '1 day'),
		  ($4, '운영진',   true,  '자연과학대학', 2019, '127.0.0.1', now() - interval '300 days', now() - interval '3 days')`,
		AdminEmail, StudentEmail, NewbieEmail, ModeratorEmail)
	if err != nil {
		return err
	}
	// A few sign-ins spread over time, for the log screens' filters and paging.
	_, err = tx.Exec(ctx, `
		INSERT INTO activity_logs (user_id, action, metadata, ip, created_at)
		SELECT u.id, 'login', '{"provider":"dev"}', '127.0.0.1', now() - (n || ' hours')::interval
		FROM users u CROSS JOIN generate_series(1, 6) AS n`)
	return err
}
```

`cmd/snuarchive/main.go`:

```diff
diff --git a/cmd/snuarchive/main.go b/cmd/snuarchive/main.go
index 101e33e..f3311e9 100644
--- a/cmd/snuarchive/main.go
+++ b/cmd/snuarchive/main.go
@@ -16,9 +16,12 @@ import (
 
 	"github.com/pressly/goose/v3"
 
+	"github.com/snuarchive/snuarchive/internal/auth"
 	"github.com/snuarchive/snuarchive/internal/config"
 	"github.com/snuarchive/snuarchive/internal/db"
 	"github.com/snuarchive/snuarchive/internal/db/dbq"
+	"github.com/snuarchive/snuarchive/internal/devseed"
+	"github.com/snuarchive/snuarchive/internal/google"
 	"github.com/snuarchive/snuarchive/internal/httpapi"
 	"github.com/snuarchive/snuarchive/internal/refdata"
 	"github.com/snuarchive/snuarchive/internal/telemetry"
@@ -34,6 +37,7 @@ commands:
   migrate up        apply pending migrations
   migrate down --yes   roll back the most recent migration
   migrate status    list migrations and whether they are applied
+  dev seed          reset the database to the development data (APP_ENV=development only)
   version           print the build version
 `
 
@@ -56,6 +60,8 @@ func run(ctx context.Context, args []string, lookup config.LookupFunc, stdout, s
 		return serve(ctx, lookup, stdout, stderr)
 	case "migrate":
 		return migrate(ctx, args[1:], lookup, stdout, stderr)
+	case "dev":
+		return dev(ctx, args[1:], lookup, stdout, stderr)
 	default:
 		fmt.Fprintf(stderr, "unknown command %q\n\n%s", args[0], usage)
 		return 2
@@ -147,6 +153,38 @@ func migrate(ctx context.Context, args []string, lookup config.LookupFunc, stdou
 	return 0
 }
 
+// dev seed empties the tables the seed fills and reloads them. It reads only
+// APP_ENV and DATABASE_URL, and refuses anything but development, since it
+// deletes every account.
+func dev(ctx context.Context, args []string, lookup config.LookupFunc, stdout, stderr io.Writer) int {
+	if len(args) != 1 || args[0] != "seed" {
+		fmt.Fprint(stderr, usage)
+		return 2
+	}
+	if env, _ := lookup("APP_ENV"); strings.TrimSpace(env) != string(config.Development) {
+		fmt.Fprintln(stderr, "dev seed: refused: APP_ENV must be development")
+		return 1
+	}
+	url, _ := lookup("DATABASE_URL")
+	if strings.TrimSpace(url) == "" {
+		fmt.Fprintln(stderr, "dev seed: DATABASE_URL is required")
+		return 1
+	}
+	pool, err := db.Open(ctx, db.Options{URL: url, MaxConns: 2})
+	if err != nil {
+		fmt.Fprintln(stderr, "dev seed:", err)
+		return 1
+	}
+	defer pool.Close()
+	start := time.Now()
+	if err := devseed.Seed(ctx, pool); err != nil {
+		fmt.Fprintln(stderr, "dev seed:", err)
+		return 1
+	}
+	fmt.Fprintf(stdout, "seeded (%s)\n", time.Since(start).Round(time.Millisecond))
+	return 0
+}
+
 func serve(ctx context.Context, lookup config.LookupFunc, stdout, stderr io.Writer) int {
 	cfg, warnings, err := config.Load(lookup)
 	if err != nil {
@@ -172,14 +210,26 @@ func serve(ctx context.Context, lookup config.LookupFunc, stdout, stderr io.Writ
 	}
 	defer pool.Close()
 
+	deps := httpapi.Deps{
+		Config:   cfg,
+		Logger:   logger,
+		DB:       pool,
+		RefData:  refdata.New(dbq.New(pool), cfg.Upload.MaxBytes),
+		Accounts: auth.NewService(pool, cfg.AdminEmails, logger),
+	}
+	// Without Google credentials (allowed only with dev login) the Google
+	// routes answer with /?auth=error.
+	if cfg.Google.ClientID != "" {
+		deps.Google = google.New(ctx, google.Options{
+			ClientID:     cfg.Google.ClientID,
+			ClientSecret: cfg.Google.ClientSecret,
+			RedirectURL:  cfg.AppOrigin + "/api/v1/auth/google/callback",
+		})
+	}
+
 	srv := &http.Server{
-		Addr: cfg.HTTPAddr,
-		Handler: httpapi.New(httpapi.Deps{
-			Config:  cfg,
-			Logger:  logger,
-			DB:      pool,
-			RefData: refdata.New(dbq.New(pool), cfg.Upload.MaxBytes),
-		}),
+		Addr:              cfg.HTTPAddr,
+		Handler:           httpapi.New(deps),
 		ReadHeaderTimeout: 10 * time.Second,
 		ReadTimeout:       30 * time.Second,
 		WriteTimeout:      60 * time.Second,
```

- [ ] **Step 4: 통과 확인**

Run: `go test ./internal/devseed/ ./cmd/... && make check`
Expected: PASS

시드 소요 시간 확인(프론트 요청은 1초 안팎). Docker로 임시 DB를 띄워 확인한다(실제 `.env`는 만들지 않는다):

```bash
docker run -d --rm --name seedcheck -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:18
sleep 3
U=postgres://postgres:pw@localhost:55432/postgres?sslmode=disable
DATABASE_URL=$U go run ./cmd/snuarchive migrate up
APP_ENV=development DATABASE_URL=$U go run ./cmd/snuarchive dev seed   # "seeded (NNms)"
docker stop seedcheck
```

Expected: `seeded (...)`가 1초 안팎이다. 넘으면 결과를 보고에 적는다.

- [ ] **Step 5: 커밋**

```bash
git add internal/devseed cmd/snuarchive
git commit -m "Wire accounts into serve; add snuarchive dev seed (accounts, O27)"
```

---

### Task 9: 문서 정리, 전체 검증, 프론트 전달

**Files:**
- Modify: `docs/backend/open-items.md` (O6 보강, O24 닫기, O27 진행 기록), `docs/backend/running-locally.md` (dev seed, 세션 설정)
- Create(커밋하지 않음): `/home/toxiclemon/Working/SCSC/SNUarchive/.worktrees/react-frontend/BACKEND_CHANGES.md` (프론트 전달 메모. 프론트 세션의 다른 파일은 건드리지 않는다. 같은 이름 파일이 이미 있으면 덮어쓰지 말고 `BACKEND_CHANGES_PHASE2.md`로 만든다)

**Interfaces:**
- Consumes: Task 1~8 결과
- Produces: 없음

- [ ] **Step 1: 문서 패치 적용**

```diff
diff --git a/docs/backend/open-items.md b/docs/backend/open-items.md
index a57f608..5dbea65 100644
--- a/docs/backend/open-items.md
+++ b/docs/backend/open-items.md
@@ -12,7 +12,7 @@
 | O3 | Vercel Go 빌더가 같은 모듈 `internal/` 패키지 import를 지원하는지 | Vercel 계정·배포 필요 | 개발자: 최소 `api/index.go`로 프리뷰 배포. 실패 시 `internal/` → `pkg/` 이름 변경 | Vercel 배포 경로 | 열림 |
 | O4 | Supabase 풀러(트랜잭션 모드)에서 pgx simple protocol 설정으로 전체 쿼리 동작 확인 | Supabase 프로젝트 필요 | 개발자: 로컬은 pgbouncer transaction 모드로 대체 검증, 최종은 Supabase 프리뷰에서 통합 테스트. 로컬 pgx simple protocol 모드는 `TestOpenInPoolerMode`로 확인. Supabase 확인은 여전히 필요. | Vercel+Supabase 배포 | 열림 |
 | O5 | snu.ac.kr Google Workspace에서 공유 드라이브 생성 가능 여부 | 학교 Workspace 정책 | 운영자: 공유 드라이브 생성 시도. 불가 시 `GDRIVE_AUTH=oauth` 사용 | Drive 보관(service_account 모드) | 열림 |
-| O6 | Google OAuth 클라이언트에 새 콜백 URI 등록 (`/api/v1/auth/google/callback`) | Google Cloud 콘솔 권한 | 운영자: VM 도메인·Vercel 도메인 각각 등록 | 운영 로그인 | 열림 |
+| O6 | Google OAuth 클라이언트에 새 콜백 URI 등록 (`/api/v1/auth/google/callback`). 2단계의 로그인 흐름은 가짜 OIDC 서버(`internal/testutil/fakegoogle`)로만 검증했으므로, 등록 후 실제 Google 계정으로 한 번 로그인해 `hd`·`email_verified`·nonce·PKCE가 통과하는지 확인한다 | Google Cloud 콘솔 권한 | 운영자: VM 도메인·Vercel 도메인 각각 등록 후 실제 로그인 확인 | 운영 로그인 | 열림 |
 | O7 | Drive API용 GCP 설정(서비스 계정 키 또는 OAuth 동의 화면·스코프 `drive.file`) | Google Cloud 콘솔 권한 | 운영자 | Drive 보관 | 열림 |
 | O8 | VM 사양·도메인·TLS(Caddy 자동 인증서 가능 여부, 포트 80/443 개방) | 서버 접근 권한 없음 | 운영자 | VM 배포 | 열림 |
 | O9 | 강의 식별(원본 행 → course 매핑) 규칙 확정 | 의도적으로 보류한 설계 결정 | 팀: 결정 후 importer의 식별 인터페이스 구현 교체. 임시 구현은 현행 규칙(강의명+교수명 정규화) | 운영 데이터 적재 | 열림 |
@@ -30,10 +30,10 @@
 | O21 | 6단계 선행 조건: graceful shutdown이 15초 제한을 넘겨 멈출 수 있다(defer된 `pool.Close`가 핸들러를 기다림). Docker 기본 stop 유예는 10초. 6단계 전에 제한 초과 시 `srv.Close()` 호출 또는 요청 BaseContext 취소, compose에 `stop_grace_period` 설정 | 6단계 작업 | 개발자, 6단계 | 6단계 | 열림 |
 | O22 | 5–6단계 선행 조건: 서버 `WriteTimeout` 60초가 긴 파일 스트리밍과 내보내기를 끊는다. 경로별로 `http.ResponseController.SetWriteDeadline` 사용 | 5–6단계 작업 | 개발자 | 5–6단계 파일 스트리밍·내보내기 | 열림 |
 | O23 | 오류 매핑 정밀도: `exam_sittings_voting_ck`는 종료가 시작보다 앞선 경우도 포함하지만 `closesAt`/`CLOSES_AT_IN_PAST`로만 매핑된다. FK 매핑(예: `votes_sitting_fk` → NOT_FOUND)은 삽입 쪽 위반을 가정한다. 기본키(예: `favorites_pk`, `upload_intents_pk`)는 분류 대상 밖이므로 이후 단계는 명시적 충돌 대상(explicit conflict target)을 주는 `ON CONFLICT`를 쓰거나 PK를 분류해야 한다 | 3–4단계 작업 | 개발자, 3–4단계 | 3–4단계 오류 매핑 | 열림 |
-| O24 | 2단계 착수 시: `TestEveryAPIRouteIsInTheContract`는 빈 Config로 서버를 만든다. `httpapi.New`가 `Config.Session.Keys`로 인증을 구성하게 되면 `New`가 빈 의존성을 견디게 하거나 그 테스트에 전체 의존성을 준다 | 2단계 작업 | 개발자, 2단계 | 2단계 착수 | 열림 |
+| O24 | 2단계 착수 시: `TestEveryAPIRouteIsInTheContract`는 빈 Config로 서버를 만든다. `httpapi.New`가 `Config.Session.Keys`로 인증을 구성하게 되면 `New`가 빈 의존성을 견디게 하거나 그 테스트에 전체 의존성을 준다 | 2단계 작업 | 개발자, 2단계 | 2단계 착수 | 닫힘(2단계: `httpapi.New`는 빈 의존성으로도 라우트를 등록하고, 세션 키 등은 요청을 처리할 때만 쓴다. 테스트 그대로 통과) |
 | O25 | 시험 일자 수집의 한계 — 시험 전 투표를 막는 "시험 이후 개시(개시 예약)" 방식은 회차마다 시험 일자가 있어야 하는데, 모든 시험의 일자를 하나하나 수집해 입력할 수 없다. 이 한계를 먼저 해결해야 한다(예: 일자 없이 운영하는 기본 규칙, 요청·제보로 일자를 받는 방법 등). | 제품 결정 | 팀: 일자 확보 방법과 일자가 없을 때의 규칙을 정한 뒤 개시 예약(voting_opened_at 미래 허용, Voting.state=scheduled) 설계 확정 | 시험 전 투표 차단 | 열림 |
 | O26 | 프론트 2차 요청 1·2·5: compose에 `web` 서비스(`web/Dockerfile`, 포트 3000, `APP_ENV`·`API_ORIGIN=http://app:8080`·`APP_ORIGIN`·`WEB_SESSION_SECRET`, `WEB_IP` 고정, readiness는 `GET /`), `caddy`의 `depends_on`에 web(healthy), Caddyfile 나머지 경로를 `web:3000`으로(요청 ID는 Caddy가 새로 부여, `/api/*`는 계속 Go), E2E용 개발 모드 override `deploy/compose.e2e.yaml`(app `APP_ENV=development`·`DEV_LOGIN_ENABLED=true`, 운영 사용 금지 경고). 프론트 3차 메모(2026-09-28): 개발 로그인은 Go가 단일 기준이라 web에는 `DEV_LOGIN`이 없다(`/config.devLoginEnabled`만 봄, 5분 캐시). web의 `APP_ENV=development`는 개발 로그인과 무관하고 비밀값 기본값과 개발용 `/api/v1` 통과 경로만 연다. web IP는 신뢰 프록시라 그 통과 경로가 브라우저 헤더를 옮기므로 override에서도 web은 `production`으로 둔다, `deploy/.env.example`에 `WEB_SESSION_SECRET` 추가. 2026-09-28 사용자 결정: 두 PR(#1, 프론트) 병합 후 main에서 새 브랜치로, override도 만든다 | `feature/go-backend`에 `web/`이 없어 build 컨텍스트가 없음 | 개발자: 병합 후 통합 브랜치 | 운영 배포(web), `E2E_TARGET=compose` | 열림 |
-| O27 | 프론트 2차 요청 4: 개발 시드 명령 `snuarchive dev seed`. `APP_ENV=development`가 아니면 거부, 확인 플래그 없음, 매번 초기화 후 적재(마이그레이션 참조 데이터 유지), 약 1초, 시각은 실행 시점 기준 상대값. 카탈로그는 시드 안의 작은 고정 목록(`미적분학 1`: 현재 학기 투표 열림·한줄평·통계, `선형대수학`: 투표 안 연 회차가 있어 요청 가능, 관리자 회차 만들기 기말 2025와 안 겹침). 계정 `admin@`(ADMIN_EMAILS)·`student@`(프로필)·`newbie@`(단과대·입학년도 없음)·`moderator@`(DB 관리자) `snu.ac.kr`. 관리자 큐(대기 간편 제보 + 이미지 파일, 숨길 통계량, 열린 투표 요청), 로그(`login` 포함 여러 건, Drive 보관 이력, 잡 이력), `student` 즐겨찾기. 기준 자료는 프론트 `web/mock-api/src/seed.ts`. 프론트 3차 메모(2026-09-28)의 E2E 기대값: 이름으로 찾는 강의는 둘뿐이고 전체 카탈로그에 기대는 검색은 없다. `미적분학 1`은 `미적분`·`미적분학`·`미적분학 1`로 검색되어 결과 이름이 `미적분학 1`로 시작하고, 이 강의에 대기 중인 간편 제보가 있다(관리자가 강의 페이지의 과목 제보 큐를 봄). `선형대수학`은 `선형대수학`으로 검색되고, 관리자가 통계량을 이 강의로 옮긴다. 이 강의의 투표 안 연 회차는 비어 있으므로 `admin_created = true`로 넣어야 강의 페이지에 보인다(O31). `student` 즐겨찾기는 3개 이상(끌어놓기 1→3번째), 홈 "즐겨찾기" 첫 항목에 배지. 홈 "투표 진행중" 1개 이상(`미적분학 1`이면 충분). 병합 전 워크트리에서 프론트는 `E2E_RESET_CMD='cd ../../go-backend && go run ./cmd/snuarchive dev seed'`로 부른다(`web/`에서 실행). 2026-09-28 사용자 결정: 단계별 누적, 2단계(명령+계정)부터 각 단계가 자기 테이블 시드를 추가 | 해당 API가 아직 없음 | 개발자, 2단계부터 | `E2E_TARGET=go`, `E2E_TARGET=compose` | 열림 |
+| O27 | 프론트 2차 요청 4: 개발 시드 명령 `snuarchive dev seed`. `APP_ENV=development`가 아니면 거부, 확인 플래그 없음, 매번 초기화 후 적재(마이그레이션 참조 데이터 유지), 약 1초, 시각은 실행 시점 기준 상대값. 카탈로그는 시드 안의 작은 고정 목록(`미적분학 1`: 현재 학기 투표 열림·한줄평·통계, `선형대수학`: 투표 안 연 회차가 있어 요청 가능, 관리자 회차 만들기 기말 2025와 안 겹침). 계정 `admin@`(ADMIN_EMAILS)·`student@`(프로필)·`newbie@`(단과대·입학년도 없음)·`moderator@`(DB 관리자) `snu.ac.kr`. 관리자 큐(대기 간편 제보 + 이미지 파일, 숨길 통계량, 열린 투표 요청), 로그(`login` 포함 여러 건, Drive 보관 이력, 잡 이력), `student` 즐겨찾기. 기준 자료는 프론트 `web/mock-api/src/seed.ts`. 프론트 3차 메모(2026-09-28)의 E2E 기대값: 이름으로 찾는 강의는 둘뿐이고 전체 카탈로그에 기대는 검색은 없다. `미적분학 1`은 `미적분`·`미적분학`·`미적분학 1`로 검색되어 결과 이름이 `미적분학 1`로 시작하고, 이 강의에 대기 중인 간편 제보가 있다(관리자가 강의 페이지의 과목 제보 큐를 봄). `선형대수학`은 `선형대수학`으로 검색되고, 관리자가 통계량을 이 강의로 옮긴다. 이 강의의 투표 안 연 회차는 비어 있으므로 `admin_created = true`로 넣어야 강의 페이지에 보인다(O31). `student` 즐겨찾기는 3개 이상(끌어놓기 1→3번째), 홈 "즐겨찾기" 첫 항목에 배지. 홈 "투표 진행중" 1개 이상(`미적분학 1`이면 충분). 병합 전 워크트리에서 프론트는 `E2E_RESET_CMD='cd ../../go-backend && go run ./cmd/snuarchive dev seed'`로 부른다(`web/`에서 실행). 2026-09-28 사용자 결정: 단계별 누적, 2단계(명령+계정)부터 각 단계가 자기 테이블 시드를 추가. 2단계에서 `internal/devseed`와 `snuarchive dev seed`(계정 4개 + `login` 로그 24건)를 만들었다. 이후 단계는 `devseed.Seed`에 자기 테이블을 더한다 | 해당 API가 아직 없음 | 개발자, 2단계부터 | `E2E_TARGET=go`, `E2E_TARGET=compose` | 열림 |
 | O28 | `deploy/.env.example`에 `COMPOSE_SUBNET`, `COMPOSE_IP_RANGE`, `CADDY_IP`, `WEB_IP`, `DB_IP`, `APP_IP`, `MIGRATE_IP` 반영. 지금은 `docs/backend/running-locally.md`에만 있음 | 읽기 가드가 `.env.example` 접근을 막음. 예외 설치(`~/.claude/read-guard-setup/allow-env-example.sh`)는 사용자가 실행 | 사용자: 설치 → 개발자: 반영 | 새 사용자의 compose 설정 | 열림 |
 | O29 | 관리자 회수의 동시성: 두 관리자가 서로를 동시에 회수하면 두 요청 모두 "다른 관리자가 남는다"고 판단해 커밋하고, 관리자가 0명이 된다(`LAST_ADMIN_PROTECTED`가 막지 못함) | 6단계 작업 | 개발자, 6단계: 회수 트랜잭션을 `pg_advisory_xact_lock(<관리자 잠금 키>)`로 직렬화한 뒤 남은 관리자를 센다(env 관리자 행도 세므로 DB 관리자 행만 `FOR UPDATE`로 잠그는 방식은 부족할 수 있음). 동시 회수 통합 테스트 추가 | 6단계 관리자 회수 | 열림 |
 | O30 | 투표 마감 변경(`PATCH /admin/sittings/{id}/voting`)의 과거 시각: `exam_sittings_voting_ck`는 마감이 개시보다 뒤인지만 본다. PATCH에서는 개시 시각이 과거라 과거의 `closesAt`도 통과해, 422 `CLOSES_AT_IN_PAST` 대신 투표가 조용히 닫힌다(개설·재개설은 개시 = now()라 DB가 막음) | 투표 관리 구현 단계 작업 | 개발자, 투표 관리 구현 단계(4 또는 6단계): 핸들러가 `closesAt > now()`를 검사해 422 `CLOSES_AT_IN_PAST`(field `closesAt`)로 답한다. 테스트 추가 | 투표 마감 변경 | 열림 |
diff --git a/docs/backend/running-locally.md b/docs/backend/running-locally.md
index 75ec70c..bbf1755 100644
--- a/docs/backend/running-locally.md
+++ b/docs/backend/running-locally.md
@@ -14,6 +14,7 @@
 | `make check` | sqlc 생성물 최신 여부 + lint + test |
 | `make run` | 현재 셸 환경변수로 서버 실행 |
 | `make migrate` | `DATABASE_URL`에 마이그레이션 적용 |
+| `go run ./cmd/snuarchive dev seed` | 개발 데이터로 초기화(계정 4개 등). `APP_ENV=development`가 아니면 거부한다 |
 
 되돌리기(`snuarchive migrate down`)는 실수 방지를 위해 `--yes`를 요구한다: `--yes` 없이 실행하면 어떤 마이그레이션이 롤백될지만 stderr에 출력하고 아무것도 되돌리지 않는다.
 
@@ -23,6 +24,14 @@
       DATABASE_URL=postgres://snuarchive:pw@localhost:5432/snuarchive?sslmode=disable \
       SESSION_KEYS=$(openssl rand -base64 32)
 
+세션은 `SESSION_TTL`(기본 168h)마다 쓰는 동안 연장되고, 로그인 후 `SESSION_MAX_AGE`(기본 720h)가 지나면 다시 로그인해야 한다.
+
+개발 시드(`snuarchive dev seed`)는 `users`를 비우고(연결된 기여·로그·즐겨찾기도 함께) 다시 채운다. 계정은
+`admin@snu.ac.kr`(관리자 권한은 `ADMIN_EMAILS`에 넣어야 생김), `student@snu.ac.kr`(프로필 있음),
+`newbie@snu.ac.kr`(프로필 없음), `moderator@snu.ac.kr`(DB 관리자). 개발 로그인으로 이 주소를 넣으면 된다.
+compose에서는 `docker compose -f deploy/compose.yaml --env-file deploy/.env exec app snuarchive dev seed`
+(`APP_ENV=development`인 스택에서만).
+
 ## docker compose
 1. `cp deploy/.env.example deploy/.env` 후 값 채우기 (Google 없이 해볼 때는 파일 끝의 개발용 두 줄 사용)
 2. `make compose-up`
```

- [ ] **Step 2: 전체 검증**

Run: `make check && gofmt -l . && npx -y @redocly/cli@latest lint docs/api/openapi.yaml`
Expected: `make check` PASS, `gofmt -l` 출력 없음, Redocly valid.

- [ ] **Step 3: 커밋**

```bash
git add docs/backend/open-items.md docs/backend/running-locally.md
git commit -m "Document dev seed and session settings; close O24, update O6 and O27"
```

- [ ] **Step 4: 프론트 전달 메모 작성**

다음 내용으로 프론트 워크트리 루트에 메모를 만든다(커밋하지 않음). 커밋 해시는 실제 값으로 채운다.

```markdown
# 백엔드 2단계(인증·사용자) 알림

작성: <날짜>, 백엔드 작업(`feature/backend-auth`, 커밋 <첫 커밋>..<마지막 커밋>)에서.
커밋하지 않은 전달용 메모다. 반영한 뒤 지우면 된다.

이제 Go가 로그인·세션·`/me`를 실제로 처리한다. `E2E_TARGET=go`의 로그인과 프로필 시나리오가 돌 수 있다.

## 1. 계약 변경: 로그인 취소

- Google 동의 화면에서 취소하면 `/?auth=cancelled`로 온다(새 값).
- 기존 값은 그대로다. `forbidden`은 검증된 snu.ac.kr Workspace 계정이 아닐 때, `error`는 그 밖의 실패.
- 문구는 프론트가 정한다. 취소는 오류로 보이지 않게 조용히 넘어가도 된다.

## 2. web 서버가 꼭 해야 할 것: 모든 Go 응답의 `Set-Cookie` 전달

- **세션이 연장된다.** 남은 시간이 7일(`SESSION_TTL`)의 절반 아래면, 인증이 필요한 **아무 API 응답**에나 새 `snu_session`이 실린다. 로그인 후 30일(`SESSION_MAX_AGE`)이 상한이다.
- **쓸 수 없는 세션은 401과 함께 쿠키를 지운다**(`Max-Age=-1`).
- web이 로그인 응답의 쿠키만 넘기면, 계속 쓰는 사용자도 7일 뒤 로그아웃된다. SSR 로더·액션이 부른 Go 응답의 `Set-Cookie`를 모두 브라우저로 넘겨 달라. `GET /me`의 CSRF 쿠키 재발급도 같은 경로로 간다.
- 쿠키 속성:
  - `snu_session`: HttpOnly, SameSite=Lax, 경로 `/`
  - `snu_csrf`: 읽기 가능, 같은 속성
  - `Secure`는 `APP_ORIGIN`이 https일 때만 붙는다. 그래서 `http://localhost` 개발도 된다.
- OAuth state 쿠키 `snu_oauth`는 경로가 `/api/v1/auth/google`이다. 브라우저가 Caddy를 거쳐 Go에 직접 오가므로 web과는 관계없다.

## 3. 개발 시드 명령 (O27 첫 부분)

- `go run ./cmd/snuarchive dev seed`(Go 워크트리 루트에서). `APP_ENV=development`와 `DATABASE_URL`이 필요하다.
  - `APP_ENV=development`가 아니면 거부한다.
  - 초기화한 뒤 적재한다. 소요 시간은 출력의 `seeded (...)`에 나온다.
- 지금 넣는 것:
  - 계정: `admin@snu.ac.kr`(관리자 권한은 Go의 `ADMIN_EMAILS`에 넣어야 생김), `student@snu.ac.kr`(공과대학, 2022), `newbie@snu.ac.kr`(프로필 없음), `moderator@snu.ac.kr`(DB 관리자)
  - 계정마다 `login` 로그 6건
- 강의·회차·기여는 3·4단계에서 더한다.
- 병합 전 워크트리에서는 `E2E_RESET_CMD='cd ../../go-backend && go run ./cmd/snuarchive dev seed'`로 적었는데, 2단계 작업 워크트리는 `backend-auth`다. 경로를 맞춰 달라.

## 4. 참고 (프론트 동작 변화 없음)

- 계정은 Google `sub`로 찾는다. 학교 주소가 재발급되면 새 주인은 새 계정을 받는다.
- 표시 이름(Google 프로필 이름)은 계정을 만들 때만 저장한다.
- 개발 로그인 이메일은 대소문자를 가리지 않고 소문자로 저장한다.
```

- [ ] **Step 5: 보고**

보고에 다음을 담는다: 커밋 목록, `make check` 결과, 시드 소요 시간, 새로 기록한 open item(있다면), O6(실제 Google 로그인 확인)이 남아 있다는 점, 푸시는 하지 않았다는 점.

---

## 자기 검토 (계획 작성 시)

- **설계서 대응:**
  - §5.1 흐름 전부: Task 5·6·7
  - §4.2 스크럽: Task 2·6
  - 관리자 판정: `auth.User.IsAdmin`, Task 6. 관리자 전용 라우트와 `requireAdmin`은 쓰는 곳이 생기는 6단계에서 추가한다. 지금 넣으면 staticcheck가 미사용으로 실패한다.
  - §6 `SESSION_MAX_AGE`: Task 3
  - 확인 헤더(탈퇴): Task 7
  - 활동 로그: login은 best-effort, profile_update·account_delete·logout_all은 트랜잭션 안
  - O27 첫 부분: Task 8
- **계약 대응:**
  - `startGoogleLogin`, `googleLoginCallback`, `logout`, `devLogin`, `getMe`, `updateMe`, `deleteMe`, `logoutAll`: 모두 `accounts_test.go`에서 계약 검증기로 요청·응답을 확인한다.
  - `DELETE /me`의 헤더 누락은 계약상 필수라 검증기를 거치지 않고 서버에 직접 보낸다.
- **남는 한계(설계서에 기록됨):** sub가 있는 계정의 새 주소를 sub 없는 계정(dev-login·가져오기)이 갖고 있으면 자동으로 합치지 않고 `/?auth=error`로 끝낸다. 운영에는 dev-login 계정이 없으므로 가져오기(8단계, O1) 때 다시 본다.
