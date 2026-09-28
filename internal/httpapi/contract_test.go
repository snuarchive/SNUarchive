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

type stubRefData struct{}

func (stubRefData) Config(context.Context) (refdata.Config, error) { return refdata.Config{}, nil }

func TestConfigReportsDevLogin(t *testing.T) {
	spec := contract.Load(t)
	cases := []struct {
		name string
		cfg  config.Config
		want bool
	}{
		{"development with dev login", config.Config{Env: config.Development, DevLoginEnabled: true}, true},
		{"development without dev login", config.Config{Env: config.Development}, false},
		{"production never", config.Config{Env: config.Production, DevLoginEnabled: true}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httpapi.New(httpapi.Deps{Config: &c.cfg, Logger: slog.New(slog.DiscardHandler), RefData: stubRefData{}})
			rec := spec.Do(t, srv, http.MethodGet, "/api/v1/config", nil, nil)
			var body struct {
				DevLoginEnabled *bool `json:"devLoginEnabled"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.DevLoginEnabled == nil || *body.DevLoginEnabled != c.want {
				t.Fatalf("devLoginEnabled = %v, want %v; body %s", body.DevLoginEnabled, c.want, rec.Body.String())
			}
		})
	}
}
