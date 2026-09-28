// Package devseed resets a development database to a known state for manual
// testing and the frontend's end-to-end runs (open item O27). Each backend
// phase adds the rows its own tables need; reference data seeded by the
// migrations (colleges, assessment kinds) is left alone.
package devseed

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Accounts made by Seed. admin@ is an administrator only through
// ADMIN_EMAILS, as in production; moderator@ is one through the database.
const (
	AdminEmail     = "admin@snu.ac.kr"
	StudentEmail   = "student@snu.ac.kr"
	NewbieEmail    = "newbie@snu.ac.kr"
	ModeratorEmail = "moderator@snu.ac.kr"
)

// reset empties every table rows are seeded into. CASCADE reaches the tables
// that reference users (contributions, votes, favourites, the activity
// log); RESTART IDENTITY makes ids repeat from run to run.
const reset = `TRUNCATE users RESTART IDENTITY CASCADE`

// Seed resets and reloads the development data in one transaction. Times are
// relative to now so "recent" stays recent whenever it runs.
func Seed(ctx context.Context, pool *pgxpool.Pool) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, reset); err != nil {
			return err
		}
		return seedAccounts(ctx, tx)
	})
}

func seedAccounts(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO users (email, display_name, is_admin, college, admission_year, last_ip, created_at, last_seen_at) VALUES
		  ($1, '관리자',   false, NULL,       NULL, '127.0.0.1', now() - interval '400 days', now() - interval '1 hour'),
		  ($2, '김학생',   false, '공과대학', 2022, '127.0.0.1', now() - interval '200 days', now() - interval '2 hours'),
		  ($3, '새내기',   false, NULL,       NULL, '127.0.0.1', now() - interval '1 day',    now() - interval '1 day'),
		  ($4, '운영진',   true,  '자연과학대학', 2019, '127.0.0.1', now() - interval '300 days', now() - interval '3 days')`,
		AdminEmail, StudentEmail, NewbieEmail, ModeratorEmail)
	if err != nil {
		return err
	}
	// A few sign-ins spread over time, for the log screens' filters and paging.
	_, err = tx.Exec(ctx, `
		INSERT INTO activity_logs (user_id, action, metadata, ip, created_at)
		SELECT u.id, 'login', '{"provider":"dev"}', '127.0.0.1', now() - (n || ' hours')::interval
		FROM users u CROSS JOIN generate_series(1, 6) AS n`)
	return err
}
