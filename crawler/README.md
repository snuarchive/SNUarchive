# Everytime 오프라인 통계 추출기

이미 확보한 JSON 강의평을 읽는 로컬 도구입니다. JSON 원문이 수치와 근거의 기준이고, XLSX는 발췌 위치 비교에만 사용합니다. 웹 접속, 외부 AI 호출, DB 연결·적재, DB ID 생성 기능은 없습니다.

## Windows / PowerShell

저장소 루트에서 실행합니다. WSL, Bash, 시스템 Python은 필요하지 않습니다.

```powershell
# 의존성은 프로젝트 가상환경에만 설치합니다.
.\.venv\Scripts\python.exe -B -m pip install -r .\crawler\requirements.txt

# 합성 테스트: 비공개 파일도, site-packages도 사용하지 않습니다.
.\.venv\Scripts\python.exe -B -S -m unittest discover -s .\crawler\tests -v

# 입력 구조·중복·XLSX 연결 집계
.\.venv\Scripts\python.exe -B -m crawler.everytime_stats profile

# 원문을 읽고 수동 작성한 비공개 기대 결과와 비교
.\.venv\Scripts\python.exe -B -m crawler.everytime_stats check-samples --split development
.\.venv\Scripts\python.exe -B -m crawler.everytime_stats check-samples --split validation

# 표본 검증 결과를 읽은 뒤 전체 적용
.\.venv\Scripts\python.exe -B -m crawler.everytime_stats extract --all
```

기본 입력은 `data/private/`의 `everytime_강의평_숫자포함_전체 (1).json`과 `everytime_시험점수_통계량.xlsx`입니다. 파일명이 다른 입력은 `--input-json`과 `--xlsx`로 지정할 수 있습니다. 경로에 공백이 있으면 PowerShell 따옴표를 사용합니다. 입력 파일은 저장하거나 수정하지 않습니다. XLSX는 `openpyxl`의 읽기 전용 모드로 읽고 읽기 전후 해시를 확인합니다.

출력은 매번 `output/<명령>_<UTC 시각>/`에 생성됩니다. `--output .\crawler\output\새폴더`로 지정할 수도 있습니다. 기존 폴더를 덮어쓰지 않고 `crawler/output/` 밖으로 출력하지 않습니다. 표본 검사에서 불일치가 있으면 종료 코드 1, 입력·경로 오류는 2입니다. 검사 실패를 숨기거나 기대 결과를 수정하는 기능은 없습니다.

## 입력과 집계

JSON 최상위는 배열이며 각 원소는 `교수: string`, `강의명: string`, `댓글: string[]`입니다. 다른 구조나 중복 JSON 키는 오류로 처리합니다. 강의 행 수, 고유 강의명, 고유 교수명, 강의명·교수명 조합, 댓글 수, 고유 댓글 문자열 수를 각각 집계합니다. 교수 수는 실인물 판별이 아닌 이름 문자열 기준입니다. 중복 댓글을 자동 삭제하지 않습니다.

XLSX는 `교수 / 강의 / 통계량` 세 텍스트 열을 기대합니다. 같은 강의·교수의 JSON 댓글에서 발췌문을 정확히 찾습니다. 연결이 없거나 여러 위치가 나오면 그 상태를 보고하며 원문을 수정해 맞추지 않습니다. 발췌문의 끝에서 숫자가 잘린 경우를 별도로 표시합니다. 추출기에는 JSON의 전체 댓글만 전달합니다.

## 결과

| 파일 | 단위와 내용 |
|---|---|
| `summary.json` | 원본·코드 해시, 집계, 분류·사유별 건수, 검증 상태 |
| `xlsx_links.jsonl` | XLSX 행·셀 → JSON Pointer와 원문 발췌 범위 |
| `accepted.jsonl` | 해석·회차 정보·범위 검사를 통과한 시험 통계 후보 |
| `review_required.jsonl` | 미처리 표현, 불명확한 시험·시기·범위, 상충 값이 있는 후보 |
| `excluded.jsonl` | 후보 표지가 없거나 명확한 개인 표현·비점수 표현만 있는 댓글 |
| `audit_selection.json` | 각 분류에서 최대 5개 댓글을 선택한 재현 가능한 사후 점검 표본 |
| `sample_report.json` | `check-samples`의 수동 기대값 비교 결과 |
| `measurement_decisions.jsonl` | 명시적 비점수 단위로 분류한 구절과 원문 위치; 다른 통계와 섞인 댓글도 포함 |
| `review_queue.jsonl` | 수치가 있는 모든 댓글의 원문과 모든 후보, 수치별 근거 연결 및 사람 검토 상태 |
| `omission_samples.json` | 수치 없는 언급 댓글과 제외 댓글에서 별도로 선택한 누락 확인 표본 |

정상·검토 행은 **댓글 안의 시험/영역 후보**, 제외 행은 **댓글** 단위입니다. 후보에는 수치를 확정하지 못한 표현도 포함됩니다. 같은 댓글에서 후보 여러 개가 나오므로 세 출력 파일의 행 수를 합산해 댓글 수로 해석하면 안 됩니다. `comment_classification`은 검토 후보가 하나라도 있으면 검토, 아니면 정상 후보가 있으면 정상, 나머지는 제외로 분류하여 입력 댓글 수와 대조합니다. 후보 수는 실제 고유 시험 수나 검증된 통계량 수가 아닙니다.

후보 레코드는 강의명·교수명, `assessment.kind/number/raw_label`, `scope/component`, `year/semester`, `statistics`, `observed_max`, `source`, `evidence`, `context_evidence`, `candidates`, `review_reasons`를 포함합니다. DB 레코드나 API 제출 본문이 아닙니다.

- `statistics`는 `q1`, `q2`, `q3`, `q4`, `average`, `max_score`이며 누락값은 `null`입니다. 값 0과 누락은 다릅니다.
- `observed_max`는 최고 득점의 중간 정보입니다. **최고점을 Q4로 변환하지 않습니다.** Q4는 원문에 명시된 경우만 추출하며 최고점 대응은 검토 사유로 남깁니다.
- `max_score`는 명시된 만점, 또는 같은 시험의 집단 통계와 연결되는 점수 분수의 분모입니다. 개인 점수의 분자, 상대점수 차이, 배점 비중은 통계값으로 사용하지 않습니다.
- `scope`는 `whole`, `section`, `composite`, `unknown`입니다. 객관식·서술형·주관식 영역은 별도 후보이며 검토 대상으로 남깁니다. 번호가 있는 중간고사도 원문 번호를 보존하고 현행 모델에 맞춰 강제 변환하지 않습니다.
- `1차/2차`는 `exam`과 번호로 기록하고 중간/기말로 치환하지 않습니다. 퀴즈·과제 번호가 없으면 만들지 않습니다.
- 연도·학기는 원문에 명시되고 해당 블록과 연결되는 경우만 기록합니다. `1학기=1`, `여름=2`, `2학기=3`, `겨울=4`입니다. 축약 연도·대시 학기는 검토 대상으로 남기며 파일 시각이나 카탈로그를 사용하지 않습니다.
- 문서 앞의 독립된 시기 헤더나 명시적 수강 소개만 전역 시기로 사용합니다. 시험과 같은 줄에 적힌 날짜는 그 줄의 시험 문맥에 한정하며 다음 시험이나 앞 문단에 소급하지 않습니다. 본문의 독립된 시기 헤더는 해당 문단의 뒤쪽 통계에 적용합니다. 연도 없는 명시적 겨울 수강은 `year=null, semester=4`로 보존합니다.
- 지원하는 조건·불확실 표현의 수치는 확정 필드에 넣지 않습니다. 예를 들어 합성 문장의 `평균 51점이라면`, `중간값 93인가 그랬어요`는 `candidates`에 원래 숫자, 대상 필드, 한정 표현과 원문 위치를 보존합니다. 같은 댓글의 확실한 다른 값은 유지합니다.
- 원문에 없는 만점·분위수·평균을 계산하거나 보충하지 않습니다. 서로 다른 댓글·강의의 값을 합치지 않습니다. 분위수 순서 오류나 상충하는 값도 자동 보정하지 않습니다.
- 수량 판정은 점수, 명시적 비점수, 단위 미확정의 세 경로입니다. 페이지·문항·횟수·시간·금액 등 비점수 단위는 점수 필드에 넣지 않습니다. 점 단위나 명확한 평가/통계표 문맥은 점수 근거가 되며, `점` 생략만으로 버리지 않습니다. 단위 불명 수치는 `candidates`에 원문 값과 사유를 보존합니다. 백분율은 점수로 변환하지 않습니다.
- 비교 대상이나 문제 출처로 언급된 과제·퀴즈는 시험 헤딩을 바꾸지 않습니다. 판단이 애매하면 시험 종류를 null로 둡니다. 합산은 개별 시험에 복제하지 않고 `composite`로 보존하며 `전체` 표시는 부분 영역 문맥을 해제합니다.
- 숫자 근거와 시험·영역·시기 근거는 원문 문자열의 0부터 시작하는 Unicode 코드포인트 범위 `[start, end)`를 사용합니다. 모든 근거의 `text == original[start:end]`를 검사합니다. 입력 파일·댓글 해시와 JSON Pointer로 출처를 재확인할 수 있습니다.

## 수동 기대 결과와 검증 분리

실제 사례와 기대 결과는 `data/private/fixtures/`에만 둡니다. 비공개 기대 결과 없이도 합성 테스트는 실행됩니다. 실제 사례 검증은 파일이 없으면 실패하며 성공으로 건너뛰지 않습니다.

기존 `development.json`과 `validation.json`은 원형을 보존합니다. 구형 스키마의 `facts` 비교는 과거 회귀 결과 재현용으로만 유지되며, 연도·학기·필수 null·동일 결과의 발생 횟수를 검사하지 못한다는 한계를 보고서에 표시합니다. 기존 validation은 이미 재사용한 회귀 자료입니다.

새 기대값은 새 파일에 `fixture_schema_version: 2`로 작성합니다. 원문을 직접 읽고 예측 전에 작성한 `expected_records`는 각 결과의 year, semester, kind, number, scope, component, statistics의 6개 필드, observed_max를 **null까지 모두** 요구합니다. 결과 전체를 발생 횟수가 있는 multiset으로 비교하여 같은 수치인 서로 다른 회차나 동일한 두 발생을 하나로 합치지 않습니다. `records_mode: numeric`은 수치가 있는 모든 결과를 비교하며 빈 언급 후보는 분류·필수 사유로 검사합니다. 빈 결과의 메타데이터와 개수까지 엄격히 비교할 때는 `all`을 명시합니다. 숫자가 있는 예상 결과의 다른 필드를 null로 지정하면 그 null도 필수입니다.

`validation_role`은 development, known_defect_regression, reused_regression, independent_holdout 중 목적에 맞게 명시합니다. 독립 표본은 규칙 고정 후 선택, 예측 전 수동 정답 작성, 알려진 사례와의 분리, 규칙 수정에 사용했는지를 `validation_protocol`에 기록해야 합니다. 코드 해시 일치만으로 독립성을 판단하지 않습니다. 규칙 수정에 사용한 자료 또는 고정 후 코드가 변경된 자료는 재사용 회귀 검사로 표시합니다. 표본 통과 수를 전체 정확도로 표현하지 않습니다.

```powershell
# 새로운 비공개 V2 기대값 파일 비교 (기존 파일은 그대로 둡니다)
.\.venv\Scripts\python.exe -B -m crawler.everytime_stats check-samples --fixture .\crawler\data\private\fixtures\review_015_defects.json

# 고정한 기대값을 수정하지 않고, 사용 이력을 재사용 회귀 검사로 명시
.\.venv\Scripts\python.exe -B -m crawler.everytime_stats check-samples --fixture .\crawler\data\private\fixtures\validation_015.json --validation-role reused_regression
```

V2 레코드 예시(합성):

```json
{
  "year": null, "semester": null, "kind": "midterm", "number": null,
  "scope": "whole", "component": null,
  "statistics": {"q1": null, "q2": null, "q3": null, "q4": null, "average": 42, "max_score": null},
  "observed_max": null
}
```

## 검토 목록 집계

`candidate_tier`와 summary의 `candidate_tiers`는 `quartiles_or_average`(Q1~Q4/평균), `bounds_only`(만점/최고점만), `mention_only`(확정한 수치 없음)로 후보를 분할합니다. 단위 미확정 수량은 점수 필드에 들어가지 않아 마지막 범주에 속합니다. 이 집계는 정확도나 고유 시험 수가 아닙니다.

`review_issues`는 수치 해석(`value_interpretation`), 시험 종류/회차/영역(`assessment_identity_or_scope`), 연도·학기(`temporal_metadata`), 모델 대응(`model_mapping`)을 나눕니다. summary의 `review_issue_counts`는 각 문제가 있는 후보 수이고 범주 사이에 중복될 수 있습니다. 날짜가 없는 것만으로 확실한 점수를 삭제하지 않습니다.

## 사람이 검토할 자료

0.1.6부터 `extract --all`은 `review_queue.jsonl`도 만듭니다. Q1~Q4·평균·만점·최고점 중 하나라도 확정 필드에 있는 댓글을 모두 포함합니다. 해당 댓글의 원문 전체와 **빈 후보까지 모든 후보**를 함께 보존하므로 숫자만 떼어 읽지 않아도 됩니다. 불확실한 숫자가 `candidates`에만 있는 댓글은 `mention_only`에 속하며 별도 누락 점검 대상입니다.

댓글의 `source`에는 원본 파일 해시, 댓글 해시, JSON Pointer가 있습니다. 각 후보의 `value_evidence_links`는 필드별 값과 같은 후보의 `evidence` 배열 인덱스(0부터)를 연결합니다. 원문 문자 위치는 계속 Unicode 코드포인트 기준입니다. `summary.human_review`에는 수치 후보 수, 해당 댓글 수, 강의·교수 조합 수와 그 댓글에 포함된 전체 후보 수를 별도로 집계합니다.

댓글과 후보의 `value_review_status`, `assessment_review_status`, `term_review_status`는 **항상 `unreviewed`로 시작**합니다. 추출기의 `accepted`와 사람의 확인은 별개입니다. 공식 시험통계의 사실 여부를 확인했다는 상태를 자동으로 만들지 않습니다.

`omission_samples.json`은 수치 후보가 없는 `mention_only` 댓글과 `excluded` 댓글에서 각각 최대 5개를 선택합니다. 수치 검토 목록과 겹치지 않으며, 모든 비공개 fixture의 `cases`에 기록된 댓글을 표본 풀에서 제외합니다. 시드와 모집단·선택 가능·선택 건수를 기록합니다. 이 소수 표본이나 수치 댓글 검토만으로 누락이 없다고 판단할 수 없습니다.

사람의 수정안은 새 `crawler/data/private/reviews/` 또는 `crawler/output/<새폴더>/`에 별도 JSONL로 저장합니다. 자동 결과·원문·기대값을 수정하지 않습니다. 아래는 **합성 예시 형식**이며 이번 버전은 수정안을 적용하는 기능을 제공하지 않습니다. 검토 상태는 `unreviewed`, `reviewed`, `needs_followup` 등으로 영역별 기록하되 `reviewed`는 원문과의 대조만 뜻합니다.

```json
{
  "review_schema_version": 1,
  "source": {
    "file": "synthetic.json",
    "file_sha256": "<검토한 원본 해시>",
    "json_pointer": "/0/댓글/0",
    "comment_sha256": "<검토한 댓글 해시>"
  },
  "extraction_code_sha256": "<해당 실행의 코드 해시>",
  "record_id": "synthetic-record",
  "reviewer": "<검토자>",
  "reviewed_at": "<ISO 8601 시각>",
  "value_review_status": "reviewed",
  "assessment_review_status": "needs_followup",
  "term_review_status": "unreviewed",
  "proposed_changes": [{
    "field": "statistics.average", "before": null, "after": 42,
    "reason": "합성 원문에서 평균을 확인함",
    "evidence": {"start": 3, "end": 9, "text": "평균 42점"}
  }],
  "note": "합성 원문은 '중간 평균 42점'. 외부 사실 확인은 수행하지 않음."
}
```

후속 결함 회귀 검사는 제공받은 `test_v015_followup.py`를 그대로 보존합니다. 추가 경계 검사와 검토 목록 검사는 별도 파일이며 실제 원문은 포함하지 않습니다. 새 실제 사례는 별도 `followup_016.json`에 수동 작성한 기대값으로 검사하고, 기존 개발/검증 기대값은 수정하지 않습니다.

## 한계와 검토 기준

규칙 기반의 보수적 첫 버전입니다. 지원하지 않는 통계 표지는 검토 후보로 남기지만 모든 자연어 표현을 탐지한다고 보장하지 않습니다. 무표제 숫자 나열, 괄호 안 별칭, 복잡한 표·범위·상대 순위, 문단을 넘어 생략된 시험명, 축약 연도와 서로 다른 시기의 비교는 수동 검토가 필요합니다. 같은 블록에 상충 값이 있으면 숫자를 `null`로 두고 모든 근거를 보존합니다.

정성적인 통계 언급이나 개인 순위를 과하게 검토 대상으로 남길 수 있습니다. 번호·영역·연도·학기의 누락 때문에 정상 출력이 비어 있을 수도 있습니다. `accepted`는 추출 규칙과 형식 검사를 통과했다는 뜻이며 강의평 내용의 사실 확인이나 전체 데이터 검증 완료를 뜻하지 않습니다. 전체 실행 후 세 분류의 원문 대조 결과와 누락·오탐을 별도 비공개 보고서로 남겨야 합니다.

## Git 보호

`crawler/.gitignore`가 `data/private/`, `output/`, Python 캐시를 제외합니다. 실제 댓글·기대 결과·실행 결과를 공개 테스트나 문서에 복사하지 않습니다. 코드·문서·합성 테스트만 공유 대상입니다. Git 제외 규칙은 이미 추적된 파일을 제거하지 않으므로 두 검사를 함께 실행합니다.

```powershell
git check-ignore -v -- crawler/data/private/fixtures/development.json crawler/data/private/fixtures/validation.json crawler/output/probe.json
git ls-files -- crawler/data/private crawler/output
git status --short --untracked-files=all
```

두 번째 명령의 출력은 비어 있어야 합니다. 이 도구는 `git add`, 커밋, 푸시, PR 생성 명령을 실행하지 않습니다.
