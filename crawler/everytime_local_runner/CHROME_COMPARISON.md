# 설치 Chrome + 전용 persistent profile 단일 비교 (2026-10-02)

> **초기 실행의 역사적 기록이다.** 이후 같은 실험용 프로필의 installed Chrome에서 수동 로그인과 정상 강의 접근이 확인됐고, `baseline_session_AdhpG9`의 세 강의 37/61/55개가 Computer Use 결과와 일치했다. 아래 `unexpected_ui`는 초기 `chrome_comparison_J8N2gg`에만 해당한다. 현재 운영·검증 상태는 [PIPELINE.md](PIPELINE.md)를 참조한다.

**결과: D. `unexpected_ui`. 정상 Google Chrome에서도 차단됐다고 판정할 근거는 확인되지 않았다.** 로그인 페이지 진입은 정상적이었지만 사용자 로그인 조작 중 의미를 분류하지 못한 JavaScript alert가 나타나 실험을 종료했다. 603889 상세 진입·identity 검증·37개 저장·Computer Use 비교는 수행하지 못했다. 이후 재접속이나 다른 강의 실행은 하지 않았다.

## 이전 bundled Chromium 실행 분석

원본: `crawler/output/everytime_local_runner/programming_20261002_01/`. 원본 manifest에 기록된 모든 파일의 SHA-256이 일치한다.

| 항목 | 이미 저장된 증거 |
| --- | --- |
| 브라우저 | Playwright 1.63.0 / bundled Chromium 153.0.8010.12 / 임시 context |
| 요청 대상 | `https://everytime.kr/lecture/view/603889?tab=article` (입력값이며 최종 관찰 URL이 아님) |
| block 당시 URL / page title | 미기록, 복원 불가 |
| HTTP status / redirect chain | 미기록, 복원 불가 |
| 정확히 일치한 DOM 조건 | 미기록 |
| 저장된 사유 | `Login/access/challenge/dialog stop; no retry` |
| 시각 | 12:25:08.440~12:25:11.467 KST, 약 3초 |
| 페이지 종류 / 수동 로그인 성공 | 미확인 |

당시 구현이 `blocked`로 처리할 수 있던 조건은 다음과 같다.

- 보이는 `iframe[src*="captcha"]`, `[id*="captcha"]`, `[class*="captcha"]` 중 하나라도 있음.
- 리뷰 밖의 보이는 텍스트에 `captcha`, 접근 제한, 너무 많은 요청, 비정상적인 접근, `잠시 후 다시` 등이 있음.
- 로그인 필요/만료 또는 최초 로그인 대기 timeout.
- 예상하지 못한 사이트 dialog.

900초 timeout은 약 3초의 실행 시간과 맞지 않는다. 그 밖의 조건 중 실제 분기는 확정할 수 없다. 당시 `reason_code`, URL, title, DOM boolean을 저장하지 않았으므로 현재의 개선 코드를 과거의 관찰 증거로 취급하지 않았다. 따라서 이전 결과는 **runner의 blocked 판정**이며 **사이트가 실제 접근 차단을 했다는 확인**과 구분해야 한다.

## 이번 단일 비교의 실행 조건

- Windows 설치 파일 확인: `C:/Program Files/Google/Chrome/Application/chrome.exe`, **153.0.8010.53**.
- 공식 지원 방식: `chromium.launchPersistentContext(profile, {channel: 'chrome', headless: false, viewport: {width: 1280, height: 900}})`.
- 새 프로필: `crawler/data/private/everytime_local_profile/`. `crawler/.gitignore`의 `/data/private/` 규칙 적용 및 `git ls-files` 비추적 확인.
- 사용자의 기본 Chrome 프로필 접근·수정·복사 없음. 쿠키/token 추출·출력·별도 세션 파일 생성 없음. persistent 프로필 자체의 내부 저장은 Chrome이 관리한다.
- 새 프로필의 password-manager 저장 기능만 비활성화했다. 자격 증명 입력은 사용자만 수행했다.
- stealth plugin, webdriver/UA 조작, 임의 anti-detection launch flag, CAPTCHA 처리·우회 없음.
- 정상 document navigation의 status와 redirect 관계만 관찰했다. API 요청 분석·응답 본문/headers/body 수집 없음.
- 진단 URL은 credential/query/fragment를 제거하고, 미지의 path/title은 redaction한다. 폼 값·계정 정보·dialog 원문은 기록하지 않았다.
- 실험 스크립트는 target을 603889로 고정하고, 이미 존재하는 프로필을 자동 재사용하거나 다른 강의를 실행하지 않는다.

공식 근거: [Playwright branded browser channels](https://playwright.dev/docs/browsers), [launchPersistentContext와 별도 user-data directory](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).

## 이번에 직접 확인한 UI와 HTTP 증거

실행 폴더: `crawler/output/everytime_local_runner/chrome_comparison_J8N2gg/`.

| 관찰 순서 | 쿼리 제거 URL | HTTP status |
| --- | --- | ---: |
| 강의 개요 요청 | `https://everytime.kr/lecture/view/603889` | 302 |
| 로그인 경유 | `https://everytime.kr/login` | 302 |
| 실제 로그인 페이지 | `https://account.everytime.kr/login` | 200 |

최종 page title은 **`로그인 - 에브리타임`**이다. 마지막 DOM은 login form 있음, login URL 일치, 강의 개요 item 0, article list 0이었다. 명시적 접근 제한·rate limit·비정상 접근·사람 인증 문구는 모두 false였다.

`captcha_marker_visible=true`, `active_challenge=false`가 관찰됐다. 새 진단에서는 일반 CAPTCHA 관련 marker/배지/안내만으로 block을 단정하지 않으며, 실제 challenge가 관찰되면 진행하지 않는다. 기존 코드는 marker만으로도 block을 판정할 수 있으므로 **이전 오탐 가능성**은 있다. 하지만 브라우저·프로필·진단 분류가 함께 달라졌고 과거 DOM 증거가 없어서 단일 원인을 입증하지는 못했다.

12:53:35 KST, 로그인 조작 도중 `type=alert`가 발생했다. 고정된 접근 제한·인증 요구·CAPTCHA 문구 분류 어디에도 일치하지 않았다. runner가 알림을 dismiss한 뒤 종료해 의미를 확인할 수 없었다. 사용자는 이후 “직접 로그인 완료”라고 응답했지만 알림 내용은 확인하지 못했다고 답했다. 이는 **사용자 완료 응답**으로 별도 기록하고, **인증된 강의 페이지 도달 확인**과 동일시하지 않았다.

이 때문에 `manual_login_confirmed=false`, `identity_verified=false`이며 outcome은 `unexpected_ui`다. 로그인 성공·비밀번호 오류·사이트 차단 등 어느 하나로 추정하지 않았다. 정상 Chrome에서도 blocked인지에 대한 답은 **확인되지 않음**이다.

## 저장 및 비교

- 실사이트 리뷰 저장 0, raw 배치 0.
- 37개 저장 조건은 정상 접근·원문 강의명/교수명 확인·전체/등록순·표시 37개와 로드/성공 37개 일치·끝 도달 검증이다. 이번에는 충족하지 않았다.
- review count/text/enrollment_term_raw/source URL/fingerprint 집합 비교는 미수행이며, 불일치 없음으로 보고하지 않는다.
- 진단 파일: `invocation.json`, `browser.json`, `diagnostics.json`, `experiment_result.json`, `experiment_manifest.json`, `experiment_manifest.sha256`.
- 사후 분석은 `old_block_analysis.json`, `operator_followup.json`, `review_manifest.json`으로 별도 추가했다. 최초 실험 manifest와 이전 실행 파일은 수정하지 않았다.

## 변경 및 테스트

새 코드 `chrome_experiment.cjs`, `chrome_diagnostics.cjs`와 합성 테스트 `tests/chrome_diagnostics.test.cjs`를 추가했다. local runner의 `adapter.cjs`에는 실험별 guard를 주입하는 선택적 인자만 추가했다. 기본 guard의 동작 및 기존 Computer Use collector/extractor 파일은 변경하지 않았다.

새 진단 합성 테스트 3개와 기존 local adapter 테스트 5개를 통과했다. URL/title redaction, 로그인/명시적 제한/unknown UI의 분리, 단순 CAPTCHA 안내와 활성 challenge의 구분을 검사했다. 이러한 합성 테스트를 로그인 성공 증거로 취급하지 않는다.

## 다음 단계

이번 단일 비교는 여기서 종료한다. Priority A, 다른 강의, 자동 재접속을 실행하지 않는다. 다음 진단이 별도로 요청되면 **알 수 없는 알림을 즉시 닫지 않고 사용자가 내용을 확인할 수 있게 유지하는 흐름**부터 보완해야 한다. 그 뒤 동일한 603889에서 정상 강의 도달 여부를 확인하는 것이 우선이다. alert의 의미가 불명확한 상태에서 Chrome 자체가 차단됐다고 결론내리거나 anti-detection 조치를 추가할 근거는 없다.

커밋·push·PR, 신규 강의 수집, queue 실행, extractor 실행, DB 적재 없음.
