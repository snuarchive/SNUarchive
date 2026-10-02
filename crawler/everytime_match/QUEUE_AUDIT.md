# 2026-10-02 전체 queue 감사

브라우저를 열거나 수집을 재개하지 않고 `scripts/build-courses.js`, 원본 학기 파일, `public/courses.json`, 기존 campaign을 대조했다.

현재 19,155개는 학기별 원본 행 수가 아니라 이미 정규화하여 합친 course 수다. 기존 campaign manifest의 입력은 `public/courses.json`이고 SHA-256은 `80ebaa51d302bd887120947a89d0ece590cbdc7701dbd9c7d34d2572ebe885e2`다. 실제 build 스크립트의 파일 쓰기를 메모리로 가로채 재현한 JSON의 바이트 SHA-256도 동일했다. 원본 파일·public 출력은 쓰지 않았다.

| 구분 | 수 |
| --- | ---: |
| 학기 원본 source rows | 40,306 |
| 원문 그대로 강의명·교수 고유 조합 | 19,213 |
| 동일 build 규칙의 정규화 course_key | 19,155 |
| 현재 queue의 중복 course_key | 0 |
| 현재 queue에서 추가 축소 | 0개 / 0% |
| source rows 대비 이미 적용된 축소율 | 52.47605815511338% |
| unique course 중 교수 `미정` | 255 |
| 원본 instructor가 문자 그대로 `미정` | 0 |
| 원본 교수 빈값·누락 → build에서 `미정` 처리 | 549행 |
| offerings 2개 이상인 course | 8,616 |
| 서로 다른 연도·학기가 2개 이상인 course | 8,549 |
| 보존된 고유 offerings | 37,890 |

`clean()`은 공백을 한 칸으로 정리하고 앞뒤를 제거한다. 빈 교수는 `미정`으로 대체한다. course_key는 강의명과 교수를 각각 공백 제거·소문자화한 뒤 `|`로 연결하고 SHA-1 앞 20자리로 만든다. 실제 스크립트를 실행해 규칙을 재사용했으며 다른 언어의 공백/대소문자 규칙으로 대체하지 않았다. offerings의 고유 기준은 연도·학기·학과다. 그래서 동일 학기의 다른 학과 offering도 별도로 남는다. 원본 2,416행은 이미 같은 course의 동일 offering 조합과 겹쳐 이 스크립트에서 합쳐진다.

이 키는 queue의 중복 판별 및 매칭 후보용이다. DB의 최종 course ID가 아니며, 이름 정규화만으로 Everytime 매칭을 확정하지 않는다. 실제 검색 원문 검증 원칙을 바꾸지 않았다.

실행 queue 재생성 조건인 학기별 중복 입력은 없었다. 기존 실행 queue를 유지하고 별도 `crawler/output/everytime_queue_audit_20261002/unique_queue_view/`에 실행 불가능한 감사용 고유 목록을 생성했다. 모든 course 객체와 offerings를 원래 catalog/queue와 전부 대조했다. 이 view는 중단 guard를 해제하는 새 campaign이 아니다.

기존 66개 결과는 모두 고유 course_key에 1:1 대응한다. `result_mapping.json`에 기존 위치·결과 경로·SHA-256·발견 URL·raw 참조를 보존했다. complete 61개는 view의 completed로 재사용 가능하고, ambiguous 3/not_found 1/partial 1/failed 0도 그대로 연결했다. 60번째 입력의 matched 상태는 수집 전 대기로 별도 유지했다. 원본 raw를 합치거나 삭제·덮어쓰지 않았다.

수집 미완료 unique는 19,094개(19,155 - 61)다. 이 중 검토 상태 5개를 제외한 terminal 미처리는 19,089개이며, matched 수집 대기 1개 + 검색 대기 19,088개다. 기존 결과 재사용 가능 66개와 수집 completed 재사용 가능 61개를 구분해야 한다.

두 전송 오류는 별도 `checksum_audit.json`에 기록했다. 42번은 반환된 base64 압축문자열과 최초 로컬 pack의 0-based 1366번째 문자가 `S`/`P`로 달랐다. 길이는 같지만 UTF-8 복원에서 실패하여 원문 FNV 비교에는 도달하지 못했다. 59번은 두 번째 배치의 세 번째 압축문자열 조각을 로컬 함수 인자로 옮긴 직후, 파일 저장 전 FNV가 달랐다. expected `7a09b2ab69670bcd` / actual `94557a6ddce3cf42`, 길이 2,724 / 2,728자다. 59번의 실패한 중간 문자열은 파일로 저장되지 않았으므로 해당 값의 근거는 직전 세션 도구 출력이다. 현재 저장된 복구본은 원래 검증을 통과한다. 현재 감사에서 raw를 고치거나 검증을 약화하지 않았다.

재현 명령은 아래와 같다. 출력 경로는 반드시 새 경로여야 하며, 감사는 브라우저나 수집기를 실행하지 않는다.

```powershell
node crawler/everytime_match/audit_full_queue.cjs . crawler/output/everytime_full_20261001T104759Z/campaign crawler/output/<새감사폴더>
node --test crawler/everytime_match/tests/audit_full_queue.test.cjs
```

기존 62개 collector 보고서를 원래 validator로 검증했다. 감사 전용 합성 테스트 2개는 실제 build 코드의 쓰기 차단, 공백/대소문자 정규화, 빈 교수 대체, offering 보존 및 변조 거부를 검사한다. 실사이트 신규 수집 결과는 없다.
