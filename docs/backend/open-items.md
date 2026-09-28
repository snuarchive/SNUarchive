# 백엔드 남은 확인·작업 목록

설계·구현 중 직접 검증할 수 없었거나 외부 결정이 필요한 항목. 항목을 닫을 때는 지우지 말고
상태와 근거를 적는다.

상태: `열림` · `진행` · `닫힘`

| ID | 항목 | 왜 직접 못 하나 | 누가/어떻게 | 막는 것 | 상태 |
|---|---|---|---|---|---|
| O1 | 운영 Firestore에 이주할 실데이터가 있는지 확인 | 운영 콘솔 접근 권한 없음 | 운영자: Firebase 콘솔에서 `stat_reports`, `quick_reports`, `difficulty_votes`, `course_comments` 문서 수 확인 | 이주 도구(선택 단계) 필요 여부 | 열림 |
| O2 | 이주 전까지 관리자 화면 "로그 비우기" 사용 금지 공지 | 운영자 행동 | 운영자: 관리자들에게 공지. 로그인 로그가 해시↔이메일 복원의 유일한 경로 | 이주 가능성 | 열림 |
| O3 | Vercel Go 빌더가 같은 모듈 `internal/` 패키지 import를 지원하는지 | Vercel 계정·배포 필요 | 개발자: 최소 `api/index.go`로 프리뷰 배포. 실패 시 `internal/` → `pkg/` 이름 변경 | Vercel 배포 경로 | 열림 |
| O4 | Supabase 풀러(트랜잭션 모드)에서 pgx simple protocol 설정으로 전체 쿼리 동작 확인 | Supabase 프로젝트 필요 | 개발자: 로컬은 pgbouncer transaction 모드로 대체 검증, 최종은 Supabase 프리뷰에서 통합 테스트. 로컬 pgx simple protocol 모드는 `TestOpenInPoolerMode`로 확인. Supabase 확인은 여전히 필요. | Vercel+Supabase 배포 | 열림 |
| O5 | snu.ac.kr Google Workspace에서 공유 드라이브 생성 가능 여부 | 학교 Workspace 정책 | 운영자: 공유 드라이브 생성 시도. 불가 시 `GDRIVE_AUTH=oauth` 사용 | Drive 보관(service_account 모드) | 열림 |
| O6 | Google OAuth 클라이언트에 새 콜백 URI 등록 (`/api/v1/auth/google/callback`) | Google Cloud 콘솔 권한 | 운영자: VM 도메인·Vercel 도메인 각각 등록 | 운영 로그인 | 열림 |
| O7 | Drive API용 GCP 설정(서비스 계정 키 또는 OAuth 동의 화면·스코프 `drive.file`) | Google Cloud 콘솔 권한 | 운영자 | Drive 보관 | 열림 |
| O8 | VM 사양·도메인·TLS(Caddy 자동 인증서 가능 여부, 포트 80/443 개방) | 서버 접근 권한 없음 | 운영자 | VM 배포 | 열림 |
| O9 | 강의 식별(원본 행 → course 매핑) 규칙 확정 | 의도적으로 보류한 설계 결정 | 팀: 결정 후 importer의 식별 인터페이스 구현 교체. 임시 구현은 현행 규칙(강의명+교수명 정규화) | 운영 데이터 적재 | 열림 |
| O11 | Supabase가 PostgreSQL 18을 제공하는지 확인 (개발·VM 기준 버전은 18) | Supabase 계정 필요 | 개발자: 프로젝트 생성 시 버전 확인. 18 미만이면 18 전용 기능 사용 여부를 목록화해 대체. 개발·테스트는 postgres:18(18.6)로 확인. | Vercel+Supabase 배포 | 열림 |
| O12 | Vercel Go 함수의 응답 크기·스트리밍·실행 시간 한도 확인 (로그 내보내기, 파일 열람 스트리밍) | Vercel 배포 필요 | 개발자: 프리뷰에서 큰 내보내기 실행. 한도 확인 후 `EXPORT_MAX_ROWS` 기본값 조정 또는 스토리지 경유 다운로드로 변경 | Vercel 배포의 내보내기 | 열림 |
| O13 | OpenTelemetry 수집 백엔드 선정 (Grafana/Tempo, Honeycomb, Jaeger 등)과 엔드포인트 | 인프라 결정 | 팀 | `OTEL_ENABLED=true` 운영 | 열림 |
| O14 | CI 구성 (GitHub Actions: vet, staticcheck, sqlc diff, 테스트, 계약 테스트, 이미지 빌드) | 사용자 결정으로 보류 | 개발자: 백엔드 1단계 이후 | 머지 품질 게이트 | 열림 |
| O15 | S3 호환 테스트·로컬 서버 선정. 2026-09-27 확인 시 `minio/minio`, `quay.io/minio/minio` 이미지를 받을 수 없음(`docker manifest inspect` 실패). 후보: `chrislusf/seaweedfs`, `rustfs/rustfs`(둘 다 manifest 확인됨) | 결정 필요 | 개발자: 5단계 착수 시 후보로 s3 드라이버 스위트를 돌려 호환성 확인 후 선정 | 5단계 s3 테스트, compose의 선택형 S3 서비스 | 열림 |
| O16 | Vercel 함수에서 클라이언트 IP 추출 방법 확인. `TRUSTED_PROXIES`만 쓰기로 했으나 Vercel 프록시의 주소 대역이 공개·고정인지, 함수가 받는 연결 주소가 무엇인지 모름 | Vercel 배포 필요 | 개발자: 프리뷰에서 `RemoteAddr`와 `X-Forwarded-For`를 기록해 확인. 대역을 특정할 수 없으면 설정 방식 재결정 필요 | Vercel 배포의 IP 수집 | 열림 |
| O10 | 동료 제안서(`schema.sql`, `openapi.yaml`) 수정본을 제안자와 검토 | 제안자와 합의 필요 | 팀 리뷰 | 계약 확정 | 열림 |
| O17 | 투표 집계 기준 시각과 수정된 투표. `v_sitting_difficulty`는 `votes.created_at`으로 거르므로, `votes_counted_from` 이전에 투표한 사용자가 나중에 투표를 바꿔도 계속 제외된다. 기준을 `updated_at`(최신 평가)으로 할지 `created_at`으로 할지 결정. 2026-09-28 사용자 결정: 제외 기준 시각 기능 자체를 제거. 시험 이후 개시 방식은 O25로 이관. | 설계 결정 필요 | 팀 결정 | 4단계 투표 수정 동작 | 닫힘 |
| O18 | `snuarchive migrate down`은 확인 없이 00001까지 되돌린다(모든 테이블 삭제). 확인 플래그를 요구할지 결정. 2026-09-28 사용자 결정: --yes 플래그 요구로 구현. | 운영 동작 결정 필요 | 팀 결정 | 안전한 운영 | 닫힘 |
| O19 | 클라이언트가 보낸 `X-Request-ID`를 어떤 호출자에게서든 받아들인다(로그 상관관계가 흐려질 수 있음). 신뢰 프록시에서 온 것만 받을지, 항상 새로 만들지 결정. 2026-09-28 사용자 결정: 신뢰 프록시에서 온 값만 수용하도록 구현. | 보안·동작 결정 필요 | 팀 결정 | – | 닫힘 |
| O20 | Compose 네트워크 서브넷 `172.30.0.0/24`와 `TRUSTED_PROXIES`가 하드코딩되어 VM의 네트워크와 겹칠 수 있음(O8 참고). 선택지: Caddy에 고정 주소를 주고 그 /32만 신뢰. 2026-09-28 사용자 결정: Caddy와 web 두 고정 IP만 신뢰(COMPOSE_SUBNET·CADDY_IP·WEB_IP 변수). 모든 서비스 고정 IP(COMPOSE_IP_RANGE 대신, 2026-09-28 사용자 결정). | VM 네트워크 확인 필요 | 운영자 + 팀 | – | 닫힘 |
| O21 | 6단계 선행 조건: graceful shutdown이 15초 제한을 넘겨 멈출 수 있다(defer된 `pool.Close`가 핸들러를 기다림). Docker 기본 stop 유예는 10초. 6단계 전에 제한 초과 시 `srv.Close()` 호출 또는 요청 BaseContext 취소, compose에 `stop_grace_period` 설정 | 6단계 작업 | 개발자, 6단계 | 6단계 | 열림 |
| O22 | 5–6단계 선행 조건: 서버 `WriteTimeout` 60초가 긴 파일 스트리밍과 내보내기를 끊는다. 경로별로 `http.ResponseController.SetWriteDeadline` 사용 | 5–6단계 작업 | 개발자 | 5–6단계 파일 스트리밍·내보내기 | 열림 |
| O23 | 오류 매핑 정밀도: `exam_sittings_voting_ck`는 종료가 시작보다 앞선 경우도 포함하지만 `closesAt`/`CLOSES_AT_IN_PAST`로만 매핑된다. FK 매핑(예: `votes_sitting_fk` → NOT_FOUND)은 삽입 쪽 위반을 가정한다. 기본키(예: `favorites_pk`, `upload_intents_pk`)는 분류 대상 밖이므로 이후 단계는 명시적 충돌 대상(explicit conflict target)을 주는 `ON CONFLICT`를 쓰거나 PK를 분류해야 한다 | 3–4단계 작업 | 개발자, 3–4단계 | 3–4단계 오류 매핑 | 열림 |
| O24 | 2단계 착수 시: `TestEveryAPIRouteIsInTheContract`는 빈 Config로 서버를 만든다. `httpapi.New`가 `Config.Session.Keys`로 인증을 구성하게 되면 `New`가 빈 의존성을 견디게 하거나 그 테스트에 전체 의존성을 준다 | 2단계 작업 | 개발자, 2단계 | 2단계 착수 | 열림 |
| O25 | 시험 일자 수집의 한계 — 시험 전 투표를 막는 "시험 이후 개시(개시 예약)" 방식은 회차마다 시험 일자가 있어야 하는데, 모든 시험의 일자를 하나하나 수집해 입력할 수 없다. 이 한계를 먼저 해결해야 한다(예: 일자 없이 운영하는 기본 규칙, 요청·제보로 일자를 받는 방법 등). | 제품 결정 | 팀: 일자 확보 방법과 일자가 없을 때의 규칙을 정한 뒤 개시 예약(voting_opened_at 미래 허용, Voting.state=scheduled) 설계 확정 | 시험 전 투표 차단 | 열림 |
| O26 | 프론트 2차 요청 1·2·5: compose에 `web` 서비스(`web/Dockerfile`, 포트 3000, `APP_ENV`·`API_ORIGIN=http://app:8080`·`APP_ORIGIN`·`WEB_SESSION_SECRET`, `WEB_IP` 고정, readiness는 `GET /`), `caddy`의 `depends_on`에 web(healthy), Caddyfile 나머지 경로를 `web:3000`으로(요청 ID는 Caddy가 새로 부여, `/api/*`는 계속 Go), E2E용 개발 모드 override `deploy/compose.e2e.yaml`(app·web `APP_ENV=development`, app `DEV_LOGIN_ENABLED=true`, web `DEV_LOGIN=1`, 운영 사용 금지 경고), `deploy/.env.example`에 `WEB_SESSION_SECRET` 추가. 2026-09-28 사용자 결정: 두 PR(#1, 프론트) 병합 후 main에서 새 브랜치로, override도 만든다 | `feature/go-backend`에 `web/`이 없어 build 컨텍스트가 없음 | 개발자: 병합 후 통합 브랜치 | 운영 배포(web), `E2E_TARGET=compose` | 열림 |
| O27 | 프론트 2차 요청 4: 개발 시드 명령 `snuarchive dev seed`. `APP_ENV=development`가 아니면 거부, 확인 플래그 없음, 매번 초기화 후 적재(마이그레이션 참조 데이터 유지), 약 1초, 시각은 실행 시점 기준 상대값. 카탈로그는 시드 안의 작은 고정 목록(`미적분학 1`: 현재 학기 투표 열림·한줄평·통계, `선형대수학`: 투표 안 연 회차가 있어 요청 가능, 관리자 회차 만들기 기말 2025와 안 겹침). 계정 `admin@`(ADMIN_EMAILS)·`student@`(프로필)·`newbie@`(단과대·입학년도 없음)·`moderator@`(DB 관리자) `snu.ac.kr`. 관리자 큐(대기 간편 제보 + 이미지 파일, 숨길 통계량, 열린 투표 요청), 로그(`login` 포함 여러 건, Drive 보관 이력, 잡 이력), `student` 즐겨찾기. 기준 자료는 프론트 `web/mock-api/src/seed.ts`. 2026-09-28 사용자 결정: 단계별 누적, 2단계(명령+계정)부터 각 단계가 자기 테이블 시드를 추가 | 해당 API가 아직 없음 | 개발자, 2단계부터 | `E2E_TARGET=go`, `E2E_TARGET=compose` | 열림 |
| O28 | `deploy/.env.example`에 `COMPOSE_SUBNET`, `CADDY_IP`, `WEB_IP`, `DB_IP`, `APP_IP`, `MIGRATE_IP` 반영. 지금은 `docs/backend/running-locally.md`에만 있음 | 읽기 가드가 `.env.example` 접근을 막음. 예외 설치(`~/.claude/read-guard-setup/allow-env-example.sh`)는 사용자가 실행 | 사용자: 설치 → 개발자: 반영 | 새 사용자의 compose 설정 | 열림 |
