# SNU Archive Go 백엔드 설계

작성 2026-09-27. 상태: 사용자 검토 대기.
입력: `docs/backend/requirements.md`, 동료 초안 `schema.sql`·`openapi.yaml`(메인 체크아웃, 미추적).
남은 확인 항목: `docs/backend/open-items.md` (O1~O14). 이 문서에서 `(Ox)`로 참조한다.

---

## 1. 목표와 범위

레거시(Vercel Node 함수 + Firestore)를 **Go 서버 + PostgreSQL 18**로 다시 만든다. React 프론트엔드는 별도 작업이며,
이 백엔드는 **`docs/api/openapi.yaml`**(v2.0.0-draft, 제안서 수정본)을 계약으로 제공한다.
API 세부(경로, 스키마, 에러 코드)는 그 파일이 기준이고, 이 문서의 5.2는 요약이다.

범위 밖:
- 강의 식별 규칙(원본 분반 → course 매핑) 확정 (O9). 임시 구현만 둔다.
- React 프론트엔드.
- CI (O14).
- Firestore 이주 도구는 마지막 선택 단계(O1).

## 2. 확정된 결정

| 주제 | 결정 |
|---|---|
| 스택 | Go(표준 `net/http` 라우팅) + pgx/v5 + sqlc + goose |
| DB | PostgreSQL 18(개발·테스트·VM). Supabase 호환은 O11 확인 전까지 18 전용 기능 최소화 |
| 배포 | 주: 학교/동아리 VM에서 docker compose. 대체: Vercel(Go 함수) + Supabase |
| 스토리지 | `STORAGE_DRIVER=fs\|s3` (s3는 MinIO·Supabase Storage·R2·S3 공용) |
| 세션 | HMAC 서명 쿠키(`user_id`, 만료, `session_epoch`), 키 교체 지원 |
| 관리자 | `ADMIN_EMAILS`(env, API로 회수 불가) **또는** `users.is_admin`(DB, 콘솔로 부여·회수) |
| 개발 로그인 | `APP_ENV=development` + `DEV_LOGIN_ENABLED=true`일 때만. production에서 켜면 기동 실패 |
| API | 제안서 `openapi.yaml` 기반 수정. `/api/v1`, 에러 코드, 키셋 커서 |
| 강의 참조 | 모든 도메인·API는 `courses.id`만 사용 |
| 시험 레이블 | 종류 × 번호. 종류는 DB 시드(번호 필요 여부·상한·표시 형식) |
| 시험 회차 | (강의, 종류, 번호, 연도, 학기) 1행 = `exam_sittings` |
| 투표 | 회차당 1인 1표, 수정 가능. **한도 없음.** 누적 난이도 없음(회차별만) |
| 투표 개설 | **관리자만**. 기한 지정 또는 무기한, 마감 변경, 즉시 종료, 재개설. 학기 제한 없음 |
| 투표 요청 | 학생이 회차 지정해 요청(1인 1요청, 메모 100자 이하, 취소 가능). 관리자 큐에서 개설/반려 |
| 통계 | 숨김만 가능(하드 삭제 없음). 제안서 CHECK 유지 |
| 간편 제보 | PDF/PNG/JPEG/WebP(매직바이트 판정), 3MB. 승인 1건 = 통계 정확히 1개, 기여자 = 업로더 |
| 파일 열람 | API 스트리밍, `inline` + CSP sandbox + nosniff, `?download=1`이면 attachment |
| 한줄평 | 50자, 작성자명 마스킹, 삭제는 관리자만 |
| 사용자 | IP 수집: 모든 활동 로그 `ip` + `users.last_ip`. 탈퇴 = 스크럽(`last_ip` 포함, 닉네임·로그는 유지) |
| 단과대 | `colleges` 참조 테이블 |
| 활동 로그 | `action` = PostgreSQL enum. 내보내기 JSON/JSONL/CSV/XLSX/Parquet. 필터 기반 일부 삭제(건수 미리보기), 전체 비우기 |
| 로그 자동 삭제 | `LOG_RETENTION_ENABLED`(기본 off) |
| 로그 Drive 보관 | `LOG_ARCHIVE_ENABLED`(기본 off), 자동 삭제와 독립. 인증 `GDRIVE_AUTH=service_account\|oauth` |
| 검색 | 정규화 `search_text` + 토큰별 `LIKE` AND. 지연 측정 테스트(p95 50ms 기준) 후 필요 시 trgm |
| 지연 로딩 | 키셋 커서(기본 20, 최대 50), 요약 응답, 사용자별 값 분리 + 카탈로그 버전 ETag |
| 홈 목록 | 즐겨찾기 · 투표 진행중 · 최근 제보 · 투표 요청 많은 강의 (각 10) |
| 통합 테스트 | testcontainers-go (postgres:18) |
| 관측 | slog(JSON, 개발은 text) + 요청 ID + OpenTelemetry(기본 off, O13) |

## 3. 구조

### 3.1 저장소 배치
`go.mod`는 저장소 루트(모듈 `github.com/snuarchive/snuarchive`). React는 이후 `web/`.
레거시 `api/*.js`, `public/`, `server.js`는 전환 시점까지 공존 후 삭제.

```
cmd/snuarchive/        serve | migrate | import | gc | jobs run <name> | logs export | gdrive auth
internal/
  config/              환경변수 파싱·검증, 모순 경고
  calendar/            Asia/Seoul 기준 현재 학기, 학기 라벨 (time/tzdata 내장 — distroless에 zoneinfo 없음)
  refdata/             /config 참조 데이터(시험 종류, 단과대, 학기 라벨)와 입력 한도 상수
  apperr/              에러 코드·필드 에러 타입, HTTP 상태 매핑
  db/                  pgxpool, goose 마이그레이션(embed), sqlc 생성 코드, 트랜잭션 헬퍼
  auth/                Google OAuth, 세션 쿠키 코덱, CSRF, 개발 로그인
  users/               사용자 upsert, 프로필, 탈퇴 스크럽, 관리자 판정
  catalog/             importer(+Identifier 인터페이스), 검색, 홈, 강의 상세
  contrib/             회차, 통계, 투표, 투표 요청, 한줄평, 즐겨찾기
  reports/             업로드, 검토 큐, 파일 열람
  admin/               통계 수정·숨김·이동, 투표 관리, 관리자 부여, 대시보드, 사용자 통계
  activity/            로그 기록, 조회·필터, 내보내기(5형식), 일부 삭제, 보존 삭제, Drive 보관
  storage/             BlobStore + fs, s3
  gdrive/              업로더(service_account | oauth)
  jobs/                잡 레지스트리(retention, archive, upload-gc)와 스케줄러
  httpapi/             라우터, 미들웨어, 에러 매핑, 영역별 핸들러
  telemetry/           slog 설정, OTel 초기화
api/index.go           Vercel 진입점
deploy/                Dockerfile, compose.yaml(app + postgres:18 [+ minio]), Caddyfile, .env.example
db/queries/            sqlc 입력 SQL
db/migrations/         goose SQL
```

의존 방향: `httpapi` → 도메인 패키지 → `db` / `storage` / `gdrive`. 도메인 패키지는 `net/http`를 모른다.

### 3.2 실행 형태
1. **VM**: `snuarchive serve`. `SCHEDULER_ENABLED=true`면 프로세스 내에서 잡을 주기 실행한다.
2. **Vercel**: `api/index.go`가 `httpapi.New(deps)`를 감싼다. 스케줄러 없음. Vercel Cron이 `POST /api/v1/internal/jobs/{name}`을 호출하며 `Authorization: Bearer $CRON_SECRET`로 보호한다. 빌더의 `internal/` import 지원은 O3.
3. **CLI**: `migrate`, `import`, `jobs run`은 어느 환경에서나 `DATABASE_URL`로 실행한다.

잡 동시 실행 방지: 잡 실행 동안 전용 커넥션에서 트랜잭션 하나를 열고 `pg_try_advisory_xact_lock(잡 키)`를 잡는다.
인스턴스가 여럿이거나 VM 스케줄러와 cron이 겹쳐도 한 번만 실행된다. 세션 단위 `pg_try_advisory_lock`은
트랜잭션 풀러(Supabase)에서 세션이 유지되지 않아 쓰지 않는다. 잠금을 못 잡으면 `skipped`(API는 409 `JOB_ALREADY_RUNNING`).
잡의 실제 작업(배치 삭제 등)은 별도 커넥션의 짧은 트랜잭션들로 수행하고, 잠금 트랜잭션은 잡이 끝날 때 롤백한다.

## 4. 데이터 모델 (마이그레이션 v1)

제안서 `schema.sql`에서 바뀐 점 위주로 적는다. 명시하지 않은 CHECK·인덱스는 제안서를 따른다.

### 4.1 카탈로그
- `departments(id, name UNIQUE)`
- `instructors(id, name UNIQUE, is_placeholder)`. `department_span`은 제거.
- `courses(id, title, instructor_id, identity_key UNIQUE, legacy_key UNIQUE NULL, search_text, is_listed, created_at, updated_at)`
  - `identity_key`: `catalog.Identifier`가 원본 행에서 계산한 불투명 키. 임시 구현은 `sha1(norm(title)|norm(instructor))`로, 현행 `course_key`와 같다.
  - `legacy_key`: 현행 `course_key`(이주 매칭용).
  - `search_text`: 강의명, 교수, 학과들을 공백 제거·소문자로 이은 값. importer가 갱신한다.
  - `is_listed`: 검색·홈 노출 여부. 상세 조회는 값과 무관하게 가능하다.
- `course_offerings(course_id, year, semester, department_id)`: PK 전체
- `catalog_sections(id, course_id, year, semester, course_number, lecture_number, department_id, class_time jsonb)`: `UNIQUE(year, semester, course_number, lecture_number)`
- `catalog_imports`: 제안서와 같음(실행 중 1개 제한 부분 유니크 인덱스).
- 카탈로그 버전: `catalog_imports`의 마지막 성공 id. 검색 ETag 입력으로 쓴다.

### 4.2 사용자
- `colleges(name PK, sort_order, is_active)` 시드.
- `users(id, email, display_name, is_admin, college FK NULL, admission_year, last_ip inet NULL, session_epoch int DEFAULT 0, created_at, last_seen_at, deleted_at)`
  - 스크럽 CHECK: `deleted_at`이 있으면 `email`, `display_name`, `college`, `admission_year`, `last_ip`가 NULL이고 `is_admin`은 false.
  - 탈퇴 시 `session_epoch`를 올린다. 기여 행의 `nickname`과 활동 로그는 유지한다.
- 관리자 판정: `is_admin OR email ∈ ADMIN_EMAILS`. env 관리자는 콘솔에 `source: env`로 표시하고 회수 API는 409다. "마지막 관리자" 판단에 env 관리자도 센다.

### 4.3 시험 회차·투표
- `assessment_kinds(id, code UNIQUE, label_ko, label_format, numbered, max_number, sort_order, is_active)`

  | code | label_ko | numbered | max | label_format |
  |---|---|---|---|---|
  | midterm | 중간 | no | – | 중간 |
  | final | 기말 | no | – | 기말 |
  | exam | 시험 | yes | 6 | {n}차 시험 |
  | quiz | 퀴즈 | yes | 20 | 퀴즈 {n} |
  | assignment | 과제 | yes | 20 | 과제 {n} |
  | other | 기타 | no | – | 기타 |

- `exam_sittings(id, course_id, kind_id, number smallint NULL, year, semester, voting_opened_at NULL, voting_closes_at NULL, voting_ended_at NULL, votes_counted_from NULL, created_at)`
  - `UNIQUE NULLS NOT DISTINCT (course_id, kind_id, number, year, semester)`
  - 번호 규칙(numbered면 1..max, 아니면 NULL)은 트리거와 앱 검증으로 강제한다.
  - 열림 여부 = `voting_opened_at IS NOT NULL AND voting_ended_at IS NULL AND (voting_closes_at IS NULL OR voting_closes_at > now())`
  - 재개설: `voting_opened_at = now()`, `voting_ended_at = NULL`, 새 `voting_closes_at`. 기존 표는 유지된다.
  - 회차 생성 경로: 통계 제출, 투표 요청, 관리자 개설, 업로드 승인(get-or-create, `ON CONFLICT`).
- `votes(id, sitting_id, user_id, rating 1..5, created_at, updated_at)`: `UNIQUE(sitting_id, user_id)`. 투표와 수정은 회차가 열려 있을 때만 가능하다(닫힌 회차는 409 `VOTING_NOT_OPEN`).
- `content_version(n bigint)`: 단일 행. 검색 ETag용(5.4).
- `voting_requests(id, sitting_id, user_id, note ≤100자 NULL, status open|fulfilled|rejected|cancelled, created_at, resolved_at, resolved_by)`
  - 부분 유니크: `(sitting_id, user_id) WHERE status = 'open'`
  - 관리자가 개설하면 해당 회차의 open 요청이 모두 fulfilled, 반려하면 rejected가 된다. 이후 다시 요청할 수 있다.
- 뷰 `v_sitting_difficulty`: 회차별 표 수, 평균(소수 1자리), 1~5 분포. `votes_counted_from`을 반영한다.

### 4.4 기여
- `stat_reports`: `sitting_id` 참조 + 제안서 필드·CHECK(`values_non_decreasing`, 만점 이하, 0 이상, 비어 있지 않음, 출처 정합성, 숨김 정합성).
- `pending_reports(id, course_id, kind_id, number, year, semester, uploader_id, nickname, file_key UNIQUE, file_name, content_type, byte_size, sha256, status, reviewer_id, reviewed_at, review_note, created_at)`
  - MIME CHECK: pdf/png/jpeg/webp.
  - 승인은 `status = 'pending'`인 행에서만 가능하다(`UPDATE … WHERE status = 'pending'`, 0행이면 409). 통계 1개 생성과 같은 트랜잭션에서 처리한다.
- `upload_intents(file_key PK, created_at)`: 오브젝트 쓰기 전에 삽입하고, `pending_reports` 커밋과 같은 트랜잭션에서 삭제한다.
- `comments(id, course_id, user_id, body ≤50자, created_at)`, `favorites(user_id, course_id, created_at)`

### 4.5 로그
- `activity_action` enum: 제안서 값 + `voting_update`, `voting_close`, `voting_request_create`, `voting_request_cancel`, `voting_request_reject`, `logs_export`, `logs_delete`, `logs_retention_delete`, `logs_archive`, `account_delete`, `profile_update`, `report_file_view`.
- `activity_logs(id, user_id NULL, action, metadata jsonb, ip inet NULL, created_at)`
- `log_archive_runs(id, started_at, finished_at, status running|succeeded|failed, cutoff, format, row_count, first_id, last_id, drive_file_id, error)`: 실행 중 1개 제한.
- `job_runs(id, name retention|archive|upload-gc, started_at, finished_at, status succeeded|failed|skipped, affected, error)`: `/admin/jobs`의 마지막 실행 결과.

### 4.6 제약 이름 규칙
모든 CHECK·FK·UNIQUE 제약과 트리거 오류에는 이름이 있다(`<테이블>_<의미>_ck|fk|u`). 트리거는 `RAISE … USING CONSTRAINT`로 이름을 싣는다.
`internal/db`의 매핑표가 모든 이름을 "필드 에러 / 에러 코드 / 내부 불변식(500)" 중 하나로 분류하고, 스키마에 있는데 표에 없는 이름은 테스트가 실패시킨다.

## 5. 동작

### 5.1 인증
- `GET /auth/google` → state 쿠키(서명, 10분) → Google(`hd=snu.ac.kr`, `openid email profile`).
- `GET /auth/google/callback`
  - state 검증 → 토큰 교환 → id_token 검증(서명, iss, aud, exp) → `email_verified`와 `@snu.ac.kr` 확인.
  - 사용자 upsert. `last_seen_at`, `last_ip`를 갱신하고 env 관리자 표시를 붙인다.
  - `login` 로그(ip 포함)를 남긴다.
  - 세션 쿠키와 CSRF 쿠키를 설정하고 `/?auth=ok`로 리다이렉트한다. 실패 시 SNU 외 계정은 `/?auth=forbidden`, 그 밖은 `/?auth=error`(현행과 같은 값).
- 세션 쿠키 `snu_session`: `base64url(payload).sig`
  - payload = `{uid, exp, ep}`
  - `SESSION_KEYS`의 첫 키로 서명하고 모든 키로 검증한다.
  - 요청마다 `users`를 조회해 `deleted_at IS NULL`이고 `session_epoch = ep`인지 확인한다. `last_seen_at`은 최대 10분에 한 번만 갱신한다.
- CSRF: `snu_csrf` 쿠키(읽기 가능)와 `X-CSRF-Token` 헤더를 비교한다(unsafe 메서드). `Origin` 헤더가 `APP_ORIGIN`과 다르면 거부한다.
- 로그아웃은 쿠키 삭제. "모든 기기 로그아웃"과 탈퇴는 `session_epoch`를 올린다.

### 5.2 API 표면 (제안서 대비 변경)
- **회차 기반**
  - `POST /courses/{id}/statistics` (본문 `kindId, number, year, semester` + 수치)
  - `POST /courses/{id}/reports` (multipart, 같은 회차 필드)
  - `POST /courses/{id}/voting-requests` (+ note)
  - `DELETE /voting-requests/{id}` (본인)
  - `PUT /sittings/{id}/vote`
- **관리자 투표**
  - `POST /admin/sittings/{id}/voting` (`closesAt` NULL 허용): 개설 또는 재개설
  - `PATCH /admin/sittings/{id}/voting` (마감 변경)
  - `POST /admin/sittings/{id}/voting/close`
  - `PUT /admin/sittings/{id}/vote-cutoff`
  - `GET /admin/voting-requests` (회차별 묶음, 요청 수 순)
  - `POST /admin/voting-requests/{sittingId}/reject`
  - 회차 생성·개설을 한 번에 하는 `POST /admin/courses/{id}/sittings`
- **검색·홈**
  - `GET /courses?q=&cursor=&limit=`: 사용자별 필드 없음, ETag
  - `GET /courses/home`: 4섹션
  - `GET /me/favorites/ids`
- **로그**
  - `GET /admin/logs?from&until&action&userId&cursor`
  - `GET /admin/logs/export?format=json|jsonl|csv|xlsx|parquet&…`
  - `POST /admin/logs/delete-preview`
  - `POST /admin/logs/delete` (같은 필터, 미리보기 건수 확인 토큰 필요)
  - `DELETE /admin/logs` (전체, `X-Confirm-Delete`)
- **업로드 관리**
  - `GET /admin/reports?status&courseId`
  - `GET /admin/reports/{id}/file`
- **사용자**
  - `GET /me`: `suggestedAdmissionYear`, `calendar.currentTerm` 포함, 투표 한도 필드 제거
  - `PATCH /me`, `DELETE /me`, `POST /me/logout-all`
- **운영 상태**
  - `GET /admin/sittings?votingState=open|closed|never|any`: 투표 관리 화면
  - `GET /admin/jobs`: 잡별 on/off(환경변수 값)와 마지막 실행 결과. API로 켜고 끄지는 않는다.
  - `GET /admin/logs/archive-runs`: Drive 보관 이력
- **확인 헤더**: 탈퇴와 로그 전체 비우기는 `X-Confirm-Delete: true`가 필요하다. 없으면 428 `CONFIRMATION_REQUIRED`.
- **개발**: `POST /auth/dev-login`
- **내부**: `POST /internal/jobs/{name}`
- **제거**
  - `/courses/{id}/assessments/*` 경로
  - 평가 병합(`assessments/merge`)과 표 이동(`votes/move`): 회차 모델에서 불필요. 잘못된 회차는 통계 이동과 cutoff로 처리한다.
  - `/admin/search/refresh`
  - `DELETE /comments/{id}`의 작성자 삭제 허용: 관리자 전용 `DELETE /admin/comments/{id}`로 옮긴다.
- **에러**: 제안서 `Error{code, message, details}`.
  - `FieldError.code` 정정: `VALUE_BELOW_REPORTED_SCORE` → `VALUE_ABOVE_MAX_SCORE`.
  - 추가 코드: `INVALID_ASSESSMENT_NUMBER`(필드), `VOTING_NOT_OPEN`, `VOTING_REQUEST_EXISTS`, `VOTING_REQUEST_NOT_OPEN`, `NOT_REQUEST_OWNER`, `ENV_ADMIN_PROTECTED`, `EXPORT_TOO_LARGE`, `DELETE_PREVIEW_MISMATCH`, `CONFIRMATION_REQUIRED`, `JOB_DISABLED`, `JOB_ALREADY_RUNNING`, `INTERNAL`.
  - 에러 본문에 `requestId`를 넣는다(`X-Request-ID` 헤더와 같은 값).
  - 제거 코드: `VOTE_QUOTA_EXHAUSTED`, `RATE_LIMITED`.

### 5.3 업로드 흐름
1. multipart 파싱. 본문 제한은 `UPLOAD_MAX_BYTES` + 여유분이다.
2. 앞부분 512바이트로 매직바이트를 판정한다. 허용 형식이 아니면 415.
3. sha256을 계산하고 `upload_intents`에 키를 삽입(커밋)한다.
4. `BlobStore.Put`으로 오브젝트를 쓴다.
5. 한 트랜잭션에서 `pending_reports`를 삽입하고 intent를 삭제한다.
6. 4 또는 5가 실패하면 오브젝트 삭제를 시도한다. 그래도 남은 것은 `upload-gc` 잡이 `UPLOAD_GC_AFTER`보다 오래된 intent를 보고 지운다.

### 5.4 검색
- 입력 → 공백 분리 → 토큰별 정규화(공백 제거, 소문자, NFC).
- `WHERE is_listed AND search_text LIKE '%'||t1||'%' AND …`. LIKE 메타문자(`%`, `_`, `\`)는 이스케이프한다.
- 정렬: 강의명이 첫 토큰으로 시작하는지, 최근 개설 학기 역순, 강의명, id. 커서 = 정렬 키 튜플.
- 결과의 "투표중·최근 제보" 표시는 카탈로그가 아니라 기여 활동에 따라 바뀌므로, 카탈로그 버전만으로는 ETag가 낡는다.
  - 단일 행 테이블 `content_version(n bigint)`을 둔다. `stat_reports` 삽입·숨김, `exam_sittings` 투표 상태 변경 트리거가 n을 올린다.
  - ETag = hash(카탈로그 버전, content_version, 현재 분(minute), 쿼리, 커서, limit). 분을 넣는 이유는 마감 시각이 지나 투표가 닫히는 것을 반영하기 위해서다.
  - 사용자별 값이 없으므로 `If-None-Match`가 일치하면 304.
- 지연 측정: 19k행 픽스처 통합 테스트에서 대표 쿼리 20개를 각 10회 실행하고 p95를 로그로 남긴다. `SEARCH_PERF_STRICT=1`일 때만 50ms 초과를 테스트 실패로 처리한다(기본은 경고). 공유 CI 장비에서 오탐으로 깨지지 않게 하기 위해서다.

### 5.5 로그 잡
- `retention`: `LOG_RETENTION_DAYS`보다 오래된 행을 배치(1만 행)로 삭제하고 `logs_retention_delete`(건수, cutoff)를 기록한다.
- `archive`
  1. `log_archive_runs`에 running을 기록한다.
  2. `LOG_ARCHIVE_AFTER_DAYS`보다 오래된 행을 id 범위로 선택한다.
  3. `LOG_ARCHIVE_FORMAT`으로 임시 파일에 직렬화(gzip)한다.
  4. Drive에 업로드한다(공유 드라이브는 `supportsAllDrives`).
  5. 업로드 응답의 파일 id와 크기를 확인한다.
  6. 같은 id 범위만 삭제한다.
  7. run을 succeeded로 표시하고 `logs_archive`를 기록한다.
  - 실패하면 삭제하지 않고 failed로 기록한다.
- 두 잡은 독립적이다. 둘 다 켜져 있고 `RETENTION_DAYS ≤ ARCHIVE_AFTER_DAYS`면 기동 시 경고한다.

### 5.6 내보내기
스트리밍 인코더 인터페이스 하나에 형식별 구현을 둔다.
- JSON: 배열 스트리밍.
- JSONL: 한 줄에 한 행.
- CSV: metadata는 JSON 문자열 컬럼.
- XLSX: excelize StreamWriter. 1,048,575행마다 시트를 나눈다.
- Parquet: parquet-go, 1만 행 단위 row group.

`EXPORT_MAX_ROWS`를 넘으면 413 `EXPORT_TOO_LARGE`(O12). 내보내기 자체도 `logs_export`로 기록한다.

## 6. 설정 (환경변수)

| 변수 | 기본 | 설명 |
|---|---|---|
| `APP_ENV` | production | development \| production |
| `APP_ORIGIN` | – | 필수. OAuth 콜백·Origin 검사 |
| `HTTP_ADDR` | :8080 | serve 전용 |
| `DATABASE_URL` | – | 필수 |
| `DB_MAX_CONNS` | 10 (Vercel 권장 2) | |
| `DB_POOLER_MODE` | false | true면 pgx simple protocol, 문장 캐시 끔(Supabase 트랜잭션 풀러) |
| `SESSION_KEYS` | – | 필수. 쉼표 구분 base64(32바이트 이상). 첫 키로 서명 |
| `SESSION_TTL` | 168h | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | – | 필수(dev-login만 쓸 때는 제외) |
| `ADMIN_EMAILS` | – | 쉼표 구분 |
| `DEV_LOGIN_ENABLED` | false | production이면 기동 실패 |
| `STORAGE_DRIVER` | fs | fs \| s3 |
| `STORAGE_FS_ROOT` | /data/uploads | |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX` | – | s3 전용 |
| `UPLOAD_MAX_BYTES` | 3145728 | |
| `UPLOAD_GC_AFTER` | 24h | |
| `SCHEDULER_ENABLED` | false | serve 전용 |
| `CRON_SECRET` | – | 내부 잡 엔드포인트. 없으면 엔드포인트 비활성 |
| `LOG_RETENTION_ENABLED` / `LOG_RETENTION_DAYS` | false / 365 | |
| `LOG_ARCHIVE_ENABLED` / `LOG_ARCHIVE_AFTER_DAYS` / `LOG_ARCHIVE_FORMAT` / `LOG_ARCHIVE_INTERVAL` | false / 90 / jsonl / 24h | 형식: json\|jsonl\|csv\|xlsx\|parquet (json·jsonl·csv는 gzip) |
| `GDRIVE_AUTH` | – | service_account \| oauth (archive 켜면 필수) |
| `GDRIVE_FOLDER_ID` | – | 대상 폴더(공유 드라이브 내 폴더 가능) |
| `GDRIVE_SERVICE_ACCOUNT_JSON` | – | base64 |
| `GDRIVE_OAUTH_CLIENT_ID`, `GDRIVE_OAUTH_CLIENT_SECRET`, `GDRIVE_OAUTH_REFRESH_TOKEN` | – | `snuarchive gdrive auth`로 발급 |
| `EXPORT_MAX_ROWS` | 1000000 | |
| `LOG_FORMAT` / `LOG_LEVEL` | json / info | 개발 기본 text/debug |
| `OTEL_ENABLED` | false | 켜면 표준 `OTEL_EXPORTER_OTLP_*`, `OTEL_SERVICE_NAME` 사용 |
| `TRUSTED_PROXIES` | – | 쉼표 구분 CIDR. 직전 홉이 여기 속할 때만 `X-Forwarded-For`를 믿고 클라이언트 IP를 뽑는다. 비우면 연결 주소를 쓴다 |

헬스체크(`/api/v1` 밖, 계약 대상 아님): `GET /healthz`(프로세스 생존), `GET /readyz`(DB ping).

검증 원칙:
- 필수 누락, 형식 오류, production의 개발 로그인은 기동을 실패시킨다.
- 기능과 설정의 모순(archive on + Drive 설정 없음)도 기동을 실패시킨다.
- 위험하지만 동작 가능한 조합(retention ≤ archive)은 경고만 한다.

## 7. 오류 처리
- 도메인은 타입이 있는 에러(`apperr.Code` + 필드 에러)를 반환하고, `httpapi`가 HTTP 상태와 `Error` 본문으로 매핑한다.
- DB 제약 위반(SQLSTATE 23514·23505·23503)은 제약 이름으로 `FieldError`/코드에 매핑한다. 매핑표 하나를 두고 테스트로 모든 CHECK 이름을 덮는다.
- 5xx는 요청 ID와 함께 로그를 남기고, 본문에는 일반 메시지만 넣는다.
- 활동 로그:
  - **쓰기 경로**(제보, 투표, 관리자 작업, 로그 삭제)는 도메인 변경과 같은 트랜잭션에 기록한다. 기록이 실패하면 요청 전체가 실패한다. 감사 기록 없는 변경을 막기 위해서다.
  - **로그인과 읽기 경로**(파일 열람, 내보내기)는 best-effort다. 실패해도 응답은 성공하고 경고 앱 로그만 남긴다.

## 8. 테스트
- **단위**: calendar, 정규화, 쿠키 코덱(키 교체, epoch), 매직바이트, 인코더 5종(골든 파일), 설정 검증.
- **통합**(testcontainers postgres:18): 마이그레이션 up/down, 모든 CHECK·트리거(위반 케이스), sqlc 쿼리, 도메인 서비스, 잡(advisory lock, archive 실패 시 미삭제).
- **HTTP 계약**: `httptest` 서버에 kin-openapi 요청·응답 검증 미들웨어를 걸고 시나리오를 실행한다.
- **스토리지**: fs는 임시 디렉터리, s3는 testcontainers MinIO로 같은 스위트를 돌린다.
- **Drive**: 인터페이스 뒤 가짜 구현으로 테스트한다. 실제 API는 수동 확인(O5, O7).
- **검색 성능**: 원본 9개 학기로 import한 픽스처로 측정한다(5.4).

## 9. 구현 단계
각 단계는 별도 구현 계획 문서를 가진다(`docs/superpowers/plans/`).

1. **기반**
   - go.mod, config, calendar, telemetry
   - db(pool, goose, sqlc), 마이그레이션 v1 전체
   - testcontainers 하네스, httpapi 골격(에러·요청ID·본문 제한·CSRF 틀)
   - `serve`/`migrate`, Dockerfile, compose
   - `openapi.yaml` 수정본과 계약 테스트 하네스
2. **인증·사용자**: OAuth, 세션, dev-login, 관리자 판정, `/me`, 프로필, 탈퇴, logout-all
3. **카탈로그**: importer(임시 Identifier), 검색, 홈, 강의 상세, 즐겨찾기
4. **기여**: 회차, 통계, 투표, 투표 요청, 한줄평
5. **업로드·검토**: storage fs/s3, 업로드, 검토 큐, 파일 열람, upload-gc
6. **관리 콘솔·로그**: 로그 조회·내보내기·삭제, retention, archive(Drive 2방식), 통계 수정·숨김·이동, 투표 관리, 관리자 부여, 대시보드, 사용자 통계
7. **Vercel 어댑터·배포 문서**: `api/index.go`, `vercel.json`, Supabase 설정 안내(O3, O4, O11, O12)
8. **(선택) Firestore 이주 도구** (O1, O2)

## 10. 제안서에서 바뀌는 것 요약
- 제거: `course_assessments`, 투표 한도, `mv_course_search`, `/admin/search/refresh`, 평가 병합, 표 이동, 작성자 한줄평 삭제, `department_span`
- 추가: `exam_sittings`, `assessment_kinds`(종류×번호), `voting_requests`, `catalog_sections`, `colleges`, `upload_intents`, `log_archive_runs`, `users.session_epoch`, `users.last_ip`, `activity_logs.ip`, 관리자 투표 제어, 로그 내보내기·삭제·보관
- 수정: 투표 개설 권한(관리자), 파일 열람(inline + sandbox), MIME 목록(HEIC 제외), 에러 코드 이름, PostgreSQL 14 → 18
