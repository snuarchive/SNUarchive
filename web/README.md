# web

SNU Archive 프론트엔드(React Router 8, SSR). 이주 계획은 `../docs/frontend/plan.md`.

Node 24 이상, pnpm.

```sh
pnpm install
pnpm dev          # 개발 서버
pnpm build        # 프로덕션 빌드
pnpm start        # 빌드 결과 실행 (PORT, 기본 3000)

pnpm typecheck
pnpm lint
pnpm format:check
pnpm test         # Vitest
pnpm test:e2e     # Playwright (빌드 후 서버를 띄워 실행)
```

Playwright 브라우저를 내려받지 않고 설치된 Chromium을 쓰려면
`PW_CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e`.
