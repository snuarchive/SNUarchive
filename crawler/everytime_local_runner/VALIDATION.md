# 2026-10-02 검증 기록

새 local runner의 구현과 합성 검증은 완료했다. **첫 실사이트 강의 수집은 blocked이며, Computer Use와의 실데이터 동등성은 아직 검증하지 못했다.** 이 결과로 다음 두 강의 또는 Priority A 전체에 진행할 수 없다.

## 실사이트 시도

- 대상: 프로그래밍방법론 · 정교민, `https://everytime.kr/lecture/view/603889?tab=article`
- 실행: `crawler/output/everytime_local_runner/programming_20261002_01/`
- Playwright 1.63.0, headed Chrome for Testing 153.0.8010.12 (Chromium build 1243).
- 2026-10-02 12:25 KST: 브라우저 실행 → 초기 로그인 대기 → 약 수 초 이내 인증/접근 제한 감지 → `blocked` 종료.
- 저장 리뷰 0, raw 배치 0. 강의 표시 총수·실제 강의 identity·리뷰 목록을 확인하지 못했다.
- 초기 실행이 원인을 `Login/access/challenge/dialog stop`으로 묶어 저장하여, CAPTCHA/제한 문구/dialog 중 정확한 원인은 사후 로그로 확정할 수 없다. 이를 특정 CAPTCHA나 사이트의 자동화 차단으로 단정하지 않는다.
- 이후 코드에는 `reason_code`와 마지막 DOM 보안 관찰의 boolean만 추가했다. 기존 실행 파일은 변경하지 않았고 실사이트 재시도도 하지 않았다.
- 특수교육학개론·기업재무론은 브라우저에 접속하지 않았다.

## 기존 Computer Use 자료

기존 worktree의 명시적 완료 archive를 읽어 raw schema·manifest SHA-256·저장 수를 오프라인으로 검증했다.

| 강의 / 교수 | 기존 저장 수 | baseline 위치 (`../SNUarchive-data/crawler/output/` 기준) | 새 실데이터 비교 |
| --- | ---: | --- | --- |
| 프로그래밍방법론 / 정교민 | 37 | `everytime_three_20260930T143702Z/603889/` | blocked로 미수행 |
| 특수교육학개론 / 김주선 | 61 | `everytime_match_20260930T161532Z/1785286/` | 미시도 |
| 기업재무론 / David Schoenherr | 55 | `everytime_priority_20261002/courses/A0002/` | 미시도 |

검증 inventory: `crawler/output/everytime_local_runner/validation_20261002/baseline_inventory.json`. 기존 원문과 새 원문의 필드 불일치, 리뷰 집합 불일치는 **판정 불가**다. 새 저장 수 0을 비교 가능한 빈 강의라고 처리하지 않았다.

## 합성 테스트와 회귀 테스트

- 새 Python unit test 9개: identity 상태, 빈 목록, partial, duplicate candidate 보존, fingerprint, manifest/checksum 변조, 저장 중단·기존 파일 보존, 순서·중복 횟수·필드 비교, 거짓 complete 거부, archive 비교 파일·checksum·덮어쓰기 거부.
- 새 JavaScript unit test 5개: 강의명/교수 불일치, 인증·CAPTCHA 중단, 실제 wheel 경계와 timeout 변환, UTF-8·배타적 저장, 직접 입력 없는 최초 로그인 대기.
- 실제 Playwright 엔진을 사용하는 **합성** 브라우저 통합 검증 1회: 모든 요청을 로컬 HTML로 처리해 실사이트 요청 0회. 20→37개를 정상 wheel로 로드하고 20+17개 배치 저장, 기존 raw/schema/fingerprint/checkpoint/최종화 검증 통과. 출력 `synthetic_browser_03pc3T/`. Unicode·줄바꿈·후행 공백 보존 확인.
- 기존 collector Python 46개, matcher Python 47개, 기존 JavaScript 33개 통과.
- 처음 회귀 실행은 새 worktree에 `crawler/output` 디렉터리가 없어 일부 테스트 fixture 생성에 실패했다. output 디렉터리 생성 후 전부 통과했으며 기존 테스트는 수정하지 않았다.
- Windows에서는 읽기 전용 descriptor에 fsync가 실패함을 합성 테스트로 발견해, 신규 파일을 변경 없이 writable handle로 열어 flush하도록 새 모듈에서 수정했다.

## 파일 checksum (SHA-256)

| 파일 | SHA-256 |
| --- | --- |
| 실사이트 blocked 실행 `local_manifest.json` | `ff2cd6234b91a7308296b02b86d9f468b5c8168144bda9dfcc05c35e317d002b` |
| 합성 브라우저 실행 `local_manifest.json` | `f10dc44fc71a80de862a4524737623dab0cf65e702631ca10df44a29a84bf410` |
| `validation_20261002/baseline_inventory.json` | `e69a69ff865e700c7167365694450b549cf2adb8988225b7f8a3913a1fc313b7` |

각 manifest에 개별 파일 SHA-256이 있으며 실제 파일과 재대조했다. 실사이트 raw checksum은 raw 미생성으로 해당 없음이다.

## DOM/UI 관찰 및 잔여 위험

실사이트의 강의·리뷰 DOM까지 도달하지 못했으므로 Computer Use와의 실제 DOM 차이는 확인하지 못했다. 기존에 관찰된 교수명 두 구조(`div.multiline > a.link`, `span.text`)와 일반/빈 개요의 개수 구조는 원본 collector를 통해 지원한다. 합성 DOM에서만 로컬 Playwright 호환을 확인했다.

다음 순서는 사용자 정상 로그인/접근 상태 확인, **프로그래밍방법론 한 강의 새 실행**, 기존 37개와 field 및 fingerprint multiset 비교, 결과 보고다. 이 단계가 성공해야 나머지 두 기존 강의로 확장할 수 있다. 자동 재시도·다른 브라우저 우회는 구현하지 않았다.

Priority A 전체 적용 전 남은 위험:

1. headed 임시 세션의 실제 로그인 완료와 제한 탐지 정확성 미검증. 보수적 visible CAPTCHA/제한 문구 감지가 오탐할 가능성도 남아 있다.
2. 실제 37/61/55개 원문 보존·집합 일치 검증 미완료. 사이트 신규 작성/수정도 baseline 차이를 만들 수 있다.
3. 느린 추가 로딩, virtualized DOM, 수집 도중 카드 변경, 필터·정렬 변경은 중단 대상. 현재 제한은 12 scroll / 20 batch다.
4. hard kill/전원 장애의 마지막 미완성 파일, 브라우저 세션 만료, 수동 재개 절차를 대량 운용 수준으로 검증하지 않았다. 자동 resume/queue를 아직 제공하지 않는다.
5. fingerprint는 사이트 review ID가 아니다. 중복 후보를 자동 제거하지 않으며 review ID·작성/수정일은 계속 null이다.

변경/생성은 `crawler/everytime_local_runner/` 신규 모듈과 Git 제외 신규 output으로 한정했다. 기존 Computer Use 코드·extractor·raw/output은 수정하지 않았다. 신규 강의 수집, queue 실행, extractor 실행, DB 적재, 커밋·push·PR을 수행하지 않았다.
