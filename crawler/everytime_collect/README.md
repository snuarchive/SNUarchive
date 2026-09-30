# Everytime 명시적 강의 수집기

승인된 기존 Chrome `cua_repl` 탭에서 **입력한 한 강의씩** 관찰합니다. `0.3.0-explicit-course`는 강의 URL·예상 강의명·교수명을 입력받으며, 고정된 603889 처리를 제거했습니다. 전체 강의 탐색, ID 순회, HTTP/API 호출, 브라우저 시작·전환, 로그인·자격 증명 내보내기는 구현하지 않습니다.

## 검증과 범위

URL은 `https://everytime.kr/lecture/view/<양의 정수>`와 그 URL의 `?tab=article`만 허용합니다. 추가 쿼리, 다른 호스트·경로, fragment를 거부합니다. 숫자는 **이미 UI에서 확인한 URL을 검증**하는 데만 사용하며 후보 URL을 생성하거나 순회하지 않습니다.

개요의 `과목명`, `교수명` 표시를 입력과 정확히 대조합니다. 같은 강의의 실제 `강의평` 링크로 이동하고 이후 각 읽기 전후 URL, 문서 제목, `전체`·`등록순` 표시를 확인합니다. 다른 강의·로그인·목록 변경·오류이면 `partial`로 중단합니다. 정책 거부·접근 제한·로그인 만료 후 재시도나 대체 브라우저 경로를 사용하지 않습니다. 재로그인은 사용자가 직접 수행합니다.

이미 강의평 탭에 있는 경우에는 같은 승인 브라우저의 **같은 강의 개요 탭**을 `overviewTab`으로 명시해 이름·교수를 검증합니다. 원래 강의평 탭을 개요로 돌리지 않으므로 20개 초과 사전 로드 상태도 보존됩니다. UI에 없는 리뷰 ID와 작성/수정 시각은 `null`입니다. 원문 수강학기는 본문에 등장하는 모든 시험 통계의 학기를 뜻하지 않습니다.

## 구성

- `browser_collect.js`: `createEverytimeCollector({url, title, instructor})`. 개요 검증, 실제 카드 읽기, 최대 20개 raw 배치 작성.
- `browser_collect_to_end.js`: `collectEverytimeToEnd(tab, collector, options)` 비동기 생성기. 관찰한 목록 내부의 정상 UI 스크롤만 수행.
- `target.py`, `raw.py`: 엄격한 대상 URL·이름 및 schema 1/2 검증. 기존 자료를 변환하지 않음.
- `archive.py`: 새 폴더에 raw와 manifest를 보존. fingerprint는 중복 후보 표시만 하며 같은 본문의 별도 카드도 모두 저장.
- `run_v2.py`: 배치를 즉시 저장하고, 마지막에 이미 저장된 배치·개수·종료 근거를 검증해 보고서 작성. 빈 목록 및 중간 중단도 지원.
- `course_run.py`: 기존 실행 보고서의 검증·보관 호환성 유지. 새 실행은 아래 `finalize-course-run` 사용.
- `browser_pack.js`, `transfer.py`: 브라우저가 반환한 JSON의 무손실 압축 전달. 사이트에 접근하지 않으며 길이·FNV-1a 64 체크섬 불일치를 거부. 원문의 재작성·요약 없이 전달하며, 보관 시 SHA-256도 기록. FNV는 전송 오류 검사이며 출처 인증이나 리뷰 ID가 아님.

## 실행

Python은 브라우저를 열지 않습니다. 아래 명령은 승인된 `cua_repl`에서 바인딩할 함수 표현식만 출력합니다.

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m crawler.everytime_collect browser-script
.\.venv\Scripts\python.exe -X utf8 -B -m crawler.everytime_collect browser-end-script
.\.venv\Scripts\python.exe -X utf8 -B -m crawler.everytime_collect browser-pack-script
```

```javascript
// 세 함수 표현식을 각각 createCollector, collectToEnd, packObservation에 바인딩
const collector = createCollector({url: observedUrl, title: expectedTitle, instructor: expectedInstructor});
const iterator = collectToEnd(tab, collector, {overviewTab, maxScrolls: 12, maxBatches: 18});
let event = (await iterator.next()).value;
// batch/failed_batch: 반드시 반환 → 검증 → 비공개 저장을 마친 뒤 next()
nodeRepl.write(JSON.stringify(packObservation(event)));
// progress: 카드 수·바닥·필터·정렬 기록; 다음 next()로 진행
// complete: event.report를 새 ui_run_report.json으로 전달
```

반환된 압축 JSON은 새 `crawler/data/private/<실행명>/batch_001.pack.json`에 전달합니다. 길이 제한으로 출력이 잘리면 메모리에 이미 반환된 **동일 값**을 작은 조각으로 전달합니다. 사이트를 다시 읽는 과정이 아닙니다. 체크섬 실패 시 저장·다음 배치 진행을 중단하고, 원래 반환값에서 오류 난 압축 조각을 다시 전달합니다. 본문을 손으로 고치지 않습니다.

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m crawler.everytime_collect unpack-transfer --input 'crawler/data/private/<실행명>/batch_001.pack.json' --output 'crawler/data/private/<실행명>/batch_001.json'
.\.venv\Scripts\python.exe -X utf8 -B -m crawler.everytime_collect save-batch-event --input 'crawler/data/private/<실행명>/batch_001.json' --output 'crawler/output/<새 실행명>/<강의>/batch_001'
```

성공 이벤트는 `batch_event.json`, `raw.json`, `manifest.json`을 저장합니다. raw는 반환된 observation을 로컬에서 기계적으로 직렬화하며 모든 필드·원문 문자열을 그대로 유지합니다. 기존 `save-observation`은 입력 파일 바이트 그대로 보관합니다. 전 항목 실패 이벤트는 빈 raw를 만들지 않고 `batch_event.json`에 실패 위치·사유를 보존합니다. 성공/실패가 섞인 배치는 성공한 리뷰를 보존하고 중단합니다.

각 배치의 `--against`에는 명시적 이전 raw와 이번 실행에서 먼저 저장한 raw를 줄 수 있습니다. 같은 본문의 별도 카드를 없애거나 합치지 않습니다. 모든 출력 파일은 새로 생성하며 기존 raw·manifest·실행 보고서를 덮어쓰지 않습니다. 디스크 오류가 나면 기존 배치를 그대로 두고 새 부분 파일과 오류를 확인해야 합니다.

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m crawler.everytime_collect finalize-course-run --input 'crawler/output/<새 실행명>/<강의>/batch_001/batch_event.json' --input 'crawler/output/<새 실행명>/<강의>/batch_002/batch_event.json' --report 'crawler/data/private/<실행명>/ui_run_report.json' --output 'crawler/output/<새 실행명>/<강의>'
```

빈 목록/첫 읽기 전 중단은 `--input` 없이 보고서를 보관합니다. 빈 목록은 표시 개수 0, 정확한 빈 목록 문구, 실제 목록 영역·전체 필터·등록순·바닥이 모두 확인될 때만 성공입니다. 페이지 로딩 실패는 `initial_loaded=null`, `status=partial`이며 0개 성공과 구분됩니다.

중간 도구 오류는 생성기가 `interrupted` 보고서를 반환하며 이전 배치는 보존됩니다. 로컬 저장 오류를 생성기에 전달하려면 `await iterator.throw(new Error("Local batch archive failed"))`로 중단 보고를 받고 추가 UI 동작을 하지 않습니다. 그 보고에는 반환 수가 있으므로 저장되지 못한 이벤트까지 정상 저장한 것처럼 `finalize-course-run`을 통과시킬 수 없습니다. 원본 이벤트·중단 보고와 이미 저장된 배치를 남겨 수동 확인합니다.

## 종료 조건과 제한

`complete`는 `전체`·`등록순`의 동일 목록 범위에서 표시 총수=로드 카드 수=저장 성공 수이고, 목록 바닥에서 두 차례 새 카드가 없을 때만 가능합니다. 예외는 명시적 빈 목록입니다. 두 번 변화가 없더라도 바닥이나 총수가 맞지 않으면 완료가 아닙니다. 오류·상한·개수 불일치는 `partial`입니다. `final_loaded`는 마지막으로 정상 검증한 상태이며 중단 이후의 화면 수를 추측하지 않습니다.

| 제한 | 값 |
| --- | --- |
| raw 한 배치 | 최대 20개; schema 1은 기존 5개 유지 |
| UI 스크롤 | 기본 12회, 설정 허용 1~30회 |
| 배치 | 기본 및 최대 20개 |
| 다음 카드 대기 | 기본 1,500ms, 허용 1,000~5,000ms |
| 보관 입력 | JSON당 최대 2 MiB |
| 비교 파일 | 최대 20개 명시; 실행 최종화는 배치+외부 비교 파일 합계 20개 이하 |

외부 비교 파일이 있으면 실행 전에 `maxBatches <= 20 - 외부 비교 파일 수`로 정해 최종화 한도를 확보합니다. 제한을 자동으로 해제하지 않습니다. 최대 배치에 걸리면 로드했지만 미시도한 카드 수도 보고합니다. 기존 물리적 목록 위치의 내용이 바뀌면 중단하며 fingerprint로 이를 보정하지 않습니다.

## 검증 결과

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -S -m unittest discover -s crawler/everytime_collect/tests -v
node --test crawler/everytime_collect/tests/browser_collect.test.cjs crawler/everytime_collect/tests/browser_end.test.cjs
```

로컬 합성 검증: Python 30개 + JavaScript 16개 통과. 소량 3개, 여러 배치 61개, 사전 로드 37/61개, 명시적 빈 목록, 로딩 실패, 개수 불일치, 잘못된 이름·교수·URL, 필터/기존 카드 변경, 항목 실패, 중간 중단, 상한, 중복 보존, 원문/공백/Unicode·전송 체크섬·덮어쓰기 방지를 검사했습니다. 이는 실사이트 결과와 별개입니다.

2026-09-30~10-01 KST 실사이트 검증은 확정한 세 강의만 수행했습니다. 추가 표본은 저장소 카탈로그와 정상 교수명 검색으로 확인한 0개/61개 강의이며 추가 검색은 하지 않았습니다. 1~20개 **비어 있지 않은** 강의 사례는 이번 실사이트 검증에 없고 합성 테스트로만 확인했습니다.

| 강의 / 교수 | 확인 URL | 표시 | 수집 시작 시 로드 | 저장 / 배치 | 실행 내부 후보 | 종료 근거 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 프로그래밍방법론 / 정교민 | https://everytime.kr/lecture/view/603889?tab=article | 37 | 37 | 37 / 2 | 0 | 바닥 2회·총수 일치 |
| 특수교육학개론 / 김주선 | https://everytime.kr/lecture/view/1785286?tab=article | 61 | 20 | 61 / 4 | 0 | 20→40→60→61, 바닥 2회·총수 일치 |
| 정서 및 행동문제와 교육상담 / 김주선 | https://everytime.kr/lecture/view/2386432?tab=article | 0 | 0 | 0 / 0 | 0 | 개요 `(0개)` + `첫 번째 강의평을 남겨주세요` |

첫 강의는 정상 스크롤 한 번으로 20→37개를 미리 로드한 뒤 수집을 시작했습니다. 이전 37개와 일치하는 재관측 후보는 37개이며 새 카드도 모두 저장했습니다. 최종 실행에서 항목 실패는 각 0개입니다. 빈 강의 최초 시도는 일반 강의와 다른 개수 요소 위치 때문에 `partial`로 중단되었고, 관찰한 `section.empty.review > div.title > span.count`를 반영한 뒤 위 최종 결과를 얻었습니다. 해당 실패 기록도 별도 보존했습니다. 압축 전달 중 2건의 체크섬 불일치는 저장 전에 검출되어 동일 반환 데이터의 전송 조각을 바로잡은 뒤 검증을 통과했습니다.

본문은 공개 문서/테스트에 포함하지 않습니다. 실행 대상 목록, 강의별 raw·보고서, 전송 검증·보존 검증은 Git 제외 경로 `crawler/output/everytime_three_20260930T143702Z/`와 대응하는 `crawler/data/private/`에 있습니다. 이전 3/20/37개 표본의 10개 파일 해시가 그대로이고 schema 1/2 raw 4개 및 기존 37개 실행 보고서 호환성을 확인했습니다.

실제 저장 98개 모두 본문·수강학기·강의명·교수명·출처 URL·근거 위치를 확보했습니다. 리뷰 ID·작성/수정 시각은 모두 `null`입니다. 0개 강의도 이름·교수·표시 개수·빈 목록 근거를 실행 보고서에 남겼습니다.

로컬 저장기는 브라우저 출처의 진위를 인증하지 않습니다. `site_structure_verified=false`와 `network_requests=0`은 **로컬 보관 명령**의 의미이며 브라우저 트래픽이 없었다는 뜻이 아닙니다. 완료는 관찰 당시 UI 범위에 한정됩니다. extractor·기존 표본·기대값·출력·Go·프론트·DB는 수정하지 않습니다.
