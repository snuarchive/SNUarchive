# 백엔드 로컬 실행

## 준비물
- Go 1.27, Docker, gcc (sqlc가 cgo로 빌드됨)
- 모듈 경로는 `github.com/snuarchive/snuarchive`(소문자). 원격 저장소 이름 `snuarchive/SNUarchive`와 대소문자가 다르지만 의도한 것이다.

## 명령
| 명령 | 하는 일 |
|---|---|
| `make generate` | `db/queries/*.sql`로 `internal/db/dbq` 재생성 (sqlc) |
| `make test` | 전체 테스트. DB 테스트는 Docker로 `postgres:18`을 띄운다 |
| `make test-short` | Docker 없이 단위 테스트만 |
| `make lint` | `go vet` + staticcheck |
| `make check` | sqlc 생성물 최신 여부 + lint + test |
| `make run` | 현재 셸 환경변수로 서버 실행 |
| `make migrate` | `DATABASE_URL`에 마이그레이션 적용 |

`make run`/`make migrate`는 환경변수를 셸에서 읽는다. 최소 개발 설정 예:

    export APP_ENV=development DEV_LOGIN_ENABLED=true APP_ORIGIN=http://localhost:5173 \
      DATABASE_URL=postgres://snuarchive:pw@localhost:5432/snuarchive?sslmode=disable \
      SESSION_KEYS=$(openssl rand -base64 32)

## docker compose
1. `cp deploy/.env.example deploy/.env` 후 값 채우기 (Google 없이 해볼 때는 파일 끝의 개발용 두 줄 사용)
2. `make compose-up`
   - `db` 정상 → `migrate` 성공 → `app` 준비(`/readyz`) → `caddy` 순으로 뜬다
3. `curl http://localhost/api/v1/config`
4. `make compose-down` (데이터까지 지우려면 `docker compose -f deploy/compose.yaml --env-file deploy/.env down -v`)

`/healthz`와 `/readyz`는 Caddy가 외부에 404로 막는다. 컨테이너 안에서만 쓴다.

## Supabase 등 트랜잭션 풀러
- 서버: `DB_POOLER_MODE=true`, `DB_MAX_CONNS`를 작게(서버리스는 2).
- 마이그레이션: 풀러가 아닌 **직접 연결 URL**로 `snuarchive migrate up`을 실행한다.
- 검증은 open-items O4.
