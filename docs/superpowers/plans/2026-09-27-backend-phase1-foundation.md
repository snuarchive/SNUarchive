# 백엔드 1단계(기반) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go 서버의 뼈대를 세운다. 설정 검증, 스키마 v1 마이그레이션, 테스트용 PostgreSQL 하네스, HTTP 골격, 첫 엔드포인트 `GET /api/v1/config`, `serve`/`migrate` CLI, docker compose 배포까지 만든다. 이후 단계는 여기에 도메인 기능을 얹기만 하면 되게 한다.

**Architecture:** 단일 Go 모듈(`github.com/snuarchive/snuarchive`, 저장소 루트). 도메인 패키지는 `net/http`를 모르고, `internal/httpapi`가 계약(`docs/api/openapi.yaml`)과 도메인 사이를 번역한다. DB 접근은 sqlc가 생성한 `internal/db/dbq`로, 스키마는 goose SQL 마이그레이션(`db/migrations`, 바이너리에 embed)으로 관리한다. 통합 테스트는 testcontainers로 띄운 `postgres:18`에서 테스트마다 템플릿 DB를 복제해 격리한다.

**Tech Stack:** Go 1.27, pgx/v5 v5.11.0, goose/v3 v3.28.0, sqlc v1.31.1(`go tool`), testcontainers-go v0.44.0, kin-openapi v0.149.0, OpenTelemetry(contrib autoexport·otelhttp v0.71.0), staticcheck(`go tool`), Docker(alpine), Caddy 2.

**Spec:** `docs/superpowers/specs/2026-09-27-go-backend-design.md` (결정 표 §2, 데이터 모델 §4, 설정 §6). API 계약: `docs/api/openapi.yaml`. 남은 확인 항목: `docs/backend/open-items.md`.

## Global Constraints

- 작업 디렉터리는 **`/home/toxiclemon/Working/SCSC/SNUarchive/.worktrees/go-backend`** (브랜치 `feature/go-backend`)뿐이다. 메인 체크아웃(`/home/toxiclemon/Working/SCSC/SNUarchive`)은 읽지도 쓰지도 않는다.
- 커밋 메시지에 `Co-Authored-By` 줄을 **절대 넣지 않는다.** push하지 않는다.
- 모듈 경로는 소문자 `github.com/snuarchive/snuarchive`. 원격 저장소 이름(`snuarchive/SNUarchive`)과 대소문자가 다르다는 점은 알고 정한 것이다.
- `go 1.27`. 빌드 이미지 `golang:1.27-alpine`, 런타임 이미지 `alpine:3.22`.
- PostgreSQL 18. 테스트·compose 모두 `postgres:18` 이미지. PG18 이미지의 볼륨 경로는 `/var/lib/postgresql`이다(PGDATA=`/var/lib/postgresql/18/docker`).
- 학기 코드: 1=봄(1학기), 2=여름(여름학기), 3=가을(2학기), 4=겨울(겨울학기). 1~2월은 전년도 겨울학기다. 시간대는 항상 Asia/Seoul이고 `time/tzdata`를 내장한다.
- JSON 요청 본문 기본 한도는 64 KiB(`65536`). 업로드 한도는 3 MiB(`3145728`, `pending_reports_size_ck`와 같음).
- 에러 응답은 모두 `{"error":{"code","message","requestId","details"}}` 형식이다. 404와 405도 포함하며, 405에는 `Allow` 헤더를 붙인다.
- 테스트: DB 통합 테스트는 `go test -short`면 건너뛰고, 아니면 Docker가 없을 때 **실패**한다. 테스트마다 템플릿 DB를 복제한다.
- 린트는 `go vet ./...`와 `go tool staticcheck ./...`, 코드 생성은 `go tool sqlc generate`. 명령은 `Makefile`로 묶는다.
- **도중 결정 규칙:** 이 계획에 없는 결정(스키마·API·보안·동작)이 필요해지면 임의로 정하지 않는다.
  1. `docs/backend/open-items.md` 표에 새 `O` 번호 행으로 무엇을·왜·무엇이 막히는지·선택지를 기록한다(상태 `열림`).
  2. 그 부분만 건너뛰고 나머지 작업을 끝낸다.
  3. 보고할 때 그 항목을 명시한다.
- 파일 인코딩 UTF-8. 주석은 코드가 스스로 말하지 않는 이유만 적는다.

## 파일 구조

```
go.mod / go.sum                      모듈, tool 의존성(sqlc, staticcheck)
Makefile                             generate, vet, lint, test, test-short, sqlc-check, check, run, migrate, compose-*
sqlc.yaml                            sqlc 설정
.dockerignore                        Docker 빌드 컨텍스트 허용 목록
cmd/snuarchive/main.go               CLI: serve | migrate up|down|status | version
cmd/snuarchive/main_test.go
db/migrations/00001_init.sql         스키마 v1 (goose)
db/migrations/embed.go               //go:embed *.sql
db/queries/reference.sql             sqlc 입력: 시험 종류, 단과대
internal/calendar/                   Asia/Seoul 현재 학기, 학기 라벨
internal/apperr/                     에러 코드·필드 코드·상태·기본 메시지
internal/config/                     환경변수 파싱·검증
internal/telemetry/                  slog + OpenTelemetry
internal/db/db.go                    pgxpool Open(풀러 모드), Migrator(goose)
internal/db/errors.go                제약 이름 → API 에러 매핑
internal/db/dbq/                     sqlc 생성 코드 (직접 수정 금지)
internal/refdata/                    /config 데이터와 입력 한도 상수
internal/httpapi/server.go           New(Deps) → *Server, Routes()
internal/httpapi/router.go           라우트 등록, 라우트별 CSRF·본문 한도, 404/405 JSON
internal/httpapi/middleware.go       요청 ID, 클라이언트 IP, 접근 로그, recover, 본문 한도, CSRF
internal/httpapi/respond.go          writeJSON, writeError, decodeJSON
internal/httpapi/handlers.go         healthz, readyz, getConfig
internal/testutil/pgtest/            testcontainers postgres:18 + 템플릿 DB 복제
internal/testutil/contract/          openapi.yaml 요청·응답 검증
deploy/Dockerfile                    golang:1.27-alpine → alpine:3.22
deploy/compose.yaml                  db, migrate, app, caddy
deploy/Caddyfile                     /api/* → app, 헬스체크 외부 차단
deploy/.env.example
docs/backend/running-locally.md
```

---

### Task 1: 모듈 뼈대와 calendar 패키지

**Files:**
- Create: `go.mod`, `Makefile`, `internal/calendar/calendar.go`, `internal/calendar/calendar_test.go`
- Modify: `.gitignore` (끝에 `/bin/` 추가)

**Interfaces:**
- Produces: `calendar.Term{Year, Semester int}`, `calendar.CurrentTerm(time.Time) Term`, `calendar.SemesterLabel(int) (string, error)`, `calendar.Semesters() []int`, `calendar.Location() *time.Location`, 상수 `calendar.Spring/Summer/Fall/Winter`.

- [ ] **Step 1: 모듈 초기화**

```bash
cd /home/toxiclemon/Working/SCSC/SNUarchive/.worktrees/go-backend
go mod init github.com/snuarchive/snuarchive
go mod edit -go=1.27
printf '\n/bin/\n' >> .gitignore
```

- [ ] **Step 2: Makefile 작성** (레시피 줄은 반드시 TAB으로 시작)

```make
GO ?= go
COMPOSE = docker compose -f deploy/compose.yaml --env-file deploy/.env

.PHONY: generate vet lint test test-short sqlc-check check run migrate compose-up compose-down

generate:
	$(GO) tool sqlc generate

vet:
	$(GO) vet ./...

lint: vet
	$(GO) tool staticcheck ./...

test:
	$(GO) test ./...

test-short:
	$(GO) test -short ./...

sqlc-check:
	$(GO) tool sqlc diff

check: sqlc-check lint test

run:
	$(GO) run ./cmd/snuarchive serve

migrate:
	$(GO) run ./cmd/snuarchive migrate up

compose-up:
	$(COMPOSE) up -d --build

compose-down:
	$(COMPOSE) down
```

- [ ] **Step 3: 실패하는 테스트 작성** — `internal/calendar/calendar_test.go`

```go
package calendar_test

import (
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/calendar"
)

func TestCurrentTerm(t *testing.T) {
	seoul := calendar.Location()
	cases := []struct {
		name string
		at   time.Time
		want calendar.Term
	}{
		{"new year is previous winter", time.Date(2026, 1, 1, 0, 0, 0, 0, seoul), calendar.Term{Year: 2025, Semester: calendar.Winter}},
		{"last minute of february", time.Date(2026, 2, 28, 23, 59, 0, 0, seoul), calendar.Term{Year: 2025, Semester: calendar.Winter}},
		{"march starts spring", time.Date(2026, 3, 1, 0, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Spring}},
		{"seoul midnight is still february in UTC", time.Date(2026, 2, 28, 15, 30, 0, 0, time.UTC), calendar.Term{Year: 2026, Semester: calendar.Spring}},
		{"june is spring", time.Date(2026, 6, 30, 12, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Spring}},
		{"july is summer", time.Date(2026, 7, 1, 0, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Summer}},
		{"august is summer", time.Date(2026, 8, 31, 23, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Summer}},
		{"september is fall", time.Date(2026, 9, 1, 0, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Fall}},
		{"december is fall", time.Date(2026, 12, 31, 23, 59, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Fall}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := calendar.CurrentTerm(tc.at); got != tc.want {
				t.Fatalf("CurrentTerm(%s) = %+v, want %+v", tc.at, got, tc.want)
			}
		})
	}
}

func TestSemesterLabel(t *testing.T) {
	want := map[int]string{1: "1학기", 2: "여름학기", 3: "2학기", 4: "겨울학기"}
	for _, s := range calendar.Semesters() {
		got, err := calendar.SemesterLabel(s)
		if err != nil || got != want[s] {
			t.Fatalf("SemesterLabel(%d) = %q, %v; want %q", s, got, err, want[s])
		}
	}
	if _, err := calendar.SemesterLabel(5); err == nil {
		t.Fatal("SemesterLabel(5) should fail")
	}
}

func TestSemestersAreCalendarOrder(t *testing.T) {
	got := calendar.Semesters()
	want := []int{calendar.Spring, calendar.Summer, calendar.Fall, calendar.Winter}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("Semesters() = %v, want %v", got, want)
		}
	}
}
```

- [ ] **Step 4: 실패 확인**

Run: `go test ./internal/calendar/`
Expected: FAIL (`package .../internal/calendar is not in std` 또는 undefined 에러)

- [ ] **Step 5: 구현** — `internal/calendar/calendar.go`

```go
// Package calendar answers "which academic term is it" in Asia/Seoul.
package calendar

import (
	"fmt"
	"time"
	_ "time/tzdata" // container images do not ship zoneinfo
)

// Semester codes follow the source timetable and are chronological within a year.
const (
	Spring = 1
	Summer = 2
	Fall   = 3
	Winter = 4
)

var seoul = mustLoad("Asia/Seoul")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

// Location returns Asia/Seoul.
func Location() *time.Location { return seoul }

// Term is an academic term: a year and a semester code.
type Term struct {
	Year     int
	Semester int
}

// CurrentTerm maps a moment to its term in Seoul local time: March–June
// spring, July–August summer, September–December fall, and January–February
// the winter session of the previous year.
func CurrentTerm(t time.Time) Term {
	local := t.In(seoul)
	year, month := local.Year(), local.Month()
	switch {
	case month <= time.February:
		return Term{Year: year - 1, Semester: Winter}
	case month <= time.June:
		return Term{Year: year, Semester: Spring}
	case month <= time.August:
		return Term{Year: year, Semester: Summer}
	default:
		return Term{Year: year, Semester: Fall}
	}
}

var labels = map[int]string{Spring: "1학기", Summer: "여름학기", Fall: "2학기", Winter: "겨울학기"}

// SemesterLabel returns the Korean label shown to students.
func SemesterLabel(semester int) (string, error) {
	label, ok := labels[semester]
	if !ok {
		return "", fmt.Errorf("calendar: unknown semester %d", semester)
	}
	return label, nil
}

// Semesters lists every semester code in calendar order.
func Semesters() []int { return []int{Spring, Summer, Fall, Winter} }
```

- [ ] **Step 6: 통과 확인**

Run: `go test ./internal/calendar/ && go vet ./...`
Expected: `ok  github.com/snuarchive/snuarchive/internal/calendar`

- [ ] **Step 7: 커밋**

```bash
git add go.mod Makefile .gitignore internal/calendar
git commit -m "Add Go module skeleton and Asia/Seoul term calendar"
```

---

### Task 2: apperr 패키지

**Files:**
- Create: `internal/apperr/apperr.go`, `internal/apperr/apperr_test.go`

**Interfaces:**
- Produces:
  - `type Code string`와 상수 23개(아래 코드). `type FieldCode string`과 상수 14개. `type FieldError struct{ Field string \`json:"field"\`; Code FieldCode \`json:"code"\` }`
  - `type Error struct{ Code Code; Message string; Fields []FieldError; Details map[string]any }`와 메서드 `Error() string`, `Unwrap() error`, `Status() int`, `WithMessage(string) *Error`, `WithDetail(string, any) *Error`, `Wrap(error) *Error`, `Cause() error`
  - `New(Code) *Error`, `Validation(...FieldError) *Error`, `As(error) (*Error, bool)`, `AllCodes() []Code`, `AllFieldCodes() []FieldCode`
  - 상수 이름: `MalformedRequest, NotAuthenticated, CSRFInvalid, AdminRequired, NotFound, MethodNotAllowed, ValidationFailed, ConfirmationRequired, VotingAlreadyOpen, VotingNotOpen, VotingRequestExists, VotingRequestNotOpen, NotRequestOwner, ReportAlreadyReviewed, FileTooLarge, FileTypeRejected, LastAdminProtected, EnvAdminProtected, ExportTooLarge, DeletePreviewMismatch, JobDisabled, JobAlreadyRunning, Internal`
  - 필드 코드 이름: `Required, TooLong, QuartilesOutOfOrder, ValueAboveMaxScore, ValueOutOfRange, NothingSubmitted, UnknownAssessmentKind, InvalidAssessmentNumber, InvalidTerm, InvalidCollege, InvalidAdmissionYear, InvalidEmail, ClosesAtInPast, WindowInverted`

- [ ] **Step 1: 실패하는 테스트 작성** — `internal/apperr/apperr_test.go`

```go
package apperr_test

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/snuarchive/snuarchive/internal/apperr"
)

func TestEveryCodeHasStatusAndMessage(t *testing.T) {
	for _, c := range apperr.AllCodes() {
		e := apperr.New(c)
		if e.Status() < 400 || e.Status() > 599 {
			t.Errorf("%s: status %d", c, e.Status())
		}
		if e.Message == "" {
			t.Errorf("%s: empty default message", c)
		}
	}
}

func TestStatuses(t *testing.T) {
	cases := map[apperr.Code]int{
		apperr.MalformedRequest:      http.StatusBadRequest,
		apperr.NotAuthenticated:      http.StatusUnauthorized,
		apperr.CSRFInvalid:           http.StatusForbidden,
		apperr.NotFound:              http.StatusNotFound,
		apperr.MethodNotAllowed:      http.StatusMethodNotAllowed,
		apperr.ValidationFailed:      http.StatusUnprocessableEntity,
		apperr.ConfirmationRequired:  http.StatusPreconditionRequired,
		apperr.VotingNotOpen:         http.StatusConflict,
		apperr.FileTooLarge:          http.StatusRequestEntityTooLarge,
		apperr.FileTypeRejected:      http.StatusUnsupportedMediaType,
		apperr.ExportTooLarge:        http.StatusRequestEntityTooLarge,
		apperr.Internal:              http.StatusInternalServerError,
	}
	for code, want := range cases {
		if got := apperr.New(code).Status(); got != want {
			t.Errorf("%s: status %d, want %d", code, got, want)
		}
	}
}

func TestValidation(t *testing.T) {
	e := apperr.Validation(apperr.FieldError{Field: "q3", Code: apperr.QuartilesOutOfOrder})
	if e.Code != apperr.ValidationFailed || e.Status() != http.StatusUnprocessableEntity {
		t.Fatalf("got %s/%d", e.Code, e.Status())
	}
	if len(e.Fields) != 1 || e.Fields[0].Field != "q3" {
		t.Fatalf("fields = %+v", e.Fields)
	}
}

func TestAsThroughWrapping(t *testing.T) {
	cause := errors.New("db said no")
	wrapped := fmt.Errorf("service: %w", apperr.New(apperr.VotingNotOpen).Wrap(cause))
	e, ok := apperr.As(wrapped)
	if !ok || e.Code != apperr.VotingNotOpen {
		t.Fatalf("As = %v, %v", e, ok)
	}
	if !errors.Is(wrapped, cause) {
		t.Fatal("cause should stay reachable with errors.Is")
	}
	if _, ok := apperr.As(errors.New("plain")); ok {
		t.Fatal("plain error must not convert")
	}
}

func TestWithMessageAndDetail(t *testing.T) {
	e := apperr.New(apperr.ExportTooLarge).WithMessage("too many").WithDetail("limit", 10)
	if e.Message != "too many" || e.Details["limit"] != 10 {
		t.Fatalf("got %+v", e)
	}
}

func TestCodesAreUnique(t *testing.T) {
	seen := map[apperr.Code]bool{}
	for _, c := range apperr.AllCodes() {
		if seen[c] {
			t.Fatalf("duplicate code %s", c)
		}
		seen[c] = true
	}
	if len(apperr.AllCodes()) != 23 || len(apperr.AllFieldCodes()) != 14 {
		t.Fatalf("got %d codes and %d field codes", len(apperr.AllCodes()), len(apperr.AllFieldCodes()))
	}
}
```

- [ ] **Step 2: 실패 확인**

Run: `go test ./internal/apperr/`
Expected: FAIL (undefined: apperr.AllCodes 등)

- [ ] **Step 3: 구현** — `internal/apperr/apperr.go`

```go
// Package apperr carries API error codes from domain code to the HTTP layer.
// Codes and field codes mirror ErrorCode and FieldError.code in
// docs/api/openapi.yaml; a contract test keeps them in step.
package apperr

import (
	"errors"
	"net/http"
)

type Code string

const (
	MalformedRequest      Code = "MALFORMED_REQUEST"
	NotAuthenticated      Code = "NOT_AUTHENTICATED"
	CSRFInvalid           Code = "CSRF_INVALID"
	AdminRequired         Code = "ADMIN_REQUIRED"
	NotFound              Code = "NOT_FOUND"
	MethodNotAllowed      Code = "METHOD_NOT_ALLOWED"
	ValidationFailed      Code = "VALIDATION_FAILED"
	ConfirmationRequired  Code = "CONFIRMATION_REQUIRED"
	VotingAlreadyOpen     Code = "VOTING_ALREADY_OPEN"
	VotingNotOpen         Code = "VOTING_NOT_OPEN"
	VotingRequestExists   Code = "VOTING_REQUEST_EXISTS"
	VotingRequestNotOpen  Code = "VOTING_REQUEST_NOT_OPEN"
	NotRequestOwner       Code = "NOT_REQUEST_OWNER"
	ReportAlreadyReviewed Code = "REPORT_ALREADY_REVIEWED"
	FileTooLarge          Code = "FILE_TOO_LARGE"
	FileTypeRejected      Code = "FILE_TYPE_REJECTED"
	LastAdminProtected    Code = "LAST_ADMIN_PROTECTED"
	EnvAdminProtected     Code = "ENV_ADMIN_PROTECTED"
	ExportTooLarge        Code = "EXPORT_TOO_LARGE"
	DeletePreviewMismatch Code = "DELETE_PREVIEW_MISMATCH"
	JobDisabled           Code = "JOB_DISABLED"
	JobAlreadyRunning     Code = "JOB_ALREADY_RUNNING"
	Internal              Code = "INTERNAL"
)

type FieldCode string

const (
	Required                FieldCode = "REQUIRED"
	TooLong                 FieldCode = "TOO_LONG"
	QuartilesOutOfOrder     FieldCode = "QUARTILES_OUT_OF_ORDER"
	ValueAboveMaxScore      FieldCode = "VALUE_ABOVE_MAX_SCORE"
	ValueOutOfRange         FieldCode = "VALUE_OUT_OF_RANGE"
	NothingSubmitted        FieldCode = "NOTHING_SUBMITTED"
	UnknownAssessmentKind   FieldCode = "UNKNOWN_ASSESSMENT_KIND"
	InvalidAssessmentNumber FieldCode = "INVALID_ASSESSMENT_NUMBER"
	InvalidTerm             FieldCode = "INVALID_TERM"
	InvalidCollege          FieldCode = "INVALID_COLLEGE"
	InvalidAdmissionYear    FieldCode = "INVALID_ADMISSION_YEAR"
	InvalidEmail            FieldCode = "INVALID_EMAIL"
	ClosesAtInPast          FieldCode = "CLOSES_AT_IN_PAST"
	WindowInverted          FieldCode = "WINDOW_INVERTED"
)

type FieldError struct {
	Field string    `json:"field"`
	Code  FieldCode `json:"code"`
}

type spec struct {
	status  int
	message string
}

var specs = map[Code]spec{
	MalformedRequest:      {http.StatusBadRequest, "요청 형식이 올바르지 않습니다."},
	NotAuthenticated:      {http.StatusUnauthorized, "로그인이 필요합니다."},
	CSRFInvalid:           {http.StatusForbidden, "요청을 확인할 수 없습니다. 새로고침한 뒤 다시 시도해주세요."},
	AdminRequired:         {http.StatusForbidden, "관리자 권한이 필요합니다."},
	NotFound:              {http.StatusNotFound, "대상을 찾을 수 없습니다."},
	MethodNotAllowed:      {http.StatusMethodNotAllowed, "지원하지 않는 요청 방식입니다."},
	ValidationFailed:      {http.StatusUnprocessableEntity, "입력값을 확인해주세요."},
	ConfirmationRequired:  {http.StatusPreconditionRequired, "확인이 필요한 작업입니다."},
	VotingAlreadyOpen:     {http.StatusConflict, "이미 투표가 열려 있습니다."},
	VotingNotOpen:         {http.StatusConflict, "열려 있는 투표가 없습니다."},
	VotingRequestExists:   {http.StatusConflict, "이미 투표를 요청했습니다."},
	VotingRequestNotOpen:  {http.StatusConflict, "이미 처리된 요청입니다."},
	NotRequestOwner:       {http.StatusForbidden, "본인의 요청만 취소할 수 있습니다."},
	ReportAlreadyReviewed: {http.StatusConflict, "이미 처리된 제보입니다."},
	FileTooLarge:          {http.StatusRequestEntityTooLarge, "파일이 너무 큽니다."},
	FileTypeRejected:      {http.StatusUnsupportedMediaType, "PDF, PNG, JPEG, WebP 파일만 올릴 수 있습니다."},
	LastAdminProtected:    {http.StatusConflict, "마지막 관리자의 권한은 회수할 수 없습니다."},
	EnvAdminProtected:     {http.StatusConflict, "환경변수로 지정된 관리자는 여기서 회수할 수 없습니다."},
	ExportTooLarge:        {http.StatusRequestEntityTooLarge, "내보낼 로그가 너무 많습니다. 기간을 줄여주세요."},
	DeletePreviewMismatch: {http.StatusConflict, "미리보기 이후 대상이 바뀌었습니다. 다시 확인해주세요."},
	JobDisabled:           {http.StatusConflict, "비활성화된 작업입니다."},
	JobAlreadyRunning:     {http.StatusConflict, "이미 실행 중인 작업입니다."},
	Internal:              {http.StatusInternalServerError, "요청을 처리하지 못했습니다."},
}

var codeOrder = []Code{
	MalformedRequest, NotAuthenticated, CSRFInvalid, AdminRequired, NotFound, MethodNotAllowed,
	ValidationFailed, ConfirmationRequired, VotingAlreadyOpen, VotingNotOpen, VotingRequestExists,
	VotingRequestNotOpen, NotRequestOwner, ReportAlreadyReviewed, FileTooLarge, FileTypeRejected,
	LastAdminProtected, EnvAdminProtected, ExportTooLarge, DeletePreviewMismatch, JobDisabled,
	JobAlreadyRunning, Internal,
}

var fieldCodeOrder = []FieldCode{
	Required, TooLong, QuartilesOutOfOrder, ValueAboveMaxScore, ValueOutOfRange, NothingSubmitted,
	UnknownAssessmentKind, InvalidAssessmentNumber, InvalidTerm, InvalidCollege, InvalidAdmissionYear,
	InvalidEmail, ClosesAtInPast, WindowInverted,
}

// AllCodes lists every error code.
func AllCodes() []Code { return append([]Code(nil), codeOrder...) }

// AllFieldCodes lists every field error code.
func AllFieldCodes() []FieldCode { return append([]FieldCode(nil), fieldCodeOrder...) }

// Error is an API error: a code the client switches on, a Korean fallback
// message, optional field errors and details, and an optional cause for logs.
type Error struct {
	Code    Code
	Message string
	Fields  []FieldError
	Details map[string]any
	cause   error
}

// New returns an error with the code's default message.
func New(code Code) *Error {
	return &Error{Code: code, Message: specs[code].message}
}

// Validation returns a VALIDATION_FAILED error carrying field errors.
func Validation(fields ...FieldError) *Error {
	e := New(ValidationFailed)
	e.Fields = fields
	return e
}

func (e *Error) Error() string {
	if e.cause != nil {
		return string(e.Code) + ": " + e.cause.Error()
	}
	return string(e.Code)
}

func (e *Error) Unwrap() error { return e.cause }

// Cause returns the wrapped error, if any.
func (e *Error) Cause() error { return e.cause }

// Status returns the HTTP status for the code.
func (e *Error) Status() int {
	if s, ok := specs[e.Code]; ok {
		return s.status
	}
	return http.StatusInternalServerError
}

func (e *Error) WithMessage(msg string) *Error {
	e.Message = msg
	return e
}

func (e *Error) WithDetail(key string, value any) *Error {
	if e.Details == nil {
		e.Details = map[string]any{}
	}
	e.Details[key] = value
	return e
}

func (e *Error) Wrap(cause error) *Error {
	e.cause = cause
	return e
}

// As finds an *Error in err's chain.
func As(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}
```

- [ ] **Step 4: 통과 확인**

Run: `go test ./internal/apperr/`
Expected: `ok`

- [ ] **Step 5: 커밋**

```bash
git add internal/apperr
git commit -m "Add apperr: API error codes, field codes and HTTP statuses"
```

---

### Task 3: config 패키지

**Files:**
- Create: `internal/config/config.go`, `internal/config/parse.go`, `internal/config/config_test.go`

**Interfaces:**
- Produces: 아래 코드의 `config.Config`와 하위 구조체(`DB`, `Session`, `Google`, `Storage`, `S3`, `Upload`, `Retention`, `Archive`, `GDrive`, `Log`), `config.Load(LookupFunc) (*Config, []string, error)`, `type LookupFunc func(string) (string, bool)`, `const MaxUploadBytes = 3 << 20`, `var ExportFormats`, `Env` 상수 `Development`/`Production`, `(*Config).IsDevelopment() bool`.

- [ ] **Step 1: 실패하는 테스트 작성** — `internal/config/config_test.go`

```go
package config_test

import (
	"bytes"
	"encoding/base64"
	"log/slog"
	"maps"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/config"
)

var key32 = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("k"), 32))

func minimal() map[string]string {
	return map[string]string{
		"APP_ORIGIN":           "https://archive.example.com",
		"DATABASE_URL":         "postgres://u:p@localhost:5432/db",
		"SESSION_KEYS":         key32,
		"GOOGLE_CLIENT_ID":     "id",
		"GOOGLE_CLIENT_SECRET": "secret",
	}
}

// with returns a copy of base with key/value pairs applied; "" unsets a key.
func with(base map[string]string, kv ...string) map[string]string {
	out := maps.Clone(base)
	for i := 0; i < len(kv); i += 2 {
		out[kv[i]] = kv[i+1]
	}
	return out
}

func load(t *testing.T, env map[string]string) (*config.Config, []string, error) {
	t.Helper()
	return config.Load(func(k string) (string, bool) { v, ok := env[k]; return v, ok })
}

func TestDefaults(t *testing.T) {
	c, warnings, err := load(t, minimal())
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings = %v", warnings)
	}
	checks := []struct {
		name      string
		got, want any
	}{
		{"env", c.Env, config.Production},
		{"http addr", c.HTTPAddr, ":8080"},
		{"db max conns", c.DB.MaxConns, int32(10)},
		{"pooler", c.DB.PoolerMode, false},
		{"session ttl", c.Session.TTL, 168 * time.Hour},
		{"storage", c.Storage.Driver, "fs"},
		{"fs root", c.Storage.FSRoot, "/data/uploads"},
		{"upload max", c.Upload.MaxBytes, int64(3 << 20)},
		{"upload gc", c.Upload.GCAfter, 24 * time.Hour},
		{"archive format", c.Archive.Format, "jsonl"},
		{"retention days", c.Retention.Days, 365},
		{"archive after", c.Archive.AfterDays, 90},
		{"export max", c.ExportMaxRows, 1_000_000},
		{"log format", c.Log.Format, "json"},
		{"log level", c.Log.Level, slog.LevelInfo},
		{"otel", c.OTelEnabled, false},
	}
	for _, ch := range checks {
		if ch.got != ch.want {
			t.Errorf("%s = %v, want %v", ch.name, ch.got, ch.want)
		}
	}
}

func TestDevelopmentLogDefaults(t *testing.T) {
	c, _, err := load(t, with(minimal(), "APP_ENV", "development"))
	if err != nil {
		t.Fatal(err)
	}
	if c.Log.Format != "text" || c.Log.Level != slog.LevelDebug || !c.IsDevelopment() {
		t.Fatalf("log = %+v, dev = %v", c.Log, c.IsDevelopment())
	}
}

func TestDevLoginSkipsGoogle(t *testing.T) {
	env := with(minimal(), "APP_ENV", "development", "DEV_LOGIN_ENABLED", "true",
		"GOOGLE_CLIENT_ID", "", "GOOGLE_CLIENT_SECRET", "")
	if _, _, err := load(t, env); err != nil {
		t.Fatal(err)
	}
}

func TestErrors(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
		want string
	}{
		{"missing database", with(minimal(), "DATABASE_URL", ""), "DATABASE_URL is required"},
		{"origin with path", with(minimal(), "APP_ORIGIN", "https://x.example.com/app"), "APP_ORIGIN must be an origin"},
		{"origin without scheme", with(minimal(), "APP_ORIGIN", "x.example.com"), "APP_ORIGIN must be an origin"},
		{"short session key", with(minimal(), "SESSION_KEYS", base64.StdEncoding.EncodeToString([]byte("short"))), "SESSION_KEYS entry 1 must be base64 of at least 32 bytes"},
		{"dev login in production", with(minimal(), "DEV_LOGIN_ENABLED", "true"), "DEV_LOGIN_ENABLED must not be true unless APP_ENV=development"},
		{"google missing", with(minimal(), "GOOGLE_CLIENT_ID", ""), "GOOGLE_CLIENT_ID is required"},
		{"non snu admin", with(minimal(), "ADMIN_EMAILS", "a@gmail.com"), "must be an @snu.ac.kr address"},
		{"upload above cap", with(minimal(), "UPLOAD_MAX_BYTES", "4000000"), "UPLOAD_MAX_BYTES must be an integer between 1 and 3145728"},
		{"s3 without bucket", with(minimal(), "STORAGE_DRIVER", "s3"), "S3_BUCKET is required"},
		{"unknown storage", with(minimal(), "STORAGE_DRIVER", "ftp"), "STORAGE_DRIVER must be one of fs, s3"},
		{"archive without drive", with(minimal(), "LOG_ARCHIVE_ENABLED", "true"), "GDRIVE_AUTH is required when LOG_ARCHIVE_ENABLED=true"},
		{"oauth without token", with(minimal(), "LOG_ARCHIVE_ENABLED", "true", "GDRIVE_AUTH", "oauth", "GDRIVE_FOLDER_ID", "f",
			"GDRIVE_OAUTH_CLIENT_ID", "c", "GDRIVE_OAUTH_CLIENT_SECRET", "s"), "GDRIVE_OAUTH_REFRESH_TOKEN is required when GDRIVE_AUTH=oauth"},
		{"service account without key", with(minimal(), "LOG_ARCHIVE_ENABLED", "true", "GDRIVE_AUTH", "service_account", "GDRIVE_FOLDER_ID", "f"), "GDRIVE_SERVICE_ACCOUNT_JSON is required when GDRIVE_AUTH=service_account"},
		{"bad archive format", with(minimal(), "LOG_ARCHIVE_FORMAT", "xml"), "LOG_ARCHIVE_FORMAT must be one of json, jsonl, csv, xlsx, parquet"},
		{"bad bool", with(minimal(), "SCHEDULER_ENABLED", "yes"), "SCHEDULER_ENABLED must be true or false"},
		{"short cron secret", with(minimal(), "CRON_SECRET", "abc"), "CRON_SECRET must be at least 32 characters"},
		{"bad proxy", with(minimal(), "TRUSTED_PROXIES", "nope"), `TRUSTED_PROXIES entry "nope" is not an IP address or CIDR`},
		{"bad log level", with(minimal(), "LOG_LEVEL", "loud"), "LOG_LEVEL must be debug, info, warn or error"},
		{"bad duration", with(minimal(), "SESSION_TTL", "-1h"), "SESSION_TTL must be a positive duration"},
		{"bad env", with(minimal(), "APP_ENV", "staging"), "APP_ENV must be one of development, production"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := load(t, tc.env)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

func TestReportsEveryProblemAtOnce(t *testing.T) {
	_, _, err := load(t, map[string]string{})
	if err == nil {
		t.Fatal("empty environment must fail")
	}
	for _, key := range []string{"APP_ORIGIN", "DATABASE_URL", "SESSION_KEYS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error does not mention %s:\n%v", key, err)
		}
	}
}

func TestNormalization(t *testing.T) {
	env := with(minimal(),
		"APP_ORIGIN", "https://archive.example.com/",
		"ADMIN_EMAILS", " A@SNU.AC.KR , b@snu.ac.kr ,",
		"TRUSTED_PROXIES", "10.0.0.1, 172.30.0.0/24",
		"SESSION_KEYS", key32+","+key32,
	)
	c, _, err := load(t, env)
	if err != nil {
		t.Fatal(err)
	}
	if c.AppOrigin != "https://archive.example.com" {
		t.Errorf("origin = %q", c.AppOrigin)
	}
	if strings.Join(c.AdminEmails, ",") != "a@snu.ac.kr,b@snu.ac.kr" {
		t.Errorf("admins = %v", c.AdminEmails)
	}
	want := []netip.Prefix{netip.MustParsePrefix("10.0.0.1/32"), netip.MustParsePrefix("172.30.0.0/24")}
	if len(c.TrustedProxies) != 2 || c.TrustedProxies[0] != want[0] || c.TrustedProxies[1] != want[1] {
		t.Errorf("proxies = %v", c.TrustedProxies)
	}
	if len(c.Session.Keys) != 2 || len(c.Session.Keys[0]) != 32 {
		t.Errorf("keys = %d", len(c.Session.Keys))
	}
}

func TestWarnsWhenRetentionPrecedesArchive(t *testing.T) {
	env := with(minimal(),
		"LOG_RETENTION_ENABLED", "true", "LOG_RETENTION_DAYS", "30",
		"LOG_ARCHIVE_ENABLED", "true", "LOG_ARCHIVE_AFTER_DAYS", "90",
		"GDRIVE_AUTH", "oauth", "GDRIVE_FOLDER_ID", "f",
		"GDRIVE_OAUTH_CLIENT_ID", "c", "GDRIVE_OAUTH_CLIENT_SECRET", "s", "GDRIVE_OAUTH_REFRESH_TOKEN", "r",
	)
	_, warnings, err := load(t, env)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "deleted before they are archived") {
		t.Fatalf("warnings = %v", warnings)
	}
}

func TestServiceAccountJSONIsDecoded(t *testing.T) {
	raw := `{"type":"service_account"}`
	env := with(minimal(), "LOG_ARCHIVE_ENABLED", "true", "GDRIVE_AUTH", "service_account", "GDRIVE_FOLDER_ID", "f",
		"GDRIVE_SERVICE_ACCOUNT_JSON", base64.StdEncoding.EncodeToString([]byte(raw)))
	c, _, err := load(t, env)
	if err != nil {
		t.Fatal(err)
	}
	if string(c.GDrive.ServiceAccountJSON) != raw {
		t.Fatalf("json = %q", c.GDrive.ServiceAccountJSON)
	}
}

func TestS3(t *testing.T) {
	env := with(minimal(), "STORAGE_DRIVER", "s3", "S3_BUCKET", "b", "S3_ACCESS_KEY_ID", "a",
		"S3_SECRET_ACCESS_KEY", "s", "S3_ENDPOINT", "https://s3.example.com", "S3_FORCE_PATH_STYLE", "true")
	c, _, err := load(t, env)
	if err != nil {
		t.Fatal(err)
	}
	if c.Storage.S3.Bucket != "b" || c.Storage.S3.Region != "us-east-1" || !c.Storage.S3.ForcePathStyle {
		t.Fatalf("s3 = %+v", c.Storage.S3)
	}
}
```

- [ ] **Step 2: 실패 확인**

Run: `go test ./internal/config/`
Expected: FAIL (undefined: config.Load)

- [ ] **Step 3: 파서 구현** — `internal/config/parse.go`

```go
package config

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

// parser reads variables and collects every problem instead of stopping at
// the first, so an operator fixes a broken environment in one pass.
type parser struct {
	lookup LookupFunc
	errs   []error
}

func (p *parser) fail(key, msg string) { p.errs = append(p.errs, fmt.Errorf("%s %s", key, msg)) }

func (p *parser) str(key, def string) string {
	v, ok := p.lookup(key)
	v = strings.TrimSpace(v)
	if !ok || v == "" {
		return def
	}
	return v
}

func (p *parser) required(key string) string {
	v := p.str(key, "")
	if v == "" {
		p.fail(key, "is required")
	}
	return v
}

func (p *parser) boolean(key string, def bool) bool {
	v := p.str(key, "")
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		p.fail(key, "must be true or false")
		return def
	}
	return b
}

func (p *parser) integer(key string, def, lo, hi int) int {
	v := p.str(key, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < lo || n > hi {
		p.fail(key, fmt.Sprintf("must be an integer between %d and %d", lo, hi))
		return def
	}
	return n
}

func (p *parser) duration(key string, def time.Duration) time.Duration {
	v := p.str(key, "")
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		p.fail(key, "must be a positive duration such as 24h")
		return def
	}
	return d
}

func (p *parser) oneOf(key, def string, allowed ...string) string {
	v := p.str(key, def)
	if !slices.Contains(allowed, v) {
		shown := slices.DeleteFunc(slices.Clone(allowed), func(s string) bool { return s == "" })
		p.fail(key, "must be one of "+strings.Join(shown, ", "))
		return def
	}
	return v
}

func (p *parser) list(key string) []string {
	var out []string
	for _, item := range strings.Split(p.str(key, ""), ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func (p *parser) origin(key string) string {
	v := p.required(key)
	if v == "" {
		return ""
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		p.fail(key, "must be an origin such as https://archive.example.com")
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func (p *parser) sessionKeys(key string) [][]byte {
	raw := p.list(key)
	if len(raw) == 0 {
		p.fail(key, "is required")
		return nil
	}
	keys := make([][]byte, 0, len(raw))
	for i, s := range raw {
		b, err := base64.StdEncoding.DecodeString(s)
		if err != nil {
			b, err = base64.RawURLEncoding.DecodeString(s)
		}
		if err != nil || len(b) < 32 {
			p.fail(key, fmt.Sprintf("entry %d must be base64 of at least 32 bytes", i+1))
			continue
		}
		keys = append(keys, b)
	}
	return keys
}

func (p *parser) adminEmails(key string) []string {
	var out []string
	for _, e := range p.list(key) {
		e = strings.ToLower(e)
		local, domain, ok := strings.Cut(e, "@")
		if !ok || local == "" || domain != "snu.ac.kr" {
			p.fail(key, fmt.Sprintf("entry %q must be an @snu.ac.kr address", e))
			continue
		}
		out = append(out, e)
	}
	return out
}

func (p *parser) prefixes(key string) []netip.Prefix {
	var out []netip.Prefix
	for _, s := range p.list(key) {
		if pfx, err := netip.ParsePrefix(s); err == nil {
			out = append(out, pfx.Masked())
			continue
		}
		if addr, err := netip.ParseAddr(s); err == nil {
			addr = addr.Unmap()
			out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
			continue
		}
		p.fail(key, fmt.Sprintf("entry %q is not an IP address or CIDR", s))
	}
	return out
}

func (p *parser) level(key, def string) slog.Level {
	var l slog.Level
	if err := l.UnmarshalText([]byte(p.str(key, def))); err != nil {
		p.fail(key, "must be debug, info, warn or error")
		_ = l.UnmarshalText([]byte(def))
	}
	return l
}

func (p *parser) gdrive(archiveEnabled bool) GDrive {
	g := GDrive{
		Auth:              p.oneOf("GDRIVE_AUTH", "", "", "service_account", "oauth"),
		FolderID:          p.str("GDRIVE_FOLDER_ID", ""),
		OAuthClientID:     p.str("GDRIVE_OAUTH_CLIENT_ID", ""),
		OAuthClientSecret: p.str("GDRIVE_OAUTH_CLIENT_SECRET", ""),
		OAuthRefreshToken: p.str("GDRIVE_OAUTH_REFRESH_TOKEN", ""),
	}
	if raw := p.str("GDRIVE_SERVICE_ACCOUNT_JSON", ""); raw != "" {
		b, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			p.fail("GDRIVE_SERVICE_ACCOUNT_JSON", "must be base64")
		} else {
			g.ServiceAccountJSON = b
		}
	}
	if !archiveEnabled {
		return g
	}
	if g.Auth == "" {
		p.fail("GDRIVE_AUTH", "is required when LOG_ARCHIVE_ENABLED=true")
	}
	if g.FolderID == "" {
		p.fail("GDRIVE_FOLDER_ID", "is required when LOG_ARCHIVE_ENABLED=true")
	}
	switch g.Auth {
	case "service_account":
		if len(g.ServiceAccountJSON) == 0 {
			p.fail("GDRIVE_SERVICE_ACCOUNT_JSON", "is required when GDRIVE_AUTH=service_account")
		}
	case "oauth":
		for _, kv := range [][2]string{
			{"GDRIVE_OAUTH_CLIENT_ID", g.OAuthClientID},
			{"GDRIVE_OAUTH_CLIENT_SECRET", g.OAuthClientSecret},
			{"GDRIVE_OAUTH_REFRESH_TOKEN", g.OAuthRefreshToken},
		} {
			if kv[1] == "" {
				p.fail(kv[0], "is required when GDRIVE_AUTH=oauth")
			}
		}
	}
	return g
}
```

- [ ] **Step 4: Config 구현** — `internal/config/config.go`

```go
// Package config reads every environment variable the server uses and
// validates them together, so a misconfigured server refuses to start.
// The variables are documented in the design spec, section 6.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"time"
)

// LookupFunc matches os.LookupEnv.
type LookupFunc func(key string) (string, bool)

type Env string

const (
	Development Env = "development"
	Production  Env = "production"
)

// MaxUploadBytes is the ceiling enforced by pending_reports_size_ck.
const MaxUploadBytes = 3 << 20

// ExportFormats are the log export and archive formats.
var ExportFormats = []string{"json", "jsonl", "csv", "xlsx", "parquet"}

type Config struct {
	Env              Env
	AppOrigin        string // scheme://host[:port], no trailing slash
	HTTPAddr         string
	DB               DB
	Session          Session
	Google           Google
	AdminEmails      []string
	DevLoginEnabled  bool
	TrustedProxies   []netip.Prefix
	Storage          Storage
	Upload           Upload
	SchedulerEnabled bool
	CronSecret       string
	Retention        Retention
	Archive          Archive
	GDrive           GDrive
	ExportMaxRows    int
	Log              Log
	OTelEnabled      bool
}

type DB struct {
	URL        string
	MaxConns   int32
	PoolerMode bool
}

type Session struct {
	Keys [][]byte // first signs, all verify
	TTL  time.Duration
}

type Google struct {
	ClientID     string
	ClientSecret string
}

type Storage struct {
	Driver string // "fs" or "s3"
	FSRoot string
	S3     S3
}

type S3 struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	Prefix          string
	ForcePathStyle  bool
}

type Upload struct {
	MaxBytes int64
	GCAfter  time.Duration
}

type Retention struct {
	Enabled bool
	Days    int
}

type Archive struct {
	Enabled   bool
	AfterDays int
	Format    string
	Interval  time.Duration
}

type GDrive struct {
	Auth               string // "", "service_account" or "oauth"
	FolderID           string
	ServiceAccountJSON []byte
	OAuthClientID      string
	OAuthClientSecret  string
	OAuthRefreshToken  string
}

type Log struct {
	Format string // "json" or "text"
	Level  slog.Level
}

func (c *Config) IsDevelopment() bool { return c.Env == Development }

// Load reads the configuration through lookup. It reports every invalid
// variable at once and, separately, warnings for settings that work but are
// probably not what the operator meant.
func Load(lookup LookupFunc) (*Config, []string, error) {
	p := &parser{lookup: lookup}
	c := &Config{}

	c.Env = Env(p.oneOf("APP_ENV", string(Production), string(Development), string(Production)))
	dev := c.Env == Development

	c.AppOrigin = p.origin("APP_ORIGIN")
	c.HTTPAddr = p.str("HTTP_ADDR", ":8080")
	c.DB = DB{
		URL:        p.required("DATABASE_URL"),
		MaxConns:   int32(p.integer("DB_MAX_CONNS", 10, 1, 1000)),
		PoolerMode: p.boolean("DB_POOLER_MODE", false),
	}
	c.Session = Session{
		Keys: p.sessionKeys("SESSION_KEYS"),
		TTL:  p.duration("SESSION_TTL", 168*time.Hour),
	}

	c.DevLoginEnabled = p.boolean("DEV_LOGIN_ENABLED", false)
	if c.DevLoginEnabled && !dev {
		p.fail("DEV_LOGIN_ENABLED", "must not be true unless APP_ENV=development")
	}
	c.Google = Google{ClientID: p.str("GOOGLE_CLIENT_ID", ""), ClientSecret: p.str("GOOGLE_CLIENT_SECRET", "")}
	if !(dev && c.DevLoginEnabled) {
		if c.Google.ClientID == "" {
			p.fail("GOOGLE_CLIENT_ID", "is required")
		}
		if c.Google.ClientSecret == "" {
			p.fail("GOOGLE_CLIENT_SECRET", "is required")
		}
	}
	c.AdminEmails = p.adminEmails("ADMIN_EMAILS")
	c.TrustedProxies = p.prefixes("TRUSTED_PROXIES")

	c.Storage.Driver = p.oneOf("STORAGE_DRIVER", "fs", "fs", "s3")
	switch c.Storage.Driver {
	case "fs":
		c.Storage.FSRoot = p.str("STORAGE_FS_ROOT", "/data/uploads")
	case "s3":
		c.Storage.S3 = S3{
			Endpoint:        p.str("S3_ENDPOINT", ""),
			Region:          p.str("S3_REGION", "us-east-1"),
			Bucket:          p.required("S3_BUCKET"),
			AccessKeyID:     p.required("S3_ACCESS_KEY_ID"),
			SecretAccessKey: p.required("S3_SECRET_ACCESS_KEY"),
			Prefix:          p.str("S3_PREFIX", ""),
			ForcePathStyle:  p.boolean("S3_FORCE_PATH_STYLE", false),
		}
	}
	c.Upload = Upload{
		MaxBytes: int64(p.integer("UPLOAD_MAX_BYTES", MaxUploadBytes, 1, MaxUploadBytes)),
		GCAfter:  p.duration("UPLOAD_GC_AFTER", 24*time.Hour),
	}

	c.SchedulerEnabled = p.boolean("SCHEDULER_ENABLED", false)
	c.CronSecret = p.str("CRON_SECRET", "")
	if c.CronSecret != "" && len(c.CronSecret) < 32 {
		p.fail("CRON_SECRET", "must be at least 32 characters")
	}
	c.Retention = Retention{
		Enabled: p.boolean("LOG_RETENTION_ENABLED", false),
		Days:    p.integer("LOG_RETENTION_DAYS", 365, 1, 36500),
	}
	c.Archive = Archive{
		Enabled:   p.boolean("LOG_ARCHIVE_ENABLED", false),
		AfterDays: p.integer("LOG_ARCHIVE_AFTER_DAYS", 90, 1, 36500),
		Format:    p.oneOf("LOG_ARCHIVE_FORMAT", "jsonl", ExportFormats...),
		Interval:  p.duration("LOG_ARCHIVE_INTERVAL", 24*time.Hour),
	}
	c.GDrive = p.gdrive(c.Archive.Enabled)
	c.ExportMaxRows = p.integer("EXPORT_MAX_ROWS", 1_000_000, 1, 100_000_000)

	logFormat, logLevel := "json", "info"
	if dev {
		logFormat, logLevel = "text", "debug"
	}
	c.Log = Log{Format: p.oneOf("LOG_FORMAT", logFormat, "json", "text"), Level: p.level("LOG_LEVEL", logLevel)}
	c.OTelEnabled = p.boolean("OTEL_ENABLED", false)

	var warnings []string
	if c.Retention.Enabled && c.Archive.Enabled && c.Retention.Days <= c.Archive.AfterDays {
		warnings = append(warnings, fmt.Sprintf(
			"LOG_RETENTION_DAYS (%d) <= LOG_ARCHIVE_AFTER_DAYS (%d): logs are deleted before they are archived",
			c.Retention.Days, c.Archive.AfterDays))
	}
	if err := errors.Join(p.errs...); err != nil {
		return nil, warnings, err
	}
	return c, warnings, nil
}
```

- [ ] **Step 5: 통과 확인**

Run: `go test ./internal/config/ && go vet ./...`
Expected: `ok`

- [ ] **Step 6: 커밋**

```bash
git add internal/config
git commit -m "Add config: parse and validate every environment variable at once"
```

---

### Task 4: telemetry 패키지

**Files:**
- Create: `internal/telemetry/telemetry.go`, `internal/telemetry/telemetry_test.go`

**Interfaces:**
- Consumes: 없음
- Produces: `telemetry.Options{Format string; Level slog.Level; OTel bool; Service string; Version string}`, `telemetry.Setup(ctx, io.Writer, Options) (*slog.Logger, func(context.Context) error, error)`

- [ ] **Step 1: 의존성 추가**

```bash
go get go.opentelemetry.io/contrib/exporters/autoexport@v0.71.0 go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk go.opentelemetry.io/otel/sdk/metric
```

- [ ] **Step 2: 실패하는 테스트 작성** — `internal/telemetry/telemetry_test.go`

```go
package telemetry_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/snuarchive/snuarchive/internal/telemetry"
)

func TestJSONLoggerFiltersByLevel(t *testing.T) {
	var buf bytes.Buffer
	log, shutdown, err := telemetry.Setup(context.Background(), &buf, telemetry.Options{
		Format: "json", Level: slog.LevelInfo, Service: "snuarchive", Version: "test",
	})
	if err != nil {
		t.Fatal(err)
	}
	log.Debug("hidden")
	log.Info("shown", "k", "v")
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d lines: %q", len(lines), buf.String())
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &m); err != nil {
		t.Fatal(err)
	}
	for k, want := range map[string]string{"msg": "shown", "k": "v", "service": "snuarchive", "version": "test"} {
		if m[k] != want {
			t.Errorf("%s = %v, want %s", k, m[k], want)
		}
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestTextLogger(t *testing.T) {
	var buf bytes.Buffer
	log, _, err := telemetry.Setup(context.Background(), &buf, telemetry.Options{Format: "text", Level: slog.LevelDebug})
	if err != nil {
		t.Fatal(err)
	}
	log.Debug("shown")
	if !strings.Contains(buf.String(), "msg=shown") {
		t.Fatalf("output = %q", buf.String())
	}
}

func TestOTelSetupWithoutExporters(t *testing.T) {
	t.Setenv("OTEL_TRACES_EXPORTER", "none")
	t.Setenv("OTEL_METRICS_EXPORTER", "none")
	var buf bytes.Buffer
	_, shutdown, err := telemetry.Setup(context.Background(), &buf, telemetry.Options{
		Format: "json", Level: slog.LevelInfo, OTel: true, Service: "snuarchive", Version: "test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 3: 실패 확인**

Run: `go test ./internal/telemetry/`
Expected: FAIL (undefined: telemetry.Setup)

- [ ] **Step 4: 구현** — `internal/telemetry/telemetry.go`

```go
// Package telemetry sets up structured logging and, when enabled,
// OpenTelemetry tracing and metrics configured through the standard OTEL_*
// environment variables.
package telemetry

import (
	"context"
	"errors"
	"io"
	"log/slog"

	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

type Options struct {
	Format  string // "json" or "text"
	Level   slog.Level
	OTel    bool
	Service string
	Version string
}

// Setup returns the process logger and a shutdown func that flushes telemetry.
func Setup(ctx context.Context, w io.Writer, o Options) (*slog.Logger, func(context.Context) error, error) {
	handlerOpts := &slog.HandlerOptions{Level: o.Level}
	var h slog.Handler
	if o.Format == "text" {
		h = slog.NewTextHandler(w, handlerOpts)
	} else {
		h = slog.NewJSONHandler(w, handlerOpts)
	}
	logger := slog.New(h)
	if o.Service != "" {
		logger = logger.With("service", o.Service)
	}
	if o.Version != "" {
		logger = logger.With("version", o.Version)
	}
	noop := func(context.Context) error { return nil }
	if !o.OTel {
		return logger, noop, nil
	}

	// OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES win over our defaults.
	ours := resource.NewSchemaless(
		attribute.String("service.name", o.Service),
		attribute.String("service.version", o.Version),
	)
	res, err := resource.Merge(resource.Default(), ours)
	if err == nil {
		res, err = resource.Merge(res, resource.Environment())
	}
	if err != nil {
		return nil, noop, err
	}
	spans, err := autoexport.NewSpanExporter(ctx)
	if err != nil {
		return nil, noop, err
	}
	reader, err := autoexport.NewMetricReader(ctx)
	if err != nil {
		return nil, noop, err
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(spans), sdktrace.WithResource(res))
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithResource(res))
	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return logger, func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx))
	}, nil
}
```

- [ ] **Step 5: 통과 확인**

Run: `go mod tidy && go test ./internal/telemetry/ && go vet ./...`
Expected: `ok`. `resource.Merge`가 스키마 URL 충돌 오류를 내면 `ours`를 `resource.NewWithAttributes(resource.Default().SchemaURL(), ...)`로 바꿔 다시 실행한다.

- [ ] **Step 6: 커밋**

```bash
git add go.mod go.sum internal/telemetry
git commit -m "Add telemetry: slog logger and optional OpenTelemetry via OTEL_* env"
```

---

### Task 5: 스키마 v1 마이그레이션, db 패키지, pgtest 하네스

**Files:**
- Create: `db/migrations/00001_init.sql`, `db/migrations/embed.go`, `internal/db/db.go`, `internal/testutil/pgtest/pgtest.go`, `internal/db/main_test.go`, `internal/db/migrate_test.go`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `migrations.FS embed.FS` (패키지 `github.com/snuarchive/snuarchive/db/migrations`)
  - `db.Options{URL string; MaxConns int32; PoolerMode bool}`, `db.Open(ctx, Options) (*pgxpool.Pool, error)`
  - `db.NewMigrator(url string) (*db.Migrator, error)`와 메서드 `Up(ctx) ([]*goose.MigrationResult, error)`, `Down(ctx) (*goose.MigrationResult, error)`, `Status(ctx) ([]*goose.MigrationStatus, error)`, `Close() error`
  - `pgtest.Main(*testing.M)`: TestMain에서 호출한다.
  - `pgtest.New(testing.TB) *pgxpool.Pool`: 마이그레이션된 새 DB의 풀
  - `pgtest.NewDatabase(testing.TB) string`: 마이그레이션된 새 DB의 URL
  - `pgtest.NewEmptyDatabase(testing.TB) string`: 스키마가 없는 새 DB의 URL
  - 세 헬퍼 모두 `-short`면 `t.Skip`

- [ ] **Step 1: 의존성 추가**

```bash
go get github.com/jackc/pgx/v5@v5.11.0 github.com/pressly/goose/v3@v3.28.0 \
  github.com/testcontainers/testcontainers-go@v0.44.0 github.com/testcontainers/testcontainers-go/modules/postgres@v0.44.0
```

- [ ] **Step 2: 마이그레이션 작성** — `db/migrations/00001_init.sql` (2026-09-27 PostgreSQL 18.6에서 Up·Down·재Up과 제약 동작을 검증한 내용 그대로)

```sql
-- +goose Up

-- ---------------------------------------------------------------- types

CREATE TYPE report_status         AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE stat_source           AS ENUM ('direct', 'transcribed');
CREATE TYPE import_status         AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE voting_request_status AS ENUM ('open', 'fulfilled', 'rejected', 'cancelled');
CREATE TYPE archive_status        AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE job_status            AS ENUM ('succeeded', 'failed', 'skipped');

CREATE TYPE activity_action AS ENUM (
  'login', 'profile_update', 'logout_all', 'account_delete',
  'favorite_add', 'favorite_remove',
  'comment_create', 'comment_delete',
  'stat_report_create', 'stat_report_update', 'stat_report_move',
  'stat_report_hide', 'stat_report_unhide',
  'pending_report_create', 'pending_report_approve', 'pending_report_reject',
  'report_file_view',
  'sitting_create', 'voting_open', 'voting_update', 'voting_close',
  'vote_cutoff_set', 'vote_cast',
  'voting_request_create', 'voting_request_cancel', 'voting_request_reject',
  'admin_grant', 'admin_revoke',
  'logs_export', 'logs_delete', 'logs_clear',
  'logs_retention_delete', 'logs_archive'
);

-- ------------------------------------------------------------ functions

-- +goose StatementBegin
CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- true when no earlier non-null value exceeds a later one; nulls are skipped
-- +goose StatementBegin
CREATE FUNCTION values_non_decreasing(VARIADIC v numeric[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM   unnest(v) WITH ORDINALITY AS a(av, ao)
    JOIN   unnest(v) WITH ORDINALITY AS b(bv, bo) ON ao < bo
    WHERE  av > bv
  );
$$;
-- +goose StatementEnd

-- numbered kinds need 1..max_number, others need NULL; shared by
-- exam_sittings and pending_reports (both have kind_id and number)
-- +goose StatementBegin
CREATE FUNCTION check_assessment_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  k_numbered boolean;
  k_max      smallint;
BEGIN
  SELECT numbered, max_number INTO k_numbered, k_max
  FROM   assessment_kinds WHERE id = NEW.kind_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports this
  END IF;
  IF (k_numbered AND (NEW.number IS NULL OR NEW.number < 1 OR NEW.number > k_max))
     OR (NOT k_numbered AND NEW.number IS NOT NULL) THEN
    RAISE EXCEPTION 'number % is not valid for assessment kind %', NEW.number, NEW.kind_id
      USING ERRCODE = 'check_violation',
            CONSTRAINT = TG_TABLE_NAME || '_number_ck';
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- search ETag input; bumped whenever a search badge could change
-- +goose StatementBegin
CREATE FUNCTION bump_content_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE content_version SET n = n + 1;
  RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- -------------------------------------------------------------- catalog

CREATE TABLE departments (
  id   integer GENERATED ALWAYS AS IDENTITY,
  name text    NOT NULL,
  CONSTRAINT departments_pk      PRIMARY KEY (id),
  CONSTRAINT departments_name_u  UNIQUE (name),
  CONSTRAINT departments_name_ck CHECK (length(btrim(name)) > 0)
);

CREATE TABLE instructors (
  id             integer GENERATED ALWAYS AS IDENTITY,
  name           text    NOT NULL,
  is_placeholder boolean NOT NULL DEFAULT false,
  CONSTRAINT instructors_pk      PRIMARY KEY (id),
  CONSTRAINT instructors_name_u  UNIQUE (name),
  CONSTRAINT instructors_name_ck CHECK (length(btrim(name)) > 0)
);

CREATE TABLE courses (
  id            bigint      GENERATED ALWAYS AS IDENTITY,
  title         text        NOT NULL,
  instructor_id integer     NOT NULL,
  identity_key  text        NOT NULL,
  legacy_key    text,
  search_text   text        NOT NULL,
  is_listed     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courses_pk            PRIMARY KEY (id),
  CONSTRAINT courses_identity_u    UNIQUE (identity_key),
  CONSTRAINT courses_legacy_u      UNIQUE (legacy_key),
  CONSTRAINT courses_instructor_fk FOREIGN KEY (instructor_id) REFERENCES instructors (id),
  CONSTRAINT courses_title_ck      CHECK (length(btrim(title)) > 0),
  CONSTRAINT courses_search_ck     CHECK (search_text = lower(search_text) AND search_text !~ '\s')
);
CREATE INDEX courses_instructor_idx ON courses (instructor_id);
CREATE TRIGGER courses_touch BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE course_offerings (
  course_id     bigint   NOT NULL,
  year          smallint NOT NULL,
  semester      smallint NOT NULL,
  department_id integer  NOT NULL,
  CONSTRAINT course_offerings_pk          PRIMARY KEY (course_id, year, semester, department_id),
  CONSTRAINT course_offerings_course_fk   FOREIGN KEY (course_id)     REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT course_offerings_dept_fk     FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT course_offerings_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT course_offerings_year_ck     CHECK (year BETWEEN 1980 AND 2200)
);
CREATE INDEX course_offerings_term_idx ON course_offerings (year, semester);
CREATE INDEX course_offerings_dept_idx ON course_offerings (department_id);

CREATE TABLE catalog_sections (
  id             bigint   GENERATED ALWAYS AS IDENTITY,
  course_id      bigint   NOT NULL,
  year           smallint NOT NULL,
  semester       smallint NOT NULL,
  course_number  text     NOT NULL,
  lecture_number text     NOT NULL,
  department_id  integer  NOT NULL,
  class_time     jsonb    NOT NULL DEFAULT '[]',
  CONSTRAINT catalog_sections_pk          PRIMARY KEY (id),
  CONSTRAINT catalog_sections_u           UNIQUE (year, semester, course_number, lecture_number),
  CONSTRAINT catalog_sections_course_fk   FOREIGN KEY (course_id)     REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT catalog_sections_dept_fk     FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT catalog_sections_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT catalog_sections_year_ck     CHECK (year BETWEEN 1980 AND 2200)
);
CREATE INDEX catalog_sections_course_idx ON catalog_sections (course_id);

-- ---------------------------------------------------------------- users

CREATE TABLE colleges (
  name       text     NOT NULL,
  sort_order smallint NOT NULL,
  is_active  boolean  NOT NULL DEFAULT true,
  CONSTRAINT colleges_pk      PRIMARY KEY (name),
  CONSTRAINT colleges_order_u UNIQUE (sort_order) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT colleges_name_ck CHECK (length(btrim(name)) > 0)
);

INSERT INTO colleges (name, sort_order) VALUES
  ('인문대학', 1), ('사회과학대학', 2), ('자연과학대학', 3), ('간호대학', 4),
  ('경영대학', 5), ('공과대학', 6), ('농업생명과학대학', 7), ('미술대학', 8),
  ('사범대학', 9), ('생활과학대학', 10), ('수의과대학', 11), ('약학대학', 12),
  ('음악대학', 13), ('의과대학', 14), ('자유전공학부', 15),
  ('법학전문대학원', 16), ('치의학대학원', 17), ('대학원/기타', 18);

CREATE TABLE users (
  id             bigint      GENERATED ALWAYS AS IDENTITY,
  email          text,
  display_name   text,
  is_admin       boolean     NOT NULL DEFAULT false,
  college        text,
  admission_year smallint,
  last_ip        inet,
  session_epoch  integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz,
  deleted_at     timestamptz,
  CONSTRAINT users_pk         PRIMARY KEY (id),
  CONSTRAINT users_email_u    UNIQUE (email),
  CONSTRAINT users_college_fk FOREIGN KEY (college) REFERENCES colleges (name) ON UPDATE CASCADE,
  CONSTRAINT users_email_ck   CHECK (email IS NULL OR (email LIKE '%_@snu.ac.kr' AND email = lower(email))),
  CONSTRAINT users_live_ck    CHECK (deleted_at IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT users_scrubbed_ck CHECK (
    deleted_at IS NULL
    OR (email IS NULL AND display_name IS NULL AND college IS NULL
        AND admission_year IS NULL AND last_ip IS NULL AND is_admin = false)
  ),
  CONSTRAINT users_admission_year_ck CHECK (admission_year IS NULL OR admission_year BETWEEN 1980 AND 2100),
  CONSTRAINT users_epoch_ck          CHECK (session_epoch >= 0)
);

-- ------------------------------------------------------- exam sittings

CREATE TABLE assessment_kinds (
  id           smallint GENERATED ALWAYS AS IDENTITY,
  code         text     NOT NULL,
  label_ko     text     NOT NULL,
  label_format text     NOT NULL,
  numbered     boolean  NOT NULL,
  max_number   smallint,
  sort_order   smallint NOT NULL,
  is_active    boolean  NOT NULL DEFAULT true,
  CONSTRAINT assessment_kinds_pk      PRIMARY KEY (id),
  CONSTRAINT assessment_kinds_code_u  UNIQUE (code),
  CONSTRAINT assessment_kinds_label_u UNIQUE (label_ko)   DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT assessment_kinds_order_u UNIQUE (sort_order) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT assessment_kinds_max_ck  CHECK (numbered = (max_number IS NOT NULL) AND (max_number IS NULL OR max_number >= 1)),
  CONSTRAINT assessment_kinds_fmt_ck  CHECK (numbered = (position('{n}' IN label_format) > 0))
);

INSERT INTO assessment_kinds (code, label_ko, label_format, numbered, max_number, sort_order) VALUES
  ('midterm',    '중간', '중간',       false, NULL, 1),
  ('final',      '기말', '기말',       false, NULL, 2),
  ('exam',       '시험', '{n}차 시험', true,  6,    3),
  ('quiz',       '퀴즈', '퀴즈 {n}',   true,  20,   4),
  ('assignment', '과제', '과제 {n}',   true,  20,   5),
  ('other',      '기타', '기타',       false, NULL, 6);

CREATE TABLE exam_sittings (
  id                 bigint      GENERATED ALWAYS AS IDENTITY,
  course_id          bigint      NOT NULL,
  kind_id            smallint    NOT NULL,
  number             smallint,
  year               smallint    NOT NULL,
  semester           smallint    NOT NULL,
  voting_opened_at   timestamptz,
  voting_closes_at   timestamptz,
  voting_ended_at    timestamptz,
  votes_counted_from timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_sittings_pk        PRIMARY KEY (id),
  CONSTRAINT exam_sittings_u         UNIQUE NULLS NOT DISTINCT (course_id, kind_id, number, year, semester),
  CONSTRAINT exam_sittings_course_fk FOREIGN KEY (course_id) REFERENCES courses (id),
  CONSTRAINT exam_sittings_kind_fk   FOREIGN KEY (kind_id)   REFERENCES assessment_kinds (id),
  CONSTRAINT exam_sittings_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT exam_sittings_year_ck     CHECK (year BETWEEN 1980 AND 2200),
  CONSTRAINT exam_sittings_voting_ck   CHECK (
    (voting_opened_at IS NOT NULL OR (voting_closes_at IS NULL AND voting_ended_at IS NULL))
    AND (voting_closes_at IS NULL OR voting_closes_at > voting_opened_at)
    AND (voting_ended_at  IS NULL OR voting_ended_at  >= voting_opened_at)
  )
);
CREATE INDEX exam_sittings_course_idx ON exam_sittings (course_id);
CREATE INDEX exam_sittings_open_idx   ON exam_sittings (voting_closes_at)
  WHERE voting_opened_at IS NOT NULL AND voting_ended_at IS NULL;
CREATE TRIGGER exam_sittings_number BEFORE INSERT OR UPDATE OF kind_id, number ON exam_sittings
  FOR EACH ROW EXECUTE FUNCTION check_assessment_number();

CREATE TABLE votes (
  id         bigint      GENERATED ALWAYS AS IDENTITY,
  sitting_id bigint      NOT NULL,
  user_id    bigint      NOT NULL,
  rating     smallint    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT votes_pk         PRIMARY KEY (id),
  CONSTRAINT votes_one_each   UNIQUE (sitting_id, user_id),
  CONSTRAINT votes_sitting_fk FOREIGN KEY (sitting_id) REFERENCES exam_sittings (id),
  CONSTRAINT votes_user_fk    FOREIGN KEY (user_id)    REFERENCES users (id),
  CONSTRAINT votes_rating_ck  CHECK (rating BETWEEN 1 AND 5)
);
CREATE INDEX votes_user_idx ON votes (user_id);
CREATE TRIGGER votes_touch BEFORE UPDATE ON votes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE voting_requests (
  id          bigint                NOT NULL GENERATED ALWAYS AS IDENTITY,
  sitting_id  bigint                NOT NULL,
  user_id     bigint                NOT NULL,
  note        text,
  status      voting_request_status NOT NULL DEFAULT 'open',
  created_at  timestamptz           NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by bigint,
  CONSTRAINT voting_requests_pk          PRIMARY KEY (id),
  CONSTRAINT voting_requests_sitting_fk  FOREIGN KEY (sitting_id)  REFERENCES exam_sittings (id),
  CONSTRAINT voting_requests_user_fk     FOREIGN KEY (user_id)     REFERENCES users (id),
  CONSTRAINT voting_requests_resolver_fk FOREIGN KEY (resolved_by) REFERENCES users (id),
  CONSTRAINT voting_requests_note_ck     CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 100),
  CONSTRAINT voting_requests_resolved_ck CHECK ((status = 'open') = (resolved_at IS NULL))
);
CREATE UNIQUE INDEX voting_requests_open_u ON voting_requests (sitting_id, user_id) WHERE status = 'open';
CREATE INDEX voting_requests_user_idx ON voting_requests (user_id);

-- ---------------------------------------------------------- contributions

CREATE TABLE pending_reports (
  id           bigint        GENERATED ALWAYS AS IDENTITY,
  course_id    bigint        NOT NULL,
  kind_id      smallint      NOT NULL,
  number       smallint,
  year         smallint      NOT NULL,
  semester     smallint      NOT NULL,
  uploader_id  bigint        NOT NULL,
  nickname     text          NOT NULL DEFAULT '(익명)',
  file_key     text          NOT NULL,
  file_name    text          NOT NULL,
  content_type text          NOT NULL,
  byte_size    integer       NOT NULL,
  sha256       text          NOT NULL,
  status       report_status NOT NULL DEFAULT 'pending',
  reviewer_id  bigint,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pending_reports_pk          PRIMARY KEY (id),
  CONSTRAINT pending_reports_file_key_u  UNIQUE (file_key),
  CONSTRAINT pending_reports_course_fk   FOREIGN KEY (course_id)   REFERENCES courses (id),
  CONSTRAINT pending_reports_kind_fk     FOREIGN KEY (kind_id)     REFERENCES assessment_kinds (id),
  CONSTRAINT pending_reports_uploader_fk FOREIGN KEY (uploader_id) REFERENCES users (id),
  CONSTRAINT pending_reports_reviewer_fk FOREIGN KEY (reviewer_id) REFERENCES users (id),
  CONSTRAINT pending_reports_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT pending_reports_year_ck     CHECK (year BETWEEN 1980 AND 2200),
  CONSTRAINT pending_reports_nickname_ck CHECK (char_length(nickname) BETWEEN 1 AND 10),
  CONSTRAINT pending_reports_note_ck     CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  CONSTRAINT pending_reports_size_ck     CHECK (byte_size > 0 AND byte_size <= 3145728),
  CONSTRAINT pending_reports_sha_ck      CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pending_reports_mime_ck     CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT pending_reports_dated_ck    CHECK (reviewed_at IS NULL OR reviewed_at >= created_at),
  CONSTRAINT pending_reports_review_ck   CHECK (
    (status =  'pending' AND reviewer_id IS NULL     AND reviewed_at IS NULL)
    OR
    (status <> 'pending' AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX pending_reports_queue_idx    ON pending_reports (created_at, id) WHERE status = 'pending';
CREATE INDEX pending_reports_course_idx   ON pending_reports (course_id, created_at DESC);
CREATE INDEX pending_reports_uploader_idx ON pending_reports (uploader_id);
CREATE TRIGGER pending_reports_number BEFORE INSERT OR UPDATE OF kind_id, number ON pending_reports
  FOR EACH ROW EXECUTE FUNCTION check_assessment_number();

CREATE TABLE upload_intents (
  file_key   text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upload_intents_pk PRIMARY KEY (file_key)
);

CREATE TABLE stat_reports (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  sitting_id       bigint      NOT NULL,
  q1               numeric(6,2),
  q2               numeric(6,2),
  q3               numeric(6,2),
  q4               numeric(6,2),
  average          numeric(6,2),
  max_score        numeric(6,2),
  note             text,
  nickname         text        NOT NULL DEFAULT '(익명)',
  contributor_id   bigint      NOT NULL,
  source           stat_source NOT NULL,
  source_report_id bigint,
  hidden_at        timestamptz,
  hidden_by        bigint,
  hidden_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stat_reports_pk             PRIMARY KEY (id),
  CONSTRAINT stat_reports_sitting_fk     FOREIGN KEY (sitting_id)       REFERENCES exam_sittings (id),
  CONSTRAINT stat_reports_contributor_fk FOREIGN KEY (contributor_id)   REFERENCES users (id),
  CONSTRAINT stat_reports_source_fk      FOREIGN KEY (source_report_id) REFERENCES pending_reports (id),
  CONSTRAINT stat_reports_hidden_by_fk   FOREIGN KEY (hidden_by)        REFERENCES users (id),
  CONSTRAINT stat_reports_source_u       UNIQUE (source_report_id),
  CONSTRAINT stat_reports_hidden_ck CHECK (
    (hidden_at IS NULL AND hidden_by IS NULL AND hidden_reason IS NULL)
    OR (hidden_at IS NOT NULL AND hidden_by IS NOT NULL)
  ),
  CONSTRAINT stat_reports_hidden_reason_ck CHECK (hidden_reason IS NULL OR char_length(hidden_reason) BETWEEN 1 AND 500),
  CONSTRAINT stat_reports_nickname_ck   CHECK (char_length(nickname) BETWEEN 1 AND 10),
  CONSTRAINT stat_reports_note_ck       CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT stat_reports_not_empty_ck  CHECK (
    num_nonnulls(q1, q2, q3, q4, average, max_score) > 0
    OR (note IS NOT NULL AND length(btrim(note)) > 0)
  ),
  CONSTRAINT stat_reports_ordered_ck    CHECK (values_non_decreasing(q1, q2, q3, q4)),
  CONSTRAINT stat_reports_within_max_ck CHECK (max_score IS NULL OR greatest(q1, q2, q3, q4, average) <= max_score),
  CONSTRAINT stat_reports_range_ck      CHECK (
    coalesce(least(q1, q2, q3, q4, average), 0) >= 0 AND (max_score IS NULL OR max_score > 0)
  ),
  CONSTRAINT stat_reports_provenance_ck CHECK (
    (source = 'direct' AND source_report_id IS NULL)
    OR (source = 'transcribed' AND source_report_id IS NOT NULL)
  )
);
CREATE INDEX stat_reports_sitting_idx     ON stat_reports (sitting_id, created_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX stat_reports_recent_idx      ON stat_reports (created_at DESC, id DESC);
CREATE INDEX stat_reports_contributor_idx ON stat_reports (contributor_id);
CREATE TRIGGER stat_reports_touch BEFORE UPDATE ON stat_reports
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE comments (
  id         bigint      GENERATED ALWAYS AS IDENTITY,
  course_id  bigint      NOT NULL,
  user_id    bigint      NOT NULL,
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_pk        PRIMARY KEY (id),
  CONSTRAINT comments_course_fk FOREIGN KEY (course_id) REFERENCES courses (id),
  CONSTRAINT comments_user_fk   FOREIGN KEY (user_id)   REFERENCES users (id),
  CONSTRAINT comments_body_ck   CHECK (char_length(btrim(body)) BETWEEN 1 AND 50)
);
CREATE INDEX comments_course_idx ON comments (course_id, created_at DESC, id DESC);
CREATE INDEX comments_recent_idx ON comments (created_at DESC, id DESC);
CREATE INDEX comments_user_idx   ON comments (user_id);

CREATE TABLE favorites (
  user_id    bigint      NOT NULL,
  course_id  bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorites_pk        PRIMARY KEY (user_id, course_id),
  CONSTRAINT favorites_user_fk   FOREIGN KEY (user_id)   REFERENCES users (id),
  CONSTRAINT favorites_course_fk FOREIGN KEY (course_id) REFERENCES courses (id)
);
CREATE INDEX favorites_user_recent_idx ON favorites (user_id, created_at DESC);
CREATE INDEX favorites_course_idx      ON favorites (course_id);

-- ----------------------------------------------------------- operations

CREATE TABLE activity_logs (
  id         bigint          GENERATED ALWAYS AS IDENTITY,
  user_id    bigint,
  action     activity_action NOT NULL,
  metadata   jsonb           NOT NULL DEFAULT '{}',
  ip         inet,
  created_at timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT activity_logs_pk      PRIMARY KEY (id),
  CONSTRAINT activity_logs_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT activity_logs_meta_ck CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX activity_logs_time_idx   ON activity_logs (created_at DESC, id DESC);
CREATE INDEX activity_logs_user_idx   ON activity_logs (user_id, created_at DESC);
CREATE INDEX activity_logs_action_idx ON activity_logs (action, created_at DESC);

CREATE TABLE catalog_imports (
  id               bigint        GENERATED ALWAYS AS IDENTITY,
  started_at       timestamptz   NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           import_status NOT NULL DEFAULT 'running',
  source_label     text,
  courses_total    integer,
  courses_added    integer,
  courses_unlisted integer,
  offerings_total  integer,
  sections_total   integer,
  error            text,
  CONSTRAINT catalog_imports_pk       PRIMARY KEY (id),
  CONSTRAINT catalog_imports_done_ck  CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT catalog_imports_error_ck CHECK (status = 'failed' OR error IS NULL),
  CONSTRAINT catalog_imports_dated_ck CHECK (finished_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX catalog_imports_recent_idx ON catalog_imports (started_at DESC);
CREATE UNIQUE INDEX catalog_imports_one_running ON catalog_imports (status) WHERE status = 'running';

CREATE TABLE log_archive_runs (
  id            bigint         GENERATED ALWAYS AS IDENTITY,
  started_at    timestamptz    NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        archive_status NOT NULL DEFAULT 'running',
  cutoff        timestamptz,
  format        text           NOT NULL,
  row_count     integer,
  first_id      bigint,
  last_id       bigint,
  drive_file_id text,
  error         text,
  CONSTRAINT log_archive_runs_pk        PRIMARY KEY (id),
  CONSTRAINT log_archive_runs_format_ck CHECK (format IN ('json', 'jsonl', 'csv', 'xlsx', 'parquet')),
  CONSTRAINT log_archive_runs_done_ck   CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT log_archive_runs_ok_ck     CHECK (status <> 'succeeded' OR drive_file_id IS NOT NULL),
  CONSTRAINT log_archive_runs_error_ck  CHECK (status = 'failed' OR error IS NULL)
);
CREATE INDEX log_archive_runs_recent_idx ON log_archive_runs (started_at DESC, id DESC);
CREATE UNIQUE INDEX log_archive_runs_one_running ON log_archive_runs (status) WHERE status = 'running';

CREATE TABLE job_runs (
  id          bigint      GENERATED ALWAYS AS IDENTITY,
  name        text        NOT NULL,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  status      job_status  NOT NULL,
  affected    integer     NOT NULL DEFAULT 0,
  error       text,
  CONSTRAINT job_runs_pk       PRIMARY KEY (id),
  CONSTRAINT job_runs_name_ck  CHECK (name IN ('retention', 'archive', 'upload-gc')),
  CONSTRAINT job_runs_error_ck CHECK (status = 'failed' OR error IS NULL),
  CONSTRAINT job_runs_dated_ck CHECK (finished_at >= started_at)
);
CREATE INDEX job_runs_name_idx ON job_runs (name, started_at DESC);

CREATE TABLE content_version (
  singleton boolean NOT NULL DEFAULT true,
  n         bigint  NOT NULL DEFAULT 0,
  CONSTRAINT content_version_pk PRIMARY KEY (singleton),
  CONSTRAINT content_version_ck CHECK (singleton)
);
INSERT INTO content_version DEFAULT VALUES;

CREATE TRIGGER stat_reports_content_version
  AFTER INSERT OR DELETE OR UPDATE OF sitting_id, hidden_at ON stat_reports
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_version();
CREATE TRIGGER exam_sittings_content_version
  AFTER UPDATE OF voting_opened_at, voting_closes_at, voting_ended_at ON exam_sittings
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_version();

-- ---------------------------------------------------------------- views

CREATE VIEW v_sitting_voting AS
SELECT s.id AS sitting_id,
       CASE
         WHEN s.voting_opened_at IS NULL THEN 'never'
         WHEN s.voting_ended_at IS NULL
              AND (s.voting_closes_at IS NULL OR s.voting_closes_at > now()) THEN 'open'
         ELSE 'closed'
       END AS state
FROM exam_sittings s;

CREATE VIEW v_sitting_difficulty AS
SELECT s.id                                    AS sitting_id,
       count(v.id)                             AS vote_count,
       round(avg(v.rating), 1)                 AS average_rating,
       count(v.id) FILTER (WHERE v.rating = 1) AS rating_1,
       count(v.id) FILTER (WHERE v.rating = 2) AS rating_2,
       count(v.id) FILTER (WHERE v.rating = 3) AS rating_3,
       count(v.id) FILTER (WHERE v.rating = 4) AS rating_4,
       count(v.id) FILTER (WHERE v.rating = 5) AS rating_5
FROM      exam_sittings s
LEFT JOIN votes v
       ON v.sitting_id = s.id
      AND (s.votes_counted_from IS NULL OR v.created_at >= s.votes_counted_from)
GROUP BY s.id;

-- +goose Down
DROP VIEW v_sitting_difficulty;
DROP VIEW v_sitting_voting;
DROP TABLE content_version;
DROP TABLE job_runs;
DROP TABLE log_archive_runs;
DROP TABLE catalog_imports;
DROP TABLE activity_logs;
DROP TABLE favorites;
DROP TABLE comments;
DROP TABLE stat_reports;
DROP TABLE upload_intents;
DROP TABLE pending_reports;
DROP TABLE voting_requests;
DROP TABLE votes;
DROP TABLE exam_sittings;
DROP TABLE assessment_kinds;
DROP TABLE users;
DROP TABLE colleges;
DROP TABLE catalog_sections;
DROP TABLE course_offerings;
DROP TABLE courses;
DROP TABLE instructors;
DROP TABLE departments;
DROP FUNCTION bump_content_version();
DROP FUNCTION check_assessment_number();
DROP FUNCTION values_non_decreasing(numeric[]);
DROP FUNCTION touch_updated_at();
DROP TYPE activity_action;
DROP TYPE job_status;
DROP TYPE archive_status;
DROP TYPE voting_request_status;
DROP TYPE import_status;
DROP TYPE stat_source;
DROP TYPE report_status;
```

- [ ] **Step 3: embed** — `db/migrations/embed.go`

```go
// Package migrations embeds the goose SQL migrations into the binary.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
```

- [ ] **Step 4: db 패키지** — `internal/db/db.go`

```go
// Package db opens PostgreSQL connections and applies migrations.
package db

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver for goose
	"github.com/pressly/goose/v3"

	"github.com/snuarchive/snuarchive/db/migrations"
)

type Options struct {
	URL        string
	MaxConns   int32
	PoolerMode bool
}

// Open connects and pings. PoolerMode switches to the simple protocol,
// because transaction-mode poolers (Supabase, pgbouncer) cannot keep
// prepared statements across transactions.
func Open(ctx context.Context, o Options) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(o.URL)
	if err != nil {
		return nil, fmt.Errorf("db: parse url: %w", err)
	}
	if o.MaxConns > 0 {
		cfg.MaxConns = o.MaxConns
	}
	if o.PoolerMode {
		cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return pool, nil
}

// Migrator applies the embedded migrations. It uses its own connection so
// migrations can target a direct (non-pooled) database URL.
type Migrator struct {
	provider *goose.Provider
}

func NewMigrator(url string) (*Migrator, error) {
	sqlDB, err := sql.Open("pgx", url)
	if err != nil {
		return nil, fmt.Errorf("db: open for migrations: %w", err)
	}
	p, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS)
	if err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("db: migrations: %w", err)
	}
	return &Migrator{provider: p}, nil
}

func (m *Migrator) Up(ctx context.Context) ([]*goose.MigrationResult, error) { return m.provider.Up(ctx) }

func (m *Migrator) Down(ctx context.Context) (*goose.MigrationResult, error) {
	return m.provider.Down(ctx)
}

func (m *Migrator) Status(ctx context.Context) ([]*goose.MigrationStatus, error) {
	return m.provider.Status(ctx)
}

// Close closes the migration connection.
func (m *Migrator) Close() error { return m.provider.Close() }
```

- [ ] **Step 5: pgtest 하네스** — `internal/testutil/pgtest/pgtest.go`

```go
// Package pgtest runs integration tests against a throwaway PostgreSQL 18.
// One container serves a whole test binary; every test gets its own
// database cloned from a migrated template, so tests can commit, lock and
// run concurrently without seeing each other.
package pgtest

import (
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/snuarchive/snuarchive/internal/db"
)

const (
	image      = "postgres:18"
	templateDB = "snu_template"
)

var (
	base    *url.URL
	counter atomic.Int64
)

// Main starts the container, migrates the template database, runs the tests
// and removes the container. Call it from TestMain. With -short it only runs
// the tests; the helpers below then skip.
func Main(m *testing.M) {
	flag.Parse()
	if testing.Short() {
		os.Exit(m.Run())
	}
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx := context.Background()
	c, err := postgres.Run(ctx, image,
		postgres.WithDatabase(templateDB),
		postgres.WithUsername("snu"),
		postgres.WithPassword("snu"),
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pgtest: start postgres (is Docker running?):", err)
		return 1
	}
	defer func() { _ = testcontainers.TerminateContainer(c) }()

	tmplURL, err := c.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintln(os.Stderr, "pgtest:", err)
		return 1
	}
	if err := migrate(ctx, tmplURL); err != nil {
		fmt.Fprintln(os.Stderr, "pgtest: migrate template:", err)
		return 1
	}
	base, err = url.Parse(tmplURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pgtest:", err)
		return 1
	}
	return m.Run()
}

func migrate(ctx context.Context, u string) error {
	m, err := db.NewMigrator(u)
	if err != nil {
		return err
	}
	defer m.Close() // the template must have no open connections before it is cloned
	_, err = m.Up(ctx)
	return err
}

func urlFor(name string) string {
	u := *base
	u.Path = "/" + name
	return u.String()
}

func admin(t testing.TB, sql string) {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, urlFor("postgres"))
	if err != nil {
		t.Fatalf("pgtest: connect: %v", err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, sql); err != nil {
		t.Fatalf("pgtest: %s: %v", sql, err)
	}
}

func create(t testing.TB, template string) string {
	t.Helper()
	if testing.Short() {
		t.Skip("pgtest: database test skipped with -short")
	}
	if base == nil {
		t.Fatal("pgtest: call pgtest.Main from TestMain")
	}
	name := fmt.Sprintf("t_%d_%d", os.Getpid(), counter.Add(1))
	admin(t, fmt.Sprintf("CREATE DATABASE %s TEMPLATE %s", name, template))
	t.Cleanup(func() { admin(t, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", name)) })
	return urlFor(name)
}

// NewDatabase returns the URL of a fresh, fully migrated database.
func NewDatabase(t testing.TB) string { return create(t, templateDB) }

// NewEmptyDatabase returns the URL of a fresh database with no schema.
func NewEmptyDatabase(t testing.TB) string { return create(t, "template0") }

// New returns a pool on a fresh, fully migrated database.
func New(t testing.TB) *pgxpool.Pool {
	t.Helper()
	u := NewDatabase(t)
	pool, err := pgxpool.New(context.Background(), u)
	if err != nil {
		t.Fatalf("pgtest: pool: %v", err)
	}
	t.Cleanup(pool.Close) // registered after the drop, so it runs first
	return pool
}
```

- [ ] **Step 6: 실패하는 테스트 작성** — `internal/db/main_test.go`와 `internal/db/migrate_test.go`

```go
// internal/db/main_test.go
package db_test

import (
	"testing"

	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }
```

```go
// internal/db/migrate_test.go
package db_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/snuarchive/snuarchive/internal/db"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func publicTables(t *testing.T, url string) int {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var n int
	err = conn.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'goose_db_version'`).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestMigrationsUpDownUp(t *testing.T) {
	ctx := context.Background()
	url := pgtest.NewEmptyDatabase(t)
	m, err := db.NewMigrator(url)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	res, err := m.Up(ctx)
	if err != nil || len(res) != 1 {
		t.Fatalf("up: %d results, %v", len(res), err)
	}
	if n := publicTables(t, url); n != 21 {
		t.Fatalf("after up: %d tables, want 21", n)
	}
	status, err := m.Status(ctx)
	if err != nil || len(status) != 1 || status[0].State != "applied" {
		t.Fatalf("status = %+v, %v", status, err)
	}
	if _, err := m.Down(ctx); err != nil {
		t.Fatalf("down: %v", err)
	}
	if n := publicTables(t, url); n != 0 {
		t.Fatalf("after down: %d tables left", n)
	}
	if _, err := m.Up(ctx); err != nil {
		t.Fatalf("second up: %v", err)
	}
}

func TestOpenInPoolerMode(t *testing.T) {
	ctx := context.Background()
	pool, err := db.Open(ctx, db.Options{URL: pgtest.NewDatabase(t), MaxConns: 2, PoolerMode: true})
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var kinds int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assessment_kinds WHERE code = $1 OR code = $2`, "exam", "quiz").Scan(&kinds); err != nil {
		t.Fatal(err)
	}
	if kinds != 2 {
		t.Fatalf("kinds = %d", kinds)
	}
}

func TestOpenRejectsBadURL(t *testing.T) {
	if _, err := db.Open(context.Background(), db.Options{URL: "not a url ::"}); err == nil {
		t.Fatal("want an error")
	}
}
```

- [ ] **Step 7: 통과 확인**

Run: `go mod tidy && go test ./internal/db/ -run 'Migrations|Open' -v`
Expected: 3개 PASS. 테이블 21개 = departments, instructors, courses, course_offerings, catalog_sections, colleges, users, assessment_kinds, exam_sittings, votes, voting_requests, pending_reports, upload_intents, stat_reports, comments, favorites, activity_logs, catalog_imports, log_archive_runs, job_runs, content_version (`goose_db_version` 제외).

Run: `go test -short ./internal/db/`
Expected: `ok` (DB 테스트 skip)

- [ ] **Step 8: 커밋**

```bash
git add go.mod go.sum db internal/db internal/testutil/pgtest
git commit -m "Add schema v1 migration, db open/migrate, and pgtest harness"
```

---

### Task 6: 스키마 동작 테스트

**Files:**
- Create: `internal/db/schema_test.go`

**Interfaces:**
- Consumes: `pgtest.New(t)` (Task 5)
- Produces: 테스트만 만든다. 스키마를 고치지 않는다. 테스트가 실패하면 마이그레이션이 spec 4장과 어긋난다는 뜻이므로 규칙에 따라 open-items에 기록한다.

- [ ] **Step 1: 테스트 작성** — `internal/db/schema_test.go`

```go
package db_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func scalar[T any](t *testing.T, pool *pgxpool.Pool, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("query %q: %v", sql, err)
	}
	return v
}

// constraintOf returns the violated constraint name, "" for success.
func constraintOf(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		return ""
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("want a PostgreSQL error, got %v", err)
	}
	return pgErr.ConstraintName
}

type fixture struct {
	courseID int64
	userID   int64
}

func seed(t *testing.T, pool *pgxpool.Pool) fixture {
	t.Helper()
	dept := scalar[int32](t, pool, `INSERT INTO departments (name) VALUES ('컴퓨터공학부') RETURNING id`)
	inst := scalar[int32](t, pool, `INSERT INTO instructors (name) VALUES ('홍길동') RETURNING id`)
	course := scalar[int64](t, pool, `
		INSERT INTO courses (title, instructor_id, identity_key, search_text)
		VALUES ('자료구조', $1, 'k1', '자료구조홍길동컴퓨터공학부') RETURNING id`, inst)
	mustExec(t, pool, `INSERT INTO course_offerings (course_id, year, semester, department_id) VALUES ($1, 2026, 1, $2)`, course, dept)
	user := scalar[int64](t, pool, `INSERT INTO users (email) VALUES ('student@snu.ac.kr') RETURNING id`)
	return fixture{courseID: course, userID: user}
}

func insertSitting(pool *pgxpool.Pool, f fixture, kind string, number *int16, year, semester int) (int64, error) {
	var id int64
	err := pool.QueryRow(context.Background(), `
		INSERT INTO exam_sittings (course_id, kind_id, number, year, semester)
		VALUES ($1, (SELECT id FROM assessment_kinds WHERE code = $2), $3, $4, $5)
		RETURNING id`, f.courseID, kind, number, year, semester).Scan(&id)
	return id, err
}

func ptr[T any](v T) *T { return &v }

func TestSittingNumberRule(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	cases := []struct {
		name   string
		kind   string
		number *int16
		want   string
	}{
		{"numbered kind without number", "exam", nil, "exam_sittings_number_ck"},
		{"number above max", "exam", ptr[int16](7), "exam_sittings_number_ck"},
		{"number zero", "quiz", ptr[int16](0), "exam_sittings_number_ck"},
		{"unnumbered kind with number", "midterm", ptr[int16](1), "exam_sittings_number_ck"},
		{"exam 2", "exam", ptr[int16](2), ""},
		{"quiz 20", "quiz", ptr[int16](20), ""},
		{"midterm", "midterm", nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := insertSitting(pool, f, tc.kind, tc.number, 2026, 1)
			if got := constraintOf(t, err); got != tc.want {
				t.Fatalf("constraint = %q, want %q (err %v)", got, tc.want, err)
			}
		})
	}
}

func TestSittingUniqueTreatsMissingNumbersAsEqual(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	if _, err := insertSitting(pool, f, "final", nil, 2026, 1); err != nil {
		t.Fatal(err)
	}
	_, err := insertSitting(pool, f, "final", nil, 2026, 1)
	if got := constraintOf(t, err); got != "exam_sittings_u" {
		t.Fatalf("constraint = %q", got)
	}
	if _, err := insertSitting(pool, f, "final", nil, 2026, 3); err != nil {
		t.Fatalf("another term must be allowed: %v", err)
	}
}

func TestStatReportConstraints(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	type row struct {
		q1, q2, q3, q4, avg, max *float64
		source                   string
	}
	cases := []struct {
		name string
		r    row
		want string
	}{
		{"q1 above q3 across a gap", row{q1: ptr(90.0), q3: ptr(10.0), source: "direct"}, "stat_reports_ordered_ck"},
		{"q4 above max", row{q4: ptr(110.0), max: ptr(100.0), source: "direct"}, "stat_reports_within_max_ck"},
		{"average above max", row{avg: ptr(101.0), max: ptr(100.0), source: "direct"}, "stat_reports_within_max_ck"},
		{"nothing at all", row{source: "direct"}, "stat_reports_not_empty_ck"},
		{"negative", row{q1: ptr(-1.0), source: "direct"}, "stat_reports_range_ck"},
		{"transcribed without upload", row{q2: ptr(50.0), source: "transcribed"}, "stat_reports_provenance_ck"},
		{"partial and ordered", row{q2: ptr(60.0), q4: ptr(95.0), max: ptr(100.0), source: "direct"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := pool.Exec(context.Background(), `
				INSERT INTO stat_reports (sitting_id, q1, q2, q3, q4, average, max_score, contributor_id, source)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				sitting, tc.r.q1, tc.r.q2, tc.r.q3, tc.r.q4, tc.r.avg, tc.r.max, f.userID, tc.r.source)
			if got := constraintOf(t, err); got != tc.want {
				t.Fatalf("constraint = %q, want %q (err %v)", got, tc.want, err)
			}
		})
	}
}

func TestUserScrubMustBeComplete(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	_, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at = now() WHERE id = $1`, f.userID)
	if got := constraintOf(t, err); got != "users_scrubbed_ck" {
		t.Fatalf("partial scrub: constraint = %q", got)
	}
	mustExec(t, pool, `UPDATE users SET email = NULL, deleted_at = now() WHERE id = $1`, f.userID)
	_, err = pool.Exec(context.Background(), `INSERT INTO users (email) VALUES ('someone@gmail.com')`)
	if got := constraintOf(t, err); got != "users_email_ck" {
		t.Fatalf("non-snu email: constraint = %q", got)
	}
}

func TestOneOpenVotingRequestPerUser(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	first := scalar[int64](t, pool, `INSERT INTO voting_requests (sitting_id, user_id, note) VALUES ($1, $2, '시험일 10/22') RETURNING id`, sitting, f.userID)
	_, err = pool.Exec(context.Background(), `INSERT INTO voting_requests (sitting_id, user_id) VALUES ($1, $2)`, sitting, f.userID)
	if got := constraintOf(t, err); got != "voting_requests_open_u" {
		t.Fatalf("constraint = %q", got)
	}
	mustExec(t, pool, `UPDATE voting_requests SET status = 'cancelled', resolved_at = now() WHERE id = $1`, first)
	mustExec(t, pool, `INSERT INTO voting_requests (sitting_id, user_id) VALUES ($1, $2)`, sitting, f.userID)
}

func TestContentVersionBumps(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	version := func() int64 { return scalar[int64](t, pool, `SELECT n FROM content_version`) }
	v0 := version()
	mustExec(t, pool, `INSERT INTO stat_reports (sitting_id, q2, contributor_id, source) VALUES ($1, 50, $2, 'direct')`, sitting, f.userID)
	if v := version(); v != v0+1 {
		t.Fatalf("after statistic: %d, want %d", v, v0+1)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET voting_opened_at = now() WHERE id = $1`, sitting)
	if v := version(); v != v0+2 {
		t.Fatalf("after opening: %d, want %d", v, v0+2)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET votes_counted_from = now() WHERE id = $1`, sitting)
	if v := version(); v != v0+2 {
		t.Fatalf("cutoff must not bump: %d", v)
	}
}

func TestVotingViews(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	state := func() string {
		return scalar[string](t, pool, `SELECT state FROM v_sitting_voting WHERE sitting_id = $1`, sitting)
	}
	if s := state(); s != "never" {
		t.Fatalf("state = %s", s)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET voting_opened_at = now(), voting_closes_at = now() + interval '7 days' WHERE id = $1`, sitting)
	if s := state(); s != "open" {
		t.Fatalf("state = %s", s)
	}
	mustExec(t, pool, `INSERT INTO votes (sitting_id, user_id, rating) VALUES ($1, $2, 4)`, sitting, f.userID)
	count := func() int64 {
		return scalar[int64](t, pool, `SELECT vote_count FROM v_sitting_difficulty WHERE sitting_id = $1`, sitting)
	}
	if c := count(); c != 1 {
		t.Fatalf("votes = %d", c)
	}
	if avg := scalar[float64](t, pool, `SELECT average_rating FROM v_sitting_difficulty WHERE sitting_id = $1`, sitting); avg != 4.0 {
		t.Fatalf("average = %v", avg)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET votes_counted_from = now() + interval '1 hour' WHERE id = $1`, sitting)
	if c := count(); c != 0 {
		t.Fatalf("cutoff should exclude the vote, got %d", c)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET voting_ended_at = now() WHERE id = $1`, sitting)
	if s := state(); s != "closed" {
		t.Fatalf("state = %s", s)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET voting_opened_at = now(), voting_closes_at = NULL, voting_ended_at = NULL WHERE id = $1`, sitting)
	if s := state(); s != "open" {
		t.Fatalf("open-ended voting state = %s", s)
	}
}
```

- [ ] **Step 2: 실행**

Run: `go test ./internal/db/ -v -run 'Sitting|Stat|Scrub|Voting|Content'`
Expected: 전부 PASS (테스트는 Task 5의 검증된 스키마를 고정할 뿐이다). 실패하면 스키마를 고치지 말고 실패 내용을 open-items에 기록한 뒤 보고한다.

- [ ] **Step 3: 커밋**

```bash
git add internal/db/schema_test.go
git commit -m "Pin schema v1 behaviour: sitting numbers, statistic checks, scrub, requests, views"
```

---

### Task 7: 제약 이름 → API 에러 매핑

**Files:**
- Create: `internal/db/errors.go`, `internal/db/errors_test.go`

**Interfaces:**
- Consumes: `apperr` (Task 2), `pgtest.New`, `seed`, `insertSitting`, `ptr`, `mustExec`, `scalar` (Task 6의 같은 테스트 패키지 헬퍼)
- Produces: `db.MapError(error) error`, `db.ClassifiedConstraints() []string`

- [ ] **Step 1: 실패하는 테스트 작성** — `internal/db/errors_test.go`

```go
package db_test

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"testing"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/db"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

// Every named CHECK, FOREIGN KEY and UNIQUE constraint (and unique index)
// in the schema, plus the trigger-raised names, must be classified, and the
// map must not name constraints that no longer exist.
func TestEveryConstraintIsClassified(t *testing.T) {
	pool := pgtest.New(t)
	rows, err := pool.Query(context.Background(), `
		SELECT c.conname FROM pg_constraint c
		JOIN pg_namespace n ON n.oid = c.connamespace
		WHERE n.nspname = 'public' AND c.contype IN ('c', 'f', 'u')
		UNION
		SELECT ic.relname FROM pg_index i
		JOIN pg_class ic ON ic.oid = i.indexrelid
		JOIN pg_namespace n ON n.oid = ic.relnamespace
		WHERE n.nspname = 'public' AND i.indisunique AND NOT i.indisprimary
		UNION
		SELECT unnest(ARRAY['exam_sittings_number_ck', 'pending_reports_number_ck'])`)
	if err != nil {
		t.Fatal(err)
	}
	var inSchema []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		inSchema = append(inSchema, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	classified := db.ClassifiedConstraints()
	for _, name := range inSchema {
		if !slices.Contains(classified, name) {
			t.Errorf("constraint %s is not classified in internal/db/errors.go", name)
		}
	}
	for _, name := range classified {
		if !slices.Contains(inSchema, name) {
			t.Errorf("classified constraint %s does not exist in the schema", name)
		}
	}
}

func TestMapErrorFieldError(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(context.Background(), `
		INSERT INTO stat_reports (sitting_id, q1, q3, contributor_id, source) VALUES ($1, 90, 10, $2, 'direct')`, sitting, f.userID)
	e, ok := apperr.As(db.MapError(err))
	if !ok || e.Status() != http.StatusUnprocessableEntity {
		t.Fatalf("got %v", db.MapError(err))
	}
	if len(e.Fields) != 1 || e.Fields[0] != (apperr.FieldError{Field: "quartiles", Code: apperr.QuartilesOutOfOrder}) {
		t.Fatalf("fields = %+v", e.Fields)
	}
	if !errors.Is(db.MapError(err), err) {
		t.Fatal("the database error must stay wrapped")
	}
}

func TestMapErrorTriggerName(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	_, err := insertSitting(pool, f, "exam", nil, 2026, 1)
	e, ok := apperr.As(db.MapError(err))
	if !ok || len(e.Fields) != 1 || e.Fields[0].Code != apperr.InvalidAssessmentNumber || e.Fields[0].Field != "number" {
		t.Fatalf("got %+v", e)
	}
}

func TestMapErrorCode(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, pool, `INSERT INTO voting_requests (sitting_id, user_id) VALUES ($1, $2)`, sitting, f.userID)
	_, err = pool.Exec(context.Background(), `INSERT INTO voting_requests (sitting_id, user_id) VALUES ($1, $2)`, sitting, f.userID)
	e, ok := apperr.As(db.MapError(err))
	if !ok || e.Code != apperr.VotingRequestExists {
		t.Fatalf("got %v", db.MapError(err))
	}
}

func TestMapErrorLeavesInternalInvariantsAlone(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	_, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at = now() WHERE id = $1`, f.userID)
	if got := db.MapError(err); got != err {
		t.Fatalf("internal invariant must pass through unchanged, got %v", got)
	}
}

func TestMapErrorPassThrough(t *testing.T) {
	plain := errors.New("boom")
	if db.MapError(plain) != plain {
		t.Fatal("non-database errors must pass through")
	}
	if db.MapError(nil) != nil {
		t.Fatal("nil must stay nil")
	}
}
```

- [ ] **Step 2: 실패 확인**

Run: `go test ./internal/db/ -run 'Classified|MapError'`
Expected: FAIL (undefined: db.MapError)

- [ ] **Step 3: 구현** — `internal/db/errors.go`

```go
package db

import (
	"errors"
	"slices"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/snuarchive/snuarchive/internal/apperr"
)

// rule says what a constraint violation means to an API client: a field
// error, a whole-request error code, or neither (an internal invariant that
// application code should never trip; it stays a 500).
type rule struct {
	field     string
	fieldCode apperr.FieldCode
	code      apperr.Code
}

var internalInvariant = rule{}

func field(name string, code apperr.FieldCode) rule { return rule{field: name, fieldCode: code} }
func code(c apperr.Code) rule                       { return rule{code: c} }

// constraintRules classifies every named constraint in the schema. A test
// fails when the schema and this map disagree.
var constraintRules = map[string]rule{
	// CHECK
	"departments_name_ck":           internalInvariant,
	"instructors_name_ck":           internalInvariant,
	"courses_title_ck":              internalInvariant,
	"courses_search_ck":             internalInvariant,
	"course_offerings_semester_ck":  internalInvariant,
	"course_offerings_year_ck":      internalInvariant,
	"catalog_sections_semester_ck":  internalInvariant,
	"catalog_sections_year_ck":      internalInvariant,
	"colleges_name_ck":              internalInvariant,
	"users_email_ck":                field("email", apperr.InvalidEmail),
	"users_live_ck":                 internalInvariant,
	"users_scrubbed_ck":             internalInvariant,
	"users_admission_year_ck":       field("admissionYear", apperr.InvalidAdmissionYear),
	"users_epoch_ck":                internalInvariant,
	"assessment_kinds_max_ck":       internalInvariant,
	"assessment_kinds_fmt_ck":       internalInvariant,
	"exam_sittings_semester_ck":     field("semester", apperr.InvalidTerm),
	"exam_sittings_year_ck":         field("year", apperr.InvalidTerm),
	"exam_sittings_voting_ck":       field("closesAt", apperr.ClosesAtInPast),
	"votes_rating_ck":               field("rating", apperr.ValueOutOfRange),
	"voting_requests_note_ck":       field("note", apperr.TooLong),
	"voting_requests_resolved_ck":   internalInvariant,
	"pending_reports_semester_ck":   field("semester", apperr.InvalidTerm),
	"pending_reports_year_ck":       field("year", apperr.InvalidTerm),
	"pending_reports_nickname_ck":   field("nickname", apperr.TooLong),
	"pending_reports_note_ck":       field("reviewNote", apperr.TooLong),
	"pending_reports_size_ck":       code(apperr.FileTooLarge),
	"pending_reports_sha_ck":        internalInvariant,
	"pending_reports_mime_ck":       code(apperr.FileTypeRejected),
	"pending_reports_dated_ck":      internalInvariant,
	"pending_reports_review_ck":     internalInvariant,
	"stat_reports_hidden_ck":        internalInvariant,
	"stat_reports_hidden_reason_ck": field("reason", apperr.TooLong),
	"stat_reports_nickname_ck":      field("nickname", apperr.TooLong),
	"stat_reports_note_ck":          field("note", apperr.TooLong),
	"stat_reports_not_empty_ck":     field("statistic", apperr.NothingSubmitted),
	"stat_reports_ordered_ck":       field("quartiles", apperr.QuartilesOutOfOrder),
	"stat_reports_within_max_ck":    field("maxScore", apperr.ValueAboveMaxScore),
	"stat_reports_range_ck":         field("statistic", apperr.ValueOutOfRange),
	"stat_reports_provenance_ck":    internalInvariant,
	"comments_body_ck":              field("body", apperr.TooLong),
	"activity_logs_meta_ck":         internalInvariant,
	"catalog_imports_done_ck":       internalInvariant,
	"catalog_imports_error_ck":      internalInvariant,
	"catalog_imports_dated_ck":      internalInvariant,
	"log_archive_runs_format_ck":    internalInvariant,
	"log_archive_runs_done_ck":      internalInvariant,
	"log_archive_runs_ok_ck":        internalInvariant,
	"log_archive_runs_error_ck":     internalInvariant,
	"job_runs_name_ck":              internalInvariant,
	"job_runs_error_ck":             internalInvariant,
	"job_runs_dated_ck":             internalInvariant,
	"content_version_ck":            internalInvariant,

	// raised by check_assessment_number()
	"exam_sittings_number_ck":   field("number", apperr.InvalidAssessmentNumber),
	"pending_reports_number_ck": field("number", apperr.InvalidAssessmentNumber),

	// UNIQUE constraints and unique indexes
	"departments_name_u":           internalInvariant,
	"instructors_name_u":           internalInvariant,
	"courses_identity_u":           internalInvariant,
	"courses_legacy_u":             internalInvariant,
	"catalog_sections_u":           internalInvariant,
	"colleges_order_u":             internalInvariant,
	"users_email_u":                internalInvariant,
	"assessment_kinds_code_u":      internalInvariant,
	"assessment_kinds_label_u":     internalInvariant,
	"assessment_kinds_order_u":     internalInvariant,
	"exam_sittings_u":              internalInvariant,
	"votes_one_each":               internalInvariant,
	"pending_reports_file_key_u":   internalInvariant,
	"stat_reports_source_u":        code(apperr.ReportAlreadyReviewed),
	"voting_requests_open_u":       code(apperr.VotingRequestExists),
	"catalog_imports_one_running":  code(apperr.JobAlreadyRunning),
	"log_archive_runs_one_running": code(apperr.JobAlreadyRunning),

	// FOREIGN KEY
	"courses_instructor_fk":       internalInvariant,
	"course_offerings_course_fk":  internalInvariant,
	"course_offerings_dept_fk":    internalInvariant,
	"catalog_sections_course_fk":  internalInvariant,
	"catalog_sections_dept_fk":    internalInvariant,
	"users_college_fk":            field("college", apperr.InvalidCollege),
	"exam_sittings_course_fk":     code(apperr.NotFound),
	"exam_sittings_kind_fk":       field("kindId", apperr.UnknownAssessmentKind),
	"votes_sitting_fk":            code(apperr.NotFound),
	"votes_user_fk":               internalInvariant,
	"voting_requests_sitting_fk":  code(apperr.NotFound),
	"voting_requests_user_fk":     internalInvariant,
	"voting_requests_resolver_fk": internalInvariant,
	"pending_reports_course_fk":   code(apperr.NotFound),
	"pending_reports_kind_fk":     field("kindId", apperr.UnknownAssessmentKind),
	"pending_reports_uploader_fk": internalInvariant,
	"pending_reports_reviewer_fk": internalInvariant,
	"stat_reports_sitting_fk":     code(apperr.NotFound),
	"stat_reports_contributor_fk": internalInvariant,
	"stat_reports_source_fk":      internalInvariant,
	"stat_reports_hidden_by_fk":   internalInvariant,
	"comments_course_fk":          code(apperr.NotFound),
	"comments_user_fk":            internalInvariant,
	"favorites_user_fk":           internalInvariant,
	"favorites_course_fk":         code(apperr.NotFound),
	"activity_logs_user_fk":       internalInvariant,
}

// ClassifiedConstraints lists every constraint name MapError knows.
func ClassifiedConstraints() []string {
	names := make([]string, 0, len(constraintRules))
	for name := range constraintRules {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// MapError turns constraint violations into API errors. Anything else,
// including violations of internal invariants, is returned unchanged and
// ends up as a 500.
func MapError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23514", "23505", "23503": // check, unique, foreign key
	default:
		return err
	}
	r, ok := constraintRules[pgErr.ConstraintName]
	switch {
	case !ok || r == internalInvariant:
		return err
	case r.code != "":
		return apperr.New(r.code).Wrap(err)
	default:
		return apperr.Validation(apperr.FieldError{Field: r.field, Code: r.fieldCode}).Wrap(err)
	}
}
```

- [ ] **Step 4: 통과 확인**

Run: `go test ./internal/db/ -v -run 'Classified|MapError'`
Expected: PASS. `TestEveryConstraintIsClassified`가 목록 차이를 보고하면, 그 이름을 스키마의 실제 제약과 대조해 맵을 고친다. 새 이름의 분류(필드/코드/내부)가 spec에서 명확하지 않으면 open-items 규칙을 따른다.

- [ ] **Step 5: 커밋**

```bash
git add internal/db/errors.go internal/db/errors_test.go
git commit -m "Map every schema constraint to a field error, error code or internal invariant"
```

---

### Task 8: sqlc 설정과 refdata 서비스

**Files:**
- Create: `sqlc.yaml`, `db/queries/reference.sql`, `internal/db/dbq/*`(생성), `internal/refdata/refdata.go`, `internal/refdata/refdata_test.go`

**Interfaces:**
- Consumes: `pgtest.Main`, `pgtest.New` (Task 5), `calendar.Semesters`, `calendar.SemesterLabel` (Task 1)
- Produces:
  - 생성 코드: `dbq.New(dbq.DBTX) *dbq.Queries`와 메서드 두 개
    - `ListAssessmentKinds(ctx) ([]dbq.ListAssessmentKindsRow, error)`: 행 필드 `ID int16, Code, LabelKo, LabelFormat string, Numbered bool, MaxNumber *int16, SortOrder int16`
    - `ListColleges(ctx) ([]dbq.ListCollegesRow, error)`: 행 필드 `Name string, SortOrder int16`
  - refdata 상수: `CommentMaxLength=50`, `NicknameMaxLength=10`, `VotingRequestNoteMaxLength=100`, `Anonymous="(익명)"`
  - refdata 변수: `UploadContentTypes`
  - refdata 타입: `Kind{ID int64; Code, Label, LabelFormat string; Numbered bool; MaxNumber *int; SortOrder int}`, `College{Name string; SortOrder int}`, `Semester{Value int; Label string}`, `Config{Kinds []Kind; Colleges []College; Semesters []Semester; UploadMaxBytes int64}`, `Querier` 인터페이스
  - 함수: `refdata.New(Querier, int64) *Service`, `(*Service).Config(ctx) (Config, error)`

- [ ] **Step 1: tool 의존성 추가** (sqlc는 cgo 빌드라 gcc 필요, 첫 빌드 약 1분)

```bash
go get -tool github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1
go get -tool honnef.co/go/tools/cmd/staticcheck@v0.8.1
go tool sqlc version && go tool staticcheck -version
```

Expected: 두 도구 모두 버전을 출력. staticcheck가 Go 1.27을 지원하지 않는다는 오류를 내면 `@latest`로 다시 받고, 그래도 실패하면 open-items 규칙에 따라 기록하고 `make lint` 대신 `make vet`로 진행한다.

- [ ] **Step 2: sqlc 설정** — `sqlc.yaml`

```yaml
version: "2"
sql:
  - engine: postgresql
    schema: db/migrations
    queries: db/queries
    gen:
      go:
        package: dbq
        out: internal/db/dbq
        sql_package: pgx/v5
        emit_pointers_for_null_types: true
        overrides:
          - db_type: timestamptz
            go_type: time.Time
          - db_type: timestamptz
            nullable: true
            go_type:
              import: time
              type: Time
              pointer: true
```

- [ ] **Step 3: 쿼리** — `db/queries/reference.sql`

```sql
-- name: ListAssessmentKinds :many
SELECT id, code, label_ko, label_format, numbered, max_number, sort_order
FROM assessment_kinds
WHERE is_active
ORDER BY sort_order;

-- name: ListColleges :many
SELECT name, sort_order
FROM colleges
WHERE is_active
ORDER BY sort_order;
```

- [ ] **Step 4: 생성**

Run: `go tool sqlc generate && ls internal/db/dbq && go build ./...`
Expected: `db.go models.go reference.sql.go`, 빌드 성공. (2026-09-27에 이 설정과 스키마로 생성해 `ListAssessmentKindsRow{ID int16, Code, LabelKo, LabelFormat string, Numbered bool, MaxNumber *int16, SortOrder int16}`를 확인했다.)

- [ ] **Step 5: 실패하는 테스트 작성** — `internal/refdata/refdata_test.go`

```go
package refdata_test

import (
	"context"
	"testing"

	"github.com/snuarchive/snuarchive/internal/db/dbq"
	"github.com/snuarchive/snuarchive/internal/refdata"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

func TestConfig(t *testing.T) {
	pool := pgtest.New(t)
	cfg, err := refdata.New(dbq.New(pool), 3<<20).Config(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	codes := []string{}
	for _, k := range cfg.Kinds {
		codes = append(codes, k.Code)
	}
	if got := join(codes); got != "midterm,final,exam,quiz,assignment,other" {
		t.Fatalf("kinds = %s", got)
	}
	exam := cfg.Kinds[2]
	if !exam.Numbered || exam.MaxNumber == nil || *exam.MaxNumber != 6 || exam.LabelFormat != "{n}차 시험" || exam.Label != "시험" {
		t.Fatalf("exam = %+v", exam)
	}
	if cfg.Kinds[0].MaxNumber != nil || cfg.Kinds[0].Numbered {
		t.Fatalf("midterm = %+v", cfg.Kinds[0])
	}

	if len(cfg.Colleges) != 18 || cfg.Colleges[0].Name != "인문대학" || cfg.Colleges[17].Name != "대학원/기타" {
		t.Fatalf("colleges = %+v", cfg.Colleges)
	}

	labels := []string{}
	for _, s := range cfg.Semesters {
		labels = append(labels, s.Label)
	}
	if got := join(labels); got != "1학기,여름학기,2학기,겨울학기" {
		t.Fatalf("semesters = %s", got)
	}
	if cfg.UploadMaxBytes != 3<<20 {
		t.Fatalf("upload max = %d", cfg.UploadMaxBytes)
	}
}

func join(items []string) string {
	out := ""
	for i, s := range items {
		if i > 0 {
			out += ","
		}
		out += s
	}
	return out
}
```

- [ ] **Step 6: 실패 확인**

Run: `go test ./internal/refdata/`
Expected: FAIL (undefined: refdata.New)

- [ ] **Step 7: 구현** — `internal/refdata/refdata.go`

```go
// Package refdata serves the reference data behind GET /config and holds the
// input limits other packages validate against.
package refdata

import (
	"context"
	"fmt"

	"github.com/snuarchive/snuarchive/internal/calendar"
	"github.com/snuarchive/snuarchive/internal/db/dbq"
)

// Input limits; each matches a CHECK constraint in the schema.
const (
	CommentMaxLength           = 50  // comments_body_ck
	NicknameMaxLength          = 10  // stat_reports_nickname_ck, pending_reports_nickname_ck
	VotingRequestNoteMaxLength = 100 // voting_requests_note_ck
	Anonymous                  = "(익명)"
)

// UploadContentTypes lists what an upload may be, by detected content
// (pending_reports_mime_ck).
var UploadContentTypes = []string{"application/pdf", "image/png", "image/jpeg", "image/webp"}

type Kind struct {
	ID          int64
	Code        string
	Label       string
	LabelFormat string
	Numbered    bool
	MaxNumber   *int
	SortOrder   int
}

type College struct {
	Name      string
	SortOrder int
}

type Semester struct {
	Value int
	Label string
}

type Config struct {
	Kinds          []Kind
	Colleges       []College
	Semesters      []Semester
	UploadMaxBytes int64
}

// Querier is the part of dbq.Queries this package uses.
type Querier interface {
	ListAssessmentKinds(ctx context.Context) ([]dbq.ListAssessmentKindsRow, error)
	ListColleges(ctx context.Context) ([]dbq.ListCollegesRow, error)
}

type Service struct {
	q              Querier
	uploadMaxBytes int64
}

func New(q Querier, uploadMaxBytes int64) *Service {
	return &Service{q: q, uploadMaxBytes: uploadMaxBytes}
}

func (s *Service) Config(ctx context.Context) (Config, error) {
	kindRows, err := s.q.ListAssessmentKinds(ctx)
	if err != nil {
		return Config{}, fmt.Errorf("refdata: kinds: %w", err)
	}
	collegeRows, err := s.q.ListColleges(ctx)
	if err != nil {
		return Config{}, fmt.Errorf("refdata: colleges: %w", err)
	}

	cfg := Config{UploadMaxBytes: s.uploadMaxBytes}
	for _, r := range kindRows {
		k := Kind{
			ID:          int64(r.ID),
			Code:        r.Code,
			Label:       r.LabelKo,
			LabelFormat: r.LabelFormat,
			Numbered:    r.Numbered,
			SortOrder:   int(r.SortOrder),
		}
		if r.MaxNumber != nil {
			n := int(*r.MaxNumber)
			k.MaxNumber = &n
		}
		cfg.Kinds = append(cfg.Kinds, k)
	}
	for _, r := range collegeRows {
		cfg.Colleges = append(cfg.Colleges, College{Name: r.Name, SortOrder: int(r.SortOrder)})
	}
	for _, v := range calendar.Semesters() {
		label, err := calendar.SemesterLabel(v)
		if err != nil {
			return Config{}, err
		}
		cfg.Semesters = append(cfg.Semesters, Semester{Value: v, Label: label})
	}
	return cfg, nil
}
```

- [ ] **Step 8: 통과 확인**

Run: `go test ./internal/refdata/ && go tool sqlc diff && make vet`
Expected: `ok`, sqlc diff 출력 없음, vet 통과.

- [ ] **Step 9: 커밋**

```bash
git add go.mod go.sum sqlc.yaml db/queries internal/db/dbq internal/refdata
git commit -m "Add sqlc setup and refdata service for GET /config"
```

---

### Task 9: httpapi 핵심 (응답, 미들웨어, 라우터)

**Files:**
- Create: `internal/httpapi/respond.go`, `internal/httpapi/middleware.go`, `internal/httpapi/router.go`, `internal/httpapi/core_test.go`

**Interfaces:**
- Consumes: `apperr`, `config.Config`(AppOrigin, TrustedProxies)
- Produces (패키지 내부, Task 10이 사용):
  - `writeJSON(w, status int, v any)`, `writeError(w, r, *slog.Logger, error)`, `decodeJSON(r, v any) error`
  - 미들웨어: `withRequestID`, `withClientIP([]netip.Prefix)`, `withAccessLog(*slog.Logger)`, `withRecover(*slog.Logger)`
  - `type router`: `newRouter(Deps) *router`, `(*router).handle(method, path string, h http.Handler, opts ...routeOption)`, 필드 `mux *http.ServeMux`, `routes []Route`
  - 라우트 옵션: `bodyLimit(int64)`, `originOnly()`, `noCSRF()`
- Produces (공개):
  - `RequestID(ctx) string`, `ClientIP(ctx) netip.Addr`
  - 상수: `CSRFCookie = "snu_csrf"`, `CSRFHeader = "X-CSRF-Token"`
  - `type Route struct{ Method, Path string }`
  - `type Deps`는 Task 10에서 `server.go`에 정의한다. 이 태스크의 테스트는 `Deps{Config, Logger}`만 쓰고, Task 9에서는 `server.go`에 아래 최소 정의를 먼저 둔다.

```go
// internal/httpapi/server.go (Task 9 최소본; Task 10에서 확장)
package httpapi

import (
	"context"
	"log/slog"

	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/refdata"
)

type Pinger interface{ Ping(ctx context.Context) error }

type ConfigSource interface {
	Config(ctx context.Context) (refdata.Config, error)
}

type Deps struct {
	Config  *config.Config
	Logger  *slog.Logger
	DB      Pinger
	RefData ConfigSource
}

type Route struct {
	Method string
	Path   string
}
```

- [ ] **Step 1: 실패하는 테스트 작성** — `internal/httpapi/core_test.go`

```go
package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"regexp"
	"strings"
	"testing"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/config"
)

const origin = "https://archive.example.com"

func testRouter() *router {
	return newRouter(Deps{
		Config: &config.Config{AppOrigin: origin},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

// serve runs the router behind the same outer middleware New uses.
func serve(rt *router, req *http.Request) *httptest.ResponseRecorder {
	log := rt.deps.Logger
	h := withRequestID(withClientIP(nil)(withAccessLog(log)(withRecover(log)(rt.mux))))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct {
			Code      string         `json:"code"`
			Message   string         `json:"message"`
			RequestID string         `json:"requestId"`
			Details   map[string]any `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	if body.Error.Message == "" || body.Error.RequestID == "" {
		t.Fatalf("error body missing message or requestId: %s", rec.Body.String())
	}
	return body.Error.Code
}

func ok(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }

func TestRequestID(t *testing.T) {
	rt := testRouter()
	rt.handle(http.MethodGet, "/x", http.HandlerFunc(ok))

	rec := serve(rt, httptest.NewRequest(http.MethodGet, "/x", nil))
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(rec.Header().Get("X-Request-ID")) {
		t.Fatalf("generated id = %q", rec.Header().Get("X-Request-ID"))
	}

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("X-Request-ID", "abc-123")
	if got := serve(rt, req).Header().Get("X-Request-ID"); got != "abc-123" {
		t.Fatalf("kept id = %q", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("X-Request-ID", "has spaces <script>")
	if got := serve(rt, req).Header().Get("X-Request-ID"); got == "has spaces <script>" {
		t.Fatal("invalid incoming id must be replaced")
	}
}

func TestResolveClientIP(t *testing.T) {
	proxies := []netip.Prefix{netip.MustParsePrefix("172.30.0.0/24")}
	cases := []struct {
		name, remote, xff string
		trusted           []netip.Prefix
		want              string
	}{
		{"no proxies configured", "203.0.113.9:5000", "198.51.100.1", nil, "203.0.113.9"},
		{"untrusted peer cannot spoof", "203.0.113.9:5000", "198.51.100.1", proxies, "203.0.113.9"},
		{"trusted peer", "172.30.0.3:5000", "198.51.100.1", proxies, "198.51.100.1"},
		{"rightmost untrusted wins", "172.30.0.3:5000", "10.9.9.9, 198.51.100.1, 172.30.0.2", proxies, "198.51.100.1"},
		{"every hop trusted", "172.30.0.3:5000", "172.30.0.7", proxies, "172.30.0.7"},
		{"malformed hop", "172.30.0.3:5000", "nonsense", proxies, "172.30.0.3"},
		{"no header", "172.30.0.3:5000", "", proxies, "172.30.0.3"},
		{"ipv6 peer", "[2001:db8::1]:5000", "", nil, "2001:db8::1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveClientIP(tc.remote, tc.xff, tc.trusted); got.String() != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestCSRF(t *testing.T) {
	rt := testRouter()
	rt.handle(http.MethodPost, "/full", http.HandlerFunc(ok))
	rt.handle(http.MethodPost, "/origin-only", http.HandlerFunc(ok), originOnly())
	rt.handle(http.MethodPost, "/exempt", http.HandlerFunc(ok), noCSRF())
	rt.handle(http.MethodGet, "/read", http.HandlerFunc(ok))

	req := func(method, path, originHdr, cookie, token string) *http.Request {
		r := httptest.NewRequest(method, path, nil)
		if originHdr != "" {
			r.Header.Set("Origin", originHdr)
		}
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: CSRFCookie, Value: cookie})
		}
		if token != "" {
			r.Header.Set(CSRFHeader, token)
		}
		return r
	}
	cases := []struct {
		name string
		r    *http.Request
		want int
	}{
		{"missing origin", req("POST", "/full", "", "t", "t"), http.StatusForbidden},
		{"foreign origin", req("POST", "/full", "https://evil.example", "t", "t"), http.StatusForbidden},
		{"no cookie", req("POST", "/full", origin, "", "t"), http.StatusForbidden},
		{"token mismatch", req("POST", "/full", origin, "t", "u"), http.StatusForbidden},
		{"token match", req("POST", "/full", origin, "t", "t"), http.StatusNoContent},
		{"origin only without token", req("POST", "/origin-only", origin, "", ""), http.StatusNoContent},
		{"origin only foreign", req("POST", "/origin-only", "https://evil.example", "", ""), http.StatusForbidden},
		{"exempt", req("POST", "/exempt", "", "", ""), http.StatusNoContent},
		{"safe method unchecked", req("GET", "/read", "", "", ""), http.StatusNoContent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := serve(rt, tc.r)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
			if tc.want == http.StatusForbidden && errorCode(t, rec) != string(apperr.CSRFInvalid) {
				t.Fatalf("code = %s", rec.Body.String())
			}
		})
	}
}

func TestBodyLimitAndDecode(t *testing.T) {
	rt := testRouter()
	decode := func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Name string `json:"name"`
		}
		if err := decodeJSON(r, &v); err != nil {
			writeError(w, r, rt.deps.Logger, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
	rt.handle(http.MethodPost, "/small", http.HandlerFunc(decode), noCSRF(), bodyLimit(16))
	rt.handle(http.MethodPost, "/json", http.HandlerFunc(decode), noCSRF())

	post := func(path, body string) *httptest.ResponseRecorder {
		return serve(rt, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
	}
	if rec := post("/small", `{"name":"this is far too long"}`); rec.Code != 400 || errorCode(t, rec) != "MALFORMED_REQUEST" {
		t.Fatalf("over limit: %d %s", rec.Code, rec.Body.String())
	}
	if rec := post("/json", `{"name":"a","extra":1}`); rec.Code != 400 {
		t.Fatalf("unknown field: %d", rec.Code)
	}
	if rec := post("/json", `{"name":"a"}{"name":"b"}`); rec.Code != 400 {
		t.Fatalf("two objects: %d", rec.Code)
	}
	if rec := post("/json", `{"name":"a"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("valid: %d %s", rec.Code, rec.Body.String())
	}
}

func TestDefaultBodyLimitIs64KiB(t *testing.T) {
	rt := testRouter()
	rt.handle(http.MethodPost, "/json", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.ReadAll(r.Body)
		if err != nil {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}), noCSRF())
	big := strings.Repeat("a", 64<<10+1)
	if rec := serve(rt, httptest.NewRequest(http.MethodPost, "/json", strings.NewReader(big))); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestRecover(t *testing.T) {
	rt := testRouter()
	rt.handle(http.MethodGet, "/boom", http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	rec := serve(rt, httptest.NewRequest(http.MethodGet, "/boom", nil))
	if rec.Code != 500 || errorCode(t, rec) != "INTERNAL" {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}

func TestNotFoundAndMethodNotAllowed(t *testing.T) {
	rt := testRouter()
	rt.handle(http.MethodGet, "/api/v1/thing", http.HandlerFunc(ok))

	rec := serve(rt, httptest.NewRequest(http.MethodGet, "/api/v1/nope", nil))
	if rec.Code != 404 || errorCode(t, rec) != "NOT_FOUND" {
		t.Fatalf("404: %d %s", rec.Code, rec.Body.String())
	}
	rec = serve(rt, httptest.NewRequest(http.MethodDelete, "/api/v1/thing", nil))
	if rec.Code != 405 || errorCode(t, rec) != "METHOD_NOT_ALLOWED" {
		t.Fatalf("405: %d %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("Allow = %q", got)
	}
	if rec := serve(rt, httptest.NewRequest(http.MethodHead, "/api/v1/thing", nil)); rec.Code != http.StatusNoContent {
		t.Fatalf("HEAD: %d", rec.Code)
	}
}

func TestWriteErrorHidesUnknownErrors(t *testing.T) {
	rt := testRouter()
	rt.handle(http.MethodGet, "/fail", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, rt.deps.Logger, io.ErrUnexpectedEOF)
	}))
	rec := serve(rt, httptest.NewRequest(http.MethodGet, "/fail", nil))
	if rec.Code != 500 || errorCode(t, rec) != "INTERNAL" || strings.Contains(rec.Body.String(), "EOF") {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}

func TestValidationErrorCarriesFields(t *testing.T) {
	rt := testRouter()
	rt.handle(http.MethodGet, "/invalid", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, rt.deps.Logger, apperr.Validation(apperr.FieldError{Field: "q3", Code: apperr.QuartilesOutOfOrder}))
	}))
	rec := serve(rt, httptest.NewRequest(http.MethodGet, "/invalid", nil))
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), `"fields":[{"field":"q3","code":"QUARTILES_OUT_OF_ORDER"}]`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}
```

- [ ] **Step 2: 실패 확인**

Run: `go test -short ./internal/httpapi/`
Expected: FAIL (undefined: newRouter 등)

- [ ] **Step 3: 응답 헬퍼** — `internal/httpapi/respond.go`

```go
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"maps"
	"net/http"

	"github.com/snuarchive/snuarchive/internal/apperr"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type errorBody struct {
	Error errorPayload `json:"error"`
}

type errorPayload struct {
	Code      apperr.Code    `json:"code"`
	Message   string         `json:"message"`
	RequestID string         `json:"requestId,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
}

// writeError renders err as the contract's Error schema. Errors that are not
// *apperr.Error become 500 INTERNAL; their text never reaches the client.
func writeError(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	ae, ok := apperr.As(err)
	if !ok {
		log.ErrorContext(r.Context(), "unhandled error", "err", err, "request_id", RequestID(r.Context()))
		ae = apperr.New(apperr.Internal)
	} else if ae.Status() >= 500 && ae.Cause() != nil {
		log.ErrorContext(r.Context(), "server error", "code", ae.Code, "err", ae.Cause(), "request_id", RequestID(r.Context()))
	}
	details := maps.Clone(ae.Details)
	if len(ae.Fields) > 0 {
		if details == nil {
			details = map[string]any{}
		}
		details["fields"] = ae.Fields
	}
	writeJSON(w, ae.Status(), errorBody{Error: errorPayload{
		Code:      ae.Code,
		Message:   ae.Message,
		RequestID: RequestID(r.Context()),
		Details:   details,
	}})
}

// decodeJSON reads exactly one JSON object into v and rejects unknown fields.
func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return apperr.New(apperr.MalformedRequest).
				WithMessage("요청 본문이 너무 큽니다.").
				WithDetail("limit", tooBig.Limit).
				Wrap(err)
		}
		return apperr.New(apperr.MalformedRequest).Wrap(err)
	}
	if dec.More() {
		return apperr.New(apperr.MalformedRequest).WithMessage("JSON 객체 하나만 보낼 수 있습니다.")
	}
	return nil
}
```

- [ ] **Step 4: 미들웨어** — `internal/httpapi/middleware.go`

```go
package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"runtime/debug"
	"strings"
	"time"

	"github.com/snuarchive/snuarchive/internal/apperr"
)

const (
	CSRFCookie = "snu_csrf"
	CSRFHeader = "X-CSRF-Token"
)

type ctxKey int

const (
	requestIDKey ctxKey = iota
	clientIPKey
)

// RequestID returns the request's ID, or "" outside a request.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// ClientIP returns the resolved client address (see withClientIP).
func ClientIP(ctx context.Context) netip.Addr {
	ip, _ := ctx.Value(clientIPKey).(netip.Addr)
	return ip
}

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if !validRequestID.MatchString(id) {
			var b [16]byte
			_, _ = rand.Read(b[:])
			id = hex.EncodeToString(b[:])
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

// withClientIP honours X-Forwarded-For only when the direct peer is a trusted
// proxy. The chain is walked right to left and the first untrusted hop wins,
// so a client cannot spoof its address by sending the header itself.
func withClientIP(trusted []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := resolveClientIP(r.RemoteAddr, r.Header.Get("X-Forwarded-For"), trusted)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientIPKey, ip)))
		})
	}
}

func resolveClientIP(remoteAddr, xff string, trusted []netip.Prefix) netip.Addr {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	peer = peer.Unmap()
	if !isTrusted(peer, trusted) || strings.TrimSpace(xff) == "" {
		return peer
	}
	hops := strings.Split(xff, ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			return peer
		}
		hop = hop.Unmap()
		if !isTrusted(hop, trusted) {
			return hop
		}
		peer = hop
	}
	return peer
}

func isTrusted(ip netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += n
	return n, err
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func withAccessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w}
			next.ServeHTTP(rec, r)
			level := slog.LevelInfo
			if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
				level = slog.LevelDebug
			}
			log.Log(r.Context(), level, "request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"bytes", rec.bytes,
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", RequestID(r.Context()),
				"client_ip", ClientIP(r.Context()).String(),
			)
		})
	}
}

func withRecover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if v == http.ErrAbortHandler {
					panic(v)
				}
				log.ErrorContext(r.Context(), "panic", "value", v, "stack", string(debug.Stack()),
					"request_id", RequestID(r.Context()))
				writeError(w, r, log, apperr.New(apperr.Internal))
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func limitBody(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil && r.Body != http.NoBody {
				r.Body = http.MaxBytesReader(w, r.Body, n)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireCSRF checks unsafe requests: the Origin header must be the app's
// origin and, when checkToken is set, the X-CSRF-Token header must equal the
// snu_csrf cookie (double submit).
func requireCSRF(origin string, checkToken bool, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if origin == "" || r.Header.Get("Origin") != origin {
				writeError(w, r, log, apperr.New(apperr.CSRFInvalid))
				return
			}
			if checkToken {
				c, err := r.Cookie(CSRFCookie)
				token := r.Header.Get(CSRFHeader)
				if err != nil || c.Value == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(token)) != 1 {
					writeError(w, r, log, apperr.New(apperr.CSRFInvalid))
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

- [ ] **Step 5: 라우터** — `internal/httpapi/router.go`

```go
package httpapi

import (
	"net/http"
	"slices"
	"strings"

	"github.com/snuarchive/snuarchive/internal/apperr"
)

const defaultBodyLimit = 64 << 10

type csrfMode int

const (
	csrfFull csrfMode = iota
	csrfOriginOnly
	csrfNone
)

type routeConfig struct {
	bodyLimit int64
	csrf      csrfMode
}

type routeOption func(*routeConfig)

// bodyLimit overrides the 64 KiB default for one route (uploads).
func bodyLimit(n int64) routeOption { return func(c *routeConfig) { c.bodyLimit = n } }

// originOnly skips the token check for routes used before a session exists
// (dev login); the Origin check still applies.
func originOnly() routeOption { return func(c *routeConfig) { c.csrf = csrfOriginOnly } }

// noCSRF is for routes authenticated another way (the cron bearer secret).
func noCSRF() routeOption { return func(c *routeConfig) { c.csrf = csrfNone } }

type router struct {
	mux     *http.ServeMux
	deps    Deps
	routes  []Route
	allowed map[string][]string
}

func newRouter(d Deps) *router {
	rt := &router{mux: http.NewServeMux(), deps: d, allowed: map[string][]string{}}
	rt.mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, d.Logger, apperr.New(apperr.NotFound))
	}))
	return rt
}

func isSafe(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

// handle registers method+path. The first registration of a path also adds a
// method-less pattern for it, which the mux picks for any other method, so
// 405 responses use the JSON error envelope.
func (rt *router) handle(method, path string, h http.Handler, opts ...routeOption) {
	cfg := routeConfig{bodyLimit: defaultBodyLimit}
	for _, o := range opts {
		o(&cfg)
	}
	if !isSafe(method) && cfg.csrf != csrfNone {
		h = requireCSRF(rt.deps.Config.AppOrigin, cfg.csrf == csrfFull, rt.deps.Logger)(h)
	}
	h = limitBody(cfg.bodyLimit)(h)
	rt.mux.Handle(method+" "+path, h)
	if _, seen := rt.allowed[path]; !seen {
		rt.mux.Handle(path, rt.methodNotAllowed(path))
	}
	rt.allowed[path] = append(rt.allowed[path], method)
	rt.routes = append(rt.routes, Route{Method: method, Path: path})
}

func (rt *router) methodNotAllowed(path string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods := slices.Clone(rt.allowed[path])
		if slices.Contains(methods, http.MethodGet) && !slices.Contains(methods, http.MethodHead) {
			methods = append(methods, http.MethodHead)
		}
		slices.Sort(methods)
		w.Header().Set("Allow", strings.Join(methods, ", "))
		writeError(w, r, rt.deps.Logger, apperr.New(apperr.MethodNotAllowed))
	})
}
```

- [ ] **Step 6: 통과 확인**

Run: `go test -short ./internal/httpapi/ && go vet ./...`
Expected: `ok`

- [ ] **Step 7: 커밋**

```bash
git add internal/httpapi
git commit -m "Add httpapi core: error envelope, request ID, client IP, CSRF, body limits, JSON 404/405"
```

---

### Task 10: 서버 조립, /config·헬스체크, 계약 테스트

**Files:**
- Modify: `internal/httpapi/server.go` (Task 9 최소본 확장), `docs/api/openapi.yaml`
- Create: `internal/httpapi/handlers.go`, `internal/testutil/contract/contract.go`, `internal/httpapi/main_test.go`, `internal/httpapi/contract_test.go`

**Interfaces:**
- Consumes: Task 8 `refdata`, Task 9 `router`, `writeJSON`, `writeError`, 미들웨어
- Produces:
  - `httpapi.New(Deps) *Server`, `(*Server).ServeHTTP`, `(*Server).Routes() []Route`
  - `contract.Load(testing.TB) *contract.Spec`
  - `(*Spec).Do(t, http.Handler, method, path string, body []byte, header http.Header) *httptest.ResponseRecorder`
  - `(*Spec).CheckSchema(t, name string, body []byte)`
  - `(*Spec).HasOperation(method, path string) bool`
  - `(*Spec).Enum(t, schema string, property ...string) []string`

- [ ] **Step 1: 계약에 METHOD_NOT_ALLOWED와 헬스체크 설명 추가** — `docs/api/openapi.yaml`

`components.schemas.ErrorCode.enum`에서 `- NOT_FOUND` 다음 줄에 추가:

```yaml
        - METHOD_NOT_ALLOWED
```

`info.description`의 `**Errors.**` 문단 끝에 다음 문장을 붙인다(같은 들여쓰기):

```yaml
    A method the path does not support returns `405 METHOD_NOT_ALLOWED` with
    an `Allow` header. `GET /healthz` and `GET /readyz` exist outside
    `/api/v1` for container health checks and are not part of this contract.
```

Run: `npx --yes @redocly/cli@latest lint docs/api/openapi.yaml --format=stylish 2>&1 | tail -3`
Expected: `Your API description is valid.` (경고 6건 유지)

- [ ] **Step 2: 의존성 추가**

```bash
go get github.com/getkin/kin-openapi@v0.149.0 go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp@v0.71.0
```

- [ ] **Step 3: 계약 헬퍼** — `internal/testutil/contract/contract.go`

```go
// Package contract validates HTTP exchanges against docs/api/openapi.yaml.
package contract

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

const apiPrefix = "/api/v1"

type Spec struct {
	doc    *openapi3.T
	router routers.Router
}

var (
	once    sync.Once
	loaded  *Spec
	loadErr error
)

// Load parses and validates the contract once per test binary.
func Load(t testing.TB) *Spec {
	t.Helper()
	once.Do(func() { loaded, loadErr = load() })
	if loadErr != nil {
		t.Fatalf("contract: %v", loadErr)
	}
	return loaded
}

func load() (*Spec, error) {
	path, err := specPath()
	if err != nil {
		return nil, err
	}
	doc, err := openapi3.NewLoader().LoadFromFile(path)
	if err != nil {
		return nil, fmt.Errorf("load %s: %w", path, err)
	}
	if err := doc.Validate(context.Background(), openapi3.IsOpenAPI31OrLater()); err != nil {
		return nil, fmt.Errorf("validate %s: %w", path, err)
	}
	r, err := gorillamux.NewRouter(doc)
	if err != nil {
		return nil, err
	}
	return &Spec{doc: doc, router: r}, nil
}

// specPath finds docs/api/openapi.yaml by walking up to the module root.
func specPath() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return filepath.Join(dir, "docs", "api", "openapi.yaml"), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("go.mod not found above the working directory")
		}
		dir = parent
	}
}

// Do validates the request against the contract, sends it to h, validates
// the response (status included), and returns it.
func (s *Spec) Do(t testing.TB, h http.Handler, method, path string, body []byte, header http.Header) *httptest.ResponseRecorder {
	t.Helper()
	ctx := context.Background()

	vreq := httptest.NewRequest(method, "http://localhost"+path, bytes.NewReader(body))
	maps.Copy(vreq.Header, header)
	route, params, err := s.router.FindRoute(vreq)
	if err != nil {
		t.Fatalf("contract: %s %s is not in the contract: %v", method, path, err)
	}
	in := &openapi3filter.RequestValidationInput{
		Request: vreq, PathParams: params, Route: route,
		Options: &openapi3filter.Options{
			AuthenticationFunc:    openapi3filter.NoopAuthenticationFunc,
			IncludeResponseStatus: true,
		},
	}
	if err := openapi3filter.ValidateRequest(ctx, in); err != nil {
		t.Fatalf("contract: request %s %s: %v", method, path, err)
	}

	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	maps.Copy(req.Header, header)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	out := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: in,
		Status:                 rec.Code,
		Header:                 rec.Header(),
		Body:                   io.NopCloser(bytes.NewReader(rec.Body.Bytes())),
	}
	if err := openapi3filter.ValidateResponse(ctx, out); err != nil {
		t.Fatalf("contract: response %s %s (%d): %v\nbody: %s", method, path, rec.Code, err, rec.Body.String())
	}
	return rec
}

// CheckSchema validates a JSON document against a named component schema,
// for responses no operation describes (unknown routes, 405).
func (s *Spec) CheckSchema(t testing.TB, name string, body []byte) {
	t.Helper()
	ref, ok := s.doc.Components.Schemas[name]
	if !ok {
		t.Fatalf("contract: no schema %q", name)
	}
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("contract: body is not JSON: %v\n%s", err, body)
	}
	if err := ref.Value.VisitJSON(v, openapi3.EnableJSONSchema2020()); err != nil {
		t.Fatalf("contract: body does not match %s: %v\n%s", name, err, body)
	}
}

// HasOperation reports whether the contract defines method on a server path
// such as /api/v1/courses/{courseId}.
func (s *Spec) HasOperation(method, path string) bool {
	rel, ok := strings.CutPrefix(path, apiPrefix)
	if !ok {
		return false
	}
	item := s.doc.Paths.Value(rel)
	return item != nil && item.GetOperation(method) != nil
}

// Enum returns the sorted enum of a component schema, or of a property path within it.
func (s *Spec) Enum(t testing.TB, schema string, property ...string) []string {
	t.Helper()
	ref, ok := s.doc.Components.Schemas[schema]
	if !ok {
		t.Fatalf("contract: no schema %q", schema)
	}
	v := ref.Value
	for _, p := range property {
		prop, ok := v.Properties[p]
		if !ok {
			t.Fatalf("contract: %s has no property %q", schema, p)
		}
		v = prop.Value
	}
	out := make([]string, 0, len(v.Enum))
	for _, e := range v.Enum {
		out = append(out, fmt.Sprint(e))
	}
	slices.Sort(out)
	return out
}
```

- [ ] **Step 4: 서버 확장** — `internal/httpapi/server.go` 전체를 다음으로 교체

```go
// Package httpapi is the HTTP surface: routing, middleware, and translation
// between domain results and the contract in docs/api/openapi.yaml.
package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"slices"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/refdata"
)

const apiPrefix = "/api/v1"

type Pinger interface{ Ping(ctx context.Context) error }

type ConfigSource interface {
	Config(ctx context.Context) (refdata.Config, error)
}

type Deps struct {
	Config  *config.Config
	Logger  *slog.Logger
	DB      Pinger
	RefData ConfigSource
}

type Route struct {
	Method string
	Path   string
}

type Server struct {
	handler http.Handler
	routes  []Route
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.handler.ServeHTTP(w, r) }

// Routes lists every registered method and path, for contract checks.
func (s *Server) Routes() []Route { return slices.Clone(s.routes) }

func New(d Deps) *Server {
	rt := newRouter(d)
	rt.handle(http.MethodGet, "/healthz", http.HandlerFunc(healthz))
	rt.handle(http.MethodGet, "/readyz", readyz(d.DB))
	rt.handle(http.MethodGet, apiPrefix+"/config", getConfig(d))

	var h http.Handler = rt.mux
	h = withRecover(d.Logger)(h)
	h = withAccessLog(d.Logger)(h)
	h = withClientIP(d.Config.TrustedProxies)(h)
	h = withRequestID(h)
	if d.Config.OTelEnabled {
		h = otelhttp.NewHandler(h, "snuarchive")
	}
	return &Server{handler: h, routes: rt.routes}
}
```

- [ ] **Step 5: 핸들러** — `internal/httpapi/handlers.go`

```go
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/snuarchive/snuarchive/internal/refdata"
)

func healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func readyz(db Pinger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

type assessmentKindJSON struct {
	ID          int64  `json:"id"`
	Code        string `json:"code"`
	Label       string `json:"label"`
	Numbered    bool   `json:"numbered"`
	MaxNumber   *int   `json:"maxNumber"`
	LabelFormat string `json:"labelFormat"`
	SortOrder   int    `json:"sortOrder"`
}

type collegeJSON struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
}

type semesterJSON struct {
	Value int    `json:"value"`
	Label string `json:"label"`
}

type configJSON struct {
	AssessmentKinds []assessmentKindJSON `json:"assessmentKinds"`
	Colleges        []collegeJSON        `json:"colleges"`
	Semesters       []semesterJSON       `json:"semesters"`
	Upload          struct {
		MaxBytes int64    `json:"maxBytes"`
		Accepts  []string `json:"accepts"`
	} `json:"upload"`
	Comment struct {
		MaxLength int `json:"maxLength"`
	} `json:"comment"`
	Nickname struct {
		MaxLength int    `json:"maxLength"`
		Anonymous string `json:"anonymous"`
	} `json:"nickname"`
	VotingRequest struct {
		NoteMaxLength int `json:"noteMaxLength"`
	} `json:"votingRequest"`
}

func toConfigJSON(c refdata.Config) configJSON {
	out := configJSON{
		AssessmentKinds: make([]assessmentKindJSON, 0, len(c.Kinds)),
		Colleges:        make([]collegeJSON, 0, len(c.Colleges)),
		Semesters:       make([]semesterJSON, 0, len(c.Semesters)),
	}
	for _, k := range c.Kinds {
		out.AssessmentKinds = append(out.AssessmentKinds, assessmentKindJSON{
			ID: k.ID, Code: k.Code, Label: k.Label, Numbered: k.Numbered,
			MaxNumber: k.MaxNumber, LabelFormat: k.LabelFormat, SortOrder: k.SortOrder,
		})
	}
	for _, col := range c.Colleges {
		out.Colleges = append(out.Colleges, collegeJSON{Name: col.Name, SortOrder: col.SortOrder})
	}
	for _, s := range c.Semesters {
		out.Semesters = append(out.Semesters, semesterJSON{Value: s.Value, Label: s.Label})
	}
	out.Upload.MaxBytes = c.UploadMaxBytes
	out.Upload.Accepts = refdata.UploadContentTypes
	out.Comment.MaxLength = refdata.CommentMaxLength
	out.Nickname.MaxLength = refdata.NicknameMaxLength
	out.Nickname.Anonymous = refdata.Anonymous
	out.VotingRequest.NoteMaxLength = refdata.VotingRequestNoteMaxLength
	return out
}

func getConfig(d Deps) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cfg, err := d.RefData.Config(r.Context())
		if err != nil {
			writeError(w, r, d.Logger, err)
			return
		}
		// changes only with a migration
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, toConfigJSON(cfg))
	})
}
```

- [ ] **Step 6: 실패하는 테스트 작성** — `internal/httpapi/main_test.go`와 `internal/httpapi/contract_test.go`

```go
// internal/httpapi/main_test.go
package httpapi_test

import (
	"testing"

	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }
```

```go
// internal/httpapi/contract_test.go
package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/db/dbq"
	"github.com/snuarchive/snuarchive/internal/httpapi"
	"github.com/snuarchive/snuarchive/internal/refdata"
	"github.com/snuarchive/snuarchive/internal/testutil/contract"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func newServer(t *testing.T) *httpapi.Server {
	t.Helper()
	pool := pgtest.New(t)
	cfg := &config.Config{AppOrigin: "http://localhost", Upload: config.Upload{MaxBytes: config.MaxUploadBytes}}
	return httpapi.New(httpapi.Deps{
		Config:  cfg,
		Logger:  slog.New(slog.DiscardHandler),
		DB:      pool,
		RefData: refdata.New(dbq.New(pool), cfg.Upload.MaxBytes),
	})
}

func TestGetConfigMatchesContract(t *testing.T) {
	spec := contract.Load(t)
	rec := spec.Do(t, newServer(t), http.MethodGet, "/api/v1/config", nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		AssessmentKinds []struct {
			Code string `json:"code"`
		} `json:"assessmentKinds"`
		Semesters []struct {
			Value int    `json:"value"`
			Label string `json:"label"`
		} `json:"semesters"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.AssessmentKinds) != 6 || body.Semesters[1].Value != 2 || body.Semesters[1].Label != "여름학기" {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") == "" {
		t.Fatal("config should be cacheable")
	}
}

func TestErrorEnvelopesMatchContract(t *testing.T) {
	spec := contract.Load(t)
	srv := newServer(t)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/does-not-exist", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("404: %d", rec.Code)
	}
	spec.CheckSchema(t, "Error", rec.Body.Bytes())

	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/v1/config", nil))
	if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != "GET, HEAD" {
		t.Fatalf("405: %d Allow=%q", rec.Code, rec.Header().Get("Allow"))
	}
	spec.CheckSchema(t, "Error", rec.Body.Bytes())
}

func TestEveryAPIRouteIsInTheContract(t *testing.T) {
	spec := contract.Load(t)
	srv := httpapi.New(httpapi.Deps{Config: &config.Config{}, Logger: slog.New(slog.DiscardHandler)})
	for _, r := range srv.Routes() {
		if r.Path == "/healthz" || r.Path == "/readyz" {
			continue
		}
		if !spec.HasOperation(r.Method, r.Path) {
			t.Errorf("%s %s is served but not in docs/api/openapi.yaml", r.Method, r.Path)
		}
	}
}

func TestErrorCodesMatchContract(t *testing.T) {
	spec := contract.Load(t)
	var codes []string
	for _, c := range apperr.AllCodes() {
		codes = append(codes, string(c))
	}
	slices.Sort(codes)
	if want := spec.Enum(t, "ErrorCode"); !slices.Equal(codes, want) {
		t.Fatalf("apperr codes %v\ncontract       %v", codes, want)
	}
	var fields []string
	for _, c := range apperr.AllFieldCodes() {
		fields = append(fields, string(c))
	}
	slices.Sort(fields)
	if want := spec.Enum(t, "FieldError", "code"); !slices.Equal(fields, want) {
		t.Fatalf("apperr field codes %v\ncontract             %v", fields, want)
	}
}

type failingPinger struct{}

func (failingPinger) Ping(context.Context) error { return errors.New("down") }

func TestHealthEndpoints(t *testing.T) {
	srv := newServer(t)
	for _, path := range []string{"/healthz", "/readyz"} {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d", path, rec.Code)
		}
	}
	down := httpapi.New(httpapi.Deps{Config: &config.Config{}, Logger: slog.New(slog.DiscardHandler), DB: failingPinger{}})
	rec := httptest.NewRecorder()
	down.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz with a dead database: %d", rec.Code)
	}
}
```

- [ ] **Step 7: 통과 확인**

Run: `go mod tidy && go test ./internal/httpapi/ -v -run 'Contract|Route|Codes|Health|Envelope' && go test -short ./... && make vet`
Expected: 전부 PASS. 계약 검증이 실패하면 **계약을 고치지 말고** 서버 응답을 계약에 맞춘다. 계약 자체가 틀렸다고 판단되면 open-items 규칙을 따른다(단, Step 1의 METHOD_NOT_ALLOWED 추가는 확정된 변경).

- [ ] **Step 8: 커밋**

```bash
git add go.mod go.sum docs/api/openapi.yaml internal/httpapi internal/testutil/contract
git commit -m "Serve GET /api/v1/config and health checks, with contract tests against openapi.yaml"
```

---

### Task 11: CLI (`serve`, `migrate`, `version`)

**Files:**
- Create: `cmd/snuarchive/main.go`, `cmd/snuarchive/main_test.go`

**Interfaces:**
- Consumes: `config.Load`, `telemetry.Setup`, `db.Open`, `db.NewMigrator`, `dbq.New`, `refdata.New`, `httpapi.New`, `pgtest.Main/NewDatabase/NewEmptyDatabase`
- Produces: `run(ctx, args []string, lookup config.LookupFunc, stdout, stderr io.Writer) int` (패키지 main, 테스트용), 바이너리 `snuarchive`, 빌드 변수 `main.version`

- [ ] **Step 1: 실패하는 테스트 작성** — `cmd/snuarchive/main_test.go`

```go
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

func env(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func runCLI(ctx context.Context, lookup func(string) (string, bool), args ...string) (int, string, string) {
	var out, errOut bytes.Buffer
	code := run(ctx, args, lookup, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestUsage(t *testing.T) {
	if code, _, stderr := runCLI(context.Background(), env(nil)); code != 2 || !strings.Contains(stderr, "usage:") {
		t.Fatalf("no args: %d %q", code, stderr)
	}
	if code, _, stderr := runCLI(context.Background(), env(nil), "frobnicate"); code != 2 || !strings.Contains(stderr, `unknown command "frobnicate"`) {
		t.Fatalf("unknown: %d %q", code, stderr)
	}
	if code, stdout, _ := runCLI(context.Background(), env(nil), "version"); code != 0 || strings.TrimSpace(stdout) != version {
		t.Fatalf("version: %d %q", code, stdout)
	}
}

func TestMigrateNeedsDatabaseURL(t *testing.T) {
	code, _, stderr := runCLI(context.Background(), env(nil), "migrate", "up")
	if code != 1 || !strings.Contains(stderr, "DATABASE_URL is required") {
		t.Fatalf("%d %q", code, stderr)
	}
}

func TestMigrateUpStatusDown(t *testing.T) {
	ctx := context.Background()
	lookup := env(map[string]string{"DATABASE_URL": pgtest.NewEmptyDatabase(t)})

	code, stdout, stderr := runCLI(ctx, lookup, "migrate", "up")
	if code != 0 || !strings.Contains(stdout, "applied") || !strings.Contains(stdout, "00001_init.sql") {
		t.Fatalf("up: %d %q %q", code, stdout, stderr)
	}
	code, stdout, _ = runCLI(ctx, lookup, "migrate", "up")
	if code != 0 || !strings.Contains(stdout, "no pending migrations") {
		t.Fatalf("second up: %d %q", code, stdout)
	}
	code, stdout, _ = runCLI(ctx, lookup, "migrate", "status")
	if code != 0 || !strings.Contains(stdout, "applied") {
		t.Fatalf("status: %d %q", code, stdout)
	}
	code, stdout, _ = runCLI(ctx, lookup, "migrate", "down")
	if code != 0 || !strings.Contains(stdout, "rolled back") {
		t.Fatalf("down: %d %q", code, stdout)
	}
	if code, _, _ := runCLI(ctx, lookup, "migrate", "sideways"); code != 2 {
		t.Fatalf("bad subcommand: %d", code)
	}
}

func TestServeRejectsBadConfig(t *testing.T) {
	code, _, stderr := runCLI(context.Background(), env(nil), "serve")
	if code != 1 || !strings.Contains(stderr, "DATABASE_URL is required") {
		t.Fatalf("%d %q", code, stderr)
	}
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()
	return addr
}

func TestServeAndShutdown(t *testing.T) {
	addr := freeAddr(t)
	lookup := env(map[string]string{
		"APP_ENV":           "development",
		"APP_ORIGIN":        "http://localhost:3000",
		"DATABASE_URL":      pgtest.NewDatabase(t),
		"SESSION_KEYS":      base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("k"), 32)),
		"DEV_LOGIN_ENABLED": "true",
		"HTTP_ADDR":         addr,
		"LOG_LEVEL":         "warn",
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan int, 1)
	go func() { code, _, _ := runCLI(ctx, lookup, "serve"); done <- code }()

	deadline := time.Now().Add(15 * time.Second)
	for {
		resp, err := http.Get("http://" + addr + "/healthz")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatalf("server did not become healthy: %v", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	resp, err := http.Get("http://" + addr + "/api/v1/config")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("config: %v %v", resp, err)
	}
	resp.Body.Close()

	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit code %d", code)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("server did not shut down")
	}
}
```

- [ ] **Step 2: 실패 확인**

Run: `go test ./cmd/snuarchive/`
Expected: FAIL (undefined: run)

- [ ] **Step 3: 구현** — `cmd/snuarchive/main.go`

```go
// Command snuarchive runs the SNU Archive API server and its maintenance tasks.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/db"
	"github.com/snuarchive/snuarchive/internal/db/dbq"
	"github.com/snuarchive/snuarchive/internal/httpapi"
	"github.com/snuarchive/snuarchive/internal/refdata"
	"github.com/snuarchive/snuarchive/internal/telemetry"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

const usage = `usage: snuarchive <command>

commands:
  serve             run the HTTP server
  migrate up        apply pending migrations
  migrate down      roll back the most recent migration
  migrate status    list migrations and whether they are applied
  version           print the build version
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, lookup config.LookupFunc, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	switch args[0] {
	case "version":
		fmt.Fprintln(stdout, version)
		return 0
	case "serve":
		return serve(ctx, lookup, stdout, stderr)
	case "migrate":
		return migrate(ctx, args[1:], lookup, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "unknown command %q\n\n%s", args[0], usage)
		return 2
	}
}

// migrate reads only DATABASE_URL so migrations can run before the rest of
// the environment exists. Point it at a direct connection, not a
// transaction-mode pooler.
func migrate(ctx context.Context, args []string, lookup config.LookupFunc, stdout, stderr io.Writer) int {
	if len(args) != 1 || (args[0] != "up" && args[0] != "down" && args[0] != "status") {
		fmt.Fprint(stderr, usage)
		return 2
	}
	url, _ := lookup("DATABASE_URL")
	if strings.TrimSpace(url) == "" {
		fmt.Fprintln(stderr, "migrate: DATABASE_URL is required")
		return 1
	}
	m, err := db.NewMigrator(url)
	if err != nil {
		fmt.Fprintln(stderr, "migrate:", err)
		return 1
	}
	defer m.Close()

	switch args[0] {
	case "up":
		results, err := m.Up(ctx)
		for _, r := range results {
			fmt.Fprintf(stdout, "applied  %s (%s)\n", r.Source.Path, r.Duration.Round(time.Millisecond))
		}
		if err != nil {
			fmt.Fprintln(stderr, "migrate up:", err)
			return 1
		}
		if len(results) == 0 {
			fmt.Fprintln(stdout, "no pending migrations")
		}
	case "down":
		r, err := m.Down(ctx)
		if err != nil {
			fmt.Fprintln(stderr, "migrate down:", err)
			return 1
		}
		fmt.Fprintf(stdout, "rolled back  %s\n", r.Source.Path)
	case "status":
		statuses, err := m.Status(ctx)
		if err != nil {
			fmt.Fprintln(stderr, "migrate status:", err)
			return 1
		}
		for _, s := range statuses {
			fmt.Fprintf(stdout, "%-8s %s\n", s.State, s.Source.Path)
		}
	}
	return 0
}

func serve(ctx context.Context, lookup config.LookupFunc, stdout, stderr io.Writer) int {
	cfg, warnings, err := config.Load(lookup)
	if err != nil {
		fmt.Fprintf(stderr, "config:\n%v\n", err)
		return 1
	}
	logger, shutdownTelemetry, err := telemetry.Setup(ctx, stdout, telemetry.Options{
		Format: cfg.Log.Format, Level: cfg.Log.Level, OTel: cfg.OTelEnabled,
		Service: "snuarchive", Version: version,
	})
	if err != nil {
		fmt.Fprintln(stderr, "telemetry:", err)
		return 1
	}
	for _, w := range warnings {
		logger.Warn("configuration", "warning", w)
	}

	pool, err := db.Open(ctx, db.Options{URL: cfg.DB.URL, MaxConns: cfg.DB.MaxConns, PoolerMode: cfg.DB.PoolerMode})
	if err != nil {
		logger.Error("database", "err", err)
		return 1
	}
	defer pool.Close()

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.New(httpapi.Deps{
			Config:  cfg,
			Logger:  logger,
			DB:      pool,
			RefData: refdata.New(dbq.New(pool), cfg.Upload.MaxBytes),
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	logger.Info("listening", "addr", cfg.HTTPAddr, "env", cfg.Env)

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server", "err", err)
			return 1
		}
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown", "err", err)
		return 1
	}
	if err := shutdownTelemetry(shutdownCtx); err != nil {
		logger.Warn("telemetry shutdown", "err", err)
	}
	logger.Info("stopped")
	return 0
}
```

- [ ] **Step 4: 통과 확인**

Run: `go test ./cmd/snuarchive/ -v && go build -o bin/snuarchive ./cmd/snuarchive && ./bin/snuarchive version`
Expected: 테스트 PASS, `dev` 출력

- [ ] **Step 5: 커밋**

```bash
git add cmd/snuarchive
git commit -m "Add snuarchive CLI: serve with graceful shutdown, migrate up/down/status, version"
```

---

### Task 12: 컨테이너 배포 (Dockerfile, compose, Caddy)

**Files:**
- Create: `deploy/Dockerfile`, `.dockerignore`, `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/.env.example`, `docs/backend/running-locally.md`

**Interfaces:**
- Consumes: 바이너리 `snuarchive`(Task 11), `/readyz`
- Produces: 이미지 `snuarchive/api:local`, compose 서비스 `db`, `migrate`, `app`, `caddy`

- [ ] **Step 1: Dockerfile** — `deploy/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY db ./db
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/snuarchive ./cmd/snuarchive

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
 && adduser -D -H -u 10001 app \
 && mkdir -p /data/uploads \
 && chown app /data/uploads
COPY --from=build /out/snuarchive /usr/local/bin/snuarchive
USER app
EXPOSE 8080
ENTRYPOINT ["snuarchive"]
CMD ["serve"]
```

- [ ] **Step 2: 빌드 컨텍스트 허용 목록** — `.dockerignore` (저장소 루트)

```
*
!go.mod
!go.sum
!cmd/
!internal/
!db/
```

- [ ] **Step 3: compose** — `deploy/compose.yaml`

```yaml
name: snuarchive

x-api-image: &api-image
  build:
    context: ..
    dockerfile: deploy/Dockerfile
  image: snuarchive/api:local

x-database-url: &database-url postgres://${POSTGRES_USER:-snuarchive}:${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in deploy/.env}@db:5432/${POSTGRES_DB:-snuarchive}?sslmode=disable

services:
  db:
    image: postgres:18
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-snuarchive}
      POSTGRES_USER: ${POSTGRES_USER:-snuarchive}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in deploy/.env}
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  migrate:
    <<: *api-image
    command: ["migrate", "up"]
    environment:
      DATABASE_URL: *database-url
    depends_on:
      db:
        condition: service_healthy
    restart: "no"

  app:
    <<: *api-image
    env_file: .env
    environment:
      DATABASE_URL: *database-url
      HTTP_ADDR: ":8080"
      STORAGE_DRIVER: fs
      STORAGE_FS_ROOT: /data/uploads
      TRUSTED_PROXIES: 172.30.0.0/24
    volumes:
      - uploads:/data/uploads
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/readyz"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  caddy:
    image: caddy:2
    environment:
      SITE_ADDRESS: ${SITE_ADDRESS:-http://localhost}
    ports:
      - "${HTTP_PORT:-80}:80"
      - "${HTTPS_PORT:-443}:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      app:
        condition: service_healthy
    restart: unless-stopped

networks:
  default:
    ipam:
      config:
        - subnet: 172.30.0.0/24

volumes:
  pgdata:
  uploads:
  caddy_data:
  caddy_config:
```

- [ ] **Step 4: Caddyfile** — `deploy/Caddyfile`

```
{$SITE_ADDRESS} {
	encode zstd gzip

	handle /api/* {
		reverse_proxy app:8080
	}

	# container health checks stay internal
	@health path /healthz /readyz
	handle @health {
		respond 404
	}

	# the React SSR server (web service) is added in the frontend phase
	handle {
		respond "SNU Archive frontend is not deployed yet" 404
	}
}
```

- [ ] **Step 5: 환경변수 예시** — `deploy/.env.example`

```sh
# Copy to deploy/.env (never commit it) and fill in.
# Every variable is described in docs/superpowers/specs/2026-09-27-go-backend-design.md, section 6.

# --- compose ---------------------------------------------------------------
# Used inside DATABASE_URL, so keep it URL-safe (letters, digits, - and _).
POSTGRES_PASSWORD=change-me
SITE_ADDRESS=http://localhost
HTTP_PORT=80
HTTPS_PORT=443

# --- app: required -----------------------------------------------------------
APP_ENV=production
APP_ORIGIN=http://localhost
# openssl rand -base64 32   (comma-separate several keys to rotate; the first signs)
SESSION_KEYS=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# --- app: optional (defaults shown) ------------------------------------------
# ADMIN_EMAILS=
# DB_MAX_CONNS=10
# SESSION_TTL=168h
# UPLOAD_MAX_BYTES=3145728
# UPLOAD_GC_AFTER=24h
# SCHEDULER_ENABLED=false
# CRON_SECRET=
# LOG_RETENTION_ENABLED=false
# LOG_RETENTION_DAYS=365
# LOG_ARCHIVE_ENABLED=false
# LOG_ARCHIVE_AFTER_DAYS=90
# LOG_ARCHIVE_FORMAT=jsonl
# LOG_ARCHIVE_INTERVAL=24h
# GDRIVE_AUTH=
# GDRIVE_FOLDER_ID=
# GDRIVE_SERVICE_ACCOUNT_JSON=
# GDRIVE_OAUTH_CLIENT_ID=
# GDRIVE_OAUTH_CLIENT_SECRET=
# GDRIVE_OAUTH_REFRESH_TOKEN=
# EXPORT_MAX_ROWS=1000000
# LOG_FORMAT=json
# LOG_LEVEL=info
# OTEL_ENABLED=false
# OTEL_SERVICE_NAME=snuarchive

# --- local development without Google ----------------------------------------
# APP_ENV=development
# DEV_LOGIN_ENABLED=true
```

- [ ] **Step 6: 로컬 실행 문서** — `docs/backend/running-locally.md`

```markdown
# 백엔드 로컬 실행

## 준비물
- Go 1.27, Docker, gcc (sqlc가 cgo로 빌드됨)
- 모듈 경로는 `github.com/snuarchive/snuarchive`(소문자). 원격 저장소 이름 `snuarchive/SNUarchive`와 대소문자가 다르지만 의도한 것이다.

## 명령
| 명령 | 하는 일 |
|---|---|
| `make generate` | `db/queries/*.sql`로 `internal/db/dbq` 재생성 (sqlc) |
| `make test` | 전체 테스트. DB 테스트는 Docker로 `postgres:18`을 띄운다 |
| `make test-short` | Docker 없이 단위 테스트만 |
| `make lint` | `go vet` + staticcheck |
| `make check` | sqlc 생성물 최신 여부 + lint + test |
| `make run` | 현재 셸 환경변수로 서버 실행 |
| `make migrate` | `DATABASE_URL`에 마이그레이션 적용 |

`make run`/`make migrate`는 환경변수를 셸에서 읽는다. 최소 개발 설정 예:

    export APP_ENV=development DEV_LOGIN_ENABLED=true APP_ORIGIN=http://localhost:5173 \
      DATABASE_URL=postgres://snuarchive:pw@localhost:5432/snuarchive?sslmode=disable \
      SESSION_KEYS=$(openssl rand -base64 32)

## docker compose
1. `cp deploy/.env.example deploy/.env` 후 값 채우기 (Google 없이 해볼 때는 파일 끝의 개발용 두 줄 사용)
2. `make compose-up`
   - `db` 정상 → `migrate` 성공 → `app` 준비(`/readyz`) → `caddy` 순으로 뜬다
3. `curl http://localhost/api/v1/config`
4. `make compose-down` (데이터까지 지우려면 `docker compose -f deploy/compose.yaml --env-file deploy/.env down -v`)

`/healthz`와 `/readyz`는 Caddy가 외부에 404로 막는다. 컨테이너 안에서만 쓴다.

## Supabase 등 트랜잭션 풀러
- 서버: `DB_POOLER_MODE=true`, `DB_MAX_CONNS`를 작게(서버리스는 2).
- 마이그레이션: 풀러가 아닌 **직접 연결 URL**로 `snuarchive migrate up`을 실행한다.
- 검증은 open-items O4.
```

- [ ] **Step 7: compose 검증** (포트 80 충돌을 피하려고 8088을 쓴다)

```bash
cat > deploy/.env <<'EOF'
POSTGRES_PASSWORD=localcheck
SITE_ADDRESS=http://localhost
HTTP_PORT=8088
HTTPS_PORT=8443
APP_ENV=development
DEV_LOGIN_ENABLED=true
APP_ORIGIN=http://localhost:8088
SESSION_KEYS=a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=
EOF
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
docker compose -f deploy/compose.yaml --env-file deploy/.env ps
curl -fsS http://localhost:8088/api/v1/config | head -c 200; echo
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8088/healthz
docker compose -f deploy/compose.yaml --env-file deploy/.env logs migrate | tail -3
docker compose -f deploy/compose.yaml --env-file deploy/.env down -v
rm deploy/.env
```

Expected:
- `ps`: db·app·caddy가 `running`(app은 `healthy`)이고 migrate는 `exited (0)`
- `/api/v1/config`: `{"assessmentKinds":[...` JSON
- `/healthz`: `404`
- migrate 로그: `applied  00001_init.sql`

`deploy/.env`가 git에 잡히지 않는지 확인한다: `git status --short deploy/`에 `.env`가 나오면 안 된다(루트 `.gitignore`의 `.env` 규칙이 적용됨).

- [ ] **Step 8: 커밋**

```bash
git add deploy/Dockerfile deploy/compose.yaml deploy/Caddyfile deploy/.env.example .dockerignore docs/backend/running-locally.md
git commit -m "Add container deployment: alpine image, compose with one-shot migrate, Caddy for /api"
```

---

### Task 13: 전체 검증과 문서 정리

**Files:**
- Modify: `docs/backend/open-items.md`, `docs/superpowers/specs/2026-09-27-go-backend-design.md` (필요 시)

- [ ] **Step 1: 전체 검사**

Run: `make check`
Expected: sqlc diff 출력 없음, vet·staticcheck 경고 없음, 모든 테스트 PASS.

Run: `go test -short ./...`
Expected: DB 테스트는 skip, 나머지 PASS.

- [ ] **Step 2: spec 대조**

spec §9의 1단계 목록과 결정 표를 하나씩 확인한다.
- go.mod, config, calendar, telemetry
- db(pool, goose, sqlc), 마이그레이션 v1 전체
- testcontainers 하네스, httpapi 골격(에러·요청ID·본문 제한·CSRF 틀)
- `serve`/`migrate`, Dockerfile, compose
- `openapi.yaml` 수정본과 계약 테스트 하네스

빠진 것이 있으면 태스크를 추가해 끝낸다.

- [ ] **Step 3: open-items 갱신**

- 이번 단계에서 새로 기록한 항목이 있으면 표에 있는지 확인한다.
- 이번 단계에서 확인이 끝난 항목이 있으면 상태를 `닫힘`으로 바꾸고 근거를 적는다.
- 1단계에서 확인된 사실을 해당 항목에 한 줄씩 덧붙인다.
  - O4: 로컬 pgx simple protocol 모드는 `TestOpenInPoolerMode`로 확인. Supabase 확인은 여전히 필요.
  - O11: 개발·테스트는 postgres:18(18.6)로 확인.

- [ ] **Step 4: 커밋**

```bash
git add docs
git commit -m "Record phase 1 verification results in open-items"
```

- [ ] **Step 5: 보고**

다음을 정리해 보고한다.
- 완료한 태스크와 커밋 목록 (`git log --oneline main..HEAD`)
- `make check` 결과
- 건너뛴 결정 항목(open-items에 새로 추가된 O 번호)과 각각이 막는 것
- 다음 단계(2단계: 인증·사용자) 착수 전에 필요한 질문
