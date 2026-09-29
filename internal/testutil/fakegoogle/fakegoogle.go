// Package fakegoogle is a stand-in for Google's token and key endpoints, so
// the sign-in flow can be tested end to end without network access. The
// authorization page itself is a browser step; tests read the state, nonce
// and PKCE challenge from the redirect URL and call Grant with them.
package fakegoogle

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"

	"github.com/snuarchive/snuarchive/internal/google"
)

const ClientID = "test-client"

// Claims describe the ID token a code will be exchanged for. Zero values get
// working defaults: this server as issuer, ClientID as audience, an hour of
// validity.
type Claims struct {
	Subject       string
	Email         string
	EmailVerified bool
	HostedDomain  string
	Name          string
	Nonce         string
	Issuer        string
	Audience      string
	Expiry        time.Time
}

type grant struct {
	challenge string
	claims    Claims
}

type Server struct {
	*httptest.Server
	key    *rsa.PrivateKey
	mu     sync.Mutex
	grants map[string]grant
}

func New(t testing.TB) *Server {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{key: key, grants: map[string]grant{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /certs", s.certs)
	mux.HandleFunc("POST /token", s.token)
	s.Server = httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s
}

// Options points a google.Client at this server.
func (s *Server) Options(redirectURL string) google.Options {
	return google.Options{
		ClientID:     ClientID,
		ClientSecret: "test-secret",
		RedirectURL:  redirectURL,
		Issuer:       s.URL,
		AuthURL:      s.URL + "/auth",
		TokenURL:     s.URL + "/token",
		JWKSURL:      s.URL + "/certs",
		HTTPClient:   s.Client(),
	}
}

// Grant makes code exchangeable once, by the verifier whose S256 challenge
// is challenge, for an ID token carrying c.
func (s *Server) Grant(code, challenge string, c Claims) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.grants[code] = grant{challenge: challenge, claims: c}
}

func (s *Server) certs(w http.ResponseWriter, _ *http.Request) {
	set := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &s.key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(set)
}

func (s *Server) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	g, ok := s.grants[r.PostForm.Get("code")]
	delete(s.grants, r.PostForm.Get("code"))
	s.mu.Unlock()
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if !ok || base64.RawURLEncoding.EncodeToString(sum[:]) != g.challenge {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	idToken, err := s.sign(g.claims)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": "at", "token_type": "Bearer", "expires_in": 3600, "id_token": idToken,
	})
}

func (s *Server) sign(c Claims) (string, error) {
	if c.Issuer == "" {
		c.Issuer = s.URL
	}
	if c.Audience == "" {
		c.Audience = ClientID
	}
	if c.Expiry.IsZero() {
		c.Expiry = time.Now().Add(time.Hour)
	}
	body, err := json.Marshal(map[string]any{
		"iss": c.Issuer, "aud": c.Audience, "sub": c.Subject,
		"iat": time.Now().Unix(), "exp": c.Expiry.Unix(), "nonce": c.Nonce,
		"email": c.Email, "email_verified": c.EmailVerified, "hd": c.HostedDomain, "name": c.Name,
	})
	if err != nil {
		return "", err
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: s.key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"))
	if err != nil {
		return "", err
	}
	obj, err := signer.Sign(body)
	if err != nil {
		return "", err
	}
	return obj.CompactSerialize()
}
