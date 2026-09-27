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
