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
	if err != nil || len(res) != 2 {
		t.Fatalf("up: %d results, %v", len(res), err)
	}
	if n := publicTables(t, url); n != 21 {
		t.Fatalf("after up: %d tables, want 21", n)
	}
	status, err := m.Status(ctx)
	if err != nil || len(status) != 2 || status[0].State != "applied" || status[1].State != "applied" {
		t.Fatalf("status = %+v, %v", status, err)
	}
	for range 2 {
		if _, err := m.Down(ctx); err != nil {
			t.Fatalf("down: %v", err)
		}
	}
	if n := publicTables(t, url); n != 0 {
		t.Fatalf("after down: %d tables left", n)
	}
	if _, err := m.Up(ctx); err != nil {
		t.Fatalf("second up: %v", err)
	}
}

// Rolling back 00002 must not fail on an account that only its Google sub
// kept alive: the old rules need an email on every live row, so such a row
// is scrubbed. Deleting it would break the rows that reference it.
func TestGoogleSubDownScrubsSubOnlyAccounts(t *testing.T) {
	ctx := context.Background()
	url := pgtest.NewEmptyDatabase(t)
	m, err := db.NewMigrator(url)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	if _, err := m.Up(ctx); err != nil {
		t.Fatal(err)
	}
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var id int64
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (google_sub, display_name) VALUES ('108', '김철수') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `INSERT INTO activity_logs (user_id, action) VALUES ($1, 'login')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Down(ctx); err != nil {
		t.Fatalf("down 00002: %v", err)
	}
	var deleted bool
	var name *string
	if err := conn.QueryRow(ctx, `SELECT deleted_at IS NOT NULL, display_name FROM users WHERE id = $1`, id).Scan(&deleted, &name); err != nil {
		t.Fatal(err)
	}
	if !deleted || name != nil {
		t.Fatalf("sub-only account after down: deleted=%v name=%v", deleted, name)
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
