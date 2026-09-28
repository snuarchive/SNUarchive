package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

func env(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func runCLI(ctx context.Context, lookup func(string) (string, bool), args ...string) (int, string, string) {
	var out, errOut bytes.Buffer
	code := run(ctx, args, lookup, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestUsage(t *testing.T) {
	if code, _, stderr := runCLI(context.Background(), env(nil)); code != 2 || !strings.Contains(stderr, "usage:") {
		t.Fatalf("no args: %d %q", code, stderr)
	}
	if code, _, stderr := runCLI(context.Background(), env(nil), "frobnicate"); code != 2 || !strings.Contains(stderr, `unknown command "frobnicate"`) {
		t.Fatalf("unknown: %d %q", code, stderr)
	}
	if code, stdout, _ := runCLI(context.Background(), env(nil), "version"); code != 0 || strings.TrimSpace(stdout) != version {
		t.Fatalf("version: %d %q", code, stdout)
	}
}

func TestMigrateNeedsDatabaseURL(t *testing.T) {
	code, _, stderr := runCLI(context.Background(), env(nil), "migrate", "up")
	if code != 1 || !strings.Contains(stderr, "DATABASE_URL is required") {
		t.Fatalf("%d %q", code, stderr)
	}
}

func TestMigrateUpStatusDown(t *testing.T) {
	ctx := context.Background()
	lookup := env(map[string]string{"DATABASE_URL": pgtest.NewEmptyDatabase(t)})

	code, stdout, stderr := runCLI(ctx, lookup, "migrate", "up")
	if code != 0 || !strings.Contains(stdout, "applied") || !strings.Contains(stdout, "00001_init.sql") {
		t.Fatalf("up: %d %q %q", code, stdout, stderr)
	}
	code, stdout, _ = runCLI(ctx, lookup, "migrate", "up")
	if code != 0 || !strings.Contains(stdout, "no pending migrations") {
		t.Fatalf("second up: %d %q", code, stdout)
	}
	code, stdout, _ = runCLI(ctx, lookup, "migrate", "status")
	if code != 0 || !strings.Contains(stdout, "applied") {
		t.Fatalf("status: %d %q", code, stdout)
	}
	code, stdout, _ = runCLI(ctx, lookup, "migrate", "down", "--yes")
	if code != 0 || !strings.Contains(stdout, "rolled back") {
		t.Fatalf("down: %d %q", code, stdout)
	}
	if code, _, _ := runCLI(ctx, lookup, "migrate", "sideways"); code != 2 {
		t.Fatalf("bad subcommand: %d", code)
	}
}

func TestMigrateDownWithoutYesRefusesToRollBack(t *testing.T) {
	ctx := context.Background()
	lookup := env(map[string]string{"DATABASE_URL": pgtest.NewEmptyDatabase(t)})

	code, _, stderr := runCLI(ctx, lookup, "migrate", "up")
	if code != 0 {
		t.Fatalf("up: %d %q", code, stderr)
	}

	code, stdout, stderr := runCLI(ctx, lookup, "migrate", "down")
	if code != 1 || !strings.Contains(stderr, "00002_google_sub.sql") || !strings.Contains(stderr, "--yes") {
		t.Fatalf("down without --yes: %d %q %q", code, stdout, stderr)
	}

	code, stdout, _ = runCLI(ctx, lookup, "migrate", "status")
	if code != 0 || !strings.Contains(stdout, "applied") {
		t.Fatalf("status after refused down: %d %q", code, stdout)
	}
}

func TestMigrateDownWithoutYesWhenNothingApplied(t *testing.T) {
	ctx := context.Background()
	lookup := env(map[string]string{"DATABASE_URL": pgtest.NewEmptyDatabase(t)})

	code, stdout, stderr := runCLI(ctx, lookup, "migrate", "down")
	if code != 1 {
		t.Fatalf("down with nothing applied: %d %q %q", code, stdout, stderr)
	}
}

func TestMigrateYesRejectedExceptForDown(t *testing.T) {
	ctx := context.Background()
	lookup := env(map[string]string{"DATABASE_URL": pgtest.NewEmptyDatabase(t)})

	if code, _, _ := runCLI(ctx, lookup, "migrate", "up", "--yes"); code != 2 {
		t.Fatalf("migrate up --yes: %d", code)
	}
	if code, _, _ := runCLI(ctx, lookup, "migrate", "status", "--yes"); code != 2 {
		t.Fatalf("migrate status --yes: %d", code)
	}
}

func TestDevSeed(t *testing.T) {
	ctx := context.Background()
	url := pgtest.NewDatabase(t)
	if code, _, stderr := runCLI(ctx, env(map[string]string{"DATABASE_URL": url}), "dev", "seed"); code != 1 || !strings.Contains(stderr, "APP_ENV must be development") {
		t.Fatalf("without APP_ENV: %d %q", code, stderr)
	}
	prod := env(map[string]string{"DATABASE_URL": url, "APP_ENV": "production"})
	if code, _, _ := runCLI(ctx, prod, "dev", "seed"); code != 1 {
		t.Fatalf("production: %d", code)
	}
	dev := env(map[string]string{"DATABASE_URL": url, "APP_ENV": "development"})
	if code, stdout, stderr := runCLI(ctx, dev, "dev", "seed"); code != 0 || !strings.Contains(stdout, "seeded") {
		t.Fatalf("seed: %d %q %q", code, stdout, stderr)
	}
	if code, _, _ := runCLI(ctx, dev, "dev", "sow"); code != 2 {
		t.Fatalf("bad subcommand: %d", code)
	}
}

func TestServeRejectsBadConfig(t *testing.T) {
	code, _, stderr := runCLI(context.Background(), env(nil), "serve")
	if code != 1 || !strings.Contains(stderr, "DATABASE_URL is required") {
		t.Fatalf("%d %q", code, stderr)
	}
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()
	return addr
}

// startServe runs "serve" in the background and waits for it to answer
// /healthz. The caller must stopServe it.
func startServe(t *testing.T, lookup func(string) (string, bool), addr string) (context.CancelFunc, <-chan int) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan int, 1)
	go func() { code, _, _ := runCLI(ctx, lookup, "serve"); done <- code }()

	deadline := time.Now().Add(15 * time.Second)
	for {
		resp, err := http.Get("http://" + addr + "/healthz")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatalf("server did not become healthy: %v", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	return cancel, done
}

func stopServe(t *testing.T, cancel context.CancelFunc, done <-chan int) {
	t.Helper()
	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit code %d", code)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("server did not shut down")
	}
}

func TestServeAndShutdown(t *testing.T) {
	addr := freeAddr(t)
	lookup := env(map[string]string{
		"APP_ENV":           "development",
		"APP_ORIGIN":        "http://localhost:3000",
		"DATABASE_URL":      pgtest.NewDatabase(t),
		"SESSION_KEYS":      base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("k"), 32)),
		"DEV_LOGIN_ENABLED": "true",
		"HTTP_ADDR":         addr,
		"LOG_LEVEL":         "warn",
	})
	cancel, done := startServe(t, lookup, addr)

	resp, err := http.Get("http://" + addr + "/api/v1/config")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("config: %v %v", resp, err)
	}
	resp.Body.Close()

	// dev-login must reach a live account through Deps.Accounts, and the
	// session it starts must authenticate /me: proof that serve wires
	// sign-in end to end, not just that the process answers requests.
	req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/api/v1/auth/dev-login", strings.NewReader(`{"email":"kim@snu.ac.kr"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusNoContent {
		t.Fatalf("dev-login: %v %v", resp, err)
	}
	var session *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == "snu_session" {
			session = c
		}
	}
	resp.Body.Close()
	if session == nil {
		t.Fatal("dev-login did not set snu_session")
	}

	req, err = http.NewRequest(http.MethodGet, "http://"+addr+"/api/v1/me", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(session)
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("me: %v %v", resp, err)
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil || !strings.Contains(string(body), `"email":"kim@snu.ac.kr"`) {
		t.Fatalf("me body: %q %v", body, err)
	}

	stopServe(t, cancel, done)
}

// TestServeRedirectsToGoogle proves serve wires the Google client: with no
// dev login, /auth/google must send the browser to accounts.google.com with
// a redirect_uri that matches APP_ORIGIN.
func TestServeRedirectsToGoogle(t *testing.T) {
	addr := freeAddr(t)
	lookup := env(map[string]string{
		"APP_ORIGIN":           "http://localhost:3000",
		"DATABASE_URL":         pgtest.NewDatabase(t),
		"SESSION_KEYS":         base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("k"), 32)),
		"GOOGLE_CLIENT_ID":     "test-client-id",
		"GOOGLE_CLIENT_SECRET": "test-client-secret",
		"HTTP_ADDR":            addr,
		"LOG_LEVEL":            "warn",
	})
	cancel, done := startServe(t, lookup, addr)
	defer stopServe(t, cancel, done)

	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get("http://" + addr + "/api/v1/auth/google")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	loc, err := url.Parse(resp.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if loc.Host != "accounts.google.com" {
		t.Fatalf("host = %s", loc.Host)
	}
	if got := loc.Query().Get("redirect_uri"); got != "http://localhost:3000/api/v1/auth/google/callback" {
		t.Fatalf("redirect_uri = %s", got)
	}
}
