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
