# 백엔드 요구사항 정리 (Go + PostgreSQL 이주)

작성: 2026-09-27. 근거: 현행 코드(`api/`, `public/app.js`, `scripts/`), 원본 학기 JSON 9개,
동료 제안 `schema.sql` / `openapi.yaml`(초안, 수정 대상).

이 문서는 백엔드 설계 착수 전에 확정·결정해야 할 것을 모은 것이다. 프론트엔드와 기타 발견은
별도 문서(`docs/findings/non-backend.md`, `docs/legacy-findings` 브랜치)에 있다.

---

## 1. 범위

| 영역 | 현행 | 목표 |
|---|---|---|
| API | Vercel Serverless (Node) 13개 핸들러 | Go 단일 서버 |
| DB | Firestore (+ 로컬 `.local-data/db.json`) | PostgreSQL |
| 파일 | Firebase Storage (+ 로컬 디스크) | 오브젝트 스토리지(미정) |
| 강의 목록 | 빌드 스크립트 → `public/courses.json` 6.4MB, 브라우저 검색 | importer → DB, 서버 검색 |
| 인증 | Google OAuth, HMAC 서명 무상태 쿠키 | Google OAuth, 세션 방식 결정 필요 |

## 2. 원본 데이터 사실 (importer 입력)

측정값(2024-1 ~ 2026-1, 9개 학기):

- 행 40,306. 필드: `course_title, instructor, class_time_json, course_number, lecture_number, department, year, semester`.
- **학기 코드: 1=봄, 2=여름, 3=가을, 4=겨울.** 1·3 학기 파일이 7.5k~8.6k행, 2·4가 250~340행.
- 강의명+교수명 기준 19,155개, 개설(강의·학기·학과) 37,890건, 교수명 4,142개, 학과 176개.
- 복수 학과 강의 775개(4.0%).
- 교수명 빈 값 549행 → '미정'. '미정' 강의 255개 중 8개가 학과 여러 개에 걸쳐 병합됨
  (예: `대학원논문연구 / 미정` 20개 학과가 한 강의로 묶임).
- 같은 강의명+교수명인데 교과목번호가 여러 개: 1,607쌍 (대개 번호 개편, 예 `F21.201` → `L0441.000700`).
- 한 교과목번호에 강의명 여러 개: 559개 (부제가 붙는 특강·연구류).
- `course_number + lecture_number + 학기` 중복 없음 → 분반 단위 자연키로 쓸 수 있음.

## 3. 도메인 모델 — 확정할 것

### 3.1 강의 식별
- 현행: `sha1(공백제거·소문자(title) | 공백제거·소문자(instructor))[:20]` = `course_key`.
- 제안서: `UNIQUE(title, instructor_id)`, 교과목번호 폐기.
- **권장**
  - 식별은 강의명+교수명 유지(사용자 기대와 일치).
  - 단, 비교 키는 현행처럼 **공백 제거·소문자 정규화 값**으로 (제안서는 원문 title로 유니크 → 공백만 다른 강의가 분리됨).
  - 교수 '미정'이면 학과를 식별 키에 포함.
  - `course_offerings`에 `course_number`, `lecture_number` 보존(또는 원본 분반 테이블 `catalog_sections`). 나중에 식별 규칙을 바꿀 때 재계산 가능해야 함.
  - 현행 `course_key` 값은 이주 매핑용 컬럼(`legacy_key`)으로 보존.

### 3.2 학기
- DB·API 모두 1=봄, 2=여름, 3=가을, 4=겨울. 정렬 = `(year, semester)`.
- 현행 코드는 2와 3을 뒤집어 씀(`api/_utils.js:117`, `public/app.js:138,147`) → **재현 금지**, 이주 시 사용자 입력 행 2↔3 교환.
- "현재 학기"는 서버가 계산해 내려줌(`/me.calendar`). 시간대 `Asia/Seoul` 고정.

### 3.3 시험(평가) 종류
- 현행: 8개 선택지 + **자유 입력**(직접/간편/투표 모두). 간편 제보 폼은 1차·2차·3차가 빠진 5개만 노출.
- 제안서: 8개 고정 어휘, 자유 입력 없음.
- 결정 필요: 고정 어휘 채택 시 (a) 이주 매핑 규칙, (b) 퀴즈 여러 번 등 `ordinal` 도입 여부.

### 3.4 난이도 투표 — **가장 큰 결정**
| | 현행 | 제안서 |
|---|---|---|
| 단위 | 투표 회차(poll) 문서. 7일, 누구나 개설 | `course_assessments.voting_closes_at` 한 컬럼 |
| 1인 1표 범위 | 회차당 1표(재투표=수정) | 평가당 평생 1표(다음 회차에도 덮어씀) |
| 집계 | 같은 강의+평가의 모든 회차 표 누적 | 같음(cutoff 이후만) |
| 학기 정보 | 표에 year/semester 저장 | 없음 |

- 권장: `votes`에 `(year, semester)` 추가, 유니크 `(assessment_id, user_id, year, semester)`.
  학기별 난이도 조회 가능, cutoff도 학기 단위로 자연스러워짐.
- 회차가 닫히자마자 누구나 다시 열 수 있음 → 사실상 상시 개방. 개설 제한(현재 학기만, README 주장이나 미구현)을 둘지 결정.

### 3.5 투표 한도
- 현행: 계정당 **시험 기간 창**마다 10표. 창 시작일 4/15, 6/10, 10/15, 12/10 (UTC 자정 기준 계산). 기존 표 수정은 소모 없음.
- 제안서: 노트엔 "학기당 20", `Config` 예시 20, `VoteQuota` 설명 "3 of 10" — 자체 모순.
- 결정 필요: 단위(시험 기간 / 학기)와 횟수.

### 3.6 통계량
- 필드: q1~q4, average, max_score(만점), note, nickname(≤10자, 빈 값 '(익명)'). Q0는 수집 안 함.
- 최소 하나의 수치 또는 비고 필수.
- 현행은 범위·순서 검증 없음 → 제안서 CHECK(q 오름차순, max 이하, 0 이상) 채택 권장.
- 연도/학기 범위 검증 현행 없음 → 추가.
- 레거시 필드 `median`(= q2) 존재 가능 → 이주 시 흡수.

### 3.7 간편 제보(업로드)
- 현행 승인 시 통계 `reporter_email_hash` = **관리자** 해시 → 제안서대로 업로더를 기여자로.
- 현행 승인/반려에 상태 확인 없음 → 이중 승인으로 통계 중복 생성 가능. 새 구현은 `pending`에서만 전이.
- 한 업로드에서 통계 여러 개(중간·기말 한 장) 허용 여부 결정. 스키마는 허용, API는 1개 생성 후 종결.

### 3.8 사용자·개인정보
- 현행: 도메인 데이터엔 `HMAC(email)`만, 활동 로그엔 이메일 원문+이름.
- 제안서: `users` 테이블(email 원문) + 로그는 `user_id`. 탈퇴 = 스크럽.
- 현행 HMAC 키가 **세션 서명 키와 동일**(`AUTH_SESSION_SECRET` 우선, `EMAIL_HASH_SECRET`은 사실상 미사용) → 키 교체 시 모든 사용자 연결이 끊김. 새 설계에서 분리.
- 프로필: 단과대(18개 고정 목록), 입학년도(2·4자리 → 4자리), `last_ip` 저장(현행) — IP 저장 유지 여부 결정.
- 이메일에서 입학년도 추정(`guessAdmissionYearFromEmail`) → `/me`에 제안값으로 내려줌(제안서 누락).

### 3.9 한줄평
- 50자(코드포인트 기준), 작성자명 마스킹(`김**수`), 관리자 삭제. 제안서는 본인 삭제 추가 — 채택 권장.

### 3.10 관리자
- 현행: `ADMIN_EMAILS` 환경변수. 미설정 로컬에선 하드코딩 이메일 2개가 기본 관리자.
- 제안서: `users.is_admin` + 부여/회수 API. **최초 관리자 부트스트랩**(환경변수 시드) 명시 필요.

### 3.11 활동 로그
- 현행 action: `login, direct_report, quick_report, quick_report_approved, quick_report_rejected, poll_open, poll_vote, favorite_add, favorite_remove, stat_update, course_comment, comment_delete`.
- 현행 로그 전체 삭제·JSON 내보내기 있음. 제안서는 append-only(삭제 없음) → 의도된 변경인지 합의.

## 4. API 표면

### 4.1 현행 → 제안서 매핑
| 현행 | 제안서 | 비고 |
|---|---|---|
| `GET /api/config` | `GET /config` | |
| `GET /api/me` | `GET /me` | 제안서: 한도·학기 포함 |
| `GET/POST /api/profile` | `PATCH /me` | `suggestedAdmissionYear` 누락 |
| `GET /api/course-activity` + `courses.json` | `GET /courses`, `/courses/home` | 서버 검색 |
| `GET/POST /api/favorites` | `GET /me/favorites`, `PUT/DELETE /courses/{id}/favorite` | |
| `GET /api/stats` | `GET /courses/{id}` (복합) | |
| `POST /api/stats` | `POST /courses/{id}/assessments/{typeId}/statistics` | |
| `GET/POST /api/polls` | `/voting`, `/vote` | |
| `GET/POST/DELETE /api/comments` | `/courses/{id}/comments`, `DELETE /comments/{id}` | |
| `POST /api/quick-reports` | `POST /courses/{id}/reports` (multipart) | base64 JSON 폐기 |
| `GET/PATCH /api/quick-reports` | `/admin/reports/*` | **courseId 필터 누락** (강의 페이지 관리자 섹션이 사용) |
| `GET/PATCH /api/admin-stats` | `/admin/statistics/*` | |
| `GET/DELETE /api/admin-logs` | `GET /admin/logs` | 내보내기·삭제 없음 |
| `GET /api/admin-user-stats` | `GET /admin/users/summary` | |

### 4.2 검색 요구
- 현행 동작(보존 대상): 입력을 공백으로 나눈 **모든 토큰이** `공백제거·소문자(강의명+교수+학과들)`에 부분일치(AND).
- 검색 전 목록 정렬: 즐겨찾기 → 투표 진행중 → 최근 제보 시각 → 최근 개설 학기 → 강의명·교수(ko 정렬). 10개씩 무한 스크롤.
- 규모 19k행 → 정규화 컬럼 + `ILIKE` 순차 스캔으로 충분. 제안서의 MV+pg_trgm은 2글자 한글 검색에 인덱스를 못 쓰고 로케일 의존 → 보류 권장.

## 5. 보안 요구

- OAuth: `state` 검증 유지. `hd=snu.ac.kr`은 힌트일 뿐 → 서버에서 이메일 도메인·`email_verified` 확인(현행 유지). `access_type=offline` 불필요.
- id_token은 토큰 엔드포인트에서 직접 받으므로 서명 검증 생략 가능하나, Go에선 라이브러리로 검증 권장.
- 세션: 현행 무상태 7일 쿠키는 폐기 불가(로그아웃 = 쿠키 삭제뿐). 관리자 회수·탈퇴 즉시 반영하려면 **DB 세션** 권장.
- 비밀값 미설정 시 `"local-dev-secret"` 폴백 → 운영에서 기동 실패하도록.
- `ALLOW_DEMO_AUTH` Bearer `demo:<email>` 우회 → 개발 전용 빌드 태그/환경으로 격리.
- CSRF: 제안서 double-submit 쿠키 + `SameSite=Lax` + 동일 출처 채택.
- **클라이언트가 강의 정보를 보냄**: 현행은 `course_key`·강의명·교수·학과를 요청 본문에서 그대로 신뢰 → 존재하지 않는 강의에 기록 가능. 새 API는 `courseId`만 받고 서버가 조회.
- 업로드: 현행 content-type을 클라이언트 값 그대로 저장, 확장자·MIME 검증 없음(로컬 서버는 `.svg`를 same-origin `image/svg+xml`로 서빙). → 매직바이트 스니핑 + 허용목록(PDF/PNG/JPEG/WebP), 파일명 정규화.
- 관리자 파일 열람: 현행 UX는 인라인 뷰어(img/iframe). 제안서의 `attachment` 강제는 이를 깨뜨림 → 이미지/PDF는 `inline` + `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff`.
- 요청 크기 제한·레이트 리밋: 제안서 `RATE_LIMITED` 코드만 있고 정책 없음 → 로그인·제보·업로드·한줄평에 정책 정의.

## 6. 파일 스토리지
- 3MB 한도(파일 기준). 현행 로컬 서버는 base64 JSON 본문 한도를 `3MB+100KB`로 잡아 약 2.4MB 초과 파일을 413으로 거절(Vercel에선 본문 선파싱이라 해당 없음) → multipart로 해결.
- DB 트랜잭션과 오브젝트 쓰기는 원자적일 수 없음(제안서 설명 오류) → "오브젝트 먼저 쓰고 행 삽입, 실패 시 삭제" + 주기적 고아 정리.
- 스토리지 선택지: 기존 Firebase Storage 유지 / S3 호환(R2, MinIO) / 로컬 디스크. 배포 환경 결정에 종속.

## 7. 카탈로그 importer
- 입력: 학기별 JSON. 멱등 upsert(학과·교수·강의·개설[·분반]).
- 가져오기에서 빠진 강의를 비활성화할 경우, **기여 데이터가 있는 강의는 상세 조회 유지**(제안서는 비활성=404).
- 실행 기록 테이블(`catalog_imports`)과 동시 실행 방지는 제안서 채택.
- `class_time_json`(요일·시간·강의실) 보존 여부 결정 — 현재 서비스는 미사용.

## 8. 데이터 이주 (Firestore → PostgreSQL)
운영 데이터가 있다면:
1. **이주 전 관리자 로그 "비우기" 금지.** `activity_logs`의 로그인 기록(이메일 원문)이 해시↔이메일을 되찾는 유일한 경로 (`HMAC(secret, email)` 재계산, 세션 비밀키 필요).
2. 사용자 입력 행(`stat_reports`, `quick_reports`, `difficulty_polls`, `difficulty_votes`)의 semester 2↔3 교환. 카탈로그 유래 값은 그대로.
3. 자유 입력 시험 라벨 → 고정 어휘 매핑(불일치 시 '기타' + 원 라벨을 note로).
4. `course_key` → `courses.id` 매핑(importer가 `legacy_key` 계산).
5. `source: direct | quick_report` → `direct | transcribed`, `linked_stat_id` → `source_report_id`.
6. 승인 통계의 기여자: 연결된 quick_report의 업로더로 교정.
7. 파일: `file_path` 그대로 복사 또는 재업로드.
8. `median` 필드 → q2.

## 9. 비기능
- 시간대: 모든 달력 계산 `Asia/Seoul`. 저장은 `timestamptz`.
- 규모: 강의 19k, 개설 38k. 기여 데이터는 소규모 → 단순 쿼리 우선.
- 테스트: 현행 없음(스모크 스크립트만). Go 쪽은 도메인 규칙 단위 테스트 + DB 통합 테스트(testcontainers 등).
- 관측: 구조화 로그, 요청 ID. 활동 로그와 앱 로그 분리.
- 배포 대상 미정(Vercel은 Go 장기 실행 서버와 맞지 않음) → 호스팅 결정 필요.

## 10. 현행 백엔드 결함 — 재현 금지
1. 학기 2↔3 반전 (`currentAcademicTerm`).
2. 간편 제보 이중 승인 가능, 승인 통계 기여자가 관리자.
3. 요청 본문의 강의 정보 신뢰.
4. 업로드 MIME 미검증.
5. 이메일 해시 키 = 세션 키.
6. 비밀값 폴백 기본값.
7. Firestore 쿼리 후 메모리 필터·정렬·offset 페이지네이션 (`listQuickReports`, `listComments`, `voteWindowCount` 등).
8. 서버 로컬 시간(UTC) 기준 학기·투표창 계산.
9. `difficulty_tags` 저장 경로는 있으나 항상 빈 배열(죽은 기능). `voteWindowLabel` 미사용.
10. 로컬 모드에서 설정 없으면 하드코딩 이메일이 관리자.

## 11. schema.sql / openapi.yaml 수정 제안 요약
- [스키마] `votes`에 year/semester, 유니크 키 변경 (3.4).
- [스키마] 강의 식별 정규화 키, '미정' 교수 학과 포함, `course_number`/`lecture_number` 보존, `legacy_key` (3.1).
- [스키마] `is_active`는 검색 노출만 제어 (7).
- [스키마] `instructors.department_span` 제거 → 뷰로 계산.
- [스키마] MV·trgm 대신 정규화 검색 컬럼 (4.2).
- [스키마] 세션 테이블 추가 (5).
- [스키마] 단과대 목록: CHECK 하드코딩 대신 코드 상수 또는 참조 테이블 한 곳으로.
- [스키마] HEIC 제외(브라우저 미표시), 허용 MIME 재검토.
- [API] `/admin/reports?courseId=`, `/me.suggestedAdmissionYear`, 로그 내보내기 여부.
- [API] 파일 열람 `inline`+sandbox (5).
- [API] "한 트랜잭션" 서술 정정 (6).
- [API] `VALUE_BELOW_REPORTED_SCORE` → `VALUE_ABOVE_MAX_SCORE` 등 이름 정정.
- [API] `RATE_LIMITED` 정책 정의, 투표 한도 수치 일관화.

## 12. 결정 필요 목록
| # | 질문 | 영향 |
|---|---|---|
| D1 | 운영 Firestore에 이주할 실데이터가 있는가 | 이주 도구 필요 여부 |
| D2 | 투표: 학기별 표 vs 평생 1표 | votes 스키마, 집계 |
| D3 | 투표 한도 단위·횟수 | 한도 계산 로직 |
| D4 | 시험 종류 고정 어휘 + ordinal 여부 | assessment 모델 |
| D5 | 세션: DB 세션 vs 서명 쿠키 | 인증 구조 |
| D6 | 파일 스토리지·호스팅 대상 | 인프라 어댑터 |
| D7 | 활동 로그 삭제/내보내기 유지 여부 | 관리자 API |
| D8 | API 경로 버전·형태: 제안서(`/api/v1`, 리소스형) 채택 여부 | 프론트 재작성 범위 |
