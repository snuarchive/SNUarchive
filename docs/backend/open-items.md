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
