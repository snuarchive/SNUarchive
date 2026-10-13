# web

SNU Archive 프론트엔드(React Router 8, SSR). 이주 계획과 결정 사항은
`../docs/frontend/plan.md`.

Node 24 이상, pnpm.

## 계약(API) 파일

`api/openapi.yaml`은 저장소의 계약 `docs/api/openapi.yaml`을 가리키는 심볼릭
링크로, 커밋되어 있다. 계약이 바뀌면 타입을 다시 만든다.

```sh
pnpm api:types   # app/api/schema.d.ts 재생성(커밋 대상)
```

## 목업 API로 개발

API 호출은 모두 React Router 서버가 한다. 개발 중에는 `mock-api/`(별도 패키지)를
띄워 두고 연결한다. 터미널 두 개:

```sh
# 1) 목업 (http://localhost:8787)
pnpm --dir mock-api install
pnpm --dir mock-api start

# 2) 앱 (http://localhost:5173)
APP_ENV=development pnpm dev
```

개발용 로그인 폼은 API가 허용할 때만 보인다(`/config.devLoginEnabled`; 목업은 항상,
Go는 `APP_ENV=development`와 `DEV_LOGIN_ENABLED=true`일 때). 로그인 화면의 개발용 이메일 칸에 `student@snu.ac.kr`(학생), `admin@snu.ac.kr`
(관리자), `newbie@snu.ac.kr`(프로필 없음)을 넣는다. 목업 사용법은
`mock-api/README.md`.

## 환경변수

| 이름                 | 설명                                                          | 개발 기본값             |
| -------------------- | ------------------------------------------------------------- | ----------------------- |
| `APP_ENV`            | `development` \| `production`(기본). `NODE_ENV`와 별개        | `production`            |
| `API_ORIGIN`         | 서버가 API에 붙는 주소                                        | `http://localhost:8787` |
| `APP_ORIGIN`         | 이 앱의 공개 주소. API에 보내는 `Origin`, 액션 출처 검사에 씀 | `http://localhost:5173` |
| `WEB_SESSION_SECRET` | 이 앱 쿠키(flash) 서명 키                                     | 개발용 고정값           |

`APP_ENV=production`이면 `API_ORIGIN`, `APP_ORIGIN`, `WEB_SESSION_SECRET`이 모두
있어야 한다.

## 검사

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test         # Vitest (순수 로직)
pnpm test:e2e     # Playwright: 목업과 프로덕션 빌드를 띄워 실행
pnpm --dir mock-api test   # 목업 응답의 계약 검증
```

Playwright 브라우저를 내려받지 않고 설치된 Chromium을 쓰려면
`PW_CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e`.

CI(`.github/workflows/web.yml`)는 목업의 계약 검증을 포함해 위 검사를 모두 돌린다.
`docs/api/`가 바뀌어도 돈다.

## Go 백엔드로 E2E

`E2E_TARGET`으로 E2E가 붙을 API를 고른다. 목업이 아니면 테스트마다 DB를
백엔드 개발 시드로 되돌리는 명령(`snuarchive dev seed`)을 `E2E_RESET_CMD`에 준다.
시드는 백엔드 단계마다 늘어나므로 Go 대상 E2E는 구현된 만큼만 통과한다. 목업의 장애 주입이 필요한 테스트는 건너뛴다.

| `E2E_TARGET` | Playwright가 띄우는 것 | 준비                                                                                                                                                                           |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mock`(기본) | 목업, 앱               | 없음                                                                                                                                                                           |
| `go`         | 앱(`:4173`)            | Postgres + `go run`으로 띄운 Go 서버(`E2E_API_ORIGIN`, 기본 `http://localhost:8080`). Go는 `APP_ENV=development`, `DEV_LOGIN_ENABLED=true`, `APP_ORIGIN=http://localhost:4173` |
| `compose`    | 없음                   | 배포 compose 전체(Caddy 포함)를 개발 모드로 띄움. 주소 `E2E_BASE_URL`(기본 `http://localhost`)                                                                                 |

```sh
# 명령은 web/에서 실행된다. Go 모듈은 저장소 루트에 있다.
E2E_RESET_CMD='cd .. && go run ./cmd/snuarchive dev seed' pnpm test:e2e:go
# compose 스택(-f compose.yaml -f compose.e2e.yaml, 백엔드가 web 서비스를 넣은 뒤)
E2E_RESET_CMD='docker compose -f ../deploy/compose.yaml -f ../deploy/compose.e2e.yaml exec -T app snuarchive dev seed' pnpm test:e2e:compose
```

## 컨테이너

`Dockerfile`은 `web/`을 컨텍스트로 프로덕션 이미지를 만든다(포트 3000, `node`
사용자). 배포 compose와 Caddy 설정은 백엔드 `deploy/`가 맡는다.

```sh
docker build -t snuarchive/web:local .
```
