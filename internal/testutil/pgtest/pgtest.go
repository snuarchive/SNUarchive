// Package pgtest runs integration tests against a throwaway PostgreSQL 18.
// One container serves a whole test binary; every test gets its own
// database cloned from a migrated template, so tests can commit, lock and
// run concurrently without seeing each other.
package pgtest

import (
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/snuarchive/snuarchive/internal/db"
)

const (
	image      = "postgres:18"
	templateDB = "snu_template"
)

var (
	base    *url.URL
	counter atomic.Int64
)

// Main starts the container, migrates the template database, runs the tests
// and removes the container. Call it from TestMain. With -short it only runs
// the tests; the helpers below then skip.
func Main(m *testing.M) {
	flag.Parse()
	if testing.Short() {
		os.Exit(m.Run())
	}
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx := context.Background()
	c, err := postgres.Run(ctx, image,
		postgres.WithDatabase(templateDB),
		postgres.WithUsername("snu"),
		postgres.WithPassword("snu"),
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pgtest: start postgres (is Docker running?):", err)
		return 1
	}
	defer func() { _ = testcontainers.TerminateContainer(c) }()

	tmplURL, err := c.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintln(os.Stderr, "pgtest:", err)
		return 1
	}
	if err := migrate(ctx, tmplURL); err != nil {
		fmt.Fprintln(os.Stderr, "pgtest: migrate template:", err)
		return 1
	}
	base, err = url.Parse(tmplURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pgtest:", err)
		return 1
	}
	return m.Run()
}

func migrate(ctx context.Context, u string) error {
	m, err := db.NewMigrator(u)
	if err != nil {
		return err
	}
	defer m.Close() // the template must have no open connections before it is cloned
	_, err = m.Up(ctx)
	return err
}

func urlFor(name string) string {
	u := *base
	u.Path = "/" + name
	return u.String()
}

func admin(t testing.TB, sql string) {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, urlFor("postgres"))
	if err != nil {
		t.Fatalf("pgtest: connect: %v", err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, sql); err != nil {
		t.Fatalf("pgtest: %s: %v", sql, err)
	}
}

func create(t testing.TB, template string) string {
	t.Helper()
	if testing.Short() {
		t.Skip("pgtest: database test skipped with -short")
	}
	if base == nil {
		t.Fatal("pgtest: call pgtest.Main from TestMain")
	}
	name := fmt.Sprintf("t_%d_%d", os.Getpid(), counter.Add(1))
	admin(t, fmt.Sprintf("CREATE DATABASE %s TEMPLATE %s", name, template))
	t.Cleanup(func() { admin(t, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", name)) })
	return urlFor(name)
}

// NewDatabase returns the URL of a fresh, fully migrated database.
func NewDatabase(t testing.TB) string { return create(t, templateDB) }

// NewEmptyDatabase returns the URL of a fresh database with no schema.
func NewEmptyDatabase(t testing.TB) string { return create(t, "template0") }

// New returns a pool on a fresh, fully migrated database.
func New(t testing.TB) *pgxpool.Pool {
	t.Helper()
	u := NewDatabase(t)
	pool, err := pgxpool.New(context.Background(), u)
	if err != nil {
		t.Fatalf("pgtest: pool: %v", err)
	}
	t.Cleanup(pool.Close) // registered after the drop, so it runs first
	return pool
}
