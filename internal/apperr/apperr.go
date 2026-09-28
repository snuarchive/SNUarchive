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
	InvalidFavoriteOrder    FieldCode = "INVALID_FAVORITE_ORDER"
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
	InvalidEmail, ClosesAtInPast, WindowInverted, InvalidFavoriteOrder,
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
