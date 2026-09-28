package optional_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/snuarchive/snuarchive/internal/optional"
)

type patch struct {
	College       optional.Field[string] `json:"college"`
	AdmissionYear optional.Field[int]    `json:"admissionYear"`
}

func decode(t *testing.T, body string) (patch, error) {
	t.Helper()
	// the same decoder settings as httpapi.decodeJSON
	dec := json.NewDecoder(strings.NewReader(body))
	dec.DisallowUnknownFields()
	var p patch
	err := dec.Decode(&p)
	return p, err
}

func TestAbsentNullAndValueDiffer(t *testing.T) {
	p, err := decode(t, `{"college": null, "admissionYear": 2021}`)
	if err != nil {
		t.Fatal(err)
	}
	if p.College != optional.Null[string]() {
		t.Errorf("college = %+v, want null", p.College)
	}
	if p.AdmissionYear != optional.Of(2021) {
		t.Errorf("admissionYear = %+v, want 2021", p.AdmissionYear)
	}

	p, err = decode(t, `{"college": "공과대학"}`)
	if err != nil {
		t.Fatal(err)
	}
	if p.College != optional.Of("공과대학") {
		t.Errorf("college = %+v", p.College)
	}
	if p.AdmissionYear.Set {
		t.Errorf("absent admissionYear must not be Set: %+v", p.AdmissionYear)
	}
}

func TestZeroValueIsNotNull(t *testing.T) {
	p, err := decode(t, `{"college": "", "admissionYear": 0}`)
	if err != nil {
		t.Fatal(err)
	}
	if p.College != optional.Of("") || p.AdmissionYear != optional.Of(0) {
		t.Fatalf("got %+v", p)
	}
}

func TestWrongTypeIsAnError(t *testing.T) {
	if _, err := decode(t, `{"admissionYear": "2021"}`); err == nil {
		t.Fatal("a string for an int field must fail")
	}
}

func TestUnknownFieldsStillRejected(t *testing.T) {
	if _, err := decode(t, `{"college": null, "extra": 1}`); err == nil {
		t.Fatal("unknown field must fail")
	}
}

func TestPtr(t *testing.T) {
	var absent optional.Field[int]
	if absent.Ptr() != nil || optional.Null[int]().Ptr() != nil {
		t.Fatal("absent and null must give nil")
	}
	if p := optional.Of(7).Ptr(); p == nil || *p != 7 {
		t.Fatalf("got %v", p)
	}
}
