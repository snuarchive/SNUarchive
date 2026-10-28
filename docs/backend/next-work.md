# 백엔드 작업 순서 · 2026-10-28

## 현재 기준과 담당

- main `248727b`: Go 1단계 기반만 병합됨.
- 작업 위치: `.worktrees/backend-auth/`, branch `feature/backend-auth`. 인증 2단계 기존 HEAD는 `c1f5b81`이다.
- PR #3은 draft이고 대상은 아직 `feature/go-backend`다. main과 이 대상 branch는 현재 파일 내용이 같지만 이력이 다르다. rebase·force-push·PR 대상 변경은 이 문서 작성으로 실행하지 않는다.
- 프론트 작업은 다른 세션이 맡는다. 인계 문서는 frontend worktree의 `docs/frontend/handover-2026-10-28.md`다.
- 기능·계약의 정본은 이 branch의 [설계서](../superpowers/specs/2026-09-27-go-backend-design.md), [API 계약](../api/openapi.yaml), `db/migrations/`다. 제품·운영 미결은 [open-items.md](open-items.md)에 유지한다.

## 이번 착수 묶음: 인증 기준선과 CI

범위는 기존 인증 구현의 재검증과 O14의 자동 검증 연결이다. 공개 API·스키마·제품 동작은 바꾸지 않는다.

| 작업 | 완료 기준 | 현재 상태 |
|---|---|---|
| 기존 인증 기준선 | `make check`의 sqlc diff·vet·staticcheck·전체 테스트 통과 | 기존 staticcheck 호환성 실패 확인, 0.8.2 반영 후 exit 0 |
| 백엔드 workflow | 모든 PR과 main push에서 `make check`, `go build ./...`, API Docker 이미지 build 실행. 게시·배포 없음 | `.github/workflows/backend.yml` 작성 |
| workflow 검토 | `actionlint` 성공, 독립 검토, 위 명령의 로컬 실행 결과 확인 | actionlint·독립 정적 검토·Go build·이미지 build 완료 |
| 원격 CI | workflow가 push된 PR에서 실제 성공 | 미실행. 이번 요청에 원격 게시·workflow 수동 실행은 포함하지 않음 |

- workflow는 PR 대상 branch를 제한하지 않는다. 현재 PR #3이 main 이외 branch를 대상으로 해도 검사 대상이다.
- 테스트는 `-short`를 사용하지 않는다. 기존 testcontainers 하네스가 임시 PostgreSQL 18과 테스트별 DB를 만든다. 실제 `.env`나 운영 DB를 사용하지 않는다.
- Go 버전과 의존성은 `go.mod`·`go.sum`을 따른다. CI용 production secret이나 별도 DB service를 추가하지 않는다.
- branch protection과 required check 설정은 원격 운영 설정이므로 이번 로컬 workflow 작성과 구분한다.
- workflow 문법·Go 설정 근거: [GitHub workflow 문법](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [setup-go 공식 사용법](https://github.com/actions/setup-go#usage).

### 실패 처리

| 실패 지점 | 영향·감지 | 대응 |
|---|---|---|
| Go·도구·의존성 준비 | setup 또는 `make check`에서 비정상 종료 | 요구 버전·네트워크·캐시 상태를 확인. 버전을 임의로 낮추지 않음 |
| Docker 또는 DB 준비 | 전체 테스트 실패 | daemon·컨테이너 준비 원인을 확인. DB 테스트를 skip하여 통과시키지 않음 |
| sqlc·정적 검사·테스트 | 해당 명령 비정상 종료 | 원인을 분리하고 실패를 유지. 새로운 동작 결정은 미결로 보고 |
| 이미지 build | build step 비정상 종료 | 배포용 Dockerfile과 실제 실행 환경 차이를 확인. 이미지를 게시하지 않음 |
| CI가 실행되지 않음 | 원격 check 부재 | 로컬 검증과 원격 성공을 구분. push 후 PR check 등록을 확인 |

운영 데이터 변경이나 자동 재시도는 없다. workflow는 job timeout과 같은 ref의 이전 실행 취소로 실행 시간을 제한한다. 단계별 성공률 실측이 없어 전체 성공 확률은 제시하지 않는다.

### 착수 중 확인한 도구 호환성

- 수정 전 `make check`는 sqlc diff·vet 이후 staticcheck에서 중단됐다. 표준 라이브러리의 export data version 5를 읽지 못했으며 전체 테스트는 실행되지 않았다.
- 로컬 Go는 `1.27.3`, 고정 도구는 staticcheck `2026.2.1` (`honnef.co/go/tools v0.8.1`)이었다.
- [Staticcheck 2026.2.2 공식 릴리스 노트](https://staticcheck.dev/changes/2026.2/#staticcheck-202622-release-notes)는 Go 1.27.2의 변경된 export data 형식 지원을 명시한다. 기존 도구를 `v0.8.2`로 업데이트하고 동일한 검사를 다시 실행한다.
- Go의 모듈 선택에 따라 `golang.org/x/tools`와 관련 간접 의존성도 함께 갱신됐다. 변경은 `go.mod`·`go.sum`에서 확인한다. 검사를 끄거나 Go 버전을 낮추지 않는다.

## 다음 구현 묶음: 카탈로그·즐겨찾기

이 목록은 작업 순서다. 3단계 실행 계획과 테스트 명세는 착수 전에 별도로 작성한다. 범위는 설계서 §9의 3단계를 따른다.

1. 카탈로그 importer와 반복 실행
   - 원본 학기 JSON에서 교수·학과·강의·개설·분반을 적재하고 검색용 정규화 값을 생성.
   - 동일 입력 재실행의 멱등성, 중복·교수 미정·학기 구분·기존 기여 보존 검증.
   - O9의 최종 강의 식별 규칙은 미결. 기존 설계의 임시 Identifier 범위를 확인하고, 영구 매핑으로 확정하지 않는다.
2. 검색·강의 상세·홈 목록
   - 계약의 `/courses`, `/courses/{courseId}`, `/courses/home` 구현.
   - 인증·비활성 강의 조회 정책·cursor·정렬·검색 일관성을 실제 DB로 검증.
   - 후속 기여 단계에 해당하는 데이터는 계약이 정한 빈 상태로 표현하되, 없는 endpoint를 정상 응답으로 위장하지 않는다.
3. 즐겨찾기와 순서 저장
   - `/me/favorites`, `/me/favorites/ids`, 추가·해제·순서 변경을 계약대로 구현.
   - 사용자 격리, 중복 요청, 잘못된 ID·순서 입력, 페이지별 목록과 홈 목록의 일관성 검증.
4. 시드와 실제 사용자 경로 연결
   - O27에 따라 계정 시드에 카탈로그·즐겨찾기를 누적.
   - 프론트 세션과 실제 Go로 로그인 → 홈 → 강의 → 계정 경로를 검증.
   - 4단계 이후에만 제공할 통계·투표·업로드 시나리오는 별도로 표시. 단계가 제공하지 않는 기능을 통과했다고 보고하지 않음.

프론트 홈은 `/courses/home`·`/me/favorites/ids`, `/me` 화면은 `/me/favorites`에도 의존한다. 인증 API 구현만으로 일반 화면 통합이 끝났다고 판단하지 않는다.

## 이후 단계와 선행 결정

| 단계 | 백엔드 범위 | 착수 전 확인 |
|---|---|---|
| 4. 기여 | 회차·통계·투표·요청·한줄평 | O25 시험 일자 없는 투표 운영, O23 오류 매핑, O30 과거 마감 검증 |
| 5. 업로드·검토 | fs/s3 저장·업로드·검토 큐·파일 열람·GC | O15 테스트 스토리지, O22 긴 전송 timeout |
| 6. 관리·로그 | 관리자 API·로그·내보내기·보관·운영 통계 | O29 관리자 회수 동시성, O21 종료 처리, Drive 설정 |
| 통합 배포 | web compose·Caddy·개발 override·실제 E2E | O26, 프론트 병합, web은 production으로 유지하는 최신 프록시 경계 |
| 운영·이관 | 실제 Google 로그인·도메인·TLS·Firestore 이관 | O1/O2 데이터·로그 보존, O6/O8 외부 운영 설정 |
| 선택 배포 경로 | Vercel·Supabase | O3/O4/O11/O12/O16. VM 경로와 구분해 검증 |

## 검증 기록

- 프론트 인계 문서는 코드·테스트·설정을 대조하고 별도 세션이 문서만 읽는 검토를 수행했다. 실행 위치·시드 경로·미결 PR 경계를 보강했다.
- `actionlint .github/workflows/backend.yml`: exit 0. 독립 정적 검토에서 workflow 차단 사항 없음.
- `make check`: 호환성 수정 전 staticcheck 단계 exit 2, 수정 후 exit 0. sqlc diff·vet·staticcheck·전체 테스트를 실행했고 `-short`는 사용하지 않았다. 인증·DB·HTTP API·개발 시드 등 DB 통합 테스트도 통과했다.
- `go build ./...`: exit 0.
- `docker build --file deploy/Dockerfile --tag snuarchive/api:ci .`: exit 0. 로컬 이미지 build이고 게시·배포하지 않았다. 이미지 ID는 `sha256:ac672d48bbfe2161355c1d4ff439877a3680501299327fded0d6adbccfd2fadd`다.
- 문서 산문 검사: 경고 0건. 프론트·백엔드 코드를 수정하는 실행 계획 대신 이번 착수 범위와 후속 의존성을 기록했다.
- 원격 PR 게시·retarget·merge와 실제 Google 로그인·운영 DB 검증은 수행하지 않는다.
