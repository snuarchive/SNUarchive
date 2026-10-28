package devseed_test

import (
	"context"
	"testing"

	"github.com/snuarchive/snuarchive/internal/devseed"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

func TestSeedIsRepeatable(t *testing.T) {
	pool := pgtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO users (email) VALUES ('leftover@snu.ac.kr')`); err != nil {
		t.Fatal(err)
	}
	for run := range 2 {
		if err := devseed.Seed(ctx, pool); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
		var users, logins int
		var studentID int64
		var newbieProfile, moderatorAdmin bool
		err := pool.QueryRow(ctx, `
			SELECT (SELECT count(*) FROM users),
			       (SELECT count(*) FROM activity_logs WHERE action = 'login'),
			       (SELECT id FROM users WHERE email = $1),
			       (SELECT college IS NOT NULL OR admission_year IS NOT NULL FROM users WHERE email = $2),
			       (SELECT is_admin FROM users WHERE email = $3)`,
			devseed.StudentEmail, devseed.NewbieEmail, devseed.ModeratorEmail,
		).Scan(&users, &logins, &studentID, &newbieProfile, &moderatorAdmin)
		if err != nil {
			t.Fatal(err)
		}
		if users != 4 || logins != 24 || studentID != 2 || newbieProfile || !moderatorAdmin {
			t.Fatalf("run %d: users=%d logins=%d student=%d newbieProfile=%v moderatorAdmin=%v",
				run, users, logins, studentID, newbieProfile, moderatorAdmin)
		}
	}
}
