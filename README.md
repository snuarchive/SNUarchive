# SNU Archive

서울대학교 강의의 시험 통계량, 난이도 투표, 한줄 후기를 모아 보는 웹서비스.
`@snu.ac.kr` Google 계정으로 로그인한다.

## 구성

| 경로                 | 내용                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `web/`               | 프론트엔드. React Router 8(SSR) + TypeScript. 브라우저는 이 서버와만 통신한다 |
| `web/mock-api/`      | 개발·E2E용 목업 API(Hono). 계약과 같은 응답을 낸다                            |
| `2024-1.json` …      | 강의 카탈로그의 원본 학기 파일(`연도-학기.json`)                              |
| `docs/frontend/`     | 프론트엔드 이주 계획과 결정 기록(`plan.md`)                                   |
| `.github/workflows/` | CI(`web.yml`)                                                                 |

API 서버(Go + PostgreSQL)와 배포 설정(docker compose + Caddy)은
`feature/go-backend` 브랜치에서 작업 중이며, 병합되면 이 저장소에 함께 들어온다.
API 계약은 그 브랜치의 `docs/api/openapi.yaml`이다.

배포 형태: 한 VM에서 compose로 Caddy, Go API, React SSR 서버(`web`), PostgreSQL을
띄운다. Caddy가 `/api/*`는 Go로, 나머지는 `web`으로 보낸다.

## 개발

Node 24 이상과 pnpm이 필요하다. 자세한 실행법과 환경변수는 `web/README.md`.

```sh
cd web
pnpm install
pnpm --dir mock-api install
pnpm --dir mock-api start                  # 목업 API, http://localhost:8787
APP_ENV=development pnpm dev              # 앱, http://localhost:5173
```

## 이전 버전

정적 HTML/JS + Vercel 함수 + Firestore로 된 이전 앱은 이 브랜치에서 지웠다. 필요하면
`main`의 이력(이주 전 마지막 커밋 `2f66367`)에서 볼 수 있다.
