# web

SNU Archive 프론트엔드(React Router 8, SSR). 이주 계획과 결정 사항은
`../docs/frontend/plan.md`.

Node 24 이상, pnpm.

## 계약(API) 파일

`api/openapi.yaml`은 백엔드 워크트리의 계약을 가리키는 심볼릭 링크이고 커밋하지
않는다. 새로 받은 체크아웃에서는 한 번 만든다.

```sh
ln -s ../../../go-backend/docs/api/openapi.yaml api/openapi.yaml
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
APP_ENV=development DEV_LOGIN=1 pnpm dev
```

로그인 화면의 개발용 이메일 칸에 `student@snu.ac.kr`(학생), `admin@snu.ac.kr`
(관리자), `newbie@snu.ac.kr`(프로필 없음)을 넣는다. 목업 사용법은
`mock-api/README.md`.

## 환경변수

| 이름                 | 설명                                                              | 개발 기본값             |
| -------------------- | ----------------------------------------------------------------- | ----------------------- |
| `APP_ENV`            | `development` \| `production`(기본). `NODE_ENV`와 별개            | `production`            |
| `API_ORIGIN`         | 서버가 API에 붙는 주소                                            | `http://localhost:8787` |
| `APP_ORIGIN`         | 이 앱의 공개 주소. API에 보내는 `Origin`, 액션 출처 검사에 씀     | `http://localhost:5173` |
| `WEB_SESSION_SECRET` | 이 앱 쿠키(flash) 서명 키                                         | 개발용 고정값           |
| `DEV_LOGIN`          | `1`이면 개발용 로그인 폼. `APP_ENV=production`에서 켜면 기동 실패 | 꺼짐                    |

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
