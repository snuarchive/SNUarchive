# 검증된 로컬 수집 경로

## 2026-10-04 저장 위치 정비

대량 수집의 새 출력은 `EVERYTIME_LOCAL_OUTPUT_ROOT`에 지정한 절대 경로를 Node와 Python이 함께 사용한다. 미지정 시 기존 경로를 사용하지만 저장소 사전 검사를 통과해야 한다. 현재 재개 경로는 `C:\codex-storage\snuArchive\everytime_local_runner\full_catalog_ntfs_20261004_01`이다. `resume_ntfs.ps1 -CheckOnly`는 수집 없이 상태를 확인하고, `resume_ntfs.ps1`은 기존 installed Chrome 전용 프로필로 수집을 재개한다. 프로필·쿠키를 복사하지 않는다.

`relocate_campaign.py`는 새 캠페인 메타데이터만 배타적으로 생성한다. 원본 raw 경로·checksum·상태와 기존 D: 캠페인을 보존하며 원본을 삭제하지 않는다. C:의 새 master plan은 C: shard를 가리키고, 기존 raw 참조는 D:에 남아 있다. 따라서 기존 D: 파일은 아직 운영 의존성이며 ZIP 백업이 있다고 임의 삭제하면 안 된다. 공간 회수는 원본 참조를 유지할 수 있는 별도 보관/복원 설계가 끝난 뒤 진행해야 한다.

기존 Computer Use collector/matcher와 `everytime_stats`를 변경하지 않고 재사용한다. 원문은 Playwright → 로컬 Node 파일 → Python 검증기로 이동하며 tool/LLM 출력에 리뷰를 반환하지 않는다. 기존 경로는 기준·예외 조사·fallback으로 유지한다.

현재 수집 범위는 사용자가 재승인한 전체 카탈로그 19,155개 강의·교수 조합이다.
`full_runner.cjs`가 검증된 기존 결과를 재사용하고 나머지를 B → C 순서로
50개씩 순차 실행한다. 아래의 B/C 보류 문구는 과거 extractor 작업 단계의 기록이다.
브라우저 supervisor는 raw 수집만 수행한다. 사용자가 요청한 기존 결과 정렬은
별도 고정 snapshot에서 오프라인 extractor/import 후보 생성으로 수행한다.
두 작업 모두 DB write를 하지 않는다.
로컬 runner에서 과목명 검색 후보/스크롤 상한에 도달하면, 알려진 교수에 한해
화면의 `교수명` 라벨을 클릭하고 교수 원문으로 정상 검색한다. 교수 검색도
동일한 160개/12회 상한과 목록 끝 확인을 요구하고, 기존 매처가 강의명과
교수 원문을 모두 정확 비교한다. 교수 검색 근거는 과목명 캐시에 넣지 않는다.
과목명 상한 근거는 `name_bounded_search.json`으로 함께 보존한다.
교수 검색도 상한에 도달하거나 교수 미정이면 `needs_review`,
`match_status: incomplete_search`로 보존한다. `bounded_search.json`에 마지막
UI checkpoint와 `ui_end: false`를 기록하며, 이 불완전 검색을 매칭·캐시에
사용하지 않는다. 해당 항목은 미해결로 남고 다른 항목 수집만 계속한다.
원래 Computer Use 검색 상한과 보안 중단 규칙은 변경하지 않는다.
전체 runner 재개 시 과거 과목명 검색 상한 보류도 다시 선택한다. 새 시도는
`--retry-search-limits`로 활성화되며, 저장 근거 checksum·알려진 교수·미완료
과목명 검색을 확인한다. 이미 교수명 검색을 시도한 항목이나 교수 미정,
차단 항목은 이 재선택 대상이 아니다. 기존 attempt는 덮어쓰지 않는다.
예외 진단은 고정된 분류만 `failure_diagnostic.json`에 저장하며 예외 원문이나
스택, 인증 정보는 저장하지 않는다.
대기 시간과 검증된 검색 결과 재사용에 관한 현재 설정·제약·검증은
[PERFORMANCE.md](PERFORMANCE.md)에 기록한다.

이후 사용자가 import 후보의 기준으로 지정한 파일은 상위 폴더의
`D:/codex/snuArchive/schema.sql`이다. 새 후보는 candidate schema v2 및
`course_assessments` 구조를 사용한다. 저장소 migration의 `exam_sittings`
구조를 참조한 과거 후보는 보존하며, 현재 DB migration을 자동 교체하지 않는다.
정확한 매핑과 미해결 조건은 [SCHEMA_CONTRACT.md](SCHEMA_CONTRACT.md)를 따른다.

2026-10-02 20:49 KST 수집 cutoff를 대상으로 한 현재 통합 데이터는
`root_schema_snapshot_20261002_02`, 참조 자료 대조는
`source_material_review_20261002_03`이다. 과거 후보·검토 제안은 보존하되
이 통합본과 합산하거나 사람 승인으로 취급하지 않는다. 이후 수집 raw는 다음
새 snapshot에서 동일한 root SQL 계약을 적용한다.

## 실사이트 동등성 gate

`baseline_session_AdhpG9`의 세 결과를 캠페인 생성 때 다시 검증한다.

| 강의 | ID | 리뷰 | 비교 |
| --- | --- | ---: | --- |
| 프로그래밍방법론 · 정교민 | 603889 | 37 | 일치 |
| 특수교육학개론 · 김주선 | 1785286 | 61 | 일치 |
| 기업재무론 · David Schoenherr | 2680931 | 55 | 일치 |

원문·수강학기·URL·강의·교수별 multiset, 연결된 review multiset, fingerprint set/multiset을 비교한다. 순서는 무시하지만 중복 횟수와 본문–학기 연결은 유지한다. raw/manifest/checkpoint SHA-256 및 완료 조건도 검증한다. 합성 테스트와 별개의 실제 사이트 증거다.

초기 bundled Chromium `blocked`는 정확한 분기·최종 URL이 기록되지 않았으며 사이트의 명시적 차단으로 확정할 수 없다. 초기 Chrome의 unknown alert 실패는 [CHROME_COMPARISON.md](CHROME_COMPARISON.md)에 보존했다. 이후 installed Chrome에서는 정상 접근·저장이 성공했다.

## 설치·브라우저·인증

```powershell
npm.cmd --prefix crawler/everytime_local_runner ci
```

Node 20+, Python 3.10+, Playwright 1.63.0. Python adapter는 표준 라이브러리만 사용한다. 공식 `launchPersistentContext(profile, {channel:'chrome', headless:false})`로 Windows 설치 Chrome을 연다. 검증된 실행 파일은 `C:/Program Files/Google/Chrome/Application/chrome.exe`, 버전 153.0.8010.53이다. 실사이트 실행에 bundled Chromium 설치는 필요 없다.

`crawler/data/private/everytime_local_profile/`는 Git ignore를 검사하는 전용 프로필이다. 사용자가 직접 로그인하며 자동 로그인·비밀번호 읽기·쿠키/token 추출·storageState export는 하지 않는다. persistent profile 내부 인증 상태는 Chrome이 관리한다. 사용자의 기본 프로필은 읽거나 복사하지 않는다.

`.runner.lock`으로 같은 프로필의 동시 실행을 막는다. 정상 종료하면 제거한다. 비정상 종료 뒤에는 PID와 창의 종료를 확인한다. 단순 창 유지용 `reopen_603889.cjs`는 수집하지 않으며 창을 닫거나 `stop`으로 종료한다. 수집과 동시에 실행하지 않는다.

CAPTCHA·명시적 차단·계정 경고·속도 제한은 즉시 중단하고 `.access_stop.json`을 남긴다. 후속 실행이 자동으로 해제하지 않는다. 로그인 만료도 수집을 중단하며, unexpected UI를 사이트 차단으로 단정하지 않는다. unknown dialog는 원문을 출력하지 않고 사용자가 확인하도록 유지한다. `ack`는 확인한 정보성 alert 전용이며 confirm/prompt/차단은 승인하지 않는다. 직접 HTTP/internal API, ID 순회, stealth, UA/웹드라이버 위장 및 우회는 없다.

## 기준 재검증 명령

```powershell
node crawler/everytime_local_runner/baseline_session.cjs '<python.exe>'
```

첫 603889 비교 성공 후 보고를 위해 대기한다. 결과 보고 후 `next`를 입력하면 나머지 두 기준을 실행한다. 비보안 DOM 문제는 창을 유지하며, 조사 후 `retry`하면 새 실행에 저장한다. 보안 중단에는 재시도하지 않는다. `stop`으로 정상 종료한다.

## Priority A 캠페인

```powershell
& '<python.exe>' -X utf8 -B -m crawler.everytime_local_runner.campaign create `
  --root 'crawler/output/everytime_local_runner/<NEW_CAMPAIGN>' `
  --queue '../SNUarchive-data/crawler/output/everytime_priority_20261002/queue' `
  --baselines 'crawler/output/everytime_local_runner/baseline_session_AdhpG9' `
  --reuse-root '../SNUarchive-data/crawler/output/everytime_priority_20261002'
node crawler/everytime_local_runner/priority_runner.cjs '<python.exe>' `
  'crawler/output/everytime_local_runner/<CAMPAIGN>'
```

A 229개(catalog matched 223/missing 6)만 허용한다. 정상 검색 UI와 기존 matcher의 범위·끝·제목·교수 검증을 통과한 관찰 URL만 수집한다. missing/ambiguous는 검토, not_found는 별도 검색 결과로 기록한다. B/C와 전체 catalog는 자동 실행하지 않는다.

개요 identity/표시 총수, `전체 / 등록순`, 카드 prefix 불변, 정상 스크롤과 바닥 2회 무증가를 확인한다. 원본 collector 한도는 최대 30회 scroll, 20 batch(배치 최대 20개)다. 총수 불일치나 한도 도달은 partial이다.

모든 output은 `crawler/output/everytime_local_runner/`의 신규 폴더다. exclusive 생성과 fsync로 기존 파일 덮어쓰기를 거부한다. 각 배치를 검증·저장한 뒤 다음 UI 동작을 하고, 강의 완료마다 immutable receipt/checkpoint를 쓴다.

**저장소 사전 검사:** `full_runner.cjs`와 `priority_runner.cjs`는 시작 및 다음 작업 전에 실제 볼륨의 `statfs` 값을 확인한다. 할당 단위가 64KiB를 넘거나 여유 공간이 5GiB 미만이면 신규 수집을 거부한다. 2026-10-04 확인한 D:는 exFAT·512KiB 단위다. 작은 JSON 하나에도 최소 512KiB가 할당되므로 파일 내용 크기만 합산해서 용량을 판단하면 안 된다. C:는 NTFS·4KiB 단위다. 기존 자료의 해시를 바꾸거나 자동 삭제하지 않으며, D:의 기존 실행은 저장 위치 정비 전까지 재개하지 않는다.

```text
<CAMPAIGN>/plan.json, entries/Axxxx/attempt_NNN.json, checkpoints/NNNNN.json
priority_execution_<random>/invocation.json, browser.json, ui_*.json, result.json
priority_Axxxx_<random>/search.json, match.json, incoming/
priority_Axxxx_<random>/batch_NNN/raw.json, manifest.json, batch_event.json
priority_Axxxx_<random>/checkpoints/NNN.json, run_report.json
priority_Axxxx_<random>/local_manifest.json, local_manifest.sha256
```

같은 캠페인 명령은 처리한 항목을 건너뛰고 미처리 항목부터 진행한다. `--retry-partial`은 partial/failed를 새 실행에 다시 관찰하며 이전 raw에 이어 붙이지 않는다. 같은 한도에 도달하면 여전히 partial일 수 있다. blocked는 옵션으로 해제하지 않는다. 디스크 장애는 마지막 검증된 checkpoint부터 확인한다. 전체 작업은 단일 DB transaction이 아니다.

디스크 부족으로 다음 shard 시작을 막을 때는 전체 캠페인 폴더의 `operator_stop_request.json`을 사용한다. `version=1`, `action=stop_before_next_shard`, `campaign=<캠페인 폴더명>`, `reason=low_disk_space`가 필요하다. `priority_runner.cjs`가 `<campaign>_[ABC]_NNNN` 실행 시작 시 Python·브라우저 실행 전에 검사하고 `operator_stop_low_disk_space`로 종료한다. 실행 중인 shard를 즉시 중단시키는 기능은 아니다. 잘못된 요청은 실행 오류로 중단한다. stdin이 닫힌 background 실행에서도 사용할 수 있다. 공간 확보와 기존 프로세스 종료를 확인한 뒤 요청 파일을 이력으로 보존하고 재개해야 하며, 자동 해제하지 않는다. 이 요청은 사이트 접근 제한을 기록하는 `.access_stop.json`과 별개다.

긴 목록에서 총수는 같지만 30회 내 바닥 확인이 끝나지 않은 경우, 보안 신호가 없음을 확인한 뒤 `--retry-partial --viewport-height=1100`으로 정상 창 높이를 늘려 별도 실행할 수 있다. 허용 높이는 900~1200이며 기본 900이다. UI 스크롤/배치 한도와 identity·총수·바닥 2회 검증은 그대로다. 이전 raw를 유지하고 재수집 겹침은 duplicate candidate로 기록한다. viewport는 새 실행 metadata에 남긴다. 이 옵션은 차단 상태를 해제하지 않는다.

local manifest 상태는 `complete_for_observed_ui`, `partial`, `empty`, `needs_review`, `blocked`, `failed`다. 기존 report/캠페인 호환 상태의 `complete`가 `complete_for_observed_ui`에 대응한다. `not_found`는 검색 결과다. 완료는 관찰 시점 UI에 대한 판정이다.

재승인된 실행은 `priority_A_authorized_20261002_01`이다. 이전 범위 이탈 `priority_A_20261002_01`은 보존했다. 세 기준의 gate를 새로 통과한 뒤 `adopt`가 원본 checksum·manifest·identity·match를 검사한 완료 20강의·644개만 참조했다. `adoption_report.json`과 receipt의 `original_receipt`로 추적한다. 이 자료를 기준 동등성 증거로 사용하지 않으며 이전 partial도 채택하지 않았다. 정상 완료된 Computer Use 2강의·75개는 별도 참조한다.

## raw와 extractor

기존 schema 2의 원문·수강학기·source URL·field evidence를 보존한다. 확인되지 않은 review ID, created_at_raw, updated_at_raw는 null이다. 배치의 coverage=sample과 강의 전체 완료 보고서를 구분한다. 중복 후보를 기록하고 raw를 병합·삭제하지 않는다.

```powershell
& '<python.exe>' -X utf8 -B -m crawler.everytime_local_runner.stats_adapter `
  --campaign 'crawler/output/everytime_local_runner/<CAMPAIGN>' `
  --output 'crawler/output/everytime_local_runner/<NEW_EXTRACTION>'
& '<python.exe>' -X utf8 -B -m crawler.everytime_local_runner.import_candidates `
  --extraction 'crawler/output/everytime_local_runner/<EXTRACTION>' `
  --output 'crawler/output/everytime_local_runner/<NEW_CANDIDATES>'
```

하나의 완전히 쓰인 checkpoint snapshot을 사용하므로 수집과 offline 작업을 병행할 수 있다. 원문 본문만 versioned extractor에 전달한다. 최초 최종 산출물은 RULE_VERSION 0.1.6이며 아래 의미 오류 수정 결과는 0.1.7이다. 수강학기를 시험 연도/학기로 복사하지 않는다. observed_max를 가능한 총점 max_score나 q4로 바꾸지 않고 개인 점수를 population statistic으로 취급하지 않는다. null과 실제 0을 구분한다.

추출 output은 accepted/review_required/excluded JSONL, 리뷰별 raw pointer/checksum/분류와 summary/manifest다. candidate output은 수치가 있는 `import_candidates.jsonl`, `auto_validated.jsonl`, `review_required.jsonl`, 수치 없는 `mention_review.jsonl`, excluded 및 중복/상충 group이다. source/evidence/fingerprint를 연결하며 날짜 미확정 후보끼리 같은 시험으로 묶지 않는다. 어떠한 후보도 자동 병합·삭제하지 않는다.

extractor accepted는 사람 검토 완료가 아니다. 모든 후보는 human review=unreviewed, ready_for_database_write=false다. course_key는 matching identifier이며 DB ID가 아니다. DB ID·기여자·출처 정책은 null이다. 현재는 사용자가 선택한 루트 SQL contract의 범위/정밀도를 offline 검사하며 임의 반올림도 하지 않는다. **DB 연결·쓰기 코드는 없다.**

## 후보의 원문 근거 검토

```powershell
& '<python.exe>' -X utf8 -B -m crawler.everytime_local_runner.candidate_review `
  --dataset 'crawler/output/everytime_local_runner/<CANDIDATES>' `
  --decisions 'crawler/output/everytime_local_runner/<ANNOTATIONS>/decisions.json' `
  --output 'crawler/output/everytime_local_runner/<NEW_REVIEW>'
```

이 단계는 offline 전용이다. 입력 manifest와 원본 파일 checksum, review fingerprint, 원문 codepoint evidence를 다시 검증한다. assistant annotation은 해당 dataset의 manifest와 개별 본문 hash에 묶이며 근거 span과 판단 이유를 요구한다. 본문의 날짜 후보 검색은 검토 힌트일 뿐 시기를 자동 배정하지 않는다. 과거 기출·다른 과목·다음 개설 시기를 현재 시험 연도로 전파하지 않는다.

`candidate_reviews.jsonl`은 기존 후보 객체와 별도 검토안을 함께 보존하고, `assistant_proposals.jsonl`은 assistant 주석이 있는 항목만 담는다. `review.html`은 외부 리소스 없는 읽기 전용 원문 대조 파일이다. 기존 추출값과 검토 사유를 변경하지 않으며 수강학기 metadata로 시험 시기를 채우지 않는다. 사람이 검토하지 않은 항목은 계속 `human_review_status=unreviewed`, `ready_for_database_write=false`다. assistant의 시험 분리 제안도 원래 후보를 자동 분할하거나 병합하지 않는다.

`review_A_20261002_01`은 최종 A 후보 332건(원문 216개)을 검증하고 그중 40건에 집중 검토 주석을 붙인 결과다. 연도·학기 동시 제안 18건, 부분 제안 11건이며 짧은 연도의 세기 확장과 겨울 연도 해석은 명시한 가정이다. 날짜가 모두 제안되어도 DB 적용 승인이 아니다. 평가 종류 label 근거 확인 222건은 구조적 검증이며 의미 검토 완료를 뜻하지 않는다. 나머지 110건은 평가 종류·번호·범위를 더 검토해야 한다.

재무관리의 중간/기말 Q3를 합친 후보 1건에는 분리 제안, 동일 기말의 원점수/기본점 제외 환산값 3건에는 같은 척도로 병합하거나 독립 시험으로 세지 말라는 주석을 남겼다. 2건에는 문맥에 따른 기말 identity 제안이 있다. 이 단계는 excluded/mention-only 후보의 누락률 검증이나 전 후보의 수치 의미 검토를 완료한 것이 아니다. 중단 중 생성된 폴더는 보존하며 `state=complete` manifest가 없으면 완성된 결과로 사용하지 않는다.

## 확인된 의미 오류 수정과 triage (0.1.7)

후속 사용자 요청에 따라 기존 extractor의 확인된 오류와 직접 변형만 수정했다. `기말은 중간이 어려워서/쉬워서`의 원인 설명을 중간시험 anchor로 재지정하지 않는다. `Q3 31, 2차 Q3 42`의 번호를 앞 통계의 미표기 수치로 삼키지 않는다. 기존 `_term`과 TERM/SEMESTER_ONLY/SHORT_TERM 규칙은 변경하지 않았다.

`score_scales.py`는 명시적 환산·기본점 차감·배점 변환 표현과 그 뒤의 기존 labelled statistic 근거가 연결될 때만 보류한다. 다른 평가 종류는 분리하며 개인 점수에서 통계를 새로 생성하지 않는다. 척도를 자동 선택하거나 총점을 역산하지 않는다. 보류 항목은 numeric 필드를 null로 두고 `score_scale_note.observations`에 원래 후보 전체와 근거를 보존한다. 이 묶음은 같은 assessment라는 확정이나 DB 후보 병합이 아니다.

최종 재처리 경로는 `stats_A_semantic_017_20261002_02`, `import_A_semantic_017_20261002_02`, `quality_A_semantic_017_20261002_02`다. 같은 이름의 `_01`은 검증 중간 산출물로 보존하며 최종 통계와 섞지 않는다. 새 raw 수집은 없고 기존 223강의 5,753리뷰의 동일 snapshot을 사용했다.

```powershell
& '<python.exe>' -X utf8 -B -m crawler.everytime_local_runner.quality_audit `
  --old 'crawler/output/everytime_local_runner/import_A_final_20261002_01' `
  --new 'crawler/output/everytime_local_runner/import_A_semantic_017_20261002_02' `
  --output 'crawler/output/everytime_local_runner/<NEW_QUALITY_AUDIT>'
```

332 numeric 후보에서 1건을 중간/기말 2건으로 분리하고 척도 혼합 3건을 보류 묶음 1건으로 바꿨다. 따라서 새 numeric은 330건이고 triage 단위는 보류 묶음을 더한 331건이다. 328 numeric 후보는 의미 필드가 같다. 원문 2개, 기존 numeric 후보 4개에만 영향이 있었다. 원문·학기·URL·fingerprint·기존 output은 그대로 보존한다.

`triage.jsonl`과 분류별 JSONL, `comparison.json`, `changed_reviews.jsonl`, 읽기 전용 `review.html` 및 manifest를 생성한다. 분류 우선순위는 척도 보류 → 상충/복수 관찰 → assessment/범위 → 기타 의미/매핑 문제 → 날짜만 미확정 → 구조상 문제 없음이다. `structure_clean`은 날짜까지 해결된 경우, `term_missing_only`는 날짜 관련 사유만 남은 경우다. 중복 의미를 피하도록 한 후보에 하나의 주 분류만 부여한다.

최종 분류는 structure_clean 0, term_missing_only 143, assessment_ambiguous 108, score_scale_ambiguous 1, multiple_observations_needs_split 0, other_review_required 79다. 내용 검토 대상은 188단위(원문 146개)이며 별도로 143건의 날짜 연결이 남았다. **331단위 모두 human_review_status=unreviewed**다. 이 수치는 규칙에 따른 업무 분류이며 사람 검증이 완료된 정확도나 오류율이 아니다. 범위 밖 mention-only/excluded의 누락률은 이번 단계에서 확정하지 않는다.

## 별도 term linker와 후속 근거 대조

`term_linker.py`는 canonical extraction을 바꾸지 않는 별도 계층이다. 과거 assistant 주석은 본문 내 범위를 가리키는 힌트로만 사용하며, 주석의 20xx 제안 숫자를 적용하지 않는다. 두 자리 연도, 겨울의 학년도/달력연도 귀속, 비표준 연도 표기, 여름과 `-2`의 혼용은 보류한다. 본문 수강 시기 근거와 작성자의 enrollment metadata를 구분한다. 과거 기출·다른 평가 영역·미래 개설 시기는 현재 시험으로 전파하지 않는다. 점수 구간 `90-100`을 `90-1` 학기로 잘라 읽지 않는다.

```powershell
& '<python.exe>' -X utf8 -B -m crawler.everytime_local_runner.review_followup `
  --quality 'crawler/output/everytime_local_runner/quality_A_semantic_017_20261002_02' `
  --prior-review 'crawler/output/everytime_local_runner/review_A_20261002_01' `
  --annotations 'crawler/output/everytime_local_runner/followup_annotations_A_20261002_01/screening.json' `
  --output 'crawler/output/everytime_local_runner/<NEW_FOLLOWUP>'
```

최종 후속 결과는 `followup_A_20261002_02`다. `_01`은 중간 검증 결과로 보존했다. 날짜 대상 143건 중 본문 시기 표현 없음 121건, 과거/다른 영역 참조 2건, 학기만 명시 8건, 두 자리 연도 10건, 표기 불명확 2건이다. 부분 학기 연결은 19건(기존 학기값 2건 포함)이며 완전한 연도·학기 연결은 0건이다. 어떤 canonical year/semester도 변경하지 않았다.

188건은 assistant가 수치 근거와 주변 문맥을 대조한 1차 screening이다. 사람의 전면 심사/승인이 아니다. 14건에서 추가 의미 오류를 확인했고 24건에 검토 제안을 붙였다. 보존된 수치가 문맥과 일치한 36건도 기존 review_required와 human_review_status를 유지한다. 그 밖의 번호/DB 매핑, 평가 범위, 미파싱 표현, 척도 문제는 계속 검토 대상으로 남긴다. 새로운 14건의 일반화된 extractor 수정은 이 단계에 포함하지 않았다.

확인 오류에는 `5xx`/`87.x`의 앞 숫자만 확정, `11점이 채 안됨`/`80점 미만`/`50점 초중반대`를 정확한 값으로 처리, 괄호 속 시험명으로의 오배정, 부정된 객관식 영역의 section 판정, 문항 배점을 시험 전체 만점으로 처리, 가정/환산/대안 배점의 확정 등이 있다. `confirmed_issues.jsonl`은 해당 원문 span과 제안을 담으며 실제 수정 적용/사람 승인 여부는 false다. 전체 후보는 원본 triage 객체와 함께 보존한다.

`term_links.jsonl`, `content_screening.jsonl`, `confirmed_issues.jsonl`, 원문 대조 `review.html`, summary/manifest로 인계한다. 후보 331단위 모두 사람 미승인 상태이고 DB 준비 완료 항목은 없다. 날짜 연결과 추가 의미 오류를 해결하기 전에는 B 확장을 보류한다. 새 실사이트 요청·세션 조작·수집·DB write는 없다.

## followup_A 확인 오류 수정 (0.1.8)

추가 원문 검토의 14건과 직접 변형만 수정했다. `numeric_semantics.py`는 `5xx`/`87.x`/`9x`/`8?`, `채 안됨`/`채 되지 않음`, `초중반`/`후반` 등 불확실한 표현을 exact numeric으로 잘라 확정하지 않는다. 기존 부등식·범위·근삿값 보류 규칙은 유지한다. 문항 배점, 대안 만점, 가정한 만점, 개인 점수 환산 배점, 시험별 보정 전후 만점이 혼재한 설명도 원문 근거를 남기고 보류한다.

오채점을 설명하는 괄호 안의 시험명은 괄호 밖 통계의 anchor를 덮지 않는다. 부정된 객관식 영역을 section으로 지정하지 않으며, 출석을 제외한 종합 성적을 앞 문장의 과제로 지정하지 않는다. 일반적인 괄호/서술형 통계 파싱으로 기능을 확대하지 않았다. 날짜 함수와 정규식은 0.1.7과 AST 수준에서 동일하며 DB schema는 변경하지 않았다.

14개 최소 재현 테스트에는 기존 오추출·기대 결과·이유를 기록했다. 별도의 `test_followup_real_cases.py`는 저장된 followup의 14개 전체 원문과 hash를 검증해 재실행한다. private 자료가 없는 checkout에서는 이 실자료 테스트가 명시적으로 skip된다. 실제 실행에서는 14개 모두 실행·통과했다. 합성/최소 재현, 저장된 실자료 재처리, 실사이트 테스트를 구분하며 이번에는 사이트에 접속하지 않았다.

결과 경로는 `stats_A_semantic_018_20261002_01`, `import_A_semantic_018_20261002_01`, `quality_A_semantic_018_20261002_01`, `verification_A_semantic_018_20261002_01`다. 모든 파일은 새 경로에 생성했다.

```powershell
& '<python.exe>' -X utf8 -B -m crawler.everytime_local_runner.semantic_followup_audit `
  --old 'crawler/output/everytime_local_runner/import_A_semantic_017_20261002_02' `
  --new 'crawler/output/everytime_local_runner/import_A_semantic_018_20261002_01' `
  --followup 'crawler/output/everytime_local_runner/followup_A_20261002_02' `
  --output 'crawler/output/everytime_local_runner/<NEW_AUDIT>'
```

0.1.7의 numeric 330건에서 0.1.8은 317건이다(최초 0.1.6은 332건). 원문 15개, 기존 numeric 후보 17개에 영향이 있었다. 잘못 확정한 필드 13개를 null로 보류했고, 이 중 12개 후보는 남은 exact 값이 없어 mention-only로 이동했다. 수치가 유지된 후보의 귀속 수정은 3건이며, 중간1 통계가 기존 중간2 만점 후보로 돌아가면서 2개 후보가 1개가 됐다. 새 split은 없다. ID 기준 numeric에서 사라진 것은 15개, 새 ID는 scope 변경의 2개다. 삭제된 원문이나 근거는 없다.

추가 영향 2건의 의미도 원문으로 확인했다. 금융수학 1의 같은 보정 문장 속 별도 max_score=500도 보류했고, 국제정치경제론의 `평균 80후반`도 exact 80에서 보류했다. 기업재무론 중간2 후보는 옮겨진 Q1/Q2/Q3를 받아 필드가 늘었다. 광범위한 새 파싱 기능을 추가하지 않았다.

188건 재대조에서 확인 오류 14/14 해결, 제안 24건은 자동 개선 0건으로 유지, 기존 정상 36건은 의미 필드·근거까지 그대로다. 나머지 114건 중 같은 문장의 중간2/보정 만점 후보 2건만 추가 변화가 있었고 112건은 같다. 기존 review_required를 사람 승인으로 올리지 않았다.

triage는 numeric 317건 + 이전 numeric에서 보류된 후속 항목 12건 + 기존 척도 보류 묶음 1건 = 330단위다. structure_clean 0, term_missing_only 143, approximate_or_bound 20, malformed_numeric 2, assessment_ambiguous 92, score_scale_ambiguous 4, multiple_observations_needs_split 0, other_review_required 69다. 따라서 이 후보 검토 범위의 내용 검토 대상은 **187단위(원문 146개)**이고 날짜만 남은 것은 **143단위**다. 330단위 모두 사람 미승인이다. 별도의 기존 mention-only 1,275개는 전체 추출 결과 triage에 보존하며 이번 188건 의미 검토가 이들의 정확도/누락률을 검증했다는 뜻은 아니다.

`comparison.json`은 source/evidence 기반 후보 계보와 null 전환·귀속·split/merge를, `regression_cases.json`은 14개 전체 원문·기존 오추출·기대 결과·이유·실제 결과를 보존한다. `rechecked_188.jsonl`, `changed_reviews.jsonl`, 분류별 JSONL, 읽기 전용 `review.html`을 함께 생성했다. synthetic/offline Python 308개와 JS 20개, 총 328개 테스트가 통과했다. raw 401파일·5,753리뷰와 기존 후보/followup checksum을 다시 검증했다. 신규 수집, B/C, DB write, commit/push/PR은 수행하지 않았다.

## 검증

```powershell
& '<python.exe>' -X utf8 -B -m unittest discover -s crawler/everytime_local_runner/tests
node --test crawler/everytime_local_runner/tests/*.test.cjs
& '<python.exe>' -X utf8 -B -m unittest discover -s crawler/tests
```

위는 합성/offline 테스트다. optional `tests/browser_smoke.cjs`와 `tests/dialog_browser_smoke.cjs`는 bundled Chromium에서 로컬 HTML만 사용하며 실사이트 요청은 없다. 설치하려면 모듈 폴더에서 `npx.cmd playwright install chromium`을 실행한다. 실제 Everytime 동등성 증거와 구분한다.

커밋·push·PR과 DB write는 하지 않는다. 최종 수집/추출 성과는 새 output의 summary와 manifest로 보고한다.
