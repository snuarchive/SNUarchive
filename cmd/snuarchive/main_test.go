package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"net"
	"net/http"
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
	resp, err := http.Get("http://" + addr + "/api/v1/config")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("config: %v %v", resp, err)
	}
	resp.Body.Close()

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
