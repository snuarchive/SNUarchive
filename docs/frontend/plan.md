# 프론트엔드 React 이주 계획

작성: 2026-09-27. 근거 문서:
- `docs/legacy-findings` 브랜치 `docs/findings/non-backend.md` — 프론트엔드 결함, 보존할 동작 목록
- `feature/go-backend` 브랜치 `docs/backend/requirements.md` — 백엔드 요구사항, 결정 목록(D1~D8)

---

## 1. 결정 사항

| 항목 | 결정 |
|---|---|
| 범위(1차) | 현행 기능과 동일. 초안(`openapi.yaml`)의 신규 관리자 기능은 제외 |
| API | 백엔드가 구현을 마치고 API 계약을 넘겨주면 그때 연결. 현행 `/api/*`, 초안 `openapi.yaml` 기준으로 만들지 않음 |
| 진행 순서 | API와 무관한 부분 먼저 → API 계약 수령 후 데이터 연결 |
| 프레임워크 | React Router 8 framework 모드(SSR). RSC(`unstable_*`)는 사용하지 않음 |
| 언어·런타임 | TypeScript, Node 24 |
| 패키지 매니저 | pnpm |
| 위치 | `web/` |
| 스타일 | `public/styles.css`를 CSS Modules로 분할. Tailwind 미사용 |
| 라우팅 | 주소 라우팅. 관리자 탭은 탭마다 주소 |
| 검색 | 검색어를 주소에 둠(`?q=`), 서버가 첫 페이지 렌더링 |
| 마지막 강의 복원 | 쿠키에 저장, `/` 요청 시 서버가 리다이렉트 |
| 폼 | 가능한 곳은 JS 없이도 제출(`<Form>` + action). 임시저장·글자 수·숫자 키 차단은 JS 로드 후 덧붙임 |
| 브라우저 저장 키 | 현행 `snu-archive:*` 키를 바탕으로 API 형식에 맞춰 수정(API 수령 후) |
| 테스트 | Vitest + Testing Library, Playwright(E2E) |
| 린트·포맷 | ESLint + Prettier |
| CI | 나중에(백엔드와 함께 저장소 단위로) |

### 현행 결함 중 고칠 것
- 남은 투표권 항상 표시
- 관리자 로그 로드 실패를 오류로 표시
- 학기 표시 반전(2=여름, 3=가을) — 백엔드 값 확정 후
- 시험 형태 선택지 통일 — 백엔드 작업 중, API 수령 후

## 2. 라우트

| 주소 | 내용 |
|---|---|
| `/` | 검색 레이아웃 + 빈 상세. 마지막 강의 쿠키가 있으면 해당 강의로 리다이렉트 |
| `/courses/:courseId` | 검색 레이아웃 + 강의 상세(투표·통계·제보·한줄평·관리자 섹션) |
| `/admin/reports` | 제보 관리 |
| `/admin/stats` | 최근 통계량 |
| `/admin/logs` | 로그 |
| `/admin/colleges` | 학과 통계 |

검색 레이아웃은 `/`와 `/courses/:courseId`의 부모 라우트로 두어 강의를 바꿔도 검색창을 유지한다.
검색어 `?q=`는 두 주소 모두에서 유지한다.

## 3. 작업 목록

### A. API와 무관 — 지금 진행
1. `web/` 스캐폴드: React Router 8, TS, pnpm, Node 24. Tailwind 제거. ESLint + Prettier, Vitest + Testing Library, Playwright 설정.
2. 라우트 골격(2절), 루트 레이아웃(상단 메뉴), 404·오류 경계.
3. CSS: 전역(토큰·리셋)과 컴포넌트별 `.module.css`로 분할.
4. 순수 로직 이식 + 단위 테스트
   - 학과 표기(2개까지, 초과 시 "외 N")
   - 작성자명 마스킹
   - 코드포인트 기준 글자 수(한줄평 50자)
   - 숫자 입력 `e E + -` 차단
   - 통계 그래프 축 최대값(만점 또는 최대값)과 마커 위치
   - 투표 분포 비율
   - 날짜 기준 기본 시험 형태(`Asia/Seoul`) — 라벨 집합은 API 수령 후 교체
5. 표시 컴포넌트(데이터는 props로만 받음): 통계 그래프, 투표 분포, 강의 목록 항목·배지, 토스트, 관리자 파일 미리보기(img/iframe).
6. 폼 골격: 직접 제보·간편 제보·한줄평·프로필. 마크업과 JS 보강(임시저장, 카운터, 키 차단)까지. action 연결은 B.
7. 모바일(1068px 이하) 강의 선택 시 검색창 접힘.
8. 로그인 결과 `?auth=ok|forbidden|error` 토스트 후 주소 정리.
9. 마지막 강의 쿠키: 저장·읽기·`/` 리다이렉트(강의 ID 형식은 API 수령 후 확정).
10. Playwright 스모크: 라우트 골격이 SSR로 뜨는지.

### B. API 계약 수령 후
1. API 클라이언트·타입, 세션 쿠키 전달, CSRF.
2. 라우트별 loader/action 연결.
3. 서버 검색(`?q=`), 기본 정렬, 10개 단위 무한 스크롤. `courses.json` 다운로드 제거.
4. 학기 라벨·현재 학기, 시험 형태 목록, 남은 투표권을 서버 값으로.
5. 관리자 로그 실패 표시, 관리자 목록 "더 보기".
6. 브라우저 저장 키를 API 형식에 맞춰 수정.
7. 보존할 동작 목록(`non-backend.md` 2절) 테스트 고정, E2E 흐름(로그인·검색·제보·투표·관리자 승인).
8. 전환: 호스팅(백엔드 D6), `vercel.json` 재작성, `public/`·`courses.json`·`scripts/build-courses.js` 제거, README 수정.
