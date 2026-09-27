// Command snuarchive runs the SNU Archive API server and its maintenance tasks.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/db"
	"github.com/snuarchive/snuarchive/internal/db/dbq"
	"github.com/snuarchive/snuarchive/internal/httpapi"
	"github.com/snuarchive/snuarchive/internal/refdata"
	"github.com/snuarchive/snuarchive/internal/telemetry"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

const usage = `usage: snuarchive <command>

commands:
  serve             run the HTTP server
  migrate up        apply pending migrations
  migrate down      roll back the most recent migration
  migrate status    list migrations and whether they are applied
  version           print the build version
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, lookup config.LookupFunc, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	switch args[0] {
	case "version":
		fmt.Fprintln(stdout, version)
		return 0
	case "serve":
		return serve(ctx, lookup, stdout, stderr)
	case "migrate":
		return migrate(ctx, args[1:], lookup, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "unknown command %q\n\n%s", args[0], usage)
		return 2
	}
}

// migrate reads only DATABASE_URL so migrations can run before the rest of
// the environment exists. Point it at a direct connection, not a
// transaction-mode pooler.
func migrate(ctx context.Context, args []string, lookup config.LookupFunc, stdout, stderr io.Writer) int {
	if len(args) != 1 || (args[0] != "up" && args[0] != "down" && args[0] != "status") {
		fmt.Fprint(stderr, usage)
		return 2
	}
	url, _ := lookup("DATABASE_URL")
	if strings.TrimSpace(url) == "" {
		fmt.Fprintln(stderr, "migrate: DATABASE_URL is required")
		return 1
	}
	m, err := db.NewMigrator(url)
	if err != nil {
		fmt.Fprintln(stderr, "migrate:", err)
		return 1
	}
	defer m.Close()

	switch args[0] {
	case "up":
		results, err := m.Up(ctx)
		for _, r := range results {
			fmt.Fprintf(stdout, "applied  %s (%s)\n", r.Source.Path, r.Duration.Round(time.Millisecond))
		}
		if err != nil {
			fmt.Fprintln(stderr, "migrate up:", err)
			return 1
		}
		if len(results) == 0 {
			fmt.Fprintln(stdout, "no pending migrations")
		}
	case "down":
		r, err := m.Down(ctx)
		if err != nil {
			fmt.Fprintln(stderr, "migrate down:", err)
			return 1
		}
		fmt.Fprintf(stdout, "rolled back  %s\n", r.Source.Path)
	case "status":
		statuses, err := m.Status(ctx)
		if err != nil {
			fmt.Fprintln(stderr, "migrate status:", err)
			return 1
		}
		for _, s := range statuses {
			fmt.Fprintf(stdout, "%-8s %s\n", s.State, s.Source.Path)
		}
	}
	return 0
}

func serve(ctx context.Context, lookup config.LookupFunc, stdout, stderr io.Writer) int {
	cfg, warnings, err := config.Load(lookup)
	if err != nil {
		fmt.Fprintf(stderr, "config:\n%v\n", err)
		return 1
	}
	logger, shutdownTelemetry, err := telemetry.Setup(ctx, stdout, telemetry.Options{
		Format: cfg.Log.Format, Level: cfg.Log.Level, OTel: cfg.OTelEnabled,
		Service: "snuarchive", Version: version,
	})
	if err != nil {
		fmt.Fprintln(stderr, "telemetry:", err)
		return 1
	}
	for _, w := range warnings {
		logger.Warn("configuration", "warning", w)
	}

	pool, err := db.Open(ctx, db.Options{URL: cfg.DB.URL, MaxConns: cfg.DB.MaxConns, PoolerMode: cfg.DB.PoolerMode})
	if err != nil {
		logger.Error("database", "err", err)
		return 1
	}
	defer pool.Close()

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.New(httpapi.Deps{
			Config:  cfg,
			Logger:  logger,
			DB:      pool,
			RefData: refdata.New(dbq.New(pool), cfg.Upload.MaxBytes),
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	logger.Info("listening", "addr", cfg.HTTPAddr, "env", cfg.Env)

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server", "err", err)
			return 1
		}
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown", "err", err)
		return 1
	}
	if err := shutdownTelemetry(shutdownCtx); err != nil {
		logger.Warn("telemetry shutdown", "err", err)
	}
	logger.Info("stopped")
	return 0
}
