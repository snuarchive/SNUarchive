package db_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/snuarchive/snuarchive/internal/db"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func publicTables(t *testing.T, url string) int {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var n int
	err = conn.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'goose_db_version'`).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestMigrationsUpDownUp(t *testing.T) {
	ctx := context.Background()
	url := pgtest.NewEmptyDatabase(t)
	m, err := db.NewMigrator(url)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	res, err := m.Up(ctx)
	if err != nil || len(res) != 1 {
		t.Fatalf("up: %d results, %v", len(res), err)
	}
	if n := publicTables(t, url); n != 21 {
		t.Fatalf("after up: %d tables, want 21", n)
	}
	status, err := m.Status(ctx)
	if err != nil || len(status) != 1 || status[0].State != "applied" {
		t.Fatalf("status = %+v, %v", status, err)
	}
	if _, err := m.Down(ctx); err != nil {
		t.Fatalf("down: %v", err)
	}
	if n := publicTables(t, url); n != 0 {
		t.Fatalf("after down: %d tables left", n)
	}
	if _, err := m.Up(ctx); err != nil {
		t.Fatalf("second up: %v", err)
	}
}

func TestOpenInPoolerMode(t *testing.T) {
	ctx := context.Background()
	pool, err := db.Open(ctx, db.Options{URL: pgtest.NewDatabase(t), MaxConns: 2, PoolerMode: true})
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var kinds int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assessment_kinds WHERE code = $1 OR code = $2`, "exam", "quiz").Scan(&kinds); err != nil {
		t.Fatal(err)
	}
	if kinds != 2 {
		t.Fatalf("kinds = %d", kinds)
	}
}

func TestOpenRejectsBadURL(t *testing.T) {
	if _, err := db.Open(context.Background(), db.Options{URL: "not a url ::"}); err == nil {
		t.Fatal("want an error")
	}
}
