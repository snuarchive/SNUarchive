# 백엔드 외 발견 사항 (프론트엔드·문서·저장소)

작성: 2026-09-27. 현행 코드(`public/`, `README.md`, 저장소 구성)를 읽으며 찾은 것 중
백엔드 설계와 직접 관계없는 항목. 백엔드 요구사항은 `feature/go-backend` 브랜치의 `docs/backend/requirements.md`에 따로 정리한다.

React 재작성 시 참고용이며, 현행 코드를 당장 고치자는 제안은 아니다.

---

## 1. 프론트엔드 결함

### 1.1 학기 표시 반전
`public/app.js:138` `semesterLabel`이 `2 → "2학기"`, `3 → "여름"`으로 표시한다.
원본 데이터는 `2 = 여름`, `3 = 가을(2학기)`이다(학기 파일 행 수로 확인: `-2.json` 약 300행, `-3.json` 약 7,600행).
- 강의 개설 이력이 가을 학기면 "여름"으로 보인다.
- 제보 폼 기본 학기(`currentAcademicTerm`, `app.js:147`)도 같은 반전 → 9~12월에 제보하면 2(여름)로 저장된다.
- 학기 셀렉트 옵션 순서도 1학기·2학기·여름·겨울로 보여 달력 순서와 어긋난다.

React 쪽 원칙: 학기 라벨·현재 학기는 서버 값(`/config`, `/me.calendar`)을 쓰고 클라이언트에서 계산하지 않는다.

### 1.2 시험 형태 선택지 불일치
- 직접 제보 폼: 중간·기말·1차·2차·3차·퀴즈·과제·기타 + 직접 입력 (`index.html:147-156`).
- 간편 제보 폼: 중간·기말·퀴즈·과제·기타 + 직접 입력 (`index.html:209-215`) — 1차·2차·3차 없음.
- 투표 선택: `ASSESSMENT_OPTIONS` 8개 + 직접 입력.
- 관리자 승인·수정 화면: 시험 형태가 자유 텍스트 input.
→ 선택지 출처를 하나(`/config.assessmentTypes`)로.

### 1.3 기타 UX 결함
- 남은 투표권 표시가 **이미 투표한 경우에만** 보인다 (`app.js:1118`). 첫 투표 전에는 한도를 알 수 없다.
- 관리자 로그 로드 실패를 조용히 빈 목록으로 삼킨다 (`app.js:1271`).
- `init`이 로그인 여부와 무관하게 `courses.json`(6.4MB)을 먼저 받는다 (`app.js:1795`). 로그인 화면에서도 전량 다운로드.
- 강의 선택 시 매번 `renderSearch()`로 목록 전체를 innerHTML 재생성.

## 2. React 재작성 시 보존할 동작 목록

| 영역 | 현행 동작 | 위치 |
|---|---|---|
| 검색 | 공백으로 나눈 모든 토큰이 공백 제거·소문자 문자열에 포함(AND) | `app.js:123-136,447` |
| 기본 정렬 | 즐겨찾기 → 투표중 → 최근 제보 → 최근 개설 → 강의명·교수(ko) | `app.js:430` |
| 목록 페이지 | 10개 단위 무한 스크롤 | `COURSE_BATCH_SIZE` |
| 배지 | 즐겨찾기 / 투표중 / 최근 제보 날짜 | `app.js:496` |
| 학과 표기 | 2개까지 나열, 초과 시 "외 N" | `departmentsText` |
| 기본 시험 형태 | 날짜 기준: 4/15~5/5·10/15~11/5 중간, 6/10~6/30·12/10~12/30 기말, 그 외 중간 | `defaultAssessmentByDate` |
| 직접 제보 임시저장 | localStorage `snu-archive:direct-report-draft` (강의별 1건) | `app.js:921` |
| 닉네임 기억 | localStorage `snu-archive:last-nickname` | `app.js:952` |
| 마지막 강의 복원 | localStorage `snu-archive:selected-course-key` | `app.js:578` |
| 프로필 배너 숨김 | sessionStorage, 이메일별 키 | `app.js:243` |
| 로그인 결과 토스트 | `?auth=ok|forbidden|error` 처리 후 URL 정리 | `app.js:1806` |
| 모바일 | 1068px 이하에서 강의 선택 시 검색창 접힘 | `MOBILE_QUERY` |
| 한줄평 | 코드포인트 기준 50자 카운터, 0자/초과 시 제출 비활성 | `app.js:765` |
| 숫자 입력 | `e E + -` 키 차단 | `app.js:1694` |
| 통계 그래프 | Q1~Q3 범위 막대 + Q1/Q2/Q3/평균 마커, 축 최대 = 만점 또는 최대값 | `statGraph` |
| 투표 | 5단계 라벨(매우 쉬움~매우 어려움), 분포 막대, 재투표 버튼 | `renderPoll` |
| 관리자 | 탭 4개(제보 관리·최근 통계량·로그·학과 통계), 10/50개 "더 보기" | `setAdminTab` |
| 관리자 제보 카드 | 이미지 `<img>`, PDF `<iframe>` 인라인 미리보기 | `quickReportViewer` |
| 강의 페이지 관리자 섹션 | 해당 강의의 대기 중 간편 제보 | `renderCourseAdminSection` |

## 3. 문서(README)와 구현 불일치
- "난이도 투표는 과거 학기 대상으로 새로 열 수 없고" — 구현 없음. 투표 개설 시 학기 검사 없음.
- "중간/기말 시험 기간 단위로 계정당 10회" — 구현은 4/15·6/10·10/15·12/10 경계 창 단위. 경계 날짜가 문서에 없다.
- README 예시의 `ADMIN_EMAILS`에 실제 계정 형태 주소가 들어 있고, 코드도 설정이 없으면 같은 주소들을 기본 관리자로 쓴다.
- 로컬 실행 안내가 PowerShell 명령만 제공(`copy`).
- `EMAIL_HASH_SECRET`은 문서상 필수처럼 보이지만 `AUTH_SESSION_SECRET`이 있으면 쓰이지 않는다.

## 4. 저장소 구성
- 원본 학기 JSON 9개(합계 약 15MB)가 저장소 루트에 있다 → `data/catalog/` 등으로 이동 고려.
- 빌드 산출물 `public/courses.json`(6.4MB)을 커밋하는 방식 → 서버 검색으로 전환하면 불필요.
- 테스트·CI·린트 없음. `validate`는 파일 존재·형식 확인, `smoke`는 데모 인증이 켜진 경우에만 동작.
- `vercel.json`은 `/api/` 외 전부 `index.html`로 rewrite(SPA). React 전환 후 호스팅 결정에 따라 재작성.
- 원격에 오래된 브랜치 `feature/firebase-migration`, `feature/ux-and-comments` 잔존.
