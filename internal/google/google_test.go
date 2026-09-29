package google_test

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/snuarchive/snuarchive/internal/google"
	"github.com/snuarchive/snuarchive/internal/testutil/fakegoogle"
)

// begin returns the client, the fake server and the challenge the client
// put in its authorization URL.
func begin(t *testing.T) (*google.Client, *fakegoogle.Server, string, string) {
	t.Helper()
	fake := fakegoogle.New(t)
	c := google.New(context.Background(), fake.Options("http://app.test/api/v1/auth/google/callback"))
	verifier := oauth2.GenerateVerifier()
	u, err := url.Parse(c.AuthCodeURL("st", "n-1", verifier))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if q.Get("hd") != "snu.ac.kr" || q.Get("nonce") != "n-1" || q.Get("state") != "st" ||
		q.Get("code_challenge_method") != "S256" || !strings.Contains(q.Get("scope"), "openid") {
		t.Fatalf("auth url = %s", u)
	}
	return c, fake, verifier, q.Get("code_challenge")
}

func TestExchangeReturnsVerifiedIdentity(t *testing.T) {
	c, fake, verifier, challenge := begin(t)
	fake.Grant("code-1", challenge, fakegoogle.Claims{
		Subject: "1001", Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr", Name: "김철수", Nonce: "n-1",
	})
	id, err := c.Exchange(context.Background(), "code-1", verifier, "n-1")
	if err != nil {
		t.Fatal(err)
	}
	want := google.Identity{Subject: "1001", Email: "kim@snu.ac.kr", EmailVerified: true, HostedDomain: "snu.ac.kr", Name: "김철수"}
	if id != want {
		t.Fatalf("identity = %+v", id)
	}
}

func TestExchangeRejects(t *testing.T) {
	good := fakegoogle.Claims{Subject: "1001", Email: "kim@snu.ac.kr", EmailVerified: true, Nonce: "n-1"}
	cases := []struct {
		name     string
		claims   func(fakegoogle.Claims) fakegoogle.Claims
		verifier func(string) string
		nonce    string
	}{
		{"wrong nonce", func(c fakegoogle.Claims) fakegoogle.Claims { c.Nonce = "other"; return c }, nil, "n-1"},
		{"wrong audience", func(c fakegoogle.Claims) fakegoogle.Claims { c.Audience = "someone-else"; return c }, nil, "n-1"},
		{"wrong issuer", func(c fakegoogle.Claims) fakegoogle.Claims { c.Issuer = "https://evil.example"; return c }, nil, "n-1"},
		{"expired", func(c fakegoogle.Claims) fakegoogle.Claims { c.Expiry = time.Now().Add(-time.Hour); return c }, nil, "n-1"},
		{"wrong verifier", nil, func(string) string { return oauth2.GenerateVerifier() }, "n-1"},
		{"empty expected nonce", func(c fakegoogle.Claims) fakegoogle.Claims { c.Nonce = ""; return c }, nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, fake, verifier, challenge := begin(t)
			claims := good
			if tc.claims != nil {
				claims = tc.claims(claims)
			}
			fake.Grant("code-1", challenge, claims)
			if tc.verifier != nil {
				verifier = tc.verifier(verifier)
			}
			if _, err := c.Exchange(context.Background(), "code-1", verifier, tc.nonce); err == nil {
				t.Fatal("exchange must fail")
			}
		})
	}
}
