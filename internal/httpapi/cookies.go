package httpapi

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"github.com/snuarchive/snuarchive/internal/session"
)

const (
	SessionCookie = "snu_session"
	stateCookie   = "snu_oauth"
	statePath     = apiPrefix + "/auth/google" // covers the callback, nothing else

	sessionPurpose = "session"
	statePurpose   = "oauth-state"
	stateTTL       = 10 * time.Minute
)

// cookieJar issues and reads the server's cookies. Secure follows the app
// origin, so plain-http development still works.
type cookieJar struct {
	codec  *session.Codec
	policy session.Policy
	secure bool
}

func newCookieJar(keys [][]byte, policy session.Policy, appOrigin string) cookieJar {
	return cookieJar{
		codec:  session.NewCodec(keys),
		policy: policy,
		secure: strings.HasPrefix(appOrigin, "https://"),
	}
}

func (j cookieJar) cookie(name, value, path string, maxAge int, httpOnly bool) *http.Cookie {
	return &http.Cookie{
		Name: name, Value: value, Path: path, MaxAge: maxAge,
		HttpOnly: httpOnly, Secure: j.secure, SameSite: http.SameSiteLaxMode,
	}
}

func (j cookieJar) setSession(w http.ResponseWriter, s session.Session, now time.Time) error {
	tok, err := j.codec.Seal(sessionPurpose, s)
	if err != nil {
		return err
	}
	http.SetCookie(w, j.cookie(SessionCookie, tok, "/", int(s.Exp-now.Unix()), true))
	return nil
}

// readSession returns the session cookie's content if it is authentic and
// not expired. Whether the account still accepts it is the caller's check.
func (j cookieJar) readSession(r *http.Request, now time.Time) (session.Session, bool) {
	c, err := r.Cookie(SessionCookie)
	if err != nil {
		return session.Session{}, false
	}
	var s session.Session
	if j.codec.Open(sessionPurpose, c.Value, &s) != nil || !j.policy.Valid(s, now) {
		return session.Session{}, false
	}
	return s, true
}

// setCSRF issues a new double-submit token, readable by scripts. It lives
// as long as a session can.
func (j cookieJar) setCSRF(w http.ResponseWriter) {
	http.SetCookie(w, j.cookie(CSRFCookie, randomToken(), "/", int(j.policy.MaxAge/time.Second), false))
}

// clear removes the session and CSRF cookies.
func (j cookieJar) clear(w http.ResponseWriter) {
	http.SetCookie(w, j.cookie(SessionCookie, "", "/", -1, true))
	http.SetCookie(w, j.cookie(CSRFCookie, "", "/", -1, false))
}

// oauthState travels in a signed cookie from /auth/google to the callback.
type oauthState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"` // PKCE code verifier
	Next     string `json:"x,omitempty"`
	Exp      int64  `json:"e"`
}

func (j cookieJar) setState(w http.ResponseWriter, st oauthState) error {
	tok, err := j.codec.Seal(statePurpose, st)
	if err != nil {
		return err
	}
	http.SetCookie(w, j.cookie(stateCookie, tok, statePath, int(stateTTL/time.Second), true))
	return nil
}

// takeState reads the state cookie and always deletes it: a state is good
// for one callback.
func (j cookieJar) takeState(w http.ResponseWriter, r *http.Request, now time.Time) (oauthState, bool) {
	http.SetCookie(w, j.cookie(stateCookie, "", statePath, -1, true))
	c, err := r.Cookie(stateCookie)
	if err != nil {
		return oauthState{}, false
	}
	var st oauthState
	if j.codec.Open(statePurpose, c.Value, &st) != nil || now.Unix() >= st.Exp {
		return oauthState{}, false
	}
	return st, true
}

// randomToken returns 32 random bytes as base64url: 43 characters, which is
// also a valid PKCE code verifier (RFC 7636 §4.1).
func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
