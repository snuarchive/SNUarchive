-- name: LockSignIn :exec
-- Serialises sign-ins that could touch the same rows (same sub or email).
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(key)::text, 7201));

-- name: GetLiveUserBySub :one
SELECT * FROM users WHERE google_sub = $1 AND deleted_at IS NULL FOR UPDATE;

-- name: GetLiveUserByEmail :one
SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL FOR UPDATE;

-- name: GetLiveUser :one
SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL;

-- name: InsertUser :one
INSERT INTO users (email, google_sub, display_name, last_ip, last_seen_at)
VALUES (sqlc.arg(email), sqlc.narg(google_sub), sqlc.narg(display_name), sqlc.narg(last_ip), now())
RETURNING *;

-- name: RecordSignIn :one
-- The display name is kept as first stored; only a missing sub is filled in.
UPDATE users
SET email = sqlc.arg(email),
    google_sub = COALESCE(google_sub, sqlc.narg(google_sub)),
    last_ip = sqlc.narg(last_ip),
    last_seen_at = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ReleaseEmail :exec
-- session_epoch also moves, so the previous holder's old cookies stay
-- invalid even after they sign in again with their new address.
UPDATE users SET email = NULL, session_epoch = session_epoch + 1 WHERE id = $1;

-- name: TouchLastSeen :exec
UPDATE users SET last_seen_at = now()
WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '10 minutes');

-- name: UpdateProfile :one
UPDATE users
SET college = CASE WHEN sqlc.arg(set_college)::boolean THEN sqlc.narg(college) ELSE college END,
    admission_year = CASE WHEN sqlc.arg(set_admission_year)::boolean THEN sqlc.narg(admission_year) ELSE admission_year END
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: BumpSessionEpoch :one
UPDATE users SET session_epoch = session_epoch + 1
WHERE id = $1 AND deleted_at IS NULL
RETURNING session_epoch;

-- name: ScrubUser :execrows
UPDATE users
SET email = NULL, google_sub = NULL, display_name = NULL, college = NULL,
    admission_year = NULL, last_ip = NULL, is_admin = false,
    deleted_at = now(), session_epoch = session_epoch + 1
WHERE id = $1 AND deleted_at IS NULL;

-- name: DeleteUserFavorites :exec
DELETE FROM favorites WHERE user_id = $1;

-- name: IsActiveCollege :one
SELECT EXISTS (SELECT 1 FROM colleges WHERE name = $1 AND is_active);

-- name: InsertActivityLog :exec
INSERT INTO activity_logs (user_id, action, metadata, ip)
VALUES (sqlc.narg(user_id), sqlc.arg(action), sqlc.arg(metadata), sqlc.narg(ip));
