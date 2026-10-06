# Everytime local Playwright runner

## Checkout 및 오프라인 검증

### Compact continuation storage

For an explicitly prepared continuation, `EVERYTIME_COMPACT_ROOT` must equal
`EVERYTIME_LOCAL_OUTPUT_ROOT`. That new root must contain `compact_policy.json`
with `{"version":1,"minimum_free_gib":20}`. This mode packs each finished
`priority_*` run into its own ZIP, checks every archived and staging checksum,
then removes only the newly generated staging copies. `search.json` remains live
for the UI search cache. Existing Computer Use archives and earlier campaigns
are not eligible for this cleanup. Readers resolve original provenance paths
through the ZIP and recheck member checksums without extracting onto another drive.

Only this opt-in mode permits allocation units up to 512 KiB, with a 20 GiB free
space reserve checked throughout collection. The browser profile volume is also
checked. A packing/validation failure halts the runner; do not automatically retry
or delete the retained staging evidence. This is storage packing, not a change to
site access limits, identity matching, review parsing, or completion rules.

Python 의존성은 `crawler/requirements.txt`, Node 의존성은 이 디렉터리의 `package-lock.json`으로 설치한다. 학기 XLS 변환에는 `scripts/requirements-catalog.txt`를 사용한다.

```powershell
npm ci --prefix crawler/everytime_local_runner
python -B -m unittest discover -s crawler/everytime_local_runner/tests
python -B -m unittest discover -s crawler/tests
npm test --prefix crawler/everytime_local_runner
npm run validate
```

원문, 추출 후보, 로그인 프로필, 실행 계획과 checkpoint는 Git에 포함하지 않는다. 사적 원문이 필요한 테스트는 원문이 없는 checkout에서 명시적으로 skip한다. 아래 날짜별 실행 설명은 개발 이력이며 현재 수집을 자동 재개하는 지시가 아니다.

`EVERYTIME_LOCAL_OUTPUT_ROOT`는 충분한 공간이 있고 작은 할당 단위를 사용하는 볼륨의 절대 경로로 지정한다. 출력뿐 아니라 브라우저 프로필 볼륨도 사전 검사한다. 과거 `full_campaign.py` 계획은 19,155건 기준의 역사적 계획이며 갱신된 목록의 전체 수집 완료를 뜻하지 않는다.

SQL 후보 검증은 함께 제공한 `schema.sql` 사본의 고정 checksum을 사용한다. `EVERYTIME_SCHEMA_FILE`로 같은 내용의 다른 파일을 지정할 수 있다. 이 SQL은 검증용이며 자동 실행하지 않는다. 압축 보관 경로는 `EVERYTIME_LEGACY_ARCHIVE` 또는 Git 비추적 `.local-data/archive-config.json`의 `archive` 값으로 지정한다.

`resume_ntfs.ps1`은 `-PythonExe`, `-OutputRoot`, `-CampaignName`을 명시해야 한다. `-CheckOnly`는 상태만 조회한다. 새로운 수집은 명시적 작업 범위와 저장 공간을 확인한 뒤 실행한다.

> **현재 운영 문서는 [PIPELINE.md](PIPELINE.md)이다.** 아래 본문은 초기 단일 강의 실험 당시 기록이다. 이후 installed Chrome에서 3개 기준 강의 153개의 실사이트 동등성 검증을 통과했고, 재승인된 Priority A 캠페인 및 offline extractor/import candidate 경로가 추가됐다. 현재 실사이트 실행에는 `priority_runner.cjs`와 설치 Chrome 전용 프로필을 사용한다. 초기 bundled Chromium 명령·실패 상태·queue 미구현 설명을 현재 상태로 해석하지 않는다.

기존 Computer Use 수집기에 병렬로 추가한 **명시적 단일 강의 URL 전용** 실험 모듈이다. 기존 `everytime_collect`, `everytime_match`, extractor는 변경하지 않는다. 검색·queue 실행·신규 강의 탐색·DB 적재 기능은 없다.

후속 단일 비교: Windows 설치 Chrome + 새 persistent 프로필 실행은 [CHROME_COMPARISON.md](CHROME_COMPARISON.md)에 기록했다. 해당 실행은 `unexpected_ui`이며, 사이트 차단이나 로그인 성공으로 확정하지 않았다. `chrome_experiment.cjs`는 603889 전용 일회성 진단이며 기존 프로필이 있으면 재실행을 거부한다.

## 계속 실행하는 기준 강의 검증 세션

확대된 프로젝트 목표의 Stage 1~2는 `baseline_session.cjs`로 진행한다. 이 파일은 기존 실험용 프로필을 **그 위치에서만** 사용하고, 프로필 복사·쿠키 읽기·자격 증명 입력을 하지 않는다. 원래의 일회성 비교 결과는 보존한다.

```powershell
node crawler/everytime_local_runner/baseline_session.cjs '<python.exe>'
```

사용자가 직접 로그인하면 603889를 기존 collector 규칙으로 수집하고, 배치마다 직접 저장·검증한다. 기존 37개와 본문·학기·URL·fingerprint multiset이 같아야 첫 검증을 통과한다. 첫 결과 보고를 위해 `first_course_pass_waiting_for_report`에서 대기하며, 실행 터미널에 `next`를 입력하면 1785286(61개), 2680931(55개)를 차례로 검증한다. `next`는 첫 비교가 성공해야 적용된다. Priority A/queue/extractor 실행은 이 스크립트에 없다.

예상하지 못한 알림은 즉시 닫지 않는다. 원문 대신 고정된 공용 어휘·사유 코드만 출력한다. 사용자가 브라우저에서 알림을 닫으면 DOM 관찰 재개를 통해 대기 상태를 해제한다. 정보성 alert를 확인한 뒤 터미널의 `ack`로 닫을 수도 있다. confirm/prompt 또는 차단/CAPTCHA 알림은 `ack`로 승인하지 않는다. `stop`은 실행 중단 요청이다.

명시적 접근 제한·인증 challenge를 확인하면 브라우저 작업을 즉시 중단하고 `crawler/data/private/everytime_local_profile.access_stop.json`을 만든다. 후속 실행은 이 기록이 존재하면 거부한다. 자동으로 해제하지 않는다. 별도 `.runner.lock`은 동일 프로필 동시 실행을 막으며, 정상 종료 후 제거된다. 비정상 종료 시 파일만 보고 재시작하지 말고 기존 PID와 브라우저 프로세스가 종료됐는지 먼저 확인해야 한다.

이 경로가 실제 기준 강의 세 개와 동등함을 확인하기 전에는 Stage 3 batch runner 구현·Stage 4 Priority A 실행·Stage 5 extractor 연결을 완료로 취급하지 않는다. 2026-10-02의 지속 작업은 수동 로그인과 기준 강의 검증 단계에 있다.

## 조사 및 재사용

| 기존 구성 | 재사용 방식 |
| --- | --- |
| `everytime_collect/browser_collect.js` | 파일을 수정하지 않고 함수 표현식을 로드한다. 실제 개요의 강의명·교수·개수, 전체/등록순, 리뷰 본문·수강학기 파싱 및 근거 생성을 재사용한다. |
| `browser_collect_to_end.js` | 20개 단위 이벤트, 물리적 카드 prefix 불변 확인, 정상 스크롤, 표시 수와 바닥 2회 확인 규칙을 재사용한다. |
| `raw.py`, `target.py` | schema 2, 필드 근거의 Unicode code-point 구간, URL·대상 검증, fingerprint 및 중복 후보 판정의 원본 구현을 사용한다. |
| `archive.py`, `run_v2.py` | 배타적 raw/manifest 저장과 기존 보고서 검증을 재사용한다. 로컬 확장 보고서는 아래 별도 검증기를 사용한다. |
| `everytime_match/full_queue.py` | manifest·불변 checkpoint·중단 분류 구조를 조사했다. 캠페인·queue 실행기는 연결하지 않는다. |
| 기존 테스트 | fake browser 및 합성 시나리오를 새 테스트에서 재사용한다. 기존 파일은 수정하지 않는다. |

`adapter.cjs`만 브라우저 경계를 연결한다. legacy `tab.playwright`, `timeoutMs`, `scroll(point,"down",3)`를 실제 Playwright Page/Locator/Mouse 호출로 바꾼다. `getAXState` 자리는 본문을 반환하지 않는 인증·제한 검사로 대체한다. DOM 파싱 규칙의 별도 복사본을 만들지 않는다.

## 설치와 실행

Node 20 이상, Python 3.10 이상이 필요하다. Python 코드는 표준 라이브러리만 사용한다. 이 모듈의 package-lock에 Playwright **1.63.0**을 고정했다.

저장소 루트에서:

```powershell
npm.cmd --prefix crawler/everytime_local_runner ci
Push-Location crawler/everytime_local_runner
npx.cmd playwright install chromium
Pop-Location

node crawler/everytime_local_runner/runner.cjs `
  --url 'https://everytime.kr/lecture/view/603889?tab=article' `
  --title '프로그래밍방법론' --instructor '정교민' `
  --python 'D:/codex/snuArchive/SNUarchive-data/.venv/Scripts/python.exe' `
  --run-name 'programming_NEW_UNIQUE_NAME' --login-timeout-seconds 900
```

`--python`에는 사용 가능한 Python 실행 파일을 지정한다. 기본값은 `python`이다. `--run-name`은 선택 사항이며 생략 시 시각+난수로 생성한다. 이미 존재하는 실행명은 거부한다. 출력 루트는 `crawler/output/everytime_local_runner/`로 고정되어 기존 수집 경로로 지정할 수 없다. 실제 차단 이후에는 자동 재시도하지 않는다. 위 명령은 사용자가 정상 접근 상태를 확인한 뒤 별도 새 실행을 시작할 때 사용한다.

실제 기본 브라우저는 Playwright가 설치하는 headed Chromium(검증 환경에서는 **Chrome for Testing 153.0.8010.12**, Chromium build 1243)이다. 기존 개인 Chrome 탭·프로필에는 연결하지 않는다. [공식 Browser API](https://playwright.dev/docs/api/class-browser)와 [Mouse API](https://playwright.dev/docs/api/class-mouse)에 따라 context와 정상 wheel 동작을 사용한다.

초기 로그인은 열린 창에서 사용자가 직접 한다. 자격 증명을 읽거나 입력·저장하지 않는다. `browser.newContext()`의 임시 세션을 사용하며 쿠키/storageState/profile을 내보내지 않는다. 종료하면 다음 실행에서 다시 로그인해야 한다. 최초 로그인 대기는 기본 600초(0~1800초)이다. CAPTCHA·접근 제한은 초기 로그인 중에도 중단하며, 수집 시작 후 로그인 화면으로 바뀌면 재로그인을 기다리거나 재시도하지 않는다. 예기치 않은 사이트 dialog도 중단한다.

직접 HTTP 요청, API 추측, 네트워크 응답 분석, 응답 본문 저장은 없다. 정상 페이지 이동·표시 링크 클릭·목록 안 mouse wheel·표시 DOM 읽기만 사용한다. 스크롤은 최대 12회, 배치는 최대 20회이며 상한에 도달하면 partial로 남긴다.

## 저장 경로와 데이터 계약

```text
crawler/output/everytime_local_runner/<new-run>/
  invocation.json, browser.json
  incoming/event_001.json, event_001_raw.json, ...
  incoming/progress_001.json, ..., ui_report.json
  batch_001/raw.json, manifest.json, batch_event.json
  checkpoints/001.json, ...
  security_observation.json
  run_report.json
  local_manifest.json, local_manifest.sha256
```

DOM 원문은 **Playwright → Node 메모리 → 로컬 파일 → 로컬 Python 검증기** 경로로 이동한다. tool/LLM 출력, shell 인자, 압축 문자열 재전달을 사용하지 않는다. stdout에는 배치 번호·개수·상태·경로만 출력한다. checksum은 실제 파일 바이트의 SHA-256이다.

raw는 기존 schema 2 그대로다. 본문·수강학기·필드 근거를 보존하고, 모든 리뷰의 강의명·교수명·source URL은 공통 `course`와 `capture.page_url`이 제공한다. review ID=`source_id`, written_at에 해당하는 `created_at_raw`, `updated_at_raw`는 모두 null이다. `coverage=sample`, `complete_course=false`는 **20개 단위 raw 봉투**의 의미로 유지한다. 강의 전체 UI 완료 판정은 별도 실행 보고서가 담당한다. 중복 fingerprint 카드도 삭제·병합하지 않는다.

모든 쓰기는 신규 파일 전용이다. Node event 저장과 checkpoint는 flush/fsync 후 처리한다. 배치 저장·검증 성공 후에만 새 checkpoint를 기록하고 다음 UI 동작을 수행한다. 디스크 오류/강제 종료 시 일부 새 파일은 남을 수 있지만, checkpoint 없는 배치를 완료로 승격하지 않는다. 기존 배치·기존 실행은 보존한다. 자동 resume는 구현하지 않았으며 중단 후에는 새 실행명을 사용한다. OS 전원 장애까지 포괄하는 원자적 다중 파일 트랜잭션은 아니다.

초기 차단/브라우저 실패는 raw나 빈 성공 보고서를 꾸미지 않고 `interruption.json` 및 `local_manifest.json`만 보존한다. 디스크 자체의 실패에서는 manifest 생성도 실패할 수 있으므로 마지막 검증된 checkpoint만 신뢰한다. `local_manifest`는 최종화 당시 파일을 검증하며, 나중에 생성한 비교 파일은 별도 `.sha256`으로 검증한다.

## 상태

| local_manifest.status | 조건 |
| --- | --- |
| complete_for_observed_ui | 표시 총수=로드 수=저장 수, 실패 0, 전체/등록순, 바닥 2회 무증가, 기존 보고서 검증 통과 |
| empty | 개요 `(0개)`와 명시적 빈 목록 문구·전체/등록순·바닥을 함께 확인. raw는 생성하지 않음 |
| partial | 일부 관찰 후 수량 불일치, 제한 도달, 항목 파싱 실패, 비보안 중단 등 |
| needs_review | 강의명·교수명·제목·scope·기존 카드 변화 등 검토 필요 |
| blocked | CAPTCHA, 접근 제한, 초기 로그인 미완료, 수집 중 로그아웃, 예기치 않은 dialog |
| failed | 첫 관찰 전 로딩/브라우저 오류 또는 로컬 저장·검증 실패 |

기존 `run_report.json.ui_observation.status`의 `complete/partial`은 기존 검증기 호환을 위해 그대로 둔다. 외부에서 사용하는 6개 상태는 `local_manifest.status`를 읽는다. 실제 기존 collector는 내부적으로 `complete/partial`을 사용하므로 상태명을 원본 코드에 역으로 적용하지 않았다.

## Computer Use 결과와의 오프라인 비교

실제 첫 강의가 성공한 후에만 실행한다. baseline은 기존 worktree 파일을 읽기 전용으로 지정한다.

```powershell
& 'D:/codex/snuArchive/SNUarchive-data/.venv/Scripts/python.exe' -X utf8 -B -m crawler.everytime_local_runner compare `
  --baseline '../SNUarchive-data/crawler/output/everytime_three_20260930T143702Z/603889/run_report.json' `
  --local 'crawler/output/everytime_local_runner/<successful-run>/run_report.json' `
  --output 'crawler/output/everytime_local_runner/<successful-run>/comparison.json'
```

명시적 archive의 raw SHA-256과 manifest, schema, 강의 정체성, 저장 수를 먼저 검증한다. 본문·수강학기·출처 URL·강의명·교수명 각각의 multiset, 이들을 묶은 리뷰 multiset, 기존 fingerprint의 set 및 multiset을 비교한다. 순서는 무시하지만 중복 횟수와 본문-학기 연결은 유지한다. timestamp/배치 위치 차이 때문에 raw 파일 checksum이 baseline과 달라도 리뷰 집합은 같을 수 있다. field evidence는 각 raw에서 기존 검증기로 검사하며 locator나 관찰 시각 자체의 동일성은 요구하지 않는다.

## 검증 명령

아래는 실사이트 검증이 아니다.

```powershell
& '<python.exe>' -X utf8 -B -m unittest discover -s crawler/everytime_local_runner/tests -v
node --test crawler/everytime_local_runner/tests/adapter.test.cjs
# 실제 브라우저 엔진 + 합성 HTML: 모든 요청을 로컬 fixture로 가로채 실사이트 요청은 0회
node crawler/everytime_local_runner/tests/browser_smoke.cjs '<python.exe>'
```

합성 browser smoke는 `synthetic_browser_*`라는 새 output에 합성 37개를 저장한다. 실제 강의 결과와 합치지 않는다. 이번 실사이트 시도와 잔여 위험은 [VALIDATION.md](VALIDATION.md)를 참조한다.

### 부분 수집의 로컬 상한 확장

`priority_runner.cjs --retry-partial`은 `collect_extended.cjs`의 유한 상한
(스크롤 300회, 배치 200개, 배치당 20개)을 사용한다. 정상 UI 스크롤,
보안 중단 검사, 원본 DOM 파서는 유지한다. 일반 실행의 상한은 바뀌지 않는다.

`local_run_v2.py`는 기존 `everytime_collect/run_v2.py`를 로컬 전용으로
분리한 검증기다. `comparison_files=20`인 기존 보고서는 원래 검증기로
검증하고, 확장 보고서(`comparison_files=200`)만 새 상한을 허용한다.
수량·강의 정체성·물리 행 연속성·바닥 안정화·checksum 검증은 유지한다.
배치별 manifest는 직전 최대 20개 raw와 비교하며 비교 파일을 명시한다.
최종 보고서에서는 전체 배치 사이의 중복을 검사하고, 어떤 중복도 삭제하지 않는다.
기존 raw나 checkpoint는 교체하지 않고 새 실행/시도를 기록한다.

합성 검증: `extended_collection.test.cjs`, `test_extended_storage.py`는
1,348개 리뷰, 68배치, 기존 상한 초과 스크롤과 배치 간 중복을 검증한다.
이는 실사이트 재수집 성공을 뜻하지 않는다.

### 교수명 검색 상한의 명시적 재시도

`--retry-professor-limits`는 기존 교수명 검색이 로컬 후보/스크롤 상한에서
중단된 경우에만 재시도 대상을 추가한다. 교수명이 미정이거나 차단 상태인
항목은 포함하지 않는다. 새 교수명 검색은 정상 UI로 최대 800후보/60스크롤/
180초를 관찰한다. `local_matching.py`의 별도 v3 검증기는 전체 검색 범위와
강의명·교수명 완전 일치를 요구한다. 기존 v1/v2 증거는 원래 검증기를 사용한다.
확장 상한에서도 중단되면 `extended_professor_800_v1` 기록으로 반복을 막는다.
이 옵션도 원본 교체 없이 새 실행/시도를 저장한다. 사용자 지정 부분 문자열,
공백 정규화 또는 교수명 추측으로 강의 정체성을 자동 승인하지 않는다.

### 승인된 동명 사이트 강의 추가 수집 (2026-10-05)

`observed_campaign.py`와 `observed_runner.cjs`는 기존 19,155개 카탈로그
조합과 별도인 2,670개 관찰 URL을 다룬다. 사용자가 추가 수집 범위를 승인했다.
제안서 → 기존 검색 증거 → 실제 URL/강의명/교수명 일치를 검증하여 계획을 만든다.
알려진 URL의 개요 화면으로 이동해 제목/교수/표시 수를 검증하고, 기존 collector가
정상 강의평 링크를 누르고 스크롤한다. HTTP/API 요청이나 ID 추측은 사용하지 않는다.

출력 루트는 `EVERYTIME_LOCAL_OUTPUT_ROOT=C:\codex-storage\snuArchive\everytime_local_runner`다.
master는 `observed_followup_20261005_01`, 54개 shard는 `_O_0001`부터 `_O_0054`다.
`node crawler/everytime_local_runner/observed_runner.cjs <python.exe> <master>`로
미처리 shard를 순차 실행하고, 각 shard의 원본 checksum·UI 수량을 검증한다.
단일 shard는 `--shard`, 제한된 파일럿은 `--shard --limit=3`를 사용한다.
실패 원인을 수정한 뒤 명시적으로 시도할 때만 `--retry-failed`를 추가한다.
차단 기록은 자동으로 해제하거나 재시도하지 않는다. 실행 중 표준입력 `stop`은
현재 UI 동작 이후 중단하며, 다음 shard를 열지 않는다.

카탈로그 연결은 항상 `catalog_mapping_approved=false`로 남고, 기존 카탈로그
receipt/raw를 수정하지 않는다. 데이터베이스 적재나 extractor 실행도 포함하지 않는다.
