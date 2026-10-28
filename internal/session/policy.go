package session

import "time"

// Session is the signed content of the snu_session cookie. Times are Unix
// seconds to keep the cookie short.
type Session struct {
	UID    int64 `json:"uid"`
	Epoch  int32 `json:"ep"`
	AuthAt int64 `json:"at"`  // sign-in time; renewals keep it
	Exp    int64 `json:"exp"` // this cookie's expiry
}

// Policy is sliding expiry with a hard cap: a session lasts TTL, is renewed
// for another TTL once less than half remains, and never outlives MaxAge
// from sign-in.
type Policy struct {
	TTL    time.Duration
	MaxAge time.Duration
}

// New starts a session at now.
func (p Policy) New(uid int64, epoch int32, now time.Time) Session {
	s := Session{UID: uid, Epoch: epoch, AuthAt: now.Unix()}
	s.Exp = p.expiry(s, now)
	return s
}

// Valid reports whether s is still usable at now. The cap is checked on its
// own so a cookie minted under a longer MaxAge stops at the current one.
func (p Policy) Valid(s Session, now time.Time) bool {
	t := now.Unix()
	return t < s.Exp && t < s.AuthAt+int64(p.MaxAge/time.Second)
}

// Renew returns s with a later expiry when less than half of TTL remains,
// and false when s should be left as it is.
func (p Policy) Renew(s Session, now time.Time) (Session, bool) {
	if !p.Valid(s, now) || time.Duration(s.Exp-now.Unix())*time.Second >= p.TTL/2 {
		return s, false
	}
	exp := p.expiry(s, now)
	if exp <= s.Exp {
		return s, false
	}
	s.Exp = exp
	return s, true
}

func (p Policy) expiry(s Session, now time.Time) int64 {
	return min(now.Add(p.TTL).Unix(), s.AuthAt+int64(p.MaxAge/time.Second))
}
