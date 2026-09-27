package httpapi

import (
	"bytes"
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
	h := withRequestID(nil)(withClientIP(nil)(withAccessLog(log)(withRecover(log)(rt.mux))))
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
	trusted := []netip.Prefix{netip.MustParsePrefix("172.30.0.0/24")}

	serveWith := func(trusted []netip.Prefix, req *http.Request) *httptest.ResponseRecorder {
		h := withRequestID(trusted)(rt.mux)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	newReq := func(remoteAddr string) *http.Request {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.RemoteAddr = remoteAddr
		return req
	}

	rec := serveWith(trusted, newReq("203.0.113.9:5000"))
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(rec.Header().Get("X-Request-ID")) {
		t.Fatalf("generated id = %q", rec.Header().Get("X-Request-ID"))
	}

	// A valid incoming id from an untrusted peer is replaced.
	req := newReq("203.0.113.9:5000")
	req.Header.Set("X-Request-ID", "abc-123")
	if got := serveWith(trusted, req).Header().Get("X-Request-ID"); got == "abc-123" {
		t.Fatalf("untrusted peer's incoming id must be replaced, got %q", got)
	}

	// A valid incoming id from a trusted peer is kept.
	req = newReq("172.30.0.3:5000")
	req.Header.Set("X-Request-ID", "abc-123")
	if got := serveWith(trusted, req).Header().Get("X-Request-ID"); got != "abc-123" {
		t.Fatalf("trusted peer's valid id must be kept, got %q", got)
	}

	// An invalid incoming id from a trusted peer is still replaced.
	req = newReq("172.30.0.3:5000")
	req.Header.Set("X-Request-ID", "has spaces <script>")
	if got := serveWith(trusted, req).Header().Get("X-Request-ID"); got == "has spaces <script>" {
		t.Fatal("invalid incoming id must be replaced even from a trusted peer")
	}

	// With no trusted proxies configured, incoming ids are always replaced.
	req = newReq("172.30.0.3:5000")
	req.Header.Set("X-Request-ID", "abc-123")
	if got := serveWith(nil, req).Header().Get("X-Request-ID"); got == "abc-123" {
		t.Fatal("with no trusted proxies configured, incoming id must be replaced")
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

// A proxy may append its own X-Forwarded-For line instead of extending the
// client's; the client's forged first line must not win.
func TestClientIPUsesEveryForwardedForLine(t *testing.T) {
	proxies := []netip.Prefix{netip.MustParsePrefix("172.30.0.0/24")}
	var got netip.Addr
	h := withClientIP(proxies)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = ClientIP(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.RemoteAddr = "172.30.0.3:5000"
	req.Header.Add("X-Forwarded-For", "10.9.9.9")
	req.Header.Add("X-Forwarded-For", "198.51.100.1")
	h.ServeHTTP(httptest.NewRecorder(), req)
	if got.String() != "198.51.100.1" {
		t.Fatalf("client ip = %s, want 198.51.100.1", got)
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

// TestWriteErrorLogsServerErrorsWithoutCause covers design spec §7: every 5xx
// must be logged with its request ID, even when the *apperr.Error carries no
// wrapped cause (writeError must not rely on Cause() != nil to decide to log).
func TestWriteErrorLogsServerErrorsWithoutCause(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	rt := newRouter(Deps{
		Config: &config.Config{AppOrigin: origin},
		Logger: log,
	})
	rt.handle(http.MethodGet, "/internal", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, log, apperr.New(apperr.Internal))
	}))

	rec := serve(rt, httptest.NewRequest(http.MethodGet, "/internal", nil))
	if rec.Code != 500 {
		t.Fatalf("status = %d", rec.Code)
	}
	reqID := rec.Header().Get("X-Request-ID")
	if reqID == "" {
		t.Fatal("missing request id")
	}
	if !strings.Contains(buf.String(), "server error") || !strings.Contains(buf.String(), reqID) {
		t.Fatalf("log missing server error line or request id %q: %s", reqID, buf.String())
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

// TestMethodNotAllowedWithWildcardRoutes guards against the mux panicking when
// a literal and a wildcard path share a prefix (the contract has
// /courses/home next to /courses/{courseId}).
func TestMethodNotAllowedWithWildcardRoutes(t *testing.T) {
	rt := testRouter()
	var hit string
	rt.handle(http.MethodGet, "/x/{id}", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = "id:" + r.PathValue("id")
		w.WriteHeader(http.StatusNoContent)
	}))
	rt.handle(http.MethodGet, "/x/home", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hit = "home"
		w.WriteHeader(http.StatusNoContent)
	}))

	for path, want := range map[string]string{"/x/home": "home", "/x/7": "id:7"} {
		hit = ""
		if rec := serve(rt, httptest.NewRequest(http.MethodGet, path, nil)); rec.Code != http.StatusNoContent || hit != want {
			t.Fatalf("GET %s: %d, hit %q, want %q", path, rec.Code, hit, want)
		}
	}
	rec := serve(rt, httptest.NewRequest(http.MethodDelete, "/x/7", nil))
	if rec.Code != 405 || errorCode(t, rec) != "METHOD_NOT_ALLOWED" {
		t.Fatalf("405: %d %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("Allow = %q", got)
	}
}
