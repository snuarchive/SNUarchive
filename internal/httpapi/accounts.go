package httpapi

import (
	"context"
	"crypto/subtle"
	"net/http"
	"net/netip"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/auth"
	"github.com/snuarchive/snuarchive/internal/calendar"
	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/session"
)

// Accounts is the part of auth.Service the HTTP layer uses.
type Accounts interface {
	SignInGoogle(ctx context.Context, id auth.Identity, ip netip.Addr) (auth.User, error)
	SignInDev(ctx context.Context, email string, name *string, ip netip.Addr) (auth.User, error)
	Authenticate(ctx context.Context, uid int64, epoch int32) (auth.User, error)
	UpdateProfile(ctx context.Context, uid int64, p auth.ProfileUpdate, ip netip.Addr) (auth.User, error)
	DeleteAccount(ctx context.Context, uid int64, ip netip.Addr) error
	LogoutAll(ctx context.Context, uid int64, ip netip.Addr) error
}

// GoogleSignIn is the part of google.Client the HTTP layer uses.
type GoogleSignIn interface {
	AuthCodeURL(state, nonce, verifier string) string
	Exchange(ctx context.Context, code, verifier, nonce string) (google.Identity, error)
}

const displayNameMaxLength = 120

type accountAPI struct {
	d   Deps
	jar cookieJar
	now func() time.Time
}

func newAccountAPI(d Deps) *accountAPI {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	policy := session.Policy{TTL: d.Config.Session.TTL, MaxAge: d.Config.Session.MaxAge}
	return &accountAPI{d: d, jar: newCookieJar(d.Config.Session.Keys, policy, d.Config.AppOrigin), now: now}
}

func (a *accountAPI) register(rt *router) {
	rt.handle(http.MethodGet, apiPrefix+"/auth/google", http.HandlerFunc(a.startGoogle))
	rt.handle(http.MethodGet, apiPrefix+"/auth/google/callback", http.HandlerFunc(a.googleCallback))
	rt.handle(http.MethodPost, apiPrefix+"/auth/logout", http.HandlerFunc(a.logout), originOnly())
	if devLoginEnabled(a.d.Config) {
		rt.handle(http.MethodPost, apiPrefix+"/auth/dev-login", http.HandlerFunc(a.devLogin), originOnly())
	}
	rt.handle(http.MethodGet, apiPrefix+"/me", a.authed(a.getMe))
	rt.handle(http.MethodPatch, apiPrefix+"/me", a.authed(a.updateMe))
	rt.handle(http.MethodDelete, apiPrefix+"/me", a.authed(a.deleteMe))
	rt.handle(http.MethodPost, apiPrefix+"/me/logout-all", a.authed(a.logoutAll))
}

// authed resolves the session to a live account, renewing the cookie when
// it is past half its lifetime. A cookie that no longer works is cleared.
func (a *accountAPI) authed(next func(http.ResponseWriter, *http.Request, auth.User)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		now := a.now()
		s, ok := a.jar.readSession(r, now)
		if !ok {
			if _, err := r.Cookie(SessionCookie); err == nil {
				a.jar.clear(w)
			}
			writeError(w, r, a.d.Logger, apperr.New(apperr.NotAuthenticated))
			return
		}
		u, err := a.d.Accounts.Authenticate(r.Context(), s.UID, s.Epoch)
		if err != nil {
			if e, ok := apperr.As(err); ok && e.Code == apperr.NotAuthenticated {
				a.jar.clear(w)
			}
			writeError(w, r, a.d.Logger, err)
			return
		}
		if renewed, ok := a.jar.policy.Renew(s, now); ok {
			if err := a.jar.setSession(w, renewed, now); err != nil {
				writeError(w, r, a.d.Logger, err)
				return
			}
		}
		next(w, r, u)
	})
}

// startSession sets both cookies for a fresh sign-in.
func (a *accountAPI) startSession(w http.ResponseWriter, u auth.User) error {
	now := a.now()
	if err := a.jar.setSession(w, a.jar.policy.New(u.ID, u.SessionEpoch, now), now); err != nil {
		return err
	}
	a.jar.setCSRF(w)
	return nil
}

func (a *accountAPI) redirect(w http.ResponseWriter, r *http.Request, path string) {
	http.Redirect(w, r, a.d.Config.AppOrigin+path, http.StatusFound)
}

func (a *accountAPI) startGoogle(w http.ResponseWriter, r *http.Request) {
	if a.d.Google == nil {
		a.d.Logger.WarnContext(r.Context(), "google sign-in is not configured")
		a.redirect(w, r, "/?auth=error")
		return
	}
	next, _ := safeNext(r.URL.Query().Get("next"), a.d.Config.AppOrigin)
	st := oauthState{
		State: randomToken(), Nonce: randomToken(), Verifier: randomToken(),
		Next: next, Exp: a.now().Add(stateTTL).Unix(),
	}
	if err := a.jar.setState(w, st); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	http.Redirect(w, r, a.d.Google.AuthCodeURL(st.State, st.Nonce, st.Verifier), http.StatusFound)
}

// googleCallback always ends in a redirect: failures go to /?auth=cancelled
// (the user declined on Google's page), /?auth=forbidden (not a verified
// snu.ac.kr account) or /?auth=error (anything else).
func (a *accountAPI) googleCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	st, haveState := a.jar.takeState(w, r, a.now())
	if e := q.Get("error"); e != "" {
		if e == "access_denied" {
			a.redirect(w, r, "/?auth=cancelled")
		} else {
			a.d.Logger.WarnContext(ctx, "google sign-in failed", "error", e)
			a.redirect(w, r, "/?auth=error")
		}
		return
	}
	if !haveState || subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(st.State)) != 1 {
		a.d.Logger.WarnContext(ctx, "google callback without a matching state")
		a.redirect(w, r, "/?auth=error")
		return
	}
	if a.d.Google == nil {
		a.redirect(w, r, "/?auth=error")
		return
	}
	g, err := a.d.Google.Exchange(ctx, q.Get("code"), st.Verifier, st.Nonce)
	if err != nil {
		a.d.Logger.WarnContext(ctx, "google token exchange", "err", err)
		a.redirect(w, r, "/?auth=error")
		return
	}
	id, ok := auth.FromGoogle(g)
	if !ok {
		a.redirect(w, r, "/?auth=forbidden")
		return
	}
	u, err := a.d.Accounts.SignInGoogle(ctx, id, ClientIP(ctx))
	if err != nil {
		a.d.Logger.ErrorContext(ctx, "google sign-in", "err", err, "request_id", RequestID(ctx))
		a.redirect(w, r, "/?auth=error")
		return
	}
	if err := a.startSession(w, u); err != nil {
		a.d.Logger.ErrorContext(ctx, "start session", "err", err, "request_id", RequestID(ctx))
		a.redirect(w, r, "/?auth=error")
		return
	}
	next := st.Next
	if next == "" {
		next = "/"
	}
	a.redirect(w, r, withAuthOK(next))
}

func (a *accountAPI) logout(w http.ResponseWriter, _ *http.Request) {
	a.jar.clear(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *accountAPI) devLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email       *string `json:"email"`
		DisplayName *string `json:"displayName"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	if body.Email == nil {
		writeError(w, r, a.d.Logger, apperr.Validation(apperr.FieldError{Field: "email", Code: apperr.Required}))
		return
	}
	email := strings.ToLower(strings.TrimSpace(*body.Email))
	if !auth.ValidEmail(email) {
		writeError(w, r, a.d.Logger, apperr.Validation(apperr.FieldError{Field: "email", Code: apperr.InvalidEmail}))
		return
	}
	var name *string
	if body.DisplayName != nil {
		if n := strings.TrimSpace(*body.DisplayName); n != "" {
			if utf8.RuneCountInString(n) > displayNameMaxLength {
				writeError(w, r, a.d.Logger, apperr.Validation(apperr.FieldError{Field: "displayName", Code: apperr.TooLong}))
				return
			}
			name = &n
		}
	}
	u, err := a.d.Accounts.SignInDev(r.Context(), email, name, ClientIP(r.Context()))
	if err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	if err := a.startSession(w, u); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type termJSON struct {
	Year     int `json:"year"`
	Semester int `json:"semester"`
}

type meJSON struct {
	ID                     int64   `json:"id"`
	Email                  string  `json:"email"`
	DisplayName            *string `json:"displayName"`
	IsAdmin                bool    `json:"isAdmin"`
	College                *string `json:"college"`
	AdmissionYear          *int    `json:"admissionYear"`
	SuggestedAdmissionYear *int    `json:"suggestedAdmissionYear"`
	Calendar               struct {
		CurrentTerm termJSON `json:"currentTerm"`
		Timezone    string   `json:"timezone"`
	} `json:"calendar"`
}

func (a *accountAPI) toMeJSON(u auth.User) meJSON {
	now := a.now()
	out := meJSON{
		ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, IsAdmin: u.IsAdmin,
		College: u.College, AdmissionYear: u.AdmissionYear,
		SuggestedAdmissionYear: auth.SuggestedAdmissionYear(u.Email, now),
	}
	term := calendar.CurrentTerm(now)
	out.Calendar.CurrentTerm = termJSON{Year: term.Year, Semester: term.Semester}
	out.Calendar.Timezone = calendar.Location().String()
	return out
}

// getMe also re-issues a missing CSRF cookie, so a client that lost it
// recovers without signing in again.
func (a *accountAPI) getMe(w http.ResponseWriter, r *http.Request, u auth.User) {
	if c, err := r.Cookie(CSRFCookie); err != nil || c.Value == "" {
		a.jar.setCSRF(w)
	}
	writeJSON(w, http.StatusOK, a.toMeJSON(u))
}

func (a *accountAPI) updateMe(w http.ResponseWriter, r *http.Request, u auth.User) {
	var p auth.ProfileUpdate
	if err := decodeJSON(r, &p); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	updated, err := a.d.Accounts.UpdateProfile(r.Context(), u.ID, p, ClientIP(r.Context()))
	if err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	writeJSON(w, http.StatusOK, a.toMeJSON(updated))
}

func (a *accountAPI) deleteMe(w http.ResponseWriter, r *http.Request, u auth.User) {
	if r.Header.Get("X-Confirm-Delete") != "true" {
		writeError(w, r, a.d.Logger, apperr.New(apperr.ConfirmationRequired))
		return
	}
	if err := a.d.Accounts.DeleteAccount(r.Context(), u.ID, ClientIP(r.Context())); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	a.jar.clear(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *accountAPI) logoutAll(w http.ResponseWriter, r *http.Request, u auth.User) {
	if err := a.d.Accounts.LogoutAll(r.Context(), u.ID, ClientIP(r.Context())); err != nil {
		writeError(w, r, a.d.Logger, err)
		return
	}
	a.jar.clear(w)
	w.WriteHeader(http.StatusNoContent)
}
