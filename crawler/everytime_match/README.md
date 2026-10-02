# 서울대 카탈로그 → Everytime 검색 매칭 표본 검증

**2026-10-01 전체 queue:** 19,155개 입력을 383개 batch로 나눈 재개 가능한 queue와 교수명 구조 수정은 [FULL_COLLECTION.md](FULL_COLLECTION.md)를 참고하세요. 전체 수집을 시작했으나 로컬 전송 검증 문제의 반복으로 두 번째 batch에서 중단했습니다. 아래 표본 기록과 제한은 이전 실행에 관한 내용입니다.

**2026-10-01 후속 배치:** 22개 입력의 제한 실행과 queue 생성 기능은 [BATCH_PILOT.md](BATCH_PILOT.md)를 참고하세요. matched 19 / ambiguous 2 / not_found 1, 수집 완료 18 / partial 1, 원문 68개를 보존했습니다. 아래 내용은 앞선 5개 표본과 레거시 1~10개 CLI의 기록입니다. 이후 실제 빈 검색 UI와 111·128개 검색 후보의 추가 로드를 확인했습니다.

`public/courses.json`에서 **명시적으로 고른 최대 10개 항목**을 정상 검색 UI의 관찰값과 대조합니다. 기존 `everytime_collect`와 `everytime_stats`는 수정하지 않습니다. 이 모듈은 오프라인 판정·연결 도구이며 브라우저 드라이버나 HTTP 클라이언트가 없습니다. 전체 강의 자동 순회 기능도 없습니다.

## 실행 절차

1. 카탈로그의 `course_key`, 원문 `title`, 원문 `instructor`를 선택 목록에 보존합니다. 빈 교수명과 `미정`도 입력 그대로 보존합니다.
2. 승인된 기존 Chrome `cua_repl`에서 `에브리타임 서울대` 헤더를 확인한 뒤 검색창에 강의명 원문을 입력하고 제출합니다. 이번 실행은 과목명 검색 3회로 5개 입력을 검사했습니다. 같은 강의명의 서로 다른 교수 입력은 동일 검색 근거를 공유합니다.
3. 검색 URL·검색어·선택 모드·관찰 시각·카드 위치·원문 강의명·원문 교수명·실제 링크를 보존합니다. 실제 확인한 카드 구조는 `div.lectures > a.lecture`, 이름은 `:scope > div.name`, 교수명은 `:scope > div.professor`입니다. 교수 요소가 없으면 `null`입니다. 링크의 숫자는 관찰된 URL 검증에만 쓰며 URL을 생성해 탐색하지 않습니다.
4. 원문 두 필드가 정확히 일치하는 후보 하나만 `matched`입니다. 관찰한 검색 범위의 바닥을 확인하지 못했거나 50개 후보 상한에 닿으면 보류합니다. 원문을 정규화하거나 교수명 없는 후보를 `미정`과 같다고 판단하지 않습니다.
5. `collector_target(record)`가 판정을 다시 검증한 경우만 기존 `createEverytimeCollector(target)`와 기존 비동기 생성기에 연결합니다. collector가 상세 페이지의 실제 강의명·교수를 다시 대조합니다. 배치 반환 → 검증 → 비공개 저장 → 다음 배치 절차를 유지합니다.
6. 기존 `finalize-course-run`으로 보관된 실행 보고서를 `attach_collection`에 연결합니다. 매칭 입력과 다른 강의 보고서는 거부하며, 수집 `partial`을 `complete`로 바꾸지 않습니다.

정상 검색은 도구 UI에서 수행합니다. 이 모듈은 관찰값을 읽는 로컬 CLI이며 검색 전체를 무인 자동화한 기능이 아닙니다.

```powershell
# --course-key를 명시적으로 반복하며 최대 10개만 허용
.\.venv\Scripts\python.exe -X utf8 -B -m crawler.everytime_match `
  --course-key 2295806d9ad24d70cc5d `
  --observations crawler/data/private/<새실행>/search_observations.json `
  --output crawler/output/<새실행>/matching_decisions.json
```

입력 observation은 기존 로컬 저장기의 2 MiB·비공개 경로 검증을 사용합니다. 출력 파일은 배타적으로 생성하여 기존 파일을 덮어쓰지 않습니다. 선택은 1~10개를 지원하고 이번 실제 표본은 5개입니다. 이번 실행의 검색 제출 상한은 제목별 2회, 검색 스크롤 상한은 2회, 후보 상한은 50개였습니다. 실제 제출은 제목별 1회였고, 19개 검색 결과에만 스크롤 1회를 사용했습니다. 수집은 기존 기본 상한인 강의당 스크롤 12회, 배치 20회, 배치당 20개, 다음 카드 대기 1,500ms를 그대로 사용했습니다.

## 상태 구분

| 상태 | 판정과 처리 |
| --- | --- |
| `matched` | 관찰한 검색 결과에서 원문 강의명·교수가 일치하는 후보 하나. 상세 페이지에서도 재검증 후 수집 |
| `ambiguous` | 후보 여러 개, 불명확한 교수, 표기 차이, 검색 범위 미확인 등. 수집하지 않음 |
| `not_found` | 정상 검색에서 결과 없음 문구의 가시성·위치가 실제 확인된 경우. 카드 0개만으로 판단하지 않음 |

이 표본에서는 `not_found`가 없었습니다. 코드의 `empty_evidence` 계약은 합성 테스트로만 검사했으며, 실제 사이트의 빈 검색 문구·선택자는 아직 구현에 고정하지 않았습니다. 빈 화면, 로딩 실패, 로그인 이동, 정책/접근 제한은 검색 실패/중단이며 `not_found`나 0개 수집 성공으로 바꾸지 않습니다. 중단 사유가 있으면 판정을 거부하고 UI 작업을 중단합니다. 우회나 재시도, 다른 브라우저, 직접 HTTP로 전환하지 않습니다.

후보 이름이 조금이라도 다르면 원문을 보존하고 보류합니다. 이는 일치할 수 있는 강의를 놓칠 수 있는 보수적 정책입니다. 검색 결과의 전역 완전성은 주장하지 않으며, 현재 관찰 범위 안에서 특정한 결과입니다.

## 실제 검증 (2026-10-01 KST)

| 카탈로그 입력 / 교수 | 실제 확인한 페이지 | 매칭 | 표시 / 저장 | 최초 / 배치 | 종료 근거 |
| --- | --- | --- | --- | --- | --- |
| 특수교육학개론 / 김주선 | https://everytime.kr/lecture/view/1785286 | matched | 61 / 61 | 20 / 4 | 20→40→60→61, 전체·등록순, 표시 수 일치와 바닥 2회 |
| 특수교육학개론 / 신혜연 | https://everytime.kr/lecture/view/2325346 | matched | 11 / 11 | 11 / 1 | 표시 수 일치와 바닥 2회 |
| 특수교육학개론 / 미정 | 19개 후보 보존, 확정 URL 없음 | ambiguous | 미확인 / 미수집 | — | 교수 누락 후보를 미정과 동일시하지 않음 |
| 정서 및 행동문제와 교육상담 / 김주선 | https://everytime.kr/lecture/view/2386432 | matched | 0 / 0 | 0 / 0 | 개요 `(0개)` + `첫 번째 강의평을 남겨주세요` + 실제 목록 바닥 |
| (공유)고급 빅데이터(특수연구) / 신대은 | https://everytime.kr/lecture/view/3049119 | matched | 1 / 1 | 1 / 1 | 표시 수 일치와 바닥 2회 |

5개 시도: matched 4, ambiguous 1, not_found 0. 확정 4개 모두 `complete`, 총 73개/6개 배치 저장. 항목 실패 0개, 실행 내부 중복 후보 0개. 외부 이전 raw와의 중복 비교는 이번 실행에서 요청하지 않았고 수행하지 않았습니다. fingerprint로 카드 병합·삭제를 하지 않습니다. 73개 모두 강의명·교수명·본문·수강학기·출처 URL·필드 근거를 보존했습니다. 리뷰 ID 및 작성/수정 시각은 모두 `null`입니다. 원문의 수강학기는 본문의 모든 시험 통계가 속한 학기로 확정하지 않습니다.

Git 제외 `crawler/output/everytime_match_20260930T161532Z/`에 강의별 raw·manifest·수집 보고서·매칭 보고서와 전체 `e2e_report.json`, `REPORT.md`를 저장했습니다. `crawler/data/private/everytime_match_20260930T161532Z/`에는 선택 원본·검색 관찰·무손실 전송본·보존 검증을 저장했습니다. 기존 collector/출력 파일 284개 해시가 유지됐고, 추적 중인 기존 파일 diff는 없습니다. 비밀번호·쿠키·토큰은 읽거나 저장하지 않았습니다.

## 테스트와 남은 문제

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -S -m unittest discover -s crawler/everytime_match/tests -v
.\.venv\Scripts\python.exe -X utf8 -B -S -m unittest discover -s crawler/everytime_collect/tests -v
node --test crawler/everytime_collect/tests/browser_collect.test.cjs crawler/everytime_collect/tests/browser_end.test.cjs
```

매칭 합성 테스트 14개, 기존 collector Python 30개 + JavaScript 16개 통과. 같은 이름의 다른 교수, 복수 정확 후보, 미정/빈 교수, 표기 차이, 명시적 빈 검색, 로딩·로그인·접근 제한, 잘못된 URL/검색어, 범위 상한, 대상 변조, 다른 강의 보고서, 부분 수집 상태 연결, 덮어쓰기 방지를 검사했습니다. 합성 테스트는 실사이트 수집 결과와 별개입니다.

전체 자동 순회 전에 해결할 사항:

- 미정·누락·다중 교수 및 이름 변경을 검토하고 확정하는 규칙과 수동 검토 기록.
- 띄어쓰기·괄호 등 표기 차이의 실제 사례 검증. 자동 정규화만으로 확정하지 않는 정책 유지.
- 검색 결과가 많을 때 페이지/추가 로드의 실제 UI 방식과 검색 범위 완전성 검증. 이번 표본 최대 후보는 19개이며 총 검색 결과 수 표시는 없었습니다.
- 실제 `not_found` UI와 중단 후 재개 절차의 검증. 접근 제한 후 재시도·우회 금지 유지.

커밋·push·PR은 수행하지 않았습니다.
