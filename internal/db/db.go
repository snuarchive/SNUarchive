// Package db opens PostgreSQL connections and applies migrations.
package db

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver for goose
	"github.com/pressly/goose/v3"

	"github.com/snuarchive/snuarchive/db/migrations"
)

type Options struct {
	URL        string
	MaxConns   int32
	PoolerMode bool
}

// Open connects and pings. PoolerMode switches to the simple protocol,
// because transaction-mode poolers (Supabase, pgbouncer) cannot keep
// prepared statements across transactions.
func Open(ctx context.Context, o Options) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(o.URL)
	if err != nil {
		return nil, fmt.Errorf("db: parse url: %w", err)
	}
	if o.MaxConns > 0 {
		cfg.MaxConns = o.MaxConns
	}
	if o.PoolerMode {
		cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return pool, nil
}

// Migrator applies the embedded migrations. It uses its own connection so
// migrations can target a direct (non-pooled) database URL.
type Migrator struct {
	provider *goose.Provider
}

func NewMigrator(url string) (*Migrator, error) {
	sqlDB, err := sql.Open("pgx", url)
	if err != nil {
		return nil, fmt.Errorf("db: open for migrations: %w", err)
	}
	p, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS)
	if err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("db: migrations: %w", err)
	}
	return &Migrator{provider: p}, nil
}

func (m *Migrator) Up(ctx context.Context) ([]*goose.MigrationResult, error) {
	return m.provider.Up(ctx)
}

func (m *Migrator) Down(ctx context.Context) (*goose.MigrationResult, error) {
	return m.provider.Down(ctx)
}

func (m *Migrator) Status(ctx context.Context) ([]*goose.MigrationStatus, error) {
	return m.provider.Status(ctx)
}

// Close closes the migration connection.
func (m *Migrator) Close() error { return m.provider.Close() }
