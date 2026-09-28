package db_test

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"testing"

	"github.com/snuarchive/snuarchive/internal/apperr"
	"github.com/snuarchive/snuarchive/internal/db"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

// Every named CHECK, FOREIGN KEY and UNIQUE constraint (and unique index)
// in the schema, plus the trigger-raised names, must be classified, and the
// map must not name constraints that no longer exist.
func TestEveryConstraintIsClassified(t *testing.T) {
	pool := pgtest.New(t)
	rows, err := pool.Query(context.Background(), `
		SELECT c.conname FROM pg_constraint c
		JOIN pg_namespace n ON n.oid = c.connamespace
		WHERE n.nspname = 'public' AND c.contype IN ('c', 'f', 'u')
		UNION
		SELECT ic.relname FROM pg_index i
		JOIN pg_class ic ON ic.oid = i.indexrelid
		JOIN pg_namespace n ON n.oid = ic.relnamespace
		WHERE n.nspname = 'public' AND i.indisunique AND NOT i.indisprimary
		UNION
		SELECT unnest(ARRAY['exam_sittings_number_ck', 'pending_reports_number_ck'])`)
	if err != nil {
		t.Fatal(err)
	}
	var inSchema []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		inSchema = append(inSchema, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	classified := db.ClassifiedConstraints()
	for _, name := range inSchema {
		if !slices.Contains(classified, name) {
			t.Errorf("constraint %s is not classified in internal/db/errors.go", name)
		}
	}
	for _, name := range classified {
		if !slices.Contains(inSchema, name) {
			t.Errorf("classified constraint %s does not exist in the schema", name)
		}
	}
}

func TestMapErrorFieldError(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(context.Background(), `
		INSERT INTO stat_reports (sitting_id, q1, q3, contributor_id, source) VALUES ($1, 90, 10, $2, 'direct')`, sitting, f.userID)
	e, ok := apperr.As(db.MapError(err))
	if !ok || e.Status() != http.StatusUnprocessableEntity {
		t.Fatalf("got %v", db.MapError(err))
	}
	if len(e.Fields) != 1 || e.Fields[0] != (apperr.FieldError{Field: "", Code: apperr.QuartilesOutOfOrder}) {
		t.Fatalf("fields = %+v", e.Fields)
	}
	if !errors.Is(db.MapError(err), err) {
		t.Fatal("the database error must stay wrapped")
	}
}

// Errors about the body as a whole, or several fields at once, carry field "".
func TestMapErrorWholeBodyErrorsHaveEmptyField(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		sql  string
		want apperr.FieldCode
	}{
		{"nothing submitted", `INSERT INTO stat_reports (sitting_id, contributor_id, source) VALUES ($1, $2, 'direct')`, apperr.NothingSubmitted},
		{"negative value", `INSERT INTO stat_reports (sitting_id, q1, contributor_id, source) VALUES ($1, -1, $2, 'direct')`, apperr.ValueOutOfRange},
		{"quartiles out of order", `INSERT INTO stat_reports (sitting_id, q1, q2, contributor_id, source) VALUES ($1, 50, 40, $2, 'direct')`, apperr.QuartilesOutOfOrder},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := pool.Exec(context.Background(), c.sql, sitting, f.userID)
			e, ok := apperr.As(db.MapError(err))
			if !ok {
				t.Fatalf("got %v", db.MapError(err))
			}
			if len(e.Fields) != 1 || e.Fields[0] != (apperr.FieldError{Field: "", Code: c.want}) {
				t.Fatalf("fields = %+v", e.Fields)
			}
		})
	}
}

func TestMapErrorTriggerName(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	_, err := insertSitting(pool, f, "exam", nil, 2026, 1)
	e, ok := apperr.As(db.MapError(err))
	if !ok || len(e.Fields) != 1 || e.Fields[0].Code != apperr.InvalidAssessmentNumber || e.Fields[0].Field != "number" {
		t.Fatalf("got %+v", e)
	}
}

func TestMapErrorCode(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, pool, `INSERT INTO voting_requests (sitting_id, user_id) VALUES ($1, $2)`, sitting, f.userID)
	_, err = pool.Exec(context.Background(), `INSERT INTO voting_requests (sitting_id, user_id) VALUES ($1, $2)`, sitting, f.userID)
	e, ok := apperr.As(db.MapError(err))
	if !ok || e.Code != apperr.VotingRequestExists {
		t.Fatalf("got %v", db.MapError(err))
	}
}

func TestMapErrorLeavesInternalInvariantsAlone(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	_, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at = now() WHERE id = $1`, f.userID)
	if got := db.MapError(err); got != err {
		t.Fatalf("internal invariant must pass through unchanged, got %v", got)
	}
}

func TestMapErrorPassThrough(t *testing.T) {
	plain := errors.New("boom")
	if db.MapError(plain) != plain {
		t.Fatal("non-database errors must pass through")
	}
	if db.MapError(nil) != nil {
		t.Fatal("nil must stay nil")
	}
}
