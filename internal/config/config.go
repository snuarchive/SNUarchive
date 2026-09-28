// Package config reads every environment variable the server uses and
// validates them together, so a misconfigured server refuses to start.
// The variables are documented in the design spec, section 6.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"time"
)

// LookupFunc matches os.LookupEnv.
type LookupFunc func(key string) (string, bool)

type Env string

const (
	Development Env = "development"
	Production  Env = "production"
)

// MaxUploadBytes is the ceiling enforced by pending_reports_size_ck.
const MaxUploadBytes = 3 << 20

// ExportFormats are the log export and archive formats.
var ExportFormats = []string{"json", "jsonl", "csv", "xlsx", "parquet"}

type Config struct {
	Env              Env
	AppOrigin        string // scheme://host[:port], no trailing slash
	HTTPAddr         string
	DB               DB
	Session          Session
	Google           Google
	AdminEmails      []string
	DevLoginEnabled  bool
	TrustedProxies   []netip.Prefix
	Storage          Storage
	Upload           Upload
	SchedulerEnabled bool
	CronSecret       string
	Retention        Retention
	Archive          Archive
	GDrive           GDrive
	ExportMaxRows    int
	Log              Log
	OTelEnabled      bool
}

type DB struct {
	URL        string
	MaxConns   int32
	PoolerMode bool
}

type Session struct {
	Keys   [][]byte // first signs, all verify
	TTL    time.Duration
	MaxAge time.Duration // hard cap from sign-in; renewals never pass it
}

type Google struct {
	ClientID     string
	ClientSecret string
}

type Storage struct {
	Driver string // "fs" or "s3"
	FSRoot string
	S3     S3
}

type S3 struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	Prefix          string
	ForcePathStyle  bool
}

type Upload struct {
	MaxBytes int64
	GCAfter  time.Duration
}

type Retention struct {
	Enabled bool
	Days    int
}

type Archive struct {
	Enabled   bool
	AfterDays int
	Format    string
	Interval  time.Duration
}

type GDrive struct {
	Auth               string // "", "service_account" or "oauth"
	FolderID           string
	ServiceAccountJSON []byte
	OAuthClientID      string
	OAuthClientSecret  string
	OAuthRefreshToken  string
}

type Log struct {
	Format string // "json" or "text"
	Level  slog.Level
}

func (c *Config) IsDevelopment() bool { return c.Env == Development }

// LogValue lists only settings that are safe to log. The database URL is left
// out because it may carry a password. The value receiver makes slog use this
// for both Config and *Config.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("env", string(c.Env)),
		slog.String("app_origin", c.AppOrigin),
		slog.String("http_addr", c.HTTPAddr),
		slog.Group("db", "max_conns", c.DB.MaxConns, "pooler_mode", c.DB.PoolerMode),
		slog.String("storage_driver", c.Storage.Driver),
		slog.Bool("dev_login_enabled", c.DevLoginEnabled),
		slog.Bool("scheduler_enabled", c.SchedulerEnabled),
		slog.Bool("retention_enabled", c.Retention.Enabled),
		slog.Bool("archive_enabled", c.Archive.Enabled),
		slog.Bool("otel_enabled", c.OTelEnabled),
		slog.Group("log", "format", c.Log.Format, "level", c.Log.Level.String()),
	)
}

// Load reads the configuration through lookup. It reports every invalid
// variable at once and, separately, warnings for settings that work but are
// probably not what the operator meant.
func Load(lookup LookupFunc) (*Config, []string, error) {
	p := &parser{lookup: lookup}
	c := &Config{}

	c.Env = Env(p.oneOf("APP_ENV", string(Production), string(Development), string(Production)))
	dev := c.Env == Development

	c.AppOrigin = p.origin("APP_ORIGIN")
	c.HTTPAddr = p.str("HTTP_ADDR", ":8080")
	c.DB = DB{
		URL:        p.required("DATABASE_URL"),
		MaxConns:   int32(p.integer("DB_MAX_CONNS", 10, 1, 1000)),
		PoolerMode: p.boolean("DB_POOLER_MODE", false),
	}
	c.Session = Session{
		Keys:   p.sessionKeys("SESSION_KEYS"),
		TTL:    p.duration("SESSION_TTL", 168*time.Hour),
		MaxAge: p.duration("SESSION_MAX_AGE", 720*time.Hour),
	}
	if c.Session.MaxAge < c.Session.TTL {
		p.fail("SESSION_MAX_AGE", "must not be shorter than SESSION_TTL")
	}

	c.DevLoginEnabled = p.boolean("DEV_LOGIN_ENABLED", false)
	if c.DevLoginEnabled && !dev {
		p.fail("DEV_LOGIN_ENABLED", "must not be true unless APP_ENV=development")
	}
	c.Google = Google{ClientID: p.str("GOOGLE_CLIENT_ID", ""), ClientSecret: p.str("GOOGLE_CLIENT_SECRET", "")}
	if !(dev && c.DevLoginEnabled) {
		if c.Google.ClientID == "" {
			p.fail("GOOGLE_CLIENT_ID", "is required")
		}
		if c.Google.ClientSecret == "" {
			p.fail("GOOGLE_CLIENT_SECRET", "is required")
		}
	}
	c.AdminEmails = p.adminEmails("ADMIN_EMAILS")
	c.TrustedProxies = p.prefixes("TRUSTED_PROXIES")

	c.Storage.Driver = p.oneOf("STORAGE_DRIVER", "fs", "fs", "s3")
	switch c.Storage.Driver {
	case "fs":
		c.Storage.FSRoot = p.str("STORAGE_FS_ROOT", "/data/uploads")
	case "s3":
		c.Storage.S3 = S3{
			Endpoint:        p.str("S3_ENDPOINT", ""),
			Region:          p.str("S3_REGION", "us-east-1"),
			Bucket:          p.required("S3_BUCKET"),
			AccessKeyID:     p.required("S3_ACCESS_KEY_ID"),
			SecretAccessKey: p.required("S3_SECRET_ACCESS_KEY"),
			Prefix:          p.str("S3_PREFIX", ""),
			ForcePathStyle:  p.boolean("S3_FORCE_PATH_STYLE", false),
		}
	}
	c.Upload = Upload{
		MaxBytes: int64(p.integer("UPLOAD_MAX_BYTES", MaxUploadBytes, 1, MaxUploadBytes)),
		GCAfter:  p.duration("UPLOAD_GC_AFTER", 24*time.Hour),
	}

	c.SchedulerEnabled = p.boolean("SCHEDULER_ENABLED", false)
	c.CronSecret = p.str("CRON_SECRET", "")
	if c.CronSecret != "" && len(c.CronSecret) < 32 {
		p.fail("CRON_SECRET", "must be at least 32 characters")
	}
	c.Retention = Retention{
		Enabled: p.boolean("LOG_RETENTION_ENABLED", false),
		Days:    p.integer("LOG_RETENTION_DAYS", 365, 1, 36500),
	}
	c.Archive = Archive{
		Enabled:   p.boolean("LOG_ARCHIVE_ENABLED", false),
		AfterDays: p.integer("LOG_ARCHIVE_AFTER_DAYS", 90, 1, 36500),
		Format:    p.oneOf("LOG_ARCHIVE_FORMAT", "jsonl", ExportFormats...),
		Interval:  p.duration("LOG_ARCHIVE_INTERVAL", 24*time.Hour),
	}
	c.GDrive = p.gdrive(c.Archive.Enabled)
	c.ExportMaxRows = p.integer("EXPORT_MAX_ROWS", 1_000_000, 1, 100_000_000)

	logFormat, logLevel := "json", "info"
	if dev {
		logFormat, logLevel = "text", "debug"
	}
	c.Log = Log{Format: p.oneOf("LOG_FORMAT", logFormat, "json", "text"), Level: p.level("LOG_LEVEL", logLevel)}
	c.OTelEnabled = p.boolean("OTEL_ENABLED", false)

	var warnings []string
	if c.Retention.Enabled && c.Archive.Enabled && c.Retention.Days <= c.Archive.AfterDays {
		warnings = append(warnings, fmt.Sprintf(
			"LOG_RETENTION_DAYS (%d) <= LOG_ARCHIVE_AFTER_DAYS (%d): logs are deleted before they are archived",
			c.Retention.Days, c.Archive.AfterDays))
	}
	if err := errors.Join(p.errs...); err != nil {
		return nil, warnings, err
	}
	return c, warnings, nil
}
