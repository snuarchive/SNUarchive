package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/auth"
	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/httpapi"
	"github.com/snuarchive/snuarchive/internal/testutil/contract"
	"github.com/snuarchive/snuarchive/internal/testutil/fakegoogle"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

const appOrigin = "http://localhost"

type env struct {
	srv  *httpapi.Server
	fake *fakegoogle.Server
	spec *contract.Spec
	now  time.Time
}

type envOption func(*config.Config)

func withDevLogin(c *config.Config) { c.Env, c.DevLoginEnabled = config.Development, true }

func newEnv(t *testing.T, opts ...envOption) *env {
	t.Helper()
	pool := pgtest.New(t)
	cfg := &config.Config{
		Env:       config.Production,
		AppOrigin: appOrigin,
		Session: config.Session{
			Keys: [][]byte{bytes.Repeat([]byte("k"), 32)},
			TTL:  7 * 24 * time.Hour, MaxAge: 30 * 24 * time.Hour,
		},
	}
	for _, o := range opts {
		o(cfg)
	}
	e := &env{fake: fakegoogle.New(t), spec: contract.Load(t), now: time.Now()}
	log := slog.New(slog.DiscardHandler)
	e.srv = httpapi.New(httpapi.Deps{
		Config:   cfg,
		Logger:   log,
		DB:       pool,
		Accounts: auth.NewService(pool, []string{"boss@snu.ac.kr"}, log),
		Google:   google.New(context.Background(), e.fake.Options(appOrigin+"/api/v1/auth/google/callback")),
		Now:      func() time.Time { return e.now },
	})
	return e
}

// cookies turns a response's Set-Cookie headers into a name → cookie map.
func cookies(rec *httptest.ResponseRecorder) map[string]*http.Cookie {
	out := map[string]*http.Cookie{}
	for _, c := range rec.Result().Cookies() {
		out[c.Name] = c
	}
	return out
}

func header(cs ...*http.Cookie) http.Header {
	h := http.Header{}
	for _, c := range cs {
		if c != nil {
			h.Add("Cookie", c.Name+"="+c.Value)
		}
	}
	return h
}

func unsafeHeader(session, csrf *http.Cookie) http.Header {
	h := header(session, csrf)
	h.Set("Origin", appOrigin)
	h.Set("Content-Type", "application/json")
	if csrf != nil {
		h.Set("X-CSRF-Token", csrf.Value)
	}
	return h
}

// signIn runs the whole Google flow for claims and returns the callback
// response. Claims.Nonce is filled from the authorization URL.
func (e *env) signIn(t *testing.T, next string, c fakegoogle.Claims) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/v1/auth/google"
	if next != "" {
		path += "?next=" + url.QueryEscape(next)
	}
	start := e.spec.Do(t, e.srv, http.MethodGet, path, nil, nil)
	if start.Code != http.StatusFound {
		t.Fatalf("start: %d", start.Code)
	}
	loc, _ := url.Parse(start.Header().Get("Location"))
	q := loc.Query()
	state := cookies(start)["snu_oauth"]
	if state == nil || state.Path != "/api/v1/auth/google" || !state.HttpOnly {
		t.Fatalf("state cookie = %+v", state)
	}
	c.Nonce = q.Get("nonce")
	e.fake.Grant("code-1", q.Get("code_challenge"), c)
	cb := "/api/v1/auth/google/callback?code=code-1&state=" + url.QueryEscape(q.Get("state"))
	return e.spec.Do(t, e.srv, http.MethodGet, cb, nil, header(state))
}

var kim = fakegoogle.Claims{Subject: "1001", Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr", Name: "김철수"}

func TestGoogleSignInFlow(t *testing.T) {
	e := newEnv(t)
	rec := e.signIn(t, "/courses/12?tab=stats#top", kim)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != appOrigin+"/courses/12?tab=stats&auth=ok#top" {
		t.Fatalf("callback: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	cs := cookies(rec)
	sess, csrf := cs["snu_session"], cs["snu_csrf"]
	if sess == nil || !sess.HttpOnly || sess.SameSite != http.SameSiteLaxMode || sess.Path != "/" {
		t.Fatalf("session cookie = %+v", sess)
	}
	if csrf == nil || csrf.HttpOnly || csrf.Value == "" {
		t.Fatalf("csrf cookie = %+v", csrf)
	}
	if st := cs["snu_oauth"]; st == nil || st.MaxAge >= 0 {
		t.Fatalf("state cookie must be deleted: %+v", st)
	}

	me := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf))
	var body struct {
		Email       string  `json:"email"`
		DisplayName *string `json:"displayName"`
		IsAdmin     bool    `json:"isAdmin"`
		Calendar    struct {
			Timezone string `json:"timezone"`
		} `json:"calendar"`
	}
	if err := json.Unmarshal(me.Body.Bytes(), &body); err != nil || me.Code != 200 {
		t.Fatalf("me: %d %s", me.Code, me.Body.String())
	}
	if body.Email != "kim@snu.ac.kr" || body.DisplayName == nil || *body.DisplayName != "김철수" || body.IsAdmin || body.Calendar.Timezone != "Asia/Seoul" {
		t.Fatalf("me = %s", me.Body.String())
	}
}

func TestGoogleCallbackOutcomes(t *testing.T) {
	cases := []struct {
		name   string
		next   string
		claims fakegoogle.Claims
		want   string
	}{
		{"no next", "", kim, "/?auth=ok"},
		{"unsafe next ignored", "//evil.example", kim, "/?auth=ok"},
		{"personal account", "", fakegoogle.Claims{Subject: "9", Email: "kim@gmail.com", EmailVerified: true}, "/?auth=forbidden"},
		{"unverified", "", fakegoogle.Claims{Subject: "9", Email: "kim@snu.ac.kr", HostedDomain: "snu.ac.kr"}, "/?auth=forbidden"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			rec := e.signIn(t, tc.next, tc.claims)
			if got := rec.Header().Get("Location"); got != appOrigin+tc.want {
				t.Fatalf("Location = %s", got)
			}
		})
	}
}

// TestGoogleSignInNextSizeCap covers O32 (2026-09-29 user decision): next is
// kept in the signed state cookie only while doing so keeps its value under
// 3500 bytes (internal/httpapi.maxStateCookieBytes, mirrored here as
// maxStateCookieBytes since it is unexported); past that it is dropped so
// sign-in still succeeds and returns to /, rather than issuing a cookie the
// browser would discard.
func TestGoogleSignInNextSizeCap(t *testing.T) {
	const maxStateCookieBytes = 3500
	cases := []struct {
		name     string
		next     string // '<' JSON-escapes to <: 6 bytes each.
		wantNext bool
	}{
		{"just under the limit: kept", "/" + strings.Repeat("<", 400), true},
		{"far past the limit: dropped", "/" + strings.Repeat("<", 2000), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			start := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/auth/google?next="+url.QueryEscape(tc.next), nil, nil)
			if start.Code != http.StatusFound {
				t.Fatalf("start: %d", start.Code)
			}
			state := cookies(start)["snu_oauth"]
			if state == nil {
				t.Fatalf("state cookie missing")
			}
			if len(state.Value) > maxStateCookieBytes {
				t.Fatalf("state cookie value is %d bytes, want <= %d", len(state.Value), maxStateCookieBytes)
			}
			loc, _ := url.Parse(start.Header().Get("Location"))
			q := loc.Query()
			c := kim
			c.Nonce = q.Get("nonce")
			e.fake.Grant("code-1", q.Get("code_challenge"), c)
			cb := "/api/v1/auth/google/callback?code=code-1&state=" + url.QueryEscape(q.Get("state"))
			rec := e.spec.Do(t, e.srv, http.MethodGet, cb, nil, header(state))

			wantLoc := appOrigin + "/?auth=ok"
			if tc.wantNext {
				wantLoc = appOrigin + tc.next + "?auth=ok"
			}
			if rec.Code != http.StatusFound || rec.Header().Get("Location") != wantLoc {
				t.Fatalf("callback: %d %s, want 302 %s", rec.Code, rec.Header().Get("Location"), wantLoc)
			}
			if sess := cookies(rec)["snu_session"]; sess == nil {
				t.Fatalf("session cookie missing")
			}
		})
	}
}

func TestGoogleCallbackFailures(t *testing.T) {
	e := newEnv(t)
	start := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/auth/google", nil, nil)
	state := cookies(start)["snu_oauth"]
	loc, _ := url.Parse(start.Header().Get("Location"))
	realState := loc.Query().Get("state")

	cases := []struct {
		name, query string
		cookie      *http.Cookie
		want        string
	}{
		{"declined", "error=access_denied&state=" + realState, state, "/?auth=cancelled"},
		{"provider error", "error=server_error&state=" + realState, state, "/?auth=error"},
		{"unknown code", "code=nope&state=" + realState, state, "/?auth=error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/auth/google/callback?"+tc.query, nil, header(tc.cookie))
			if got := rec.Header().Get("Location"); rec.Code != http.StatusFound || got != appOrigin+tc.want {
				t.Fatalf("%d %s", rec.Code, got)
			}
			if _, ok := cookies(rec)["snu_session"]; ok {
				t.Fatal("a failed callback must not start a session")
			}
		})
	}
}

// TestGoogleCallbackRejectsBadState covers the two cases that only the
// state check itself can catch: a code is granted and exchangeable, with
// the flow's real code_challenge and nonce, so a callback that skipped the
// state check would sign the visitor in. Both must still end in
// /?auth=error with no session cookie.
func TestGoogleCallbackRejectsBadState(t *testing.T) {
	e := newEnv(t)
	start := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/auth/google", nil, nil)
	state := cookies(start)["snu_oauth"]
	loc, _ := url.Parse(start.Header().Get("Location"))
	q := loc.Query()
	realState := q.Get("state")

	cases := []struct {
		name, code, query string
		cookie            *http.Cookie
	}{
		{"state mismatch", "good-code-1", "state=forged", state},
		{"no state cookie", "good-code-2", "state=" + realState, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			claims := kim
			claims.Nonce = q.Get("nonce")
			e.fake.Grant(tc.code, q.Get("code_challenge"), claims)
			rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/auth/google/callback?code="+tc.code+"&"+tc.query, nil, header(tc.cookie))
			if got := rec.Header().Get("Location"); rec.Code != http.StatusFound || got != appOrigin+"/?auth=error" {
				t.Fatalf("%d %s", rec.Code, got)
			}
			if _, ok := cookies(rec)["snu_session"]; ok {
				t.Fatal("a failed callback must not start a session")
			}
		})
	}
}

// devSignIn signs in through dev login and returns the two cookies.
func (e *env) devSignIn(t *testing.T, email string) (*http.Cookie, *http.Cookie) {
	t.Helper()
	body := []byte(`{"email":"` + email + `","displayName":"개발자"}`)
	h := http.Header{"Origin": {appOrigin}, "Content-Type": {"application/json"}}
	rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/dev-login", body, h)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("dev login: %d %s", rec.Code, rec.Body.String())
	}
	cs := cookies(rec)
	return cs["snu_session"], cs["snu_csrf"]
}

func TestDevLogin(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "Boss@SNU.ac.kr")
	me := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf))
	if !strings.Contains(me.Body.String(), `"isAdmin":true`) || !strings.Contains(me.Body.String(), `"email":"boss@snu.ac.kr"`) {
		t.Fatalf("me = %s", me.Body.String())
	}

	h := http.Header{"Origin": {appOrigin}, "Content-Type": {"application/json"}}
	if rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/dev-login", []byte(`{"email":"kim@gmail.com"}`), h); rec.Code != 422 ||
		!strings.Contains(rec.Body.String(), `"code":"INVALID_EMAIL"`) {
		t.Fatalf("non-snu email: %d %s", rec.Code, rec.Body.String())
	}
	h.Set("Origin", "https://evil.example")
	if rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/dev-login", []byte(`{"email":"kim@snu.ac.kr"}`), h); rec.Code != 403 {
		t.Fatalf("foreign origin: %d", rec.Code)
	}
}

func TestDevLoginIsAbsentOutsideDevelopment(t *testing.T) {
	e := newEnv(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/dev-login", strings.NewReader(`{"email":"kim@snu.ac.kr"}`))
	req.Header.Set("Origin", appOrigin)
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestMeNeedsAWorkingSession(t *testing.T) {
	e := newEnv(t, withDevLogin)
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, nil); rec.Code != 401 {
		t.Fatalf("no cookie: %d", rec.Code)
	}
	forged := &http.Cookie{Name: "snu_session", Value: "eyJ1aWQiOjF9.AAAA"}
	rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(forged))
	if rec.Code != 401 || cookies(rec)["snu_session"] == nil || cookies(rec)["snu_session"].MaxAge >= 0 {
		t.Fatalf("forged cookie: %d, must be cleared", rec.Code)
	}
}

func TestMeReissuesAMissingCSRFCookie(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess)); cookies(rec)["snu_csrf"] == nil {
		t.Fatal("csrf cookie not re-issued")
	}
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf)); cookies(rec)["snu_csrf"] != nil {
		t.Fatal("an existing csrf cookie must be left alone")
	}
}

func TestSessionRenewal(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf)); cookies(rec)["snu_session"] != nil {
		t.Fatal("renewed a fresh session")
	}
	e.now = e.now.Add(4 * 24 * time.Hour)
	rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf))
	renewed := cookies(rec)["snu_session"]
	if rec.Code != 200 || renewed == nil || renewed.MaxAge != int((7*24*time.Hour)/time.Second) {
		t.Fatalf("renewal: %d %+v", rec.Code, renewed)
	}
	e.now = e.now.Add(5 * 24 * time.Hour) // day 9: the first cookie ended on day 7, the renewed one runs to day 11
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf)); rec.Code != 401 {
		t.Fatalf("the old cookie outlived its expiry: %d", rec.Code)
	}
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(renewed, csrf)); rec.Code != 200 {
		t.Fatalf("the renewed cookie: %d", rec.Code)
	}
}

func TestUpdateMe(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	rec := e.spec.Do(t, e.srv, http.MethodPatch, "/api/v1/me", []byte(`{"college":"공과대학","admissionYear":2021}`), unsafeHeader(sess, csrf))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"college":"공과대학"`) {
		t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.spec.Do(t, e.srv, http.MethodPatch, "/api/v1/me", []byte(`{"college":null}`), unsafeHeader(sess, csrf))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"college":null`) || !strings.Contains(rec.Body.String(), `"admissionYear":2021`) {
		t.Fatalf("clear college: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.spec.Do(t, e.srv, http.MethodPatch, "/api/v1/me", []byte(`{"college":"없는대학"}`), unsafeHeader(sess, csrf))
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), `"code":"INVALID_COLLEGE"`) {
		t.Fatalf("bad college: %d %s", rec.Code, rec.Body.String())
	}
	h := unsafeHeader(sess, csrf)
	h.Del("X-CSRF-Token")
	if rec := e.spec.Do(t, e.srv, http.MethodPatch, "/api/v1/me", []byte(`{"college":null}`), h); rec.Code != 403 {
		t.Fatalf("without csrf token: %d", rec.Code)
	}
}

func TestDeleteMe(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	// The contract marks the header required, so this request goes straight
	// to the server instead of through the contract check.
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/me", nil)
	req.Header = unsafeHeader(sess, csrf)
	unconfirmed := httptest.NewRecorder()
	e.srv.ServeHTTP(unconfirmed, req)
	if unconfirmed.Code != 428 {
		t.Fatalf("without confirmation: %d", unconfirmed.Code)
	}
	h := unsafeHeader(sess, csrf)
	h.Set("X-Confirm-Delete", "true")
	rec := e.spec.Do(t, e.srv, http.MethodDelete, "/api/v1/me", nil, h)
	if rec.Code != 204 || cookies(rec)["snu_session"].MaxAge >= 0 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf)); rec.Code != 401 {
		t.Fatalf("session survived deletion: %d", rec.Code)
	}
}

// TestStaleSessionClearsTheCookie covers the contract's promise that a
// session invalidated by logout-all or account deletion is not just
// rejected but actively cleared: the 401 carries a snu_session Set-Cookie
// with a negative MaxAge, so a client that ignores the body still stops
// sending a dead cookie.
func TestStaleSessionClearsTheCookie(t *testing.T) {
	t.Run("logout-all", func(t *testing.T) {
		e := newEnv(t, withDevLogin)
		sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
		if rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/me/logout-all", nil, unsafeHeader(sess, csrf)); rec.Code != 204 {
			t.Fatalf("logout-all: %d", rec.Code)
		}
		rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf))
		if rec.Code != 401 {
			t.Fatalf("stale session: %d", rec.Code)
		}
		if cleared := cookies(rec)["snu_session"]; cleared == nil || cleared.MaxAge >= 0 {
			t.Fatalf("session cookie not cleared: %+v", cleared)
		}
	})
	t.Run("delete me", func(t *testing.T) {
		e := newEnv(t, withDevLogin)
		sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
		h := unsafeHeader(sess, csrf)
		h.Set("X-Confirm-Delete", "true")
		if rec := e.spec.Do(t, e.srv, http.MethodDelete, "/api/v1/me", nil, h); rec.Code != 204 {
			t.Fatalf("delete: %d", rec.Code)
		}
		rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(sess, csrf))
		if rec.Code != 401 {
			t.Fatalf("stale session: %d", rec.Code)
		}
		if cleared := cookies(rec)["snu_session"]; cleared == nil || cleared.MaxAge >= 0 {
			t.Fatalf("session cookie not cleared: %+v", cleared)
		}
	})
}

// TestDevLoginCookieIsSecureUnderHTTPS covers the contract's promise that
// the session cookie follows the app origin's scheme: Secure must be set
// once the app runs behind https, not just in the http development default
// every other test in this file uses.
func TestDevLoginCookieIsSecureUnderHTTPS(t *testing.T) {
	const httpsOrigin = "https://archive.example.com"
	e := newEnv(t, withDevLogin, func(c *config.Config) { c.AppOrigin = httpsOrigin })
	h := http.Header{"Origin": {httpsOrigin}, "Content-Type": {"application/json"}}
	rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/dev-login", []byte(`{"email":"kim@snu.ac.kr"}`), h)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("dev login: %d %s", rec.Code, rec.Body.String())
	}
	sess := cookies(rec)["snu_session"]
	if sess == nil || !sess.Secure {
		t.Fatalf("session cookie = %+v, want Secure", sess)
	}
}

func TestLogoutAllAndLogout(t *testing.T) {
	e := newEnv(t, withDevLogin)
	sess, csrf := e.devSignIn(t, "kim@snu.ac.kr")
	other, _ := e.devSignIn(t, "kim@snu.ac.kr")
	if rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/me/logout-all", nil, unsafeHeader(sess, csrf)); rec.Code != 204 {
		t.Fatalf("logout-all: %d", rec.Code)
	}
	if rec := e.spec.Do(t, e.srv, http.MethodGet, "/api/v1/me", nil, header(other)); rec.Code != 401 {
		t.Fatalf("another device survived logout-all: %d", rec.Code)
	}

	rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/logout", nil, http.Header{"Origin": {appOrigin}})
	if rec.Code != 204 || cookies(rec)["snu_session"] == nil || cookies(rec)["snu_csrf"] == nil {
		t.Fatalf("logout without a session: %d", rec.Code)
	}
	if rec := e.spec.Do(t, e.srv, http.MethodPost, "/api/v1/auth/logout", nil, http.Header{"Origin": {"https://evil.example"}}); rec.Code != 403 {
		t.Fatalf("logout from a foreign origin: %d", rec.Code)
	}
}
