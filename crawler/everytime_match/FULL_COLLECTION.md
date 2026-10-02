# 전체 카탈로그 queue와 중단 기록

2026-10-01 사용자가 전체 카탈로그 수집을 승인했다. 기존 22개 pilot을 반복하지 않고, 실패했던 교수명 구조를 고친 뒤 해당 강의만 한 번 재실행했다. 정상 Chrome 확장 브라우저와 검색 UI를 사용했으며 직접 HTTP, 내부 endpoint, ID 추측, 다른 브라우저 경로를 사용하지 않았다.

## 교수명 구조 수정

`browser_collect.js`는 보이는 `교수명` 라벨의 동일 정보 행 안에서 다음 두 형태를 읽는다.

- `:scope > div.multiline > a.link`: 기존 교수 링크.
- `:scope > span.text`: 실제 602278 페이지에서 관찰한 일반 텍스트.

두 형태를 합쳐 보이는 비어 있지 않은 요소가 정확히 하나여야 한다. 여러 값, 숨겨진 값, 누락된 값은 중단한다. 강의명과 교수명의 원문은 입력값과 정확히 대조하며, trim/정규화로 일치를 만들지 않는다. 선택한 필드 위치를 근거에 남긴다. 강의 ID 예외는 없다. 합성 DOM 회귀 테스트는 `identity_dom.test.cjs`에 있다.

실제 `거시경제학특수연구 (비동질적 거시경제모형의 수량적 분석) · 홍재화`는 `https://everytime.kr/lecture/view/602278`에서 일반 텍스트 교수명을 확인했다. 수정 후 단 한 번 재실행했고, 개요 `(0개)`와 리뷰 탭의 `첫 번째 강의평을 남겨주세요`, 전체/등록순, 빈 목록 바닥을 함께 확인하여 complete 0개로 종료했다. 기존 partial 보고서는 보존했다.

## queue와 실행 순서

`full_queue.py`는 로컬 queue 관리 도구다. 브라우저 연결이나 백그라운드 작업을 시작하는 CLI가 아니다. 브라우저 동작은 승인된 `cua_repl`에서 기존 검색 UI 관찰 절차와 기존 collector를 호출한다. 로컬 명령으로 네트워크 접근을 하지 않는다. 동일 campaign에는 실행자 하나만 사용한다.

```powershell
.venv/Scripts/python.exe -X utf8 -B -m crawler.everytime_match.full_queue init --catalog public/courses.json --output crawler/output/<새실행>/campaign --batch-size 50
.venv/Scripts/python.exe -X utf8 -B -m crawler.everytime_match.full_queue pending --root crawler/output/<새실행>/campaign --batch 1
```

1. 전체 원문 입력, course_key, 1부터 시작하는 위치를 고정한다. catalog와 batch 입력에 SHA-256을 기록하며 변조되면 재개를 거부한다. 기본 50개, 허용 50~100개다. 마지막 소량은 앞 batch와 합쳐 100개 이내로 유지한다.
2. `pending`에서 terminal result가 없는 입력만 가져온다. 정상 검색 UI로 강의명을 입력하고, 실제 원문 후보/URL/위치/검색 모드/서울대 헤더/빈 검색 근거/추가 로드 범위를 저장한다. 같은 제목의 여러 입력에는 동일한 검색 관찰을 공유할 수 있다.
3. `match --position N --search <비공개 관찰 파일>`로 검증한다. 정확한 강의명·교수가 하나인 경우만 matched다. 미정·빈 교수, 이름 차이, 복수 후보, 검색 범위 미확인은 ambiguous다. not_found에는 실제 빈 검색 근거가 필요하다. URL의 도메인·경로를 검증하고, 전역 URL 소유권과 중복 입력도 검사한다.
4. matched에만 `begin-capture --position N --output <새 강의 폴더>`를 기록한 다음 정상 UI로 해당 URL을 연다. collector가 상세 페이지 강의명·교수를 다시 검증한다.
5. collector의 배치를 반환받고 → `unpack-transfer`로 길이/해시 검증 → `save-batch-event`로 raw/manifest 저장 → 성공 후에만 다음 배치를 요청한다. 대형 반환은 조각별 해시도 검사한다. 원문을 요약·재작성하지 않는다.
6. `finalize-course-run`의 검증된 보고서를 `finish --position N --report <run_report.json>`에 연결한다. partial도 별도 결과로 보존한다. 매 입력 종료마다 새 checkpoint 파일을 만든다. 배치가 끝나면 다음 batch의 pending을 처리한다.

`match.json`은 검색 근거의 위치와 checksum, 발견 URL과 판정을 보존한다. `result.json`은 입력, 매칭 상태, 수집 상태, 표시/저장 개수, 시각, raw와 보고서 checksum, 오류를 보존한다. checkpoint는 입력 위치, 마지막 연속 완료 위치, 잔여 위치, 상태별 검토 queue와 raw checksum을 담는다. 원본 schema 1/2와 기존 저장기는 유지한다. 리뷰 ID·작성/수정 시각을 추측하지 않으며 fingerprint는 중복 후보 표시에만 사용한다.

완료된 기존 표본은 검증된 검색 근거와 complete 보고서/원문 checksum을 대조해 참조로 가져온다. raw를 복사·병합·삭제하거나 다시 수집하지 않는다. 과거 partial은 완료로 가져오지 않는다. 이번 602278 재실행 결과는 새 보고서를 연결했다.

## 한계와 중단·재개

검색 상한은 후보 160개, 스크롤 12회, 다음 카드 대기 2초, 검색 60초다. collector 상한은 스크롤 12회, 배치 20개, 배치당 리뷰 20개, 다음 카드 대기 1.5초, 과거 비교 파일 20개다. 상한을 없애지 않았다. 검색 바닥만으로 사이트 전체 검색 완전성을 주장하지 않는다. 리뷰 수집 완료는 표시 개수 일치와 전체/등록순 및 바닥 확인, 또는 명시적 빈 목록 근거가 필요하다.

로그인·CAPTCHA·접근/보안 제한은 즉시 중단한다. 동일 오류 분류가 두 번 발생하면 campaign을 중단하며 구조 오류 외 전송 검증 문제에도 보수적으로 적용한다. 단순 ambiguous/not_found/실제 빈 강의는 이 오류 계수에 포함하지 않는다. 이미 회복한 전송 사고는 `record_incident`로 완료 결과를 수정하지 않고 남긴다. 동일 사고를 결과와 incident 양쪽에 중복 기록하지 않는다.

재개 시 `capture_started.json`만 있고 terminal 결과가 없으면 `recover-capture`로 기존 보고서를 검증하거나 확보된 raw를 partial로 보존한다. UI에서 다시 수집하지 않는다. completed 입력을 덮어쓰거나 partial을 자동 재시도하지 않는다. 중단 원인이 남아 있는 campaign의 `pending`/`begin`은 실행을 거부한다. 오류 기록을 삭제해 강제로 진행해서는 안 된다. 원인 해결과 재개 정책 검토가 먼저 필요하다.

## 실제 실행 결과와 로컬 테스트의 구분

비공개 campaign: `crawler/output/everytime_full_20261001T104759Z/campaign/`.
관찰·전송 근거: `crawler/data/private/everytime_full_20261001T104759Z/`.

전체 19,155개 입력을 383개 batch(382 × 50, 마지막 55)로 생성했다. 기존 결과 25건을 연결했고 첫 batch의 50개 처리를 마친 뒤 두 번째 batch를 시작했다. 로컬 브라우저 반환값을 파일로 옮기는 중 두 번 전송 검증이 실패했다. 둘 다 원본 payload와 대조하여 복구했고 저장된 raw는 검증을 통과했지만 반복 패턴 때문에 추가 UI 동작을 중단했다. 사이트 제한·교수명 구조 오류로 중단한 것이 아니다.

중단 시 terminal 입력은 66개: matched 62(complete 61, partial 1), ambiguous 3, not_found 1. 저장 268개 중 기존 원문 140개와 신규 원문 128개다. complete 중 빈 리뷰 강의 30개다. 부분 강의는 `21세기 한국소설의 이해 · 이지은`(2179628), 표시 78개/저장 40개/2배치이며 바닥 미도달이다. 60번째 입력은 검색 매칭만 끝나고 수집을 시작하지 않았다. 남은 terminal 미처리 입력 19,089개이며 백그라운드 실행은 없다.

구조 회귀, queue 분할, 중복 URL, 재시작 skip, 중간 중단, 접근 제한, 반복 오류, 전송 사고 계수는 합성 테스트로 검사한다. 합성 통과를 전체 실사이트 수집 성공으로 간주하지 않는다. 전체 상세 통계·checksum·보존 검사와 강의별 결과는 해당 비공개 실행 보고서에서 확인한다. extractor·Go·프론트·DB는 변경하거나 실행하지 않았고 커밋·push·PR도 하지 않았다.
