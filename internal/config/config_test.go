package config_test

import (
	"bytes"
	"encoding/base64"
	"log/slog"
	"maps"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/config"
)

var key32 = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("k"), 32))

func minimal() map[string]string {
	return map[string]string{
		"APP_ORIGIN":           "https://archive.example.com",
		"DATABASE_URL":         "postgres://u:p@localhost:5432/db",
		"SESSION_KEYS":         key32,
		"GOOGLE_CLIENT_ID":     "id",
		"GOOGLE_CLIENT_SECRET": "secret",
	}
}

// with returns a copy of base with key/value pairs applied; "" unsets a key.
func with(base map[string]string, kv ...string) map[string]string {
	out := maps.Clone(base)
	for i := 0; i < len(kv); i += 2 {
		out[kv[i]] = kv[i+1]
	}
	return out
}

func load(t *testing.T, env map[string]string) (*config.Config, []string, error) {
	t.Helper()
	return config.Load(func(k string) (string, bool) { v, ok := env[k]; return v, ok })
}

func TestDefaults(t *testing.T) {
	c, warnings, err := load(t, minimal())
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings = %v", warnings)
	}
	checks := []struct {
		name      string
		got, want any
	}{
		{"env", c.Env, config.Production},
		{"http addr", c.HTTPAddr, ":8080"},
		{"db max conns", c.DB.MaxConns, int32(10)},
		{"pooler", c.DB.PoolerMode, false},
		{"session ttl", c.Session.TTL, 168 * time.Hour},
		{"storage", c.Storage.Driver, "fs"},
		{"fs root", c.Storage.FSRoot, "/data/uploads"},
		{"upload max", c.Upload.MaxBytes, int64(3 << 20)},
		{"upload gc", c.Upload.GCAfter, 24 * time.Hour},
		{"archive format", c.Archive.Format, "jsonl"},
		{"retention days", c.Retention.Days, 365},
		{"archive after", c.Archive.AfterDays, 90},
		{"export max", c.ExportMaxRows, 1_000_000},
		{"log format", c.Log.Format, "json"},
		{"log level", c.Log.Level, slog.LevelInfo},
		{"otel", c.OTelEnabled, false},
	}
	for _, ch := range checks {
		if ch.got != ch.want {
			t.Errorf("%s = %v, want %v", ch.name, ch.got, ch.want)
		}
	}
}

func TestDevelopmentLogDefaults(t *testing.T) {
	c, _, err := load(t, with(minimal(), "APP_ENV", "development"))
	if err != nil {
		t.Fatal(err)
	}
	if c.Log.Format != "text" || c.Log.Level != slog.LevelDebug || !c.IsDevelopment() {
		t.Fatalf("log = %+v, dev = %v", c.Log, c.IsDevelopment())
	}
}

func TestDevLoginSkipsGoogle(t *testing.T) {
	env := with(minimal(), "APP_ENV", "development", "DEV_LOGIN_ENABLED", "true",
		"GOOGLE_CLIENT_ID", "", "GOOGLE_CLIENT_SECRET", "")
	if _, _, err := load(t, env); err != nil {
		t.Fatal(err)
	}
}

func TestErrors(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
		want string
	}{
		{"missing database", with(minimal(), "DATABASE_URL", ""), "DATABASE_URL is required"},
		{"origin with path", with(minimal(), "APP_ORIGIN", "https://x.example.com/app"), "APP_ORIGIN must be an origin"},
		{"origin without scheme", with(minimal(), "APP_ORIGIN", "x.example.com"), "APP_ORIGIN must be an origin"},
		{"short session key", with(minimal(), "SESSION_KEYS", base64.StdEncoding.EncodeToString([]byte("short"))), "SESSION_KEYS entry 1 must be base64 of at least 32 bytes"},
		{"dev login in production", with(minimal(), "DEV_LOGIN_ENABLED", "true"), "DEV_LOGIN_ENABLED must not be true unless APP_ENV=development"},
		{"google missing", with(minimal(), "GOOGLE_CLIENT_ID", ""), "GOOGLE_CLIENT_ID is required"},
		{"non snu admin", with(minimal(), "ADMIN_EMAILS", "a@gmail.com"), "must be an @snu.ac.kr address"},
		{"upload above cap", with(minimal(), "UPLOAD_MAX_BYTES", "4000000"), "UPLOAD_MAX_BYTES must be an integer between 1 and 3145728"},
		{"s3 without bucket", with(minimal(), "STORAGE_DRIVER", "s3"), "S3_BUCKET is required"},
		{"unknown storage", with(minimal(), "STORAGE_DRIVER", "ftp"), "STORAGE_DRIVER must be one of fs, s3"},
		{"archive without drive", with(minimal(), "LOG_ARCHIVE_ENABLED", "true"), "GDRIVE_AUTH is required when LOG_ARCHIVE_ENABLED=true"},
		{"oauth without token", with(minimal(), "LOG_ARCHIVE_ENABLED", "true", "GDRIVE_AUTH", "oauth", "GDRIVE_FOLDER_ID", "f",
			"GDRIVE_OAUTH_CLIENT_ID", "c", "GDRIVE_OAUTH_CLIENT_SECRET", "s"), "GDRIVE_OAUTH_REFRESH_TOKEN is required when GDRIVE_AUTH=oauth"},
		{"service account without key", with(minimal(), "LOG_ARCHIVE_ENABLED", "true", "GDRIVE_AUTH", "service_account", "GDRIVE_FOLDER_ID", "f"), "GDRIVE_SERVICE_ACCOUNT_JSON is required when GDRIVE_AUTH=service_account"},
		{"bad archive format", with(minimal(), "LOG_ARCHIVE_FORMAT", "xml"), "LOG_ARCHIVE_FORMAT must be one of json, jsonl, csv, xlsx, parquet"},
		{"bad bool", with(minimal(), "SCHEDULER_ENABLED", "yes"), "SCHEDULER_ENABLED must be true or false"},
		{"short cron secret", with(minimal(), "CRON_SECRET", "abc"), "CRON_SECRET must be at least 32 characters"},
		{"bad proxy", with(minimal(), "TRUSTED_PROXIES", "nope"), `TRUSTED_PROXIES entry "nope" is not an IP address or CIDR`},
		{"bad log level", with(minimal(), "LOG_LEVEL", "loud"), "LOG_LEVEL must be debug, info, warn or error"},
		{"bad duration", with(minimal(), "SESSION_TTL", "-1h"), "SESSION_TTL must be a positive duration"},
		{"bad env", with(minimal(), "APP_ENV", "staging"), "APP_ENV must be one of development, production"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := load(t, tc.env)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

func TestReportsEveryProblemAtOnce(t *testing.T) {
	_, _, err := load(t, map[string]string{})
	if err == nil {
		t.Fatal("empty environment must fail")
	}
	for _, key := range []string{"APP_ORIGIN", "DATABASE_URL", "SESSION_KEYS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error does not mention %s:\n%v", key, err)
		}
	}
}

func TestNormalization(t *testing.T) {
	env := with(minimal(),
		"APP_ORIGIN", "https://archive.example.com/",
		"ADMIN_EMAILS", " A@SNU.AC.KR , b@snu.ac.kr ,",
		"TRUSTED_PROXIES", "10.0.0.1, 172.30.0.0/24",
		"SESSION_KEYS", key32+","+key32,
	)
	c, _, err := load(t, env)
	if err != nil {
		t.Fatal(err)
	}
	if c.AppOrigin != "https://archive.example.com" {
		t.Errorf("origin = %q", c.AppOrigin)
	}
	if strings.Join(c.AdminEmails, ",") != "a@snu.ac.kr,b@snu.ac.kr" {
		t.Errorf("admins = %v", c.AdminEmails)
	}
	want := []netip.Prefix{netip.MustParsePrefix("10.0.0.1/32"), netip.MustParsePrefix("172.30.0.0/24")}
	if len(c.TrustedProxies) != 2 || c.TrustedProxies[0] != want[0] || c.TrustedProxies[1] != want[1] {
		t.Errorf("proxies = %v", c.TrustedProxies)
	}
	if len(c.Session.Keys) != 2 || len(c.Session.Keys[0]) != 32 {
		t.Errorf("keys = %d", len(c.Session.Keys))
	}
}

// Browsers send Origin with a lower-case scheme and host and no default
// port, and the CSRF check compares it exactly.
func TestOriginMatchesBrowserForm(t *testing.T) {
	cases := map[string]string{
		"HTTPS://Archive.Example.com:443/": "https://archive.example.com",
		"http://localhost:80":              "http://localhost",
		"http://localhost:8088":            "http://localhost:8088",
		"https://archive.example.com:80":   "https://archive.example.com:80",
	}
	for in, want := range cases {
		c, _, err := load(t, with(minimal(), "APP_ORIGIN", in))
		if err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		if c.AppOrigin != want {
			t.Errorf("%s: origin = %q, want %q", in, c.AppOrigin, want)
		}
	}
}

func TestWarnsWhenRetentionPrecedesArchive(t *testing.T) {
	env := with(minimal(),
		"LOG_RETENTION_ENABLED", "true", "LOG_RETENTION_DAYS", "30",
		"LOG_ARCHIVE_ENABLED", "true", "LOG_ARCHIVE_AFTER_DAYS", "90",
		"GDRIVE_AUTH", "oauth", "GDRIVE_FOLDER_ID", "f",
		"GDRIVE_OAUTH_CLIENT_ID", "c", "GDRIVE_OAUTH_CLIENT_SECRET", "s", "GDRIVE_OAUTH_REFRESH_TOKEN", "r",
	)
	_, warnings, err := load(t, env)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "deleted before they are archived") {
		t.Fatalf("warnings = %v", warnings)
	}
}

func TestServiceAccountJSONIsDecoded(t *testing.T) {
	raw := `{"type":"service_account"}`
	env := with(minimal(), "LOG_ARCHIVE_ENABLED", "true", "GDRIVE_AUTH", "service_account", "GDRIVE_FOLDER_ID", "f",
		"GDRIVE_SERVICE_ACCOUNT_JSON", base64.StdEncoding.EncodeToString([]byte(raw)))
	c, _, err := load(t, env)
	if err != nil {
		t.Fatal(err)
	}
	if string(c.GDrive.ServiceAccountJSON) != raw {
		t.Fatalf("json = %q", c.GDrive.ServiceAccountJSON)
	}
}

func TestS3(t *testing.T) {
	env := with(minimal(), "STORAGE_DRIVER", "s3", "S3_BUCKET", "b", "S3_ACCESS_KEY_ID", "a",
		"S3_SECRET_ACCESS_KEY", "s", "S3_ENDPOINT", "https://s3.example.com", "S3_FORCE_PATH_STYLE", "true")
	c, _, err := load(t, env)
	if err != nil {
		t.Fatal(err)
	}
	if c.Storage.S3.Bucket != "b" || c.Storage.S3.Region != "us-east-1" || !c.Storage.S3.ForcePathStyle {
		t.Fatalf("s3 = %+v", c.Storage.S3)
	}
}
