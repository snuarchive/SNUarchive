# Import 후보의 SQL 기준

사용자가 2026-10-02에 선택한 루트 SQL의 사본을 이 모듈의 `schema.sql`에 보존한다. 원본 데이터나 DB dump가 아닌 DDL만 포함한다.
SHA-256은 `ca92b1ad96e93bc68f4606142b778183c01076b49adb27a274b638fb569ca963`이다.
`schema_contract.py`는 후보 생성 전에 이 파일의 hash를 확인한다. 파일이 없거나
변경되면 변환을 중단하며, 검토 없이 다른 migration으로 대체하지 않는다.
SQL을 실행하거나 DB에 접속하는 기능은 없다.

## 원문과 중간 추출 결과

브라우저 수집 raw는 DB와 독립적이다. 원문·수강학기 raw·강의명·교수명·URL·
fingerprint·evidence를 보존하므로 이 변경을 위해 다시 수집할 필요가 없다.
원문이나 기존 후보를 덮어쓰지 않는다. extractor의 의미 해석 규칙과 수치,
evidence, 날짜 보류, 사람 미승인 상태도 변경하지 않는다.

## 새 후보 v2

`database_mapping`은 `course_id`, `assessment_id`, `type_id`, `contributor_id`,
`source`, `source_report_id`를 담으며, 실제 DB 식별자가 확인되기 전에는 모두
null이다. catalog의 `course_key`를 DB ID로 사용하지 않는다.

`database_projection.assessment_type_label`은 다음의 명확한 경우만 연결한다.

| 중간 추출 표현 | SQL 평가 유형 |
| --- | --- |
| midterm / final | 중간 / 기말 |
| exam, number=1..3 | 1차 / 2차 / 3차 |
| quiz / assignment, number 없음 | 퀴즈 / 과제 |
| 명시적으로 분류된 other, number 없음 | 기타 |

유형을 모르는 경우를 기타로 대체하지 않는다. 중간 1차, 퀴즈 2회, 4차 시험처럼
원래 구분을 SQL의 8개 유형으로 온전히 담을 수 없는 경우에는 label을 null로
두고 매핑 보류 사유를 추가한다. 원래 assessment와 각 후보는 모두 남긴다.
기존 extractor가 붙인 missing_number 등 검토 사유도 이 단계에서 제거하거나
사람 승인으로 바꾸지 않는다.

연도·학기·Q1..Q4·평균·만점은 `database_projection.stat_reports`에 별도로
투영한다. 연도/학기는 시험 시기를 뜻한다. 코드 1=봄, 2=여름, 3=가을,
4=겨울을 유지한다. 두 자리 연도나 겨울 학년도 귀속을 추정하거나 작성자의
수강학기를 모든 시험에 복사하지 않는다. 불명확한 값은 계속 null이다.

`max_score`는 만점이며 관측 최고점과 다르다. 근삿값·범위·척도 혼합 및
원래 evidence는 그대로 보존한다. 소수점 정밀도에 맞추려고 임의로 반올림하지
않는다. 원문 전체를 길이 제한 500자의 note나 50자의 comments로 잘라 넣지 않는다.

## import를 위해 남은 조건

이 SQL의 source enum은 direct/transcribed뿐이고 contributor_id는 실제 제공
학생을 가리킨다. 에브리타임 원문의 익명 작성자를 앱 사용자로 자동 연결하거나,
관리자/가상 계정을 작성자로 지정하거나, 임의의 source 값을 만들지 않는다.
출처 귀속 정책·DB 식별자·시험 시기·사람 검토가 해결되기 전에는
`ready_for_database_write=false`를 유지한다.

저장소 `db/migrations/00001_init.sql`의 assessment_kinds/exam_sittings 구조는
선택된 루트 SQL과 다르다. 이번 작업은 후보 형식만 맞추며 실제 앱 DB migration은
변경하지 않는다. 따라서 새 후보는 현재 앱 DB에 바로 넣을 수 있다는 뜻이 아니다.

기존 `import_A_semantic_018_20261002_01`을 보존하고,
`import_A_root_schema_20261002_01`에 기존 0.1.8 추출 결과를 새 형식으로 변환한다.
위 A 재투영 단계에서는 새로운 원문 추출이나 DB write를 실행하지 않았다.

## 수집 완료분 전체 정렬 (2026-10-02 20:49 KST cutoff)

추가 사용자 지시에 따라 `schema_snapshot.py`가 master의 재사용 archive와
각 shard의 immutable checkpoint를 고정하고 동일한 extractor 0.1.8을 적용한다.
현재 완성된 통합본은 `root_schema_snapshot_20261002_02` 및 그 `_candidates`다.
원문 15,076개/1,017개 강의·교수 조합(A223, B734, 기존 C60), 수치 후보 475개,
mention-only 2,253개를 보존했다. 추출본은 `_01_stats`를 검증하여 재사용했다.
첫 `_01`의 candidate 생성은 metadata 2MiB 제한으로 중단되었고, 이 시도 역시
삭제하지 않았다. 오프라인 manifest reader만 확장했으며 browser raw 제한은 유지한다.

기존 A317개의 extraction/projection/fingerprint는 일치한다. 과거 출력은 역사
기록으로 보존하며 최신 후보와 합산하지 않는다. 분류상 structure_clean도 사람
승인이 아니다. DB write 준비가 완료된 후보는 0개다.

`source_material_audit.py`는 루트 SQL/API/JSON/XLSX 및 팀 대화를 읽기 전용으로
대조한다. 최종 대조 결과 `source_material_review_20261002_03`의
`source_comparison_holds.json`은 현재 후보에 대한 추가 출처 확인 목록이다.
7개 강의의 기존 댓글25개 불일치 중10개가 다른 강의에서 발견되어, legacy
자료를 정답/승인 데이터로 자동 채택하지 않는다. 이 목록의 수치 후보1개는
기존 assessment_ambiguous 분류에 이미 포함된다.

통합본 생성 후에도 수집은 진행된다. 이후 완료분은 다음 `schema_snapshot`
실행에서 새 경로로 반영한다. 기존 snapshot/후보를 덮어쓰지 않는다.
