package db_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func scalar[T any](t *testing.T, pool *pgxpool.Pool, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("query %q: %v", sql, err)
	}
	return v
}

// constraintOf returns the violated constraint name, "" for success.
func constraintOf(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		return ""
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("want a PostgreSQL error, got %v", err)
	}
	return pgErr.ConstraintName
}

type fixture struct {
	courseID int64
	userID   int64
}

func seed(t *testing.T, pool *pgxpool.Pool) fixture {
	t.Helper()
	dept := scalar[int32](t, pool, `INSERT INTO departments (name) VALUES ('컴퓨터공학부') RETURNING id`)
	inst := scalar[int32](t, pool, `INSERT INTO instructors (name) VALUES ('홍길동') RETURNING id`)
	course := scalar[int64](t, pool, `
		INSERT INTO courses (title, instructor_id, identity_key, search_text)
		VALUES ('자료구조', $1, 'k1', '자료구조홍길동컴퓨터공학부') RETURNING id`, inst)
	mustExec(t, pool, `INSERT INTO course_offerings (course_id, year, semester, department_id) VALUES ($1, 2026, 1, $2)`, course, dept)
	user := scalar[int64](t, pool, `INSERT INTO users (email) VALUES ('student@snu.ac.kr') RETURNING id`)
	return fixture{courseID: course, userID: user}
}

func insertSitting(pool *pgxpool.Pool, f fixture, kind string, number *int16, year, semester int) (int64, error) {
	var id int64
	err := pool.QueryRow(context.Background(), `
		INSERT INTO exam_sittings (course_id, kind_id, number, year, semester)
		VALUES ($1, (SELECT id FROM assessment_kinds WHERE code = $2), $3, $4, $5)
		RETURNING id`, f.courseID, kind, number, year, semester).Scan(&id)
	return id, err
}

func ptr[T any](v T) *T { return &v }

func TestSittingNumberRule(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	cases := []struct {
		name   string
		kind   string
		number *int16
		want   string
	}{
		{"numbered kind without number", "exam", nil, "exam_sittings_number_ck"},
		{"number above max", "exam", ptr[int16](7), "exam_sittings_number_ck"},
		{"number zero", "quiz", ptr[int16](0), "exam_sittings_number_ck"},
		{"unnumbered kind with number", "midterm", ptr[int16](1), "exam_sittings_number_ck"},
		{"exam 2", "exam", ptr[int16](2), ""},
		{"quiz 20", "quiz", ptr[int16](20), ""},
		{"midterm", "midterm", nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := insertSitting(pool, f, tc.kind, tc.number, 2026, 1)
			if got := constraintOf(t, err); got != tc.want {
				t.Fatalf("constraint = %q, want %q (err %v)", got, tc.want, err)
			}
		})
	}
}

func TestSittingUniqueTreatsMissingNumbersAsEqual(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	if _, err := insertSitting(pool, f, "final", nil, 2026, 1); err != nil {
		t.Fatal(err)
	}
	_, err := insertSitting(pool, f, "final", nil, 2026, 1)
	if got := constraintOf(t, err); got != "exam_sittings_u" {
		t.Fatalf("constraint = %q", got)
	}
	if _, err := insertSitting(pool, f, "final", nil, 2026, 3); err != nil {
		t.Fatalf("another term must be allowed: %v", err)
	}
}

func TestStatReportConstraints(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	type row struct {
		q1, q2, q3, q4, avg, max *float64
		source                   string
	}
	cases := []struct {
		name string
		r    row
		want string
	}{
		{"q1 above q3 across a gap", row{q1: ptr(90.0), q3: ptr(10.0), source: "direct"}, "stat_reports_ordered_ck"},
		{"q4 above max", row{q4: ptr(110.0), max: ptr(100.0), source: "direct"}, "stat_reports_within_max_ck"},
		{"average above max", row{avg: ptr(101.0), max: ptr(100.0), source: "direct"}, "stat_reports_within_max_ck"},
		{"nothing at all", row{source: "direct"}, "stat_reports_not_empty_ck"},
		{"negative", row{q1: ptr(-1.0), source: "direct"}, "stat_reports_range_ck"},
		{"transcribed without upload", row{q2: ptr(50.0), source: "transcribed"}, "stat_reports_provenance_ck"},
		{"partial and ordered", row{q2: ptr(60.0), q4: ptr(95.0), max: ptr(100.0), source: "direct"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := pool.Exec(context.Background(), `
				INSERT INTO stat_reports (sitting_id, q1, q2, q3, q4, average, max_score, contributor_id, source)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				sitting, tc.r.q1, tc.r.q2, tc.r.q3, tc.r.q4, tc.r.avg, tc.r.max, f.userID, tc.r.source)
			if got := constraintOf(t, err); got != tc.want {
				t.Fatalf("constraint = %q, want %q (err %v)", got, tc.want, err)
			}
		})
	}
}

func TestUserScrubMustBeComplete(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	_, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at = now() WHERE id = $1`, f.userID)
	if got := constraintOf(t, err); got != "users_scrubbed_ck" {
		t.Fatalf("partial scrub: constraint = %q", got)
	}
	mustExec(t, pool, `UPDATE users SET email = NULL, deleted_at = now() WHERE id = $1`, f.userID)
	_, err = pool.Exec(context.Background(), `INSERT INTO users (email) VALUES ('someone@gmail.com')`)
	if got := constraintOf(t, err); got != "users_email_ck" {
		t.Fatalf("non-snu email: constraint = %q", got)
	}
}

func TestOneOpenVotingRequestPerUser(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	first := scalar[int64](t, pool, `INSERT INTO voting_requests (sitting_id, user_id, note) VALUES ($1, $2, '시험일 10/22') RETURNING id`, sitting, f.userID)
	_, err = pool.Exec(context.Background(), `INSERT INTO voting_requests (sitting_id, user_id) VALUES ($1, $2)`, sitting, f.userID)
	if got := constraintOf(t, err); got != "voting_requests_open_u" {
		t.Fatalf("constraint = %q", got)
	}
	mustExec(t, pool, `UPDATE voting_requests SET status = 'cancelled', resolved_at = now() WHERE id = $1`, first)
	mustExec(t, pool, `INSERT INTO voting_requests (sitting_id, user_id) VALUES ($1, $2)`, sitting, f.userID)
}

func TestContentVersionBumps(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	version := func() int64 { return scalar[int64](t, pool, `SELECT n FROM content_version`) }
	v0 := version()
	mustExec(t, pool, `INSERT INTO stat_reports (sitting_id, q2, contributor_id, source) VALUES ($1, 50, $2, 'direct')`, sitting, f.userID)
	if v := version(); v != v0+1 {
		t.Fatalf("after statistic: %d, want %d", v, v0+1)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET voting_opened_at = now() WHERE id = $1`, sitting)
	if v := version(); v != v0+2 {
		t.Fatalf("after opening: %d, want %d", v, v0+2)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET kind_id = kind_id WHERE id = $1`, sitting)
	if v := version(); v != v0+2 {
		t.Fatalf("unwatched column update must not bump: %d", v)
	}
}

func TestVotingViews(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	sitting, err := insertSitting(pool, f, "midterm", nil, 2026, 1)
	if err != nil {
		t.Fatal(err)
	}
	state := func() string {
		return scalar[string](t, pool, `SELECT state FROM v_sitting_voting WHERE sitting_id = $1`, sitting)
	}
	if s := state(); s != "never" {
		t.Fatalf("state = %s", s)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET voting_opened_at = now(), voting_closes_at = now() + interval '7 days' WHERE id = $1`, sitting)
	if s := state(); s != "open" {
		t.Fatalf("state = %s", s)
	}
	mustExec(t, pool, `INSERT INTO votes (sitting_id, user_id, rating) VALUES ($1, $2, 4)`, sitting, f.userID)
	count := func() int64 {
		return scalar[int64](t, pool, `SELECT vote_count FROM v_sitting_difficulty WHERE sitting_id = $1`, sitting)
	}
	if c := count(); c != 1 {
		t.Fatalf("votes = %d", c)
	}
	if avg := scalar[float64](t, pool, `SELECT average_rating FROM v_sitting_difficulty WHERE sitting_id = $1`, sitting); avg != 4.0 {
		t.Fatalf("average = %v", avg)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET voting_ended_at = now() WHERE id = $1`, sitting)
	if s := state(); s != "closed" {
		t.Fatalf("state = %s", s)
	}
	mustExec(t, pool, `UPDATE exam_sittings SET voting_opened_at = now(), voting_closes_at = NULL, voting_ended_at = NULL WHERE id = $1`, sitting)
	if s := state(); s != "open" {
		t.Fatalf("open-ended voting state = %s", s)
	}
}

func TestFavoritePositions(t *testing.T) {
	pool := pgtest.New(t)
	f := seed(t, pool)
	inst := scalar[int32](t, pool, `SELECT instructor_id FROM courses WHERE id = $1`, f.courseID)
	other := scalar[int64](t, pool, `
		INSERT INTO courses (title, instructor_id, identity_key, search_text)
		VALUES ('알고리즘', $1, 'k2', '알고리즘') RETURNING id`, inst)
	mustExec(t, pool, `INSERT INTO favorites (user_id, course_id, position) VALUES ($1, $2, 0)`, f.userID, f.courseID)

	_, err := pool.Exec(context.Background(), `INSERT INTO favorites (user_id, course_id, position) VALUES ($1, $2, 0)`, f.userID, other)
	if got := constraintOf(t, err); got != "favorites_position_u" {
		t.Fatalf("shared position: constraint = %q", got)
	}
	mustExec(t, pool, `INSERT INTO favorites (user_id, course_id, position) VALUES ($1, $2, -1)`, f.userID, other)

	// A reorder swaps positions inside one transaction.
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	const move = `UPDATE favorites SET position = $3 WHERE user_id = $1 AND course_id = $2`
	if _, err := tx.Exec(ctx, `SET CONSTRAINTS favorites_position_u DEFERRED`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, move, f.userID, f.courseID, -1); err != nil {
		t.Fatalf("first move: %v", err)
	}
	if _, err := tx.Exec(ctx, move, f.userID, other, 0); err != nil {
		t.Fatalf("second move: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("swap must commit: %v", err)
	}
	if got := scalar[int32](t, pool, `SELECT position FROM favorites WHERE user_id = $1 AND course_id = $2`, f.userID, f.courseID); got != -1 {
		t.Fatalf("position after swap = %d", got)
	}
}
