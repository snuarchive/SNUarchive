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

되돌리기(`snuarchive migrate down`)는 실수 방지를 위해 `--yes`를 요구한다: `--yes` 없이 실행하면 어떤 마이그레이션이 롤백될지만 stderr에 출력하고 아무것도 되돌리지 않는다.

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

### 네트워크와 신뢰 프록시
compose가 치환하는 변수(셸 또는 `deploy/.env`에서 읽는다. 기본값이면 따로 적지 않아도 된다):

| 변수 | 기본 | 설명 |
|---|---|---|
| `COMPOSE_SUBNET` | `172.30.0.0/24` | compose 네트워크 대역. VM의 다른 네트워크와 겹치면 바꾼다 |
| `CADDY_IP` | `172.30.0.2` | Caddy의 고정 주소 |
| `WEB_IP` | `172.30.0.3` | React SSR 서버(web, 프론트 단계에서 추가)의 고정 주소. 지금은 예약만 한다 |
| `DB_IP` | `172.30.0.4` | `db`(PostgreSQL)의 고정 주소 |
| `APP_IP` | `172.30.0.5` | `app`(Go API)의 고정 주소 |
| `MIGRATE_IP` | `172.30.0.6` | `migrate`(1회성 마이그레이션 컨테이너)의 고정 주소 |

다섯 주소는 모두 `COMPOSE_SUBNET` 안에 있어야 하고, 바꿀 때는 함께 바꾼다(겹치면 compose가
`docker compose config`에서 바로 에러를 낸다).

`app`의 `TRUSTED_PROXIES`는 `${CADDY_IP}/32,${WEB_IP}/32`로 정해진다. 두 곳만 신뢰하는 이유:

- 요청 경로는 두 가지다. 화면은 브라우저 → Caddy → web(Node) → Go, OAuth 콜백처럼 브라우저가
  `/api/v1`에 직접 오는 요청은 브라우저 → Caddy → Go.
- Caddy는 밖에서 들어온 `X-Forwarded-For`를 버리고 실제 접속 주소로 새로 붙인다(Caddy는
  `trusted_proxies`를 설정하지 않으면 들어온 값을 믿지 않는다). Caddy는 또한 들어온
  `X-Request-ID`를 항상 자신이 만든 UUID(`{http.request.uuid}`)로 덮어써서 프록시로 넘긴다.
  web은 받은 `X-Forwarded-For`를 Go 호출에 그대로 넘기고, 자신의 `X-Request-ID`를 만들거나
  전달한다 — 이 부분은 React SSR 서버가 붙는 프론트 단계에서 구현한다.
- Go는 직전 홉이 `TRUSTED_PROXIES`에 속할 때만 `X-Forwarded-For`(와 `X-Request-ID`)를 믿고,
  오른쪽부터 왼쪽으로 훑어 신뢰 주소가 아닌 첫 항목을 클라이언트 IP로 쓴다. 그 밖에는 연결 주소를 쓴다.
  Caddy가 `X-Request-ID`를 항상 자신의 값으로 덮어쓰므로, Go가 신뢰하는 값은 클라이언트가 보낸
  값이 아니라 언제나 Caddy(또는 이후 web)가 만든 값이다.
- 대역 전체를 믿으면 같은 네트워크의 다른 컨테이너(db, migrate 등)도 헤더를 위조할 수 있으므로 /32 두 개만 둔다.
- 다섯 서비스 모두 고정 주소를 가지므로(`CADDY_IP`, `WEB_IP`, `DB_IP`, `APP_IP`, `MIGRATE_IP`),
  Docker의 동적 할당은 전혀 쓰이지 않는다. 따라서 어떤 컨테이너가 먼저 뜨든 다른 컨테이너의
  고정 주소를 가져갈 수 없다.

## Supabase 등 트랜잭션 풀러
- 서버: `DB_POOLER_MODE=true`, `DB_MAX_CONNS`를 작게(서버리스는 2).
- 마이그레이션: 풀러가 아닌 **직접 연결 URL**로 `snuarchive migrate up`을 실행한다.
- 검증은 open-items O4.
