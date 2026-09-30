# raw observation schema 1 / 2

이는 Everytime 응답 형식이 아니라 **브라우저에서 관찰한 자료를 보존하기 위한 내부 봉투 형식**입니다. schema 1은 기존 수동 표본을 그대로 지원하며, schema 2는 명시적으로 확인한 한 강의씩 자동 DOM 관찰에 사용합니다. 모든 필드를 포함하되 미확인 선택 값은 `null`로 둡니다. 여기서 `null`은 ‘확인하지 못함’이며 ‘사이트에 없음’과 같지 않습니다.

| 위치 | 형식과 의미 |
| --- | --- |
| `schema_version` | 정수 `1` 또는 `2`. 기존 파일을 자동 변환하지 않음 |
| `capture.method` | schema 1: `manual_browser_observation`, schema 2: `browser_dom_observation` |
| `capture.observed_at` | 실제 관찰 시각. 시간대를 포함한 ISO 문자열. 리뷰 작성 시각과 구분 |
| `capture.page_url` | 실제로 확인한 HTTPS Everytime URL. 자격 증명·세션 쿼리 금지 |
| `capture.page_title` | 표시 제목 원문 또는 `null` |
| `capture.coverage` | `sample`. 완전 수집을 뜻하지 않음 |
| `capture.metadata` | 페이지 위치, 선택 범위 등 추가 관찰 맥락 객체. 세션 정보 금지 |
| `course.title_raw`, `course.instructor_raw` | 필수 원문 문자열. 기존 JSON의 강의명·교수 보존 |
| `course.source_id` | 실제 확인한 강의 ID 문자열 또는 `null`. 카탈로그 키/DB ID를 대신 넣지 않음 |
| `course.metadata` | 추가로 관찰한 강의 표시 정보 객체 |
| `course.field_evidence` | 아래 근거 참조 규칙 적용 |
| `reviews` | 한 강의의 리뷰. schema 1: 1~5개, schema 2: 1~20개 |
| `reviews[].text_raw` | 생략·요약하지 않은 필수 본문 문자열. 공백·줄바꿈 보존 |
| `reviews[].source_id` | 실제 확인한 리뷰 ID 문자열 또는 `null` |
| `reviews[].enrollment_term_raw` | 표시된 수강 학기 원문 또는 `null` |
| `reviews[].created_at_raw`, `updated_at_raw` | 각각 작성·수정 시기로 확인된 표시 원문 또는 `null` |
| `reviews[].metadata` | 추가 리뷰 표시 정보 객체. 해석이 불명확한 날짜/레이블도 원문으로 보존 가능 |
| `reviews[].field_evidence` | 아래 근거 참조 규칙 적용 |
| `evidence` | 강의·리뷰 영역의 근거 블록. schema 1: 1~30개, schema 2: 1~50개 |
| `evidence[].id` | 이 파일 내부의 고유한 근거 이름. 사이트/DB 식별자 아님 |
| `evidence[].kind` | 현재 `visible_text`만 지원 |
| `evidence[].text` | 관찰한 영역의 텍스트 그대로. 전체 HTML, 계정 메뉴, 헤더 금지 |
| `evidence[].locator` | 실제로 확인한 위치 설명 또는 `null`. 선택자를 추측하지 않음 |

본문 밖의 노출 필드를 알아내지 못했다면 임의로 채우지 않습니다. 예를 들어 `2024-1`이라는 문구만으로 수강 학기인지 작성 시기인지 알 수 없다면 정규 필드는 `null`로 두고 해당 레이블·문구·불명확한 사유를 `metadata`와 근거에 남깁니다. `metadata`에는 실제 관찰한 추가 필드를 원래 레이블·값과 함께 보존합니다. 알 수 없는 최상위 키를 버리는 대신 입력을 거부하므로, 추가 사이트 정보는 적절한 `metadata`로 표현해야 합니다.

## 근거 참조

강의/리뷰의 `null`이 아닌 각 필드마다 `field_evidence`에 같은 키가 필요합니다. 비어 있지 않은 `metadata`에도 하나의 근거 참조가 필요합니다.

```json
{"evidence_id": "heading", "start": 0, "end": 4}
```

위치는 해당 근거 텍스트의 **Unicode 코드 포인트** 단위 `[start, end)`입니다. Python 문자열 인덱스이며 UTF-8 바이트 또는 JavaScript UTF-16 인덱스가 아닙니다. 정규 원문 필드는 `evidence.text[start:end] == field_value`를 검사합니다. 이 일치는 입력 내부의 정합성을 확인할 뿐, 실제 사이트에서 나온 내용인지 또는 접힌 부분 없이 완전한지 증명하지 않습니다.

`metadata` 참조는 해당 원문 구간의 존재만 검사합니다. 구조화한 값과 근거의 의미가 일치하는지는 사람이 확인해야 합니다. 지금은 DOM 속성/URL 내부 ID에 대한 별도 근거 형식을 지원하지 않습니다. 이를 관찰하게 되면 실제 형식을 확인하여 별도 확장하고, 표시 텍스트처럼 꾸며 넣지 않습니다.

## 합성 예시

다음은 스키마 설명용 합성 입력입니다. URL은 알려진 홈페이지를 예시 참조로 사용한 것이며 실제 강의 경로나 endpoint가 아닙니다. 실제 raw나 실사이트 조사 결과로 사용하지 않습니다.

```json
{
  "schema_version": 1,
  "capture": {
    "method": "manual_browser_observation",
    "observed_at": "2026-09-30T10:00:00+09:00",
    "page_url": "https://everytime.kr/",
    "page_title": "합성 화면",
    "coverage": "sample",
    "metadata": {"synthetic": true}
  },
  "course": {
    "title_raw": "합성강의",
    "instructor_raw": "합성교수",
    "source_id": null,
    "metadata": {},
    "field_evidence": {
      "title_raw": {"evidence_id": "heading", "start": 0, "end": 4},
      "instructor_raw": {"evidence_id": "heading", "start": 5, "end": 9}
    }
  },
  "reviews": [{
    "source_id": null,
    "text_raw": "합성 리뷰",
    "enrollment_term_raw": null,
    "created_at_raw": null,
    "updated_at_raw": null,
    "metadata": {},
    "field_evidence": {"text_raw": {"evidence_id": "r1", "start": 0, "end": 5}}
  }],
  "evidence": [
    {"id": "heading", "kind": "visible_text", "text": "합성강의\n합성교수", "locator": null},
    {"id": "r1", "kind": "visible_text", "text": "합성 리뷰", "locator": null}
  ]
}
```

## 저장 결과

`raw.json`에는 검증한 입력의 **바이트 그대로**를 보존합니다. `manifest.json`에는 저장기 버전, 실제 저장 시각, 제공된 관찰 시각, 입력 경로·SHA-256, raw SHA-256, 리뷰별 본문/비교 해시와 배열 위치, 이전 파일·해시·리뷰 위치를 참조하는 중복 후보가 들어갑니다. 비교 해시는 로컬 비교용이며 사이트 또는 DB ID가 아닙니다.

저장 결과는 `operation=archive_supplied_observation`, `network_requests=0`, `site_structure_verified=false`, `human_review_status=unreviewed`입니다. `network_requests`는 로컬 저장 명령만의 값입니다. schema 1의 `site_adapter`는 `null`이고 schema 2는 기존 `everytime_visible_dom_v1` 또는 일반화한 `everytime_visible_dom_v2`입니다. 저장 성공을 사이트 진위 검증이나 사람의 승인으로 취급하지 않습니다. JSON Pointer는 리뷰 배열 위치에서 `/reviews/0`처럼 결정할 수 있습니다. 작성 연도·학기·시험 정보를 별도로 추정하지 않습니다.

## schema 2의 단일 강의 제약

`capture.page_url`은 관찰한 `https://everytime.kr/lecture/view/<강의 번호>?tab=article`, `capture.metadata.overview_page_url`은 같은 강의의 개요 URL이어야 합니다. 경로 속 번호는 URL 검증에만 사용하며 탐색하거나 리뷰 ID로 대체하지 않습니다. 본문은 이 페이지에서 이미 렌더링된 카드만 읽습니다. `course`와 `capture.page_url`은 파일 내 모든 리뷰의 강의명·교수명·출처 URL을 공통으로 제공합니다.

v2 어댑터는 `capture.metadata.target={url,title,instructor}`를 추가하고 실제 course 필드와 정확히 대조합니다. `scope={filter:"전체",sort:"등록순",locator:"div.article_tab > div.header button"}`와 `list_window`도 필수입니다. raw `schema_version=2`와 기존 필드 구조는 바뀌지 않습니다. v1 어댑터 자료에는 새 메타데이터를 강요하지 않습니다.

`capture.metadata.collection`에는 `adapter`, `requested_limit`, `loaded_count`, `attempted`, `succeeded`, `failed`, `not_attempted_loaded`, `failures`, `complete_course`가 필요합니다. 성공 수는 저장된 리뷰 수와 같아야 하며 성공+실패=시도 수, 시도 수=min(limit, 로드된 수), 미시도 수=로드된 수-시도 수를 검증합니다. `complete_course`는 항상 `false`입니다.

`failures`의 각 항목은 1부터 시작하는 `list_position`과 `reason`을 갖습니다. 허용 사유는 `body_missing_or_ambiguous`, `body_empty_or_hidden`, `term_ambiguous`, `term_unrecognized`입니다. 실패 항목의 원문을 추측하거나 정상 리뷰로 저장하지 않습니다. 모든 항목 실패 시 브라우저 함수는 raw 대신 `observation=null`과 집계를 반환합니다.

근거의 `locator`는 당시 실제로 읽은 URL과 표시 레이블/요소 위치입니다. 카드의 `:nth-child(n)`은 그 관찰 시점의 위치이며 영구 리뷰 식별자가 아닙니다. URL 속 강의 번호·숫자가 아닌 별점·숨겨진 속성은 `visible_text` 근거처럼 꾸미지 않습니다. 현재 어댑터의 강의/리뷰 `source_id`, 작성/수정 시각은 `null`입니다.

## UI 스크롤 실행의 배치 보존

schema 2의 필드와 한 파일 최대 20개 제한은 유지합니다. 추가 로드된 리뷰는 새 배치로 저장하며 `capture.metadata.list_window`에 다음을 기록합니다.

| 키 | 의미 |
| --- | --- |
| `start_position` | 이 배치의 첫 카드 위치. 전체 DOM 목록에서 1부터 시작 |
| `end_position` | 이 배치의 마지막 카드 위치 |
| `dom_loaded_count` | 이 배치를 읽을 당시 DOM에 로드된 전체 카드 수 |

이 메타데이터가 있으면 `collection.loaded_count`는 **해당 배치 창에 들어온 카드 수**입니다. 전체 DOM 수는 `dom_loaded_count`로 구분합니다. 예를 들어 추가 17개 배치는 시작 21, 끝 37, DOM 수 37, loaded_count/attempted/succeeded 17입니다. 각 배치의 `failures[].list_position`은 배치 내 위치이며 실행 보고에서는 전역 위치로 변환합니다. 원문 근거 locator는 항상 실제 전역 DOM 위치입니다.

각 raw의 `coverage=sample`, `collection.complete_course=false`는 배치 단위 의미를 유지합니다. 여러 배치의 실행 범위와 종료 판단은 별도 `run_report.json`에 기록합니다. `ui_end_confirmed`는 표시된 총수, 바닥 스크롤 위치, 두 차례 새 카드 없음 기록이 서로 맞을 때만 참입니다. UI 뒤의 비공개 데이터까지 완전하다는 뜻은 아닙니다.

실행 보관기는 창의 연속성·강의 일치·성공/실패 수·종료 근거를 먼저 검증합니다. 중복 후보는 이번 실행 내부, 이전 raw 대비, 추가 카드 대 최초 카드로 구분해 셉니다. fingerprint가 같은 리뷰도 모두 저장하며 영구 ID나 자동 병합 기준으로 사용하지 않습니다.

## 일반화한 실행 보고서

`report_version=2`는 raw schema 버전과 별개입니다. 기존 실행 보고서도 계속 읽습니다. 새 보고서는 target, 표시 총수의 원문/위치/시각, 이름·교수 근거, 현재 필터·정렬, 매 UI 동작의 로드 수·스크롤 위치·높이·바닥 상태, 제한, 실패 위치 및 종료 사유를 보존합니다.

`initial_loaded`는 수집 시작 시점의 실제 카드 수라서 20을 넘을 수 있습니다. 카드 1번부터 끝까지 연속한 창으로 나누며 동일 본문의 다른 카드도 별도 행입니다. `attempted=succeeded+failed`, `unattempted_loaded=final_loaded-attempted`를 검증합니다. 오류 이후 관찰하지 않은 화면 상태는 추정하지 않습니다.

`status=complete`는 표시 총수와 로드·저장 수가 같고, 전체/등록순 목록 바닥에서 두 차례 새 카드가 없을 때만 허용합니다. 예외인 0개는 개요의 `(0개)`와 목록의 `첫 번째 강의평을 남겨주세요`를 함께 요구합니다. 빈 개요의 개수 위치는 실제 확인한 `section.empty.review > div.title > span.count`이며 일반 개요의 위치와 다릅니다. 0개 실행은 빈 raw를 만들지 않고 보고서만 남깁니다.

로딩 실패/로그인/강의 불일치로 첫 목록을 못 읽으면 로드 수는 `null`이고 `status=partial`입니다. 표시 개수 불일치, 스크롤·배치 상한, 항목 실패, 중간 오류도 partial입니다. 중간 오류는 이미 저장한 배치와 `stop_error`를 남깁니다. 로컬 최종화는 저장된 `batch_event.json`과 raw·manifest 해시를 대조해 누락된 배치를 정상 저장으로 꾸밀 수 없게 합니다.

`enrollment_term_raw`는 카드에 표시된 수강학기일 뿐, 본문 속 모든 시험 점수·통계의 학기를 확정하는 근거가 아닙니다. 현재 어댑터가 확인하지 못한 리뷰 ID·작성/수정 시각은 계속 `null`입니다.
