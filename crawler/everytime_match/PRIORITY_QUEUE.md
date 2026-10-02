# 통계 자료 기반 priority queue

`priority_queue.py`는 브라우저를 열지 않는 오프라인 계획 생성기다. XLSX의 `시험점수 통계량!A2:C398`을 읽어 원문 `(강의명, 교수명)` 고유 조합을 A로 묶고, 숫자 포함 강의평 JSON에서 A를 제외한 조합을 B로 둔다. 나머지 catalog course는 C다. 원본 파일을 수정하거나 extractor를 실행하지 않는다.

catalog 연결은 원문 강의명과 교수가 둘 다 정확히 일치하고 후보가 하나일 때만 확정한다. 공백·대소문자만 다른 후보도 `ambiguous_mapping`이다. 교수 미정·빈값과 복수 후보도 보류한다. 같은 강의명에 다른 교수만 있으면 `missing`이며 해당 후보를 근거로 보존한다. fuzzy 정규화로 매칭을 확정하지 않는다.

각 항목은 원문·catalog 표기, course_key, 원래 offerings 전체, XLSX 행/JSON 항목 참조, 통계 원문 존재 여부, 과거 실행 상태·URL·보고서·raw 경로와 checksum을 가진다. course_key는 queue의 중복 및 매칭 후보용이며 최종 DB ID가 아니다. A/B에서 연결하지 못한 원문도 버리지 않으므로 priority 항목 수는 catalog 수보다 클 수 있다.

```powershell
.venv/Scripts/python.exe -X utf8 -B -m crawler.everytime_match.priority_queue --previous-campaign crawler/output/everytime_full_20261001T104759Z/campaign --output crawler/output/<새폴더>/queue
```

기존 19,155개 campaign과 중단 상태는 보존한다. 새 계획은 기존 결과 66개를 경로와 SHA-256으로 연결한다. 완료 항목은 `completed`이며 raw를 복사·합치거나 재수집하지 않는다. ambiguous/not_found/partial도 그대로 남긴다. 새 생성 경로가 이미 있거나 원본/기존 raw hash가 바뀌면 거부한다.

이번 실제 실행은 A만 허용했다. `A_execution_mapping.json`이 A 항목과 기존 Campaign 구현의 실행 위치를 연결한다. A의 exact catalog 223개 객체를 offerings와 함께 비공개 `A_catalog.json`으로 저장했고, Campaign의 50~100개 batch 규칙에 따라 50/50/50/73개로 나눴다. B/C를 실행하는 코드는 추가하지 않았다. `queue/A`의 50개 계획 파일은 실행 campaign의 batch 번호와 별개다.

실행은 승인된 동일 Chrome 경로에서 기존 검색 UI와 collector를 사용한다. 검색 상한은 12 scroll/160 후보/60초, 수집 상한은 12 scroll/20 batch/배치당 20개/비교 파일 20개다. 매 배치마다 UI 반환 → 전송 checksum → 기존 schema/근거 검증 → 비공개 저장 → 다음 UI 순서를 유지한다. 개별 리뷰 ID와 미확인 작성·수정 시각은 null이다. fingerprint 후보를 자동 삭제·병합하지 않는다. 수강학기는 리뷰 표시값이며 본문의 모든 시험 통계에 적용된다고 해석하지 않는다.

전송 실패는 raw 저장 전에 거부한다. 첫 실패는 브라우저 메모리의 같은 원본과 대조하여 전체 checksum이 다시 일치한 경우에만 복구한다. 같은 batch에서 같은 전송 손상이 재발하면 다음 UI 동작을 중단한다. 기존 Campaign guard는 campaign 전체에서도 같은 오류 2회에 중단하므로 더 엄격하다. 인증/보안/접근 제한은 첫 발생에 중단한다. partial의 확인된 배치는 그대로 보존한다.

`priority_report.py`는 실행 결과와 immutable 계획을 연결하는 오프라인 snapshot 생성기다. raw checksum과 schema를 다시 검사하고, 읽은 리뷰 수와 저장 리뷰 수를 구분한다. 중간 중단 UI 보고서는 별도 근거이며 저장되지 않은 리뷰를 성공 건수에 합산하지 않는다. 출력은 매번 새 폴더여야 한다.

```powershell
.venv/Scripts/python.exe -X utf8 -B -m crawler.everytime_match.priority_report --root crawler/output/everytime_priority_20261002 --output crawler/output/<새snapshot> --interrupted-report crawler/data/private/everytime_priority_20261002/A0003_interrupted_ui_report.json
```

2026-10-02 실행은 A0003에서 두 번째 전송 손상이 발생해 중단했다. 중단 guard를 자동 해제하거나 기존 partial을 재수집하지 않는다. 검증된 A0001/A0002는 completed로 건너뛰며 A0003은 120개 raw를 가진 partial 검토 항목이다. 다음 일반 미처리 위치는 4지만, 전송 문제 해결과 재개 판단 전에는 실행하지 않는다. 상세 결과와 checksum 근거는 비공개 `crawler/output/everytime_priority_20261002/REPORT.md`와 `snapshot_stopped/`에 있다.

합성 테스트는 정확 일치, 표기 차이 보류, 미정·복수 후보, A/B 제외 규칙, offerings, 완료/ambiguous/not_found/partial 재사용, hash 변조 거부, missing과 실제 검색 not_found 구분을 검사한다. 실사이트 결과와 구분하여 보고한다.
