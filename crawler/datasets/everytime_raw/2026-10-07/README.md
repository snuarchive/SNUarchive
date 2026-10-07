# Everytime 수집 원문 전달본

2026-10-07에 기존 로컬 수집 자료에서 만든 원문 전달본입니다. 신규 수집이나 DB 적재를 수행하지 않았습니다. 추출 후보, 사람 승인 결과, 브라우저 프로필·쿠키·세션은 포함하지 않습니다.

## 규모와 해석

- 강의명·교수 조합 목록: 31,957건. 사이트 URL: 29,044개.
- 목록 처리 결과: complete 9,336 / empty 16,895 / needs_review 1,302 / not_found 4,424.
- 수집 기록(capture): 29,658개. 상태 complete 29,645 / partial 9 / complete_for_observed_ui 4. 빈 수집 기록도 포함하므로 이 수를 리뷰가 있는 강의 수로 해석하지 않습니다.
- 원본 JSON 문서 13,384개 중 13,383개는 바이트 단위로 동일합니다. 공개 전달본의 리뷰 1건은 이메일만 마스킹했으며 관련 checksum과 fingerprint를 재계산했습니다. 로컬 수집 원본은 수정하지 않았습니다.
- 전체 수집 기록의 리뷰 합계: 126,381건.
- 동일한 리뷰 다중집합을 가진 반복 수집 기록을 제외한 기본 읽기 대상: 121,809건. 제외된 반복 수집분 4,572건도 원본에는 보존됩니다.
- 위 수치는 실제로 서로 다른 리뷰 수를 보장하지 않습니다. 사이트 리뷰 ID가 없어 다른 수집 기록 사이의 동일성을 확정하지 못한 8건은 자동 병합하지 않았습니다. 한 수집 기록 안의 동일 문구 반복은 유지합니다.

## 파일

- `raw-001.zip` ~ `raw-009.zip`: 공개용 JSON(이메일 1건 마스킹), `raw/<sha256>.json` 이름으로 저장. ZIP을 대량으로 풀 필요가 없습니다.
- `raw_files.jsonl.gz`: 전달본 checksum, 바이트 수, ZIP 파일 및 내부 경로.
- `captures.jsonl.gz`: 강의명·교수·URL·상태·표시 개수 및 각 리뷰의 원본 참조(JSON pointer), 전달 본문 checksum, 학기 원문, fingerprint. 수집 ID와 report checksum은 기존 수집본의 출처 표시입니다.
- `capture_groups.jsonl.gz`: 반복 수집 그룹과 기본 대표 수집본 선택 근거.
- `uncertain_capture_pairs.jsonl.gz`: 동일성을 확정하지 못한 수집 기록 관계.
- `catalog_outcomes.jsonl.gz`: 목록별 수집 결과. 로컬 실행 경로는 제외했습니다.
- `course_catalog.jsonl.gz`: 기존 강의 목록의 전달용 사본.
- `summary.json`: 집계 및 범위.
- `redactions.json`: 이메일 마스킹 범위와 원본·전달본 checksum 대응. 이메일 원문은 포함하지 않습니다.
- `.gitattributes`: checkout 시 줄바꿈 변환을 막아 checksum을 보존합니다.
- `manifest.json`: 이 파일을 제외한 전달 파일별 SHA-256.
- `read_raw.py`: 네트워크·DB 접근 없이 ZIP에서 직접 읽고 검증하는 도구.

## 읽기와 검증

Python 3.11 이상, 추가 패키지는 필요 없습니다. 이 폴더에서 실행합니다.

```powershell
python -X utf8 -B read_raw.py --verify
python -X utf8 -B read_raw.py --lecture-url 'https://everytime.kr/lecture/view/603889?tab=article' --limit 1
python -X utf8 -B read_raw.py --include-repeat-captures --limit 1
```

기본 읽기는 반복 수집본을 제외합니다. `--include-repeat-captures`는 보존된 모든 수집 기록을 읽습니다. 결과의 `raw_review`는 이메일 1건 마스킹을 반영한 리뷰 객체이며 `text_raw`, `enrollment_term_raw`와 원본 evidence/metadata를 포함합니다. `review_reference`는 원본 문서 위치와 검증값을 제공합니다.

```python
from read_raw import RawDataset
with RawDataset('.') as dataset:
    for row in dataset.reviews():
        review = row['raw_review']
        # review['text_raw'], review['enrollment_term_raw'] 등 처리
```

## 한계와 후속 작업

부분 수집·일치 미확정·검색 실패를 완전 수집으로 취급하지 않습니다. 교수 미확정 evidence 문서도 원문 그대로 보존됩니다. 리뷰 ID와 작성·수정 시각의 미확인 값은 새로 추정하지 않습니다. 작성자가 남긴 이메일 주소 1건을 `[EMAIL_REDACTED]`로 바꿨습니다. 같은 주소가 포함된 evidence도 함께 마스킹했습니다. 다른 원문과 외부 링크는 수정하지 않았습니다.

이 자료는 원문 전달본이며 `schema.sql`에 바로 넣는 import dataset이 아닙니다. 통계 추출, 의미 검토, 학기 연결, 대상 schema 매핑 및 DB 적재는 별도 단계입니다. 기존 추출 제안은 사람 승인으로 간주하지 않습니다.
