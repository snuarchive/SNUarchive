# 20~30개 제한 배치와 검토 queue

이번 실행은 `public/courses.json` 19,155개 중 **명시적으로 선택한 22개 입력**만 대상으로 했습니다. 처음 20개(목록 앞 18개 + 미정 교수의 대학 글쓰기 1·대학영어 1)에 빈 검색 사례를 확인하기 위한 2개를 추가했습니다. 선택 파일 20·21·22개 버전을 모두 보존했습니다. 무작위·대표 표본이 아니며 전체 목록 성공률로 일반화할 수 없습니다.

## 결과와 저장 위치

- 입력 22개, 제목별 정상 UI 검색 제출 20회. 같은 제목의 교수별 입력은 동일 검색 근거를 공유했습니다.
- matched 19 / ambiguous 2 / not_found 1. 수집 queue 19개, 별도 검토 queue 3개.
- 수집 완료 18개(리뷰가 있는 강의 12개 + 명시적 빈 목록 6개), partial 1개. 원문 68개 / 12개 배치, 리뷰 항목 실패 0개.
- 마지막 `거시경제학특수연구 (비동질적 거시경제모형의 수량적 분석)` / 홍재화는 검색에서 정확 일치했지만 상세 교수명이 `section.info > div.item > span.text`로 표시됐습니다. 기존 collector의 교수 링크 선택자와 달라 `Course value missing or ambiguous`로 중단했습니다. 읽기 전용 진단에서 개요 `(0개)`가 보였어도 수집 성공으로 바꾸지 않았습니다. collector는 수정하지 않았고 재시도하지 않았습니다.
- 로그인 만료·보안 거부·rate limit은 관찰되지 않았습니다. 마지막 UI 형태 차이로 실행 상태를 `stopped`로 남겼습니다.

Git 제외 위치:

- `crawler/data/private/everytime_queue_20261001T031939Z/`: 선택 원본, 검색 관찰값과 근거, 무손실 전송본, UI 보고서, 진단, 보존 검사.
- `crawler/output/everytime_queue_20261001T031939Z/queues/`: 최초 queue 3종. 실행 후에도 덮어쓰지 않습니다.
- 같은 output의 `execution_report.json`: 완료/partial 상태를 연결한 새 실행 보고서.
- 같은 output의 `courses/<관찰된 강의 ID>/`: 강의별 기존 collector raw·manifest·보고서. 0개 성공과 초기 중단은 가짜 빈 raw를 만들지 않습니다.
- 같은 output의 `REPORT.md`: 강의별 URL·표시/저장 수·중단 사유·검증 결과.

원문 68개 모두 강의명·교수명·본문·수강학기·출처 URL·필드 근거를 확보했습니다. 리뷰 ID 및 작성/수정 시각은 미확인으로 `null`입니다. 수강학기는 본문의 모든 시험 통계에 일괄 적용하지 않습니다. fingerprint는 후보 표시용이며 카드 병합·삭제는 없습니다. 이전 실행 raw와의 외부 중복 비교는 하지 않았습니다.

## 판정과 queue

`batch_queue.py`는 20~30개 명시적 catalog key만 받습니다. 자동 전체 목록 모드는 없습니다. 입력 원문을 보존하고 정상 검색에서 반환된 URL·강의명·교수명·카드 위치·검색 범위만 사용합니다.

- 원문 강의명과 교수명이 정확히 일치하는 후보 하나만 matched.
- 띄어쓰기·괄호·영문 이름 등을 정규화해 일치를 만들지 않습니다.
- 교수 `null`·빈 문자열·공백·미정·담당교수 등은 검색이 비어도 ambiguous.
- 결과 0카드만으로 not_found를 만들지 않습니다. 실제 관찰한 `div.lectures > div.alert > p.noresult`의 **검색된 강의가 없습니다** 가시성이 필요합니다.
- 동일 URL이 여러 입력에 확정되면 충돌한 입력 모두 검토 queue로 보류합니다. 한 입력에 정확 후보 URL이 여러 개여도 보류합니다.
- 같은 제목을 여러 번 검색한 근거 중 유리한 결과를 고르는 방식은 거부합니다.
- 검색 실패/로그인/접근 제한은 not_found가 아닙니다. 이미 판정한 입력과 미시도 입력을 구분해 중단 상태로 보존합니다.

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m crawler.everytime_match.batch_queue `
  --selection crawler/data/private/<새실행>/selection.json `
  --searches crawler/data/private/<새실행>/searches.json `
  --output crawler/output/<새실행>/queues

# 종료된 기존 collector run_report.json만 명시적으로 반복 전달
.\.venv\Scripts\python.exe -X utf8 -B -m crawler.everytime_match.batch_execution `
  --queue crawler/output/<새실행>/queues/batch_queue.json `
  --report crawler/output/<새실행>/courses/<관찰된ID>/run_report.json `
  --output crawler/output/<새실행>/execution_report.json
```

선택 파일은 `{ "catalog": "public/courses.json", "courses": [카탈로그 원본 행들] }`, 검색 파일은 관찰값 배열입니다. CLI는 카탈로그에서 key를 다시 조회해 선택 원문과 일치하는지 확인합니다. 기존 1~10개 CLI·schema 1/2 raw·37개 이전 표본은 유지합니다.

## 브라우저 절차와 상한

정상 접근에 성공한 동일 Chrome 확장 경로의 `cua_repl`만 사용했습니다. UI 검색 입력·Enter·화면 내부 스크롤·관찰된 후보 URL 이동만 수행했습니다. 다른 브라우저 생성/HTTP/CDP/endpoint 추측/순차 ID 탐색은 없습니다.

`browser_pilot.js`는 이를 재사용할 수 있게 정리한 오케스트레이션입니다. 브라우저를 생성하거나 파일·인증정보에 접근하지 않습니다. 승인된 탭과 **기존** `createEverytimeCollector`, `collectCourseToEnd` 함수를 주입해야 합니다. 전체 목록을 읽는 함수도 없습니다.

**검증 구분:** 이번 실사이트 실행은 REPL의 제한된 검색·queue helper와 기존 collector를 사용했습니다. `browser_pilot.js` 파일은 그 절차를 실행 후 정리했고 합성 브라우저로 테스트했습니다. 이 새 파일 자체를 실사이트에서 다시 실행한 것은 아닙니다.

```javascript
const pilot = createEverytimePilot();
// tab은 이미 정상 UI에서 확보한 같은 승인 브라우저의 검색 페이지.
const searches = pilot.searchSelected(tab, selectedCatalogRows);
let event = await searches.next();
// event.value.observation을 무손실 반환 → 로컬 검증 → 새 비공개 파일 저장.
// 성공한 경우에만 searches.next({saved: true, query: event.value.query}).

const run = pilot.collectQueued(tab, verifiedQueue, createCollector, collectToEnd);
event = await run.next();
// batch: 기존 pack/unpack-transfer → save-batch-event 성공 후
// run.next({saved:true, course_key: event.value.course_key, type:'batch', batch:event.value.batch})
// complete: finalize-course-run 성공 후
// run.next({saved:true, course_key: event.value.course_key, type:'complete'})
// progress는 기록하고 다음 이벤트로 진행. stopped는 보존하고 종료.
```

- 입력 상한 30개. 이번 실제 입력은 22개.
- 검색 후보 상한 160개, 검색 스크롤 상한 12회, 추가 카드 대기 2초, 최초 결과 대기 5초. UI 바닥에서 두 차례 안정된 현재 후보 범위만 인정하며 검색 전체의 전역 완전성을 주장하지 않습니다.
- 패키징한 검색 helper는 검색당 누적 60초를 검사하고 초과 시 중단합니다. 실사이트 REPL helper에는 이 누적 시간 검사가 없었고, 제한된 스크롤·각 카드 대기와 도구 호출 상한을 사용했습니다. 따라서 60초 자동 중단은 합성 검증 결과입니다.
- 기존 collector 상한 유지: 강의당 스크롤 12회, 배치 20회, 배치당 20개, 추가 카드 대기 1.5초, 비교 파일 20개. 상한 도달/개수 불일치는 partial. 초기 20개 초과 로드도 기존 collector가 순서대로 분할합니다.
- 매 배치 반환 → 검증 → 비공개 저장 → 다음 배치. 저장 확인 없는 진행은 중단합니다.
- partial·로그인 만료·정책 거부·접근 제한·검색/상세 UI 변화는 후속 강의로 진행하지 않습니다. 이전 배치와 미시도 queue를 남기고 자동 재개하지 않습니다.

## 추가 검증 항목

| 항목 | 실사이트 관찰 / 합성 테스트 구분 |
| --- | --- |
| 검색 20개 초과 | 대학 글쓰기 1: 20→111, 대학영어 1: 20→128. 실제 스크롤로 뒤쪽 링크까지 보존 |
| 빈 검색 | 글로벌 공학기술 교류 특강 1 (미세유체 시스템과 바이오메디컬 응용) / 김호영. 실제 빈 검색 문구 확인, not_found |
| 이름·교수 표기 차이 | 대학영어 후보에서 띄어쓰기/영문 표기 차이 관찰. 원문 보존. 작은 차이가 matched 되지 않는 판정은 합성 테스트 |
| 교수 미정/빈값 | 실제 미정 입력 2개 모두 ambiguous. 선택한 카탈로그에 빈 교수 입력은 없었고 빈값은 합성 테스트 |
| 동일 URL 여러 입력 | 실제 확정 URL 충돌 0. 충돌 시 모두 보류하는 경우는 합성 테스트 |
| 동일 입력 여러 URL | 실제 복수 정확 후보 0. 여러 정확 후보 차단은 합성 테스트 |
| 초기 20개 초과/여러 배치 | 새 검색 helper와 기존 collector 합성 테스트. 이번 실수집 최대 리뷰 15개로 한 배치 이내 |
| 초기 중단 | 실제 교수명 표시 구조 차이로 1개 partial. 표시 0개 진단과 성공 판정을 분리 |

이번 전송 과정에서 검색 packet 복사 오류는 파일 저장 전 chunk 검사로 차단했습니다. 리뷰 packet 1건은 decoder 해시 검사에서 거부되어 raw를 생성하지 않았고, 동일한 이미 반환된 packet을 정확히 옮긴 새 전송 파일로 검증 후 저장했습니다. 본문을 재작성하거나 사이트를 재요청하지 않았습니다. 이 복구된 전송 오류는 수집 리뷰 실패와 별도입니다.

## 로컬 테스트와 다음 결정

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -S -m unittest discover -s crawler/everytime_match/tests -v
node --test crawler/everytime_match/tests/browser_pilot.test.cjs
.\.venv\Scripts\python.exe -X utf8 -B -S -m unittest discover -s crawler/everytime_collect/tests -v
node --test crawler/everytime_collect/tests/browser_collect.test.cjs crawler/everytime_collect/tests/browser_end.test.cjs
```

매칭/queue Python 28개 + 오케스트레이션 JavaScript 12개, 기존 collector Python 30개 + JavaScript 16개 = 86개. extractor는 실행하지 않습니다.

전체 순회 전에는 이번에 발견한 링크 없는 교수명 상세 UI를 어떤 근거로 검증할지, 미정·표기 차이 검토 승인 기록, 실제 결과 총수 표시가 없는 검색의 누락 가능성, 안전한 중단/재개 및 브라우저→파일 전송 방식을 해결해야 합니다. 이번 결과로 전체 순회를 시작하지 않았습니다. collector/extractor·기존 데이터/출력·Go·프론트·DB를 변경하지 않았고 커밋·push·PR은 없습니다.
