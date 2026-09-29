package session_test

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/session"
)

var (
	keyA = bytes.Repeat([]byte("a"), 32)
	keyB = bytes.Repeat([]byte("b"), 32)
)

type payload struct {
	N int `json:"n"`
}

func TestSealOpenRoundTrip(t *testing.T) {
	c := session.NewCodec([][]byte{keyA})
	tok, err := c.Seal("session", payload{N: 7})
	if err != nil {
		t.Fatal(err)
	}
	var got payload
	if err := c.Open("session", tok, &got); err != nil || got.N != 7 {
		t.Fatalf("open = %+v, %v", got, err)
	}
}

func TestKeyRotation(t *testing.T) {
	old := session.NewCodec([][]byte{keyA})
	tok, _ := old.Seal("session", payload{N: 1})
	var got payload
	if err := session.NewCodec([][]byte{keyB, keyA}).Open("session", tok, &got); err != nil {
		t.Fatalf("a token from the old key must open while the old key is listed: %v", err)
	}
	if err := session.NewCodec([][]byte{keyB}).Open("session", tok, &got); !errors.Is(err, session.ErrInvalid) {
		t.Fatalf("a retired key must not verify: %v", err)
	}
}

func TestRejectsTampering(t *testing.T) {
	c := session.NewCodec([][]byte{keyA})
	tok, _ := c.Seal("session", payload{N: 1})
	forged, _ := session.NewCodec([][]byte{keyA}).Seal("session", payload{N: 2})
	payloadPart, _, _ := strings.Cut(forged, ".")
	_, sig, _ := strings.Cut(tok, ".")
	var got payload
	for name, bad := range map[string]string{
		"swapped payload":   payloadPart + "." + sig,
		"no separator":      strings.ReplaceAll(tok, ".", ""),
		"garbage signature": payloadPart + ".!!!",
		"empty":             "",
	} {
		if err := c.Open("session", bad, &got); !errors.Is(err, session.ErrInvalid) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if err := c.Open("oauth-state", tok, &got); !errors.Is(err, session.ErrInvalid) {
		t.Fatalf("a session token must not open as another purpose: %v", err)
	}
}

func TestSealNeedsAKey(t *testing.T) {
	if _, err := session.NewCodec(nil).Seal("session", payload{}); err == nil {
		t.Fatal("sealing without a key must fail")
	}
}

func TestPolicy(t *testing.T) {
	p := session.Policy{TTL: 7 * 24 * time.Hour, MaxAge: 30 * 24 * time.Hour}
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	s := p.New(42, 3, start)
	if s.UID != 42 || s.Epoch != 3 || s.AuthAt != start.Unix() || s.Exp != start.Add(p.TTL).Unix() {
		t.Fatalf("new = %+v", s)
	}

	// More than half left: no renewal.
	if _, renewed := p.Renew(s, start.Add(3*24*time.Hour)); renewed {
		t.Fatal("renewed with more than half of the TTL left")
	}
	// Less than half left: renewed to a full TTL from now.
	at := start.Add(4 * 24 * time.Hour)
	r, renewed := p.Renew(s, at)
	if !renewed || r.Exp != at.Add(p.TTL).Unix() || r.AuthAt != s.AuthAt {
		t.Fatalf("renew = %+v, %v", r, renewed)
	}
	// Expired: invalid and not renewed.
	if p.Valid(s, start.Add(p.TTL)) {
		t.Fatal("valid at its expiry")
	}
	if _, renewed := p.Renew(s, start.Add(p.TTL+time.Second)); renewed {
		t.Fatal("renewed an expired session")
	}

	// Renewals stop at MaxAge from sign-in.
	late := start.Add(27 * 24 * time.Hour)
	s.Exp = late.Add(time.Hour).Unix()
	r, renewed = p.Renew(s, late)
	if !renewed || r.Exp != start.Add(p.MaxAge).Unix() {
		t.Fatalf("capped renew = %+v, %v", r, renewed)
	}
	if p.Valid(r, start.Add(p.MaxAge)) {
		t.Fatal("valid at the cap")
	}
	// Already at the cap: nothing to extend.
	if _, renewed := p.Renew(r, start.Add(p.MaxAge-time.Hour)); renewed {
		t.Fatal("renewed past the cap")
	}
}

// A cookie issued while MaxAge was longer stops at the current cap.
func TestPolicyShorterCapApplies(t *testing.T) {
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	long := session.Policy{TTL: 7 * 24 * time.Hour, MaxAge: 90 * 24 * time.Hour}
	s := long.New(1, 0, start)
	s.Exp = start.Add(60 * 24 * time.Hour).Unix()
	short := session.Policy{TTL: 7 * 24 * time.Hour, MaxAge: 30 * 24 * time.Hour}
	if short.Valid(s, start.Add(31*24*time.Hour)) {
		t.Fatal("a cookie from a longer cap must stop at the current one")
	}
}
