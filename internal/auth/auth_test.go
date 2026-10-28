package auth_test

import (
	"context"
	"log/slog"
	"net/netip"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/auth"
	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/optional"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

var ip = netip.MustParseAddr("198.51.100.7")

func newService(t *testing.T, admins ...string) (*auth.Service, *pgxpool.Pool) {
	t.Helper()
	pool := pgtest.New(t)
	return auth.NewService(pool, admins, slog.New(slog.DiscardHandler)), pool
}

func scalar[T any](t *testing.T, pool *pgxpool.Pool, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("query %q: %v", sql, err)
	}
	return v
}

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func code(err error) apperr.Code {
	if e, ok := apperr.As(err); ok {
		return e.Code
	}
	return ""
}

func TestFromGoogle(t *testing.T) {
	ok := google.Identity{Subject: "1", Email: "Kim@SNU.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr", Name: " 김철수 "}
	id, accepted := auth.FromGoogle(ok)
	if !accepted || id != (auth.Identity{Subject: "1", Email: "kim@snu.ac.kr", Name: "김철수"}) {
		t.Fatalf("got %+v %v", id, accepted)
	}
	for name, g := range map[string]google.Identity{
		"unverified":        {Subject: "1", Email: "kim@snu.ac.kr", HostedDomain: "snu.ac.kr"},
		"personal account":  {Subject: "1", Email: "kim@gmail.com", EmailVerified: true},
		"no hd claim":       {Subject: "1", Email: "kim@snu.ac.kr", EmailVerified: true},
		"other workspace":   {Subject: "1", Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "example.com"},
		"subdomain address": {Subject: "1", Email: "kim@cse.snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr"},
		"no subject":        {Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr"},
	} {
		if _, accepted := auth.FromGoogle(g); accepted {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestSuggestedAdmissionYear(t *testing.T) {
	now := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	for email, want := range map[string]int{"2021-12345@snu.ac.kr": 2021, "1998-10001@snu.ac.kr": 1998} {
		if got := auth.SuggestedAdmissionYear(email, now); got == nil || *got != want {
			t.Errorf("%s: %v", email, got)
		}
	}
	for _, email := range []string{"kim@snu.ac.kr", "2031-12345@snu.ac.kr", "2021-123@snu.ac.kr", "x2021-12345@snu.ac.kr"} {
		if got := auth.SuggestedAdmissionYear(email, now); got != nil {
			t.Errorf("%s: %d", email, *got)
		}
	}
}

func TestSignInGoogleCreatesThenKeepsTheFirstName(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "김철수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "kim@snu.ac.kr" || u.DisplayName == nil || *u.DisplayName != "김철수" || u.IsAdmin {
		t.Fatalf("user = %+v", u)
	}
	again, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "Kim Chulsoo"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != u.ID || *again.DisplayName != "김철수" {
		t.Fatalf("second sign-in = %+v", again)
	}
	if got := scalar[string](t, pool, `SELECT host(last_ip) FROM users WHERE id = $1`, u.ID); got != ip.String() {
		t.Fatalf("last_ip = %s", got)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM activity_logs WHERE user_id = $1 AND action = 'login' AND metadata->>'provider' = 'google' AND ip IS NOT NULL`, u.ID); n != 2 {
		t.Fatalf("login entries = %d", n)
	}
}

// A reissued address goes to its new holder; the previous holder keeps its
// account (by sub) and gets its current address back when it signs in.
func TestSignInGoogleReissuedEmail(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	old, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "김철수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, pool, `UPDATE users SET is_admin = true WHERE id = $1`, old.ID)

	newcomer, err := s.SignInGoogle(ctx, auth.Identity{Subject: "2002", Email: "kim@snu.ac.kr", Name: "김민수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if newcomer.ID == old.ID || newcomer.IsAdmin || *newcomer.DisplayName != "김민수" {
		t.Fatalf("the new holder must get a fresh account: %+v", newcomer)
	}
	if email := scalar[*string](t, pool, `SELECT email FROM users WHERE id = $1`, old.ID); email != nil {
		t.Fatalf("the old account still holds %s", *email)
	}
	if _, err := s.Authenticate(ctx, old.ID, old.SessionEpoch); code(err) != apperr.NotAuthenticated {
		t.Fatalf("an account without an address must sign in again: %v", err)
	}

	back, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "chulsoo.kim@snu.ac.kr"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if back.ID != old.ID || back.Email != "chulsoo.kim@snu.ac.kr" || !back.IsAdmin {
		t.Fatalf("returning account = %+v", back)
	}
	// Release ends the old holder's sessions: releaseEmail bumped the
	// epoch, so cookies from before the address was taken away stay dead
	// even though the account is signing in again.
	if _, err := s.Authenticate(ctx, back.ID, old.SessionEpoch); code(err) != apperr.NotAuthenticated {
		t.Fatalf("the pre-release epoch must not authenticate: %v", err)
	}
	if _, err := s.Authenticate(ctx, back.ID, back.SessionEpoch); err != nil {
		t.Fatalf("the new epoch must authenticate: %v", err)
	}
}

// The known-sub branch of SignInGoogle: an account signing in with its own
// (already-known) sub, but a new address, takes that address away from
// another Google-linked account, just as a first-time reissue does.
func TestSignInGoogleKnownSubTakesAnAddressFromAnotherSubAccount(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	a, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "x@snu.ac.kr", Name: "김철수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.SignInGoogle(ctx, auth.Identity{Subject: "2002", Email: "c@snu.ac.kr", Name: "박민수"}, ip)
	if err != nil {
		t.Fatal(err)
	}

	again, err := s.SignInGoogle(ctx, auth.Identity{Subject: "2002", Email: "x@snu.ac.kr", Name: "박민수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != c.ID || again.Email != "x@snu.ac.kr" {
		t.Fatalf("C must now hold x@: %+v", again)
	}
	if email := scalar[*string](t, pool, `SELECT email FROM users WHERE id = $1`, a.ID); email != nil {
		t.Fatalf("A must give up x@: %s", *email)
	}
	if sub := scalar[string](t, pool, `SELECT google_sub FROM users WHERE id = $1`, a.ID); sub != "1001" {
		t.Fatalf("A must keep its sub: %s", sub)
	}

	back, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "new-a@snu.ac.kr"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if back.ID != a.ID || back.Email != "new-a@snu.ac.kr" {
		t.Fatalf("A must be able to sign in again with a new address: %+v", back)
	}
}

// A first Google sign-in claims the account dev login (or an import) made.
func TestSignInGoogleClaimsAnAccountWithoutSub(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	dev, err := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "김철수"}, ip)
	if err != nil {
		t.Fatal(err)
	}
	if u.ID != dev.ID || u.DisplayName != nil {
		t.Fatalf("claimed = %+v (the name is only stored at creation)", u)
	}
	if sub := scalar[string](t, pool, `SELECT google_sub FROM users WHERE id = $1`, u.ID); sub != "1001" {
		t.Fatalf("sub = %s", sub)
	}
}

func TestSignInGoogleRefusesToTakeAnAddressFromAnAccountWithoutSub(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	if _, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr"}, ip); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SignInDev(ctx, "kim2@snu.ac.kr", nil, ip); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim2@snu.ac.kr"}, ip); err == nil {
		t.Fatal("two accounts would share an address")
	}
}

func TestAdminFromEnvOrDB(t *testing.T) {
	s, pool := newService(t, "boss@snu.ac.kr")
	ctx := context.Background()
	boss, err := s.SignInDev(ctx, "boss@snu.ac.kr", nil, ip)
	if err != nil || !boss.IsAdmin {
		t.Fatalf("env admin = %+v, %v", boss, err)
	}
	u, _ := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)
	mustExec(t, pool, `UPDATE users SET is_admin = true WHERE id = $1`, u.ID)
	if got, err := s.Authenticate(ctx, u.ID, u.SessionEpoch); err != nil || !got.IsAdmin {
		t.Fatalf("db admin = %+v, %v", got, err)
	}
}

func TestAuthenticate(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, _ := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)
	mustExec(t, pool, `UPDATE users SET last_seen_at = now() - interval '1 hour' WHERE id = $1`, u.ID)
	if _, err := s.Authenticate(ctx, u.ID, u.SessionEpoch); err != nil {
		t.Fatal(err)
	}
	if fresh := scalar[bool](t, pool, `SELECT last_seen_at > now() - interval '1 minute' FROM users WHERE id = $1`, u.ID); !fresh {
		t.Fatal("last_seen_at not refreshed")
	}
	if _, err := s.Authenticate(ctx, u.ID, u.SessionEpoch+1); code(err) != apperr.NotAuthenticated {
		t.Fatalf("wrong epoch: %v", err)
	}
	if _, err := s.Authenticate(ctx, 999999, 0); code(err) != apperr.NotAuthenticated {
		t.Fatalf("unknown user: %v", err)
	}
}

func TestUpdateProfile(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, _ := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)

	got, err := s.UpdateProfile(ctx, u.ID, auth.ProfileUpdate{
		College: optional.Of("공과대학"), AdmissionYear: optional.Of(2021),
	}, ip)
	if err != nil || got.College == nil || *got.College != "공과대학" || got.AdmissionYear == nil || *got.AdmissionYear != 2021 {
		t.Fatalf("set: %+v %v", got, err)
	}
	got, err = s.UpdateProfile(ctx, u.ID, auth.ProfileUpdate{College: optional.Null[string]()}, ip)
	if err != nil || got.College != nil || got.AdmissionYear == nil {
		t.Fatalf("clear college only: %+v %v", got, err)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM activity_logs WHERE user_id = $1 AND action = 'profile_update'`, u.ID); n != 2 {
		t.Fatalf("profile_update entries = %d", n)
	}

	mustExec(t, pool, `UPDATE colleges SET is_active = false WHERE name = '미술대학'`)
	cases := map[string]struct {
		p    auth.ProfileUpdate
		want apperr.FieldError
	}{
		"nothing":         {auth.ProfileUpdate{}, apperr.FieldError{Field: "", Code: apperr.Required}},
		"unknown college": {auth.ProfileUpdate{College: optional.Of("없는대학")}, apperr.FieldError{Field: "college", Code: apperr.InvalidCollege}},
		"retired college": {auth.ProfileUpdate{College: optional.Of("미술대학")}, apperr.FieldError{Field: "college", Code: apperr.InvalidCollege}},
		"year too early":  {auth.ProfileUpdate{AdmissionYear: optional.Of(1979)}, apperr.FieldError{Field: "admissionYear", Code: apperr.InvalidAdmissionYear}},
		"two digits":      {auth.ProfileUpdate{AdmissionYear: optional.Of(21)}, apperr.FieldError{Field: "admissionYear", Code: apperr.InvalidAdmissionYear}},
	}
	for name, tc := range cases {
		_, err := s.UpdateProfile(ctx, u.ID, tc.p, ip)
		e, ok := apperr.As(err)
		if !ok || e.Code != apperr.ValidationFailed || len(e.Fields) != 1 || e.Fields[0] != tc.want {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestDeleteAccount(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, _ := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr", Name: "김철수"}, ip)
	inst := scalar[int32](t, pool, `INSERT INTO instructors (name) VALUES ('홍길동') RETURNING id`)
	course := scalar[int64](t, pool, `INSERT INTO courses (title, instructor_id, identity_key, search_text) VALUES ('자료구조', $1, 'k1', 'x') RETURNING id`, inst)
	mustExec(t, pool, `INSERT INTO favorites (user_id, course_id, position) VALUES ($1, $2, 0)`, u.ID, course)

	if err := s.DeleteAccount(ctx, u.ID, ip); err != nil {
		t.Fatal(err)
	}
	if scrubbed := scalar[bool](t, pool, `
		SELECT deleted_at IS NOT NULL AND email IS NULL AND google_sub IS NULL AND display_name IS NULL AND session_epoch = 1
		FROM users WHERE id = $1`, u.ID); !scrubbed {
		t.Fatal("account not scrubbed")
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM favorites WHERE user_id = $1`, u.ID); n != 0 {
		t.Fatalf("favorites left: %d", n)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM activity_logs WHERE user_id = $1 AND action = 'account_delete'`, u.ID); n != 1 {
		t.Fatalf("account_delete entries = %d", n)
	}
	if _, err := s.Authenticate(ctx, u.ID, 1); code(err) != apperr.NotAuthenticated {
		t.Fatalf("deleted account authenticated: %v", err)
	}
	if err := s.DeleteAccount(ctx, u.ID, ip); code(err) != apperr.NotAuthenticated {
		t.Fatalf("second delete: %v", err)
	}
	again, err := s.SignInGoogle(ctx, auth.Identity{Subject: "1001", Email: "kim@snu.ac.kr"}, ip)
	if err != nil || again.ID == u.ID {
		t.Fatalf("signing in again must make a new account: %+v %v", again, err)
	}
}

func TestLogoutAll(t *testing.T) {
	s, pool := newService(t)
	ctx := context.Background()
	u, _ := s.SignInDev(ctx, "kim@snu.ac.kr", nil, ip)
	if err := s.LogoutAll(ctx, u.ID, ip); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, u.ID, u.SessionEpoch); code(err) != apperr.NotAuthenticated {
		t.Fatalf("old epoch still valid: %v", err)
	}
	if _, err := s.Authenticate(ctx, u.ID, u.SessionEpoch+1); err != nil {
		t.Fatalf("new epoch: %v", err)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM activity_logs WHERE user_id = $1 AND action = 'logout_all'`, u.ID); n != 1 {
		t.Fatalf("logout_all entries = %d", n)
	}
}
