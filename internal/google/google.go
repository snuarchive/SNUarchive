// Package google runs the OAuth authorization-code flow against Google with
// PKCE and a nonce, and verifies the returned ID token.
package google

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// Google's published endpoints. They are fixed rather than discovered so
// that starting the server needs no network round trip.
const (
	Issuer   = "https://accounts.google.com"
	AuthURL  = "https://accounts.google.com/o/oauth2/v2/auth"
	TokenURL = "https://oauth2.googleapis.com/token"
	JWKSURL  = "https://www.googleapis.com/oauth2/v3/certs"
)

// HostedDomain is the Workspace domain accounts must belong to.
const HostedDomain = "snu.ac.kr"

type Options struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string

	// Overridable for tests; empty means Google's.
	Issuer, AuthURL, TokenURL, JWKSURL string
	HTTPClient                         *http.Client
}

// Identity is what a verified ID token says about the account.
type Identity struct {
	Subject       string
	Email         string
	EmailVerified bool
	HostedDomain  string
	Name          string
}

type Client struct {
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
	http     *http.Client
}

func New(ctx context.Context, o Options) *Client {
	def := func(v, d string) string {
		if v == "" {
			return d
		}
		return v
	}
	hc := o.HTTPClient
	if hc == nil {
		// A hung connection to Google must not block every sign-in; this
		// client is used both for the token exchange and, through
		// oidc.ClientContext, for JWKS fetches.
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	keys := oidc.NewRemoteKeySet(oidc.ClientContext(ctx, hc), def(o.JWKSURL, JWKSURL))
	return &Client{
		oauth: oauth2.Config{
			ClientID:     o.ClientID,
			ClientSecret: o.ClientSecret,
			RedirectURL:  o.RedirectURL,
			Endpoint: oauth2.Endpoint{
				AuthURL:   def(o.AuthURL, AuthURL),
				TokenURL:  def(o.TokenURL, TokenURL),
				AuthStyle: oauth2.AuthStyleInParams,
			},
			Scopes: []string{oidc.ScopeOpenID, "email", "profile"},
		},
		verifier: oidc.NewVerifier(def(o.Issuer, Issuer), keys, &oidc.Config{ClientID: o.ClientID}),
		http:     hc,
	}
}

// AuthCodeURL is where the browser goes to sign in. hd only preselects the
// school domain on Google's page; the token's hd claim is what is trusted.
func (c *Client) AuthCodeURL(state, nonce, verifier string) string {
	return c.oauth.AuthCodeURL(state,
		oauth2.S256ChallengeOption(verifier),
		oidc.Nonce(nonce),
		oauth2.SetAuthURLParam("hd", HostedDomain),
	)
}

var errNonce = errors.New("google: nonce mismatch")

// Exchange trades the code for tokens and verifies the ID token: signature,
// issuer, audience and expiry (go-oidc), then the nonce from this sign-in.
func (c *Client) Exchange(ctx context.Context, code, verifier, nonce string) (Identity, error) {
	if nonce == "" {
		return Identity{}, errNonce
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.http)
	tok, err := c.oauth.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return Identity{}, fmt.Errorf("google: exchange: %w", err)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" {
		return Identity{}, errors.New("google: no id_token in the token response")
	}
	idt, err := c.verifier.Verify(ctx, raw)
	if err != nil {
		return Identity{}, fmt.Errorf("google: verify id_token: %w", err)
	}
	if idt.Nonce != nonce {
		return Identity{}, errNonce
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		HD            string `json:"hd"`
		Name          string `json:"name"`
	}
	if err := idt.Claims(&claims); err != nil {
		return Identity{}, fmt.Errorf("google: claims: %w", err)
	}
	return Identity{
		Subject:       idt.Subject,
		Email:         claims.Email,
		EmailVerified: claims.EmailVerified,
		HostedDomain:  claims.HD,
		Name:          claims.Name,
	}, nil
}
