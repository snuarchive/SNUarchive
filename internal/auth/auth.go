// Package auth owns accounts: signing in, checking a session against the
// account, the voluntary profile, and ending sessions or the account.
package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/netip"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/db"
	"github.com/snuarchive/snuarchive/internal/db/dbq"
	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/optional"
)

const emailDomain = "@snu.ac.kr"

// User is a live account as the rest of the server sees it.
type User struct {
	ID            int64
	Email         string
	DisplayName   *string
	IsAdmin       bool // DB flag or ADMIN_EMAILS
	College       *string
	AdmissionYear *int
	SessionEpoch  int32
}

// Identity is a verified Google account allowed to sign in.
type Identity struct {
	Subject string
	Email   string // lower-case, @snu.ac.kr
	Name    string
}

// FromGoogle accepts only verified @snu.ac.kr accounts of the snu.ac.kr
// Workspace. The hd claim is what proves Workspace membership; the hd
// parameter on the sign-in page is only a hint.
func FromGoogle(g google.Identity) (Identity, bool) {
	email := strings.ToLower(strings.TrimSpace(g.Email))
	if !g.EmailVerified || g.HostedDomain != google.HostedDomain || !ValidEmail(email) || g.Subject == "" {
		return Identity{}, false
	}
	return Identity{Subject: g.Subject, Email: email, Name: strings.TrimSpace(g.Name)}, true
}

// ValidEmail reports whether email is a lower-case school address.
func ValidEmail(email string) bool {
	local, ok := strings.CutSuffix(email, emailDomain)
	return ok && local != "" && !strings.Contains(local, "@") && email == strings.ToLower(email)
}

var studentID = regexp.MustCompile(`^((?:19|20)\d{2})-\d{5}$`)

// SuggestedAdmissionYear guesses the admission year from a student-number
// style local part (2021-12345@snu.ac.kr), for pre-filling the profile.
func SuggestedAdmissionYear(email string, now time.Time) *int {
	local, _, _ := strings.Cut(email, "@")
	m := studentID.FindStringSubmatch(local)
	if m == nil {
		return nil
	}
	y, _ := strconv.Atoi(m[1])
	if y < 1980 || y > now.Year() {
		return nil
	}
	return &y
}

// Profile changes: an absent field is left alone, null clears it.
type ProfileUpdate struct {
	College       optional.Field[string] `json:"college"`
	AdmissionYear optional.Field[int]    `json:"admissionYear"`
}

type Service struct {
	pool   *pgxpool.Pool
	admins []string
	log    *slog.Logger
}

func NewService(pool *pgxpool.Pool, adminEmails []string, log *slog.Logger) *Service {
	return &Service{pool: pool, admins: adminEmails, log: log}
}

func unauthenticated() error { return apperr.New(apperr.NotAuthenticated) }

// errEmailHeld: the address belongs to a row with no Google sub (made by
// dev login or a data import) while this Google account already has a row
// of its own. The two cannot be merged automatically.
var errEmailHeld = errors.New("auth: email held by an account without a Google sub")

// SignInGoogle finds the account by Google sub, or links or creates one.
//   - A known sub: its email is brought up to date. If another account
//     holds that email, the other account is a previous holder of a
//     reissued address and gives it up (it keeps its own sub).
//   - An unknown sub whose email belongs to an account without a sub: that
//     account is claimed (a first Google sign-in after dev login or import).
//   - An unknown sub whose email belongs to another sub: the address was
//     reissued; the old account gives it up and a new account is made.
//
// The display name is stored only when the account is created.
func (s *Service) SignInGoogle(ctx context.Context, id Identity, ip netip.Addr) (User, error) {
	var out dbq.User
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		for _, k := range []string{"sub:" + id.Subject, "email:" + id.Email} {
			if err := q.LockSignIn(ctx, k); err != nil {
				return err
			}
		}
		ipp := addrPtr(ip)
		bySub, err := q.GetLiveUserBySub(ctx, &id.Subject)
		switch {
		case err == nil:
			if bySub.Email == nil || *bySub.Email != id.Email {
				if err := releaseEmail(ctx, q, id.Email, bySub.ID); err != nil {
					return err
				}
			}
			out, err = q.RecordSignIn(ctx, dbq.RecordSignInParams{ID: bySub.ID, Email: &id.Email, GoogleSub: &id.Subject, LastIp: ipp})
			return err
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		byEmail, err := q.GetLiveUserByEmail(ctx, &id.Email)
		switch {
		case err == nil && byEmail.GoogleSub == nil:
			out, err = q.RecordSignIn(ctx, dbq.RecordSignInParams{ID: byEmail.ID, Email: &id.Email, GoogleSub: &id.Subject, LastIp: ipp})
			return err
		case err == nil:
			if err := q.ReleaseEmail(ctx, byEmail.ID); err != nil {
				return err
			}
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		out, err = q.InsertUser(ctx, dbq.InsertUserParams{Email: &id.Email, GoogleSub: &id.Subject, DisplayName: nonEmpty(id.Name), LastIp: ipp})
		return err
	})
	if err != nil {
		return User{}, err
	}
	s.logBestEffort(ctx, out.ID, dbq.ActivityActionLogin, `{"provider":"google"}`, ip)
	return s.toUser(out), nil
}

// releaseEmail takes email away from any live account other than keep. Only
// an account with a Google sub can give it up; it gets its current address
// back the next time it signs in.
func releaseEmail(ctx context.Context, q *dbq.Queries, email string, keep int64) error {
	holder, err := q.GetLiveUserByEmail(ctx, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if holder.ID == keep {
		return nil
	}
	if holder.GoogleSub == nil {
		return errEmailHeld
	}
	return q.ReleaseEmail(ctx, holder.ID)
}

// SignInDev signs in by email alone (development only; the HTTP layer
// refuses the route otherwise). It never touches a Google sub.
func (s *Service) SignInDev(ctx context.Context, email string, name *string, ip netip.Addr) (User, error) {
	var out dbq.User
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := q.LockSignIn(ctx, "email:"+email); err != nil {
			return err
		}
		existing, err := q.GetLiveUserByEmail(ctx, &email)
		switch {
		case err == nil:
			out, err = q.RecordSignIn(ctx, dbq.RecordSignInParams{ID: existing.ID, Email: &email, LastIp: addrPtr(ip)})
			return err
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		out, err = q.InsertUser(ctx, dbq.InsertUserParams{Email: &email, DisplayName: name, LastIp: addrPtr(ip)})
		return err
	})
	if err != nil {
		return User{}, err
	}
	s.logBestEffort(ctx, out.ID, dbq.ActivityActionLogin, `{"provider":"dev"}`, ip)
	return s.toUser(out), nil
}

// Authenticate checks a session's account: live, same epoch, and holding an
// email (an account that gave its address up must sign in again to get its
// current one). last_seen_at is refreshed at most every ten minutes.
func (s *Service) Authenticate(ctx context.Context, uid int64, epoch int32) (User, error) {
	q := dbq.New(s.pool)
	u, err := q.GetLiveUser(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, unauthenticated()
	}
	if err != nil {
		return User{}, err
	}
	if u.SessionEpoch != epoch || u.Email == nil {
		return User{}, unauthenticated()
	}
	if err := q.TouchLastSeen(ctx, uid); err != nil {
		s.log.WarnContext(ctx, "touch last_seen_at", "user_id", uid, "err", err)
	}
	return s.toUser(u), nil
}

// UpdateProfile applies the voluntary profile fields.
func (s *Service) UpdateProfile(ctx context.Context, uid int64, p ProfileUpdate, ip netip.Addr) (User, error) {
	if !p.College.Set && !p.AdmissionYear.Set {
		return User{}, apperr.Validation(apperr.FieldError{Field: "", Code: apperr.Required})
	}
	var fields []apperr.FieldError
	var changed []string
	if p.College.Set {
		changed = append(changed, "college")
		if !p.College.Null {
			ok, err := dbq.New(s.pool).IsActiveCollege(ctx, p.College.Value)
			if err != nil {
				return User{}, err
			}
			if !ok {
				fields = append(fields, apperr.FieldError{Field: "college", Code: apperr.InvalidCollege})
			}
		}
	}
	var year *int16
	if p.AdmissionYear.Set {
		changed = append(changed, "admissionYear")
		if !p.AdmissionYear.Null {
			if y := p.AdmissionYear.Value; y < 1980 || y > 2100 {
				fields = append(fields, apperr.FieldError{Field: "admissionYear", Code: apperr.InvalidAdmissionYear})
			} else {
				v := int16(y)
				year = &v
			}
		}
	}
	if len(fields) > 0 {
		return User{}, apperr.Validation(fields...)
	}
	var out dbq.User
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		var err error
		out, err = q.UpdateProfile(ctx, dbq.UpdateProfileParams{
			ID: uid, SetCollege: p.College.Set, College: p.College.Ptr(),
			SetAdmissionYear: p.AdmissionYear.Set, AdmissionYear: year,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return unauthenticated()
		}
		if err != nil {
			return db.MapError(err)
		}
		return q.InsertActivityLog(ctx, activity(uid, dbq.ActivityActionProfileUpdate, fieldsMeta(changed), ip))
	})
	if err != nil {
		return User{}, err
	}
	return s.toUser(out), nil
}

// DeleteAccount scrubs the account: identity and profile are cleared, the
// sessions end, favourites go; contributions, open voting requests and the
// activity log stay.
func (s *Service) DeleteAccount(ctx context.Context, uid int64, ip netip.Addr) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		n, err := q.ScrubUser(ctx, uid)
		if err != nil {
			return err
		}
		if n == 0 {
			return unauthenticated()
		}
		if err := q.DeleteUserFavorites(ctx, uid); err != nil {
			return err
		}
		return q.InsertActivityLog(ctx, activity(uid, dbq.ActivityActionAccountDelete, `{}`, ip))
	})
}

// LogoutAll ends every session of the account by moving its epoch.
func (s *Service) LogoutAll(ctx context.Context, uid int64, ip netip.Addr) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if _, err := q.BumpSessionEpoch(ctx, uid); errors.Is(err, pgx.ErrNoRows) {
			return unauthenticated()
		} else if err != nil {
			return err
		}
		return q.InsertActivityLog(ctx, activity(uid, dbq.ActivityActionLogoutAll, `{}`, ip))
	})
}

// logBestEffort records a sign-in outside the sign-in transaction: a log
// failure must not stop someone signing in (design spec §7).
func (s *Service) logBestEffort(ctx context.Context, uid int64, action dbq.ActivityAction, meta string, ip netip.Addr) {
	if err := dbq.New(s.pool).InsertActivityLog(ctx, activity(uid, action, meta, ip)); err != nil {
		s.log.WarnContext(ctx, "activity log", "action", action, "user_id", uid, "err", err)
	}
}

func activity(uid int64, action dbq.ActivityAction, meta string, ip netip.Addr) dbq.InsertActivityLogParams {
	return dbq.InsertActivityLogParams{UserID: &uid, Action: action, Metadata: []byte(meta), Ip: addrPtr(ip)}
}

func fieldsMeta(fields []string) string {
	quoted := make([]string, len(fields))
	for i, f := range fields {
		quoted[i] = strconv.Quote(f)
	}
	return `{"fields":[` + strings.Join(quoted, ",") + `]}`
}

func (s *Service) toUser(u dbq.User) User {
	out := User{
		ID:           u.ID,
		DisplayName:  u.DisplayName,
		College:      u.College,
		SessionEpoch: u.SessionEpoch,
	}
	if u.Email != nil {
		out.Email = *u.Email
	}
	out.IsAdmin = u.IsAdmin || (out.Email != "" && slices.Contains(s.admins, out.Email))
	if u.AdmissionYear != nil {
		y := int(*u.AdmissionYear)
		out.AdmissionYear = &y
	}
	return out
}

func addrPtr(ip netip.Addr) *netip.Addr {
	if !ip.IsValid() {
		return nil
	}
	return &ip
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
