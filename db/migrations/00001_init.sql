-- +goose Up

-- ---------------------------------------------------------------- types

CREATE TYPE report_status         AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE stat_source           AS ENUM ('direct', 'transcribed');
CREATE TYPE import_status         AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE voting_request_status AS ENUM ('open', 'fulfilled', 'rejected', 'cancelled');
CREATE TYPE archive_status        AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE job_status            AS ENUM ('succeeded', 'failed', 'skipped');

CREATE TYPE activity_action AS ENUM (
  'login', 'profile_update', 'logout_all', 'account_delete',
  'favorite_add', 'favorite_remove',
  'comment_create', 'comment_delete',
  'stat_report_create', 'stat_report_update', 'stat_report_move',
  'stat_report_hide', 'stat_report_unhide',
  'pending_report_create', 'pending_report_approve', 'pending_report_reject',
  'report_file_view',
  'sitting_create', 'voting_open', 'voting_update', 'voting_close',
  'vote_cutoff_set', 'vote_cast',
  'voting_request_create', 'voting_request_cancel', 'voting_request_reject',
  'admin_grant', 'admin_revoke',
  'logs_export', 'logs_delete', 'logs_clear',
  'logs_retention_delete', 'logs_archive'
);

-- ------------------------------------------------------------ functions

-- +goose StatementBegin
CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- true when no earlier non-null value exceeds a later one; nulls are skipped
-- +goose StatementBegin
CREATE FUNCTION values_non_decreasing(VARIADIC v numeric[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM   unnest(v) WITH ORDINALITY AS a(av, ao)
    JOIN   unnest(v) WITH ORDINALITY AS b(bv, bo) ON ao < bo
    WHERE  av > bv
  );
$$;
-- +goose StatementEnd

-- numbered kinds need 1..max_number, others need NULL; shared by
-- exam_sittings and pending_reports (both have kind_id and number)
-- +goose StatementBegin
CREATE FUNCTION check_assessment_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  k_numbered boolean;
  k_max      smallint;
BEGIN
  SELECT numbered, max_number INTO k_numbered, k_max
  FROM   assessment_kinds WHERE id = NEW.kind_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports this
  END IF;
  IF (k_numbered AND (NEW.number IS NULL OR NEW.number < 1 OR NEW.number > k_max))
     OR (NOT k_numbered AND NEW.number IS NOT NULL) THEN
    RAISE EXCEPTION 'number % is not valid for assessment kind %', NEW.number, NEW.kind_id
      USING ERRCODE = 'check_violation',
            CONSTRAINT = TG_TABLE_NAME || '_number_ck';
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- search ETag input; bumped whenever a search badge could change
-- +goose StatementBegin
CREATE FUNCTION bump_content_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE content_version SET n = n + 1;
  RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- -------------------------------------------------------------- catalog

CREATE TABLE departments (
  id   integer GENERATED ALWAYS AS IDENTITY,
  name text    NOT NULL,
  CONSTRAINT departments_pk      PRIMARY KEY (id),
  CONSTRAINT departments_name_u  UNIQUE (name),
  CONSTRAINT departments_name_ck CHECK (length(btrim(name)) > 0)
);

CREATE TABLE instructors (
  id             integer GENERATED ALWAYS AS IDENTITY,
  name           text    NOT NULL,
  is_placeholder boolean NOT NULL DEFAULT false,
  CONSTRAINT instructors_pk      PRIMARY KEY (id),
  CONSTRAINT instructors_name_u  UNIQUE (name),
  CONSTRAINT instructors_name_ck CHECK (length(btrim(name)) > 0)
);

CREATE TABLE courses (
  id            bigint      GENERATED ALWAYS AS IDENTITY,
  title         text        NOT NULL,
  instructor_id integer     NOT NULL,
  identity_key  text        NOT NULL,
  legacy_key    text,
  search_text   text        NOT NULL,
  is_listed     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courses_pk            PRIMARY KEY (id),
  CONSTRAINT courses_identity_u    UNIQUE (identity_key),
  CONSTRAINT courses_legacy_u      UNIQUE (legacy_key),
  CONSTRAINT courses_instructor_fk FOREIGN KEY (instructor_id) REFERENCES instructors (id),
  CONSTRAINT courses_title_ck      CHECK (length(btrim(title)) > 0),
  CONSTRAINT courses_search_ck     CHECK (search_text = lower(search_text) AND search_text !~ '\s')
);
CREATE INDEX courses_instructor_idx ON courses (instructor_id);
CREATE TRIGGER courses_touch BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE course_offerings (
  course_id     bigint   NOT NULL,
  year          smallint NOT NULL,
  semester      smallint NOT NULL,
  department_id integer  NOT NULL,
  CONSTRAINT course_offerings_pk          PRIMARY KEY (course_id, year, semester, department_id),
  CONSTRAINT course_offerings_course_fk   FOREIGN KEY (course_id)     REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT course_offerings_dept_fk     FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT course_offerings_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT course_offerings_year_ck     CHECK (year BETWEEN 1980 AND 2200)
);
CREATE INDEX course_offerings_term_idx ON course_offerings (year, semester);
CREATE INDEX course_offerings_dept_idx ON course_offerings (department_id);

CREATE TABLE catalog_sections (
  id             bigint   GENERATED ALWAYS AS IDENTITY,
  course_id      bigint   NOT NULL,
  year           smallint NOT NULL,
  semester       smallint NOT NULL,
  course_number  text     NOT NULL,
  lecture_number text     NOT NULL,
  department_id  integer  NOT NULL,
  class_time     jsonb    NOT NULL DEFAULT '[]',
  CONSTRAINT catalog_sections_pk          PRIMARY KEY (id),
  CONSTRAINT catalog_sections_u           UNIQUE (year, semester, course_number, lecture_number),
  CONSTRAINT catalog_sections_course_fk   FOREIGN KEY (course_id)     REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT catalog_sections_dept_fk     FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT catalog_sections_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT catalog_sections_year_ck     CHECK (year BETWEEN 1980 AND 2200)
);
CREATE INDEX catalog_sections_course_idx ON catalog_sections (course_id);

-- ---------------------------------------------------------------- users

CREATE TABLE colleges (
  name       text     NOT NULL,
  sort_order smallint NOT NULL,
  is_active  boolean  NOT NULL DEFAULT true,
  CONSTRAINT colleges_pk      PRIMARY KEY (name),
  CONSTRAINT colleges_order_u UNIQUE (sort_order) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT colleges_name_ck CHECK (length(btrim(name)) > 0)
);

INSERT INTO colleges (name, sort_order) VALUES
  ('인문대학', 1), ('사회과학대학', 2), ('자연과학대학', 3), ('간호대학', 4),
  ('경영대학', 5), ('공과대학', 6), ('농업생명과학대학', 7), ('미술대학', 8),
  ('사범대학', 9), ('생활과학대학', 10), ('수의과대학', 11), ('약학대학', 12),
  ('음악대학', 13), ('의과대학', 14), ('자유전공학부', 15),
  ('법학전문대학원', 16), ('치의학대학원', 17), ('대학원/기타', 18);

CREATE TABLE users (
  id             bigint      GENERATED ALWAYS AS IDENTITY,
  email          text,
  display_name   text,
  is_admin       boolean     NOT NULL DEFAULT false,
  college        text,
  admission_year smallint,
  last_ip        inet,
  session_epoch  integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz,
  deleted_at     timestamptz,
  CONSTRAINT users_pk         PRIMARY KEY (id),
  CONSTRAINT users_email_u    UNIQUE (email),
  CONSTRAINT users_college_fk FOREIGN KEY (college) REFERENCES colleges (name) ON UPDATE CASCADE,
  CONSTRAINT users_email_ck   CHECK (email IS NULL OR (email LIKE '%_@snu.ac.kr' AND email = lower(email))),
  CONSTRAINT users_live_ck    CHECK (deleted_at IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT users_scrubbed_ck CHECK (
    deleted_at IS NULL
    OR (email IS NULL AND display_name IS NULL AND college IS NULL
        AND admission_year IS NULL AND last_ip IS NULL AND is_admin = false)
  ),
  CONSTRAINT users_admission_year_ck CHECK (admission_year IS NULL OR admission_year BETWEEN 1980 AND 2100),
  CONSTRAINT users_epoch_ck          CHECK (session_epoch >= 0)
);

-- ------------------------------------------------------- exam sittings

CREATE TABLE assessment_kinds (
  id           smallint GENERATED ALWAYS AS IDENTITY,
  code         text     NOT NULL,
  label_ko     text     NOT NULL,
  label_format text     NOT NULL,
  numbered     boolean  NOT NULL,
  max_number   smallint,
  sort_order   smallint NOT NULL,
  is_active    boolean  NOT NULL DEFAULT true,
  CONSTRAINT assessment_kinds_pk      PRIMARY KEY (id),
  CONSTRAINT assessment_kinds_code_u  UNIQUE (code),
  CONSTRAINT assessment_kinds_label_u UNIQUE (label_ko)   DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT assessment_kinds_order_u UNIQUE (sort_order) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT assessment_kinds_max_ck  CHECK (numbered = (max_number IS NOT NULL) AND (max_number IS NULL OR max_number >= 1)),
  CONSTRAINT assessment_kinds_fmt_ck  CHECK (numbered = (position('{n}' IN label_format) > 0))
);

INSERT INTO assessment_kinds (code, label_ko, label_format, numbered, max_number, sort_order) VALUES
  ('midterm',    '중간', '중간',       false, NULL, 1),
  ('final',      '기말', '기말',       false, NULL, 2),
  ('exam',       '시험', '{n}차 시험', true,  6,    3),
  ('quiz',       '퀴즈', '퀴즈 {n}',   true,  20,   4),
  ('assignment', '과제', '과제 {n}',   true,  20,   5),
  ('other',      '기타', '기타',       false, NULL, 6);

CREATE TABLE exam_sittings (
  id                 bigint      GENERATED ALWAYS AS IDENTITY,
  course_id          bigint      NOT NULL,
  kind_id            smallint    NOT NULL,
  number             smallint,
  year               smallint    NOT NULL,
  semester           smallint    NOT NULL,
  voting_opened_at   timestamptz,
  voting_closes_at   timestamptz,
  voting_ended_at    timestamptz,
  votes_counted_from timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_sittings_pk        PRIMARY KEY (id),
  CONSTRAINT exam_sittings_u         UNIQUE NULLS NOT DISTINCT (course_id, kind_id, number, year, semester),
  CONSTRAINT exam_sittings_course_fk FOREIGN KEY (course_id) REFERENCES courses (id),
  CONSTRAINT exam_sittings_kind_fk   FOREIGN KEY (kind_id)   REFERENCES assessment_kinds (id),
  CONSTRAINT exam_sittings_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT exam_sittings_year_ck     CHECK (year BETWEEN 1980 AND 2200),
  CONSTRAINT exam_sittings_voting_ck   CHECK (
    (voting_opened_at IS NOT NULL OR (voting_closes_at IS NULL AND voting_ended_at IS NULL))
    AND (voting_closes_at IS NULL OR voting_closes_at > voting_opened_at)
    AND (voting_ended_at  IS NULL OR voting_ended_at  >= voting_opened_at)
  )
);
CREATE INDEX exam_sittings_course_idx ON exam_sittings (course_id);
CREATE INDEX exam_sittings_open_idx   ON exam_sittings (voting_closes_at)
  WHERE voting_opened_at IS NOT NULL AND voting_ended_at IS NULL;
CREATE TRIGGER exam_sittings_number BEFORE INSERT OR UPDATE OF kind_id, number ON exam_sittings
  FOR EACH ROW EXECUTE FUNCTION check_assessment_number();

CREATE TABLE votes (
  id         bigint      GENERATED ALWAYS AS IDENTITY,
  sitting_id bigint      NOT NULL,
  user_id    bigint      NOT NULL,
  rating     smallint    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT votes_pk         PRIMARY KEY (id),
  CONSTRAINT votes_one_each   UNIQUE (sitting_id, user_id),
  CONSTRAINT votes_sitting_fk FOREIGN KEY (sitting_id) REFERENCES exam_sittings (id),
  CONSTRAINT votes_user_fk    FOREIGN KEY (user_id)    REFERENCES users (id),
  CONSTRAINT votes_rating_ck  CHECK (rating BETWEEN 1 AND 5)
);
CREATE INDEX votes_user_idx ON votes (user_id);
CREATE TRIGGER votes_touch BEFORE UPDATE ON votes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE voting_requests (
  id          bigint                NOT NULL GENERATED ALWAYS AS IDENTITY,
  sitting_id  bigint                NOT NULL,
  user_id     bigint                NOT NULL,
  note        text,
  status      voting_request_status NOT NULL DEFAULT 'open',
  created_at  timestamptz           NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by bigint,
  CONSTRAINT voting_requests_pk          PRIMARY KEY (id),
  CONSTRAINT voting_requests_sitting_fk  FOREIGN KEY (sitting_id)  REFERENCES exam_sittings (id),
  CONSTRAINT voting_requests_user_fk     FOREIGN KEY (user_id)     REFERENCES users (id),
  CONSTRAINT voting_requests_resolver_fk FOREIGN KEY (resolved_by) REFERENCES users (id),
  CONSTRAINT voting_requests_note_ck     CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 100),
  CONSTRAINT voting_requests_resolved_ck CHECK ((status = 'open') = (resolved_at IS NULL))
);
CREATE UNIQUE INDEX voting_requests_open_u ON voting_requests (sitting_id, user_id) WHERE status = 'open';
CREATE INDEX voting_requests_user_idx ON voting_requests (user_id);

-- ---------------------------------------------------------- contributions

CREATE TABLE pending_reports (
  id           bigint        GENERATED ALWAYS AS IDENTITY,
  course_id    bigint        NOT NULL,
  kind_id      smallint      NOT NULL,
  number       smallint,
  year         smallint      NOT NULL,
  semester     smallint      NOT NULL,
  uploader_id  bigint        NOT NULL,
  nickname     text          NOT NULL DEFAULT '(익명)',
  file_key     text          NOT NULL,
  file_name    text          NOT NULL,
  content_type text          NOT NULL,
  byte_size    integer       NOT NULL,
  sha256       text          NOT NULL,
  status       report_status NOT NULL DEFAULT 'pending',
  reviewer_id  bigint,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pending_reports_pk          PRIMARY KEY (id),
  CONSTRAINT pending_reports_file_key_u  UNIQUE (file_key),
  CONSTRAINT pending_reports_course_fk   FOREIGN KEY (course_id)   REFERENCES courses (id),
  CONSTRAINT pending_reports_kind_fk     FOREIGN KEY (kind_id)     REFERENCES assessment_kinds (id),
  CONSTRAINT pending_reports_uploader_fk FOREIGN KEY (uploader_id) REFERENCES users (id),
  CONSTRAINT pending_reports_reviewer_fk FOREIGN KEY (reviewer_id) REFERENCES users (id),
  CONSTRAINT pending_reports_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT pending_reports_year_ck     CHECK (year BETWEEN 1980 AND 2200),
  CONSTRAINT pending_reports_nickname_ck CHECK (char_length(nickname) BETWEEN 1 AND 10),
  CONSTRAINT pending_reports_note_ck     CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  CONSTRAINT pending_reports_size_ck     CHECK (byte_size > 0 AND byte_size <= 3145728),
  CONSTRAINT pending_reports_sha_ck      CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pending_reports_mime_ck     CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT pending_reports_dated_ck    CHECK (reviewed_at IS NULL OR reviewed_at >= created_at),
  CONSTRAINT pending_reports_review_ck   CHECK (
    (status =  'pending' AND reviewer_id IS NULL     AND reviewed_at IS NULL)
    OR
    (status <> 'pending' AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX pending_reports_queue_idx    ON pending_reports (created_at, id) WHERE status = 'pending';
CREATE INDEX pending_reports_course_idx   ON pending_reports (course_id, created_at DESC);
CREATE INDEX pending_reports_uploader_idx ON pending_reports (uploader_id);
CREATE TRIGGER pending_reports_number BEFORE INSERT OR UPDATE OF kind_id, number ON pending_reports
  FOR EACH ROW EXECUTE FUNCTION check_assessment_number();

CREATE TABLE upload_intents (
  file_key   text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upload_intents_pk PRIMARY KEY (file_key)
);

CREATE TABLE stat_reports (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  sitting_id       bigint      NOT NULL,
  q1               numeric(6,2),
  q2               numeric(6,2),
  q3               numeric(6,2),
  q4               numeric(6,2),
  average          numeric(6,2),
  max_score        numeric(6,2),
  note             text,
  nickname         text        NOT NULL DEFAULT '(익명)',
  contributor_id   bigint      NOT NULL,
  source           stat_source NOT NULL,
  source_report_id bigint,
  hidden_at        timestamptz,
  hidden_by        bigint,
  hidden_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stat_reports_pk             PRIMARY KEY (id),
  CONSTRAINT stat_reports_sitting_fk     FOREIGN KEY (sitting_id)       REFERENCES exam_sittings (id),
  CONSTRAINT stat_reports_contributor_fk FOREIGN KEY (contributor_id)   REFERENCES users (id),
  CONSTRAINT stat_reports_source_fk      FOREIGN KEY (source_report_id) REFERENCES pending_reports (id),
  CONSTRAINT stat_reports_hidden_by_fk   FOREIGN KEY (hidden_by)        REFERENCES users (id),
  CONSTRAINT stat_reports_source_u       UNIQUE (source_report_id),
  CONSTRAINT stat_reports_hidden_ck CHECK (
    (hidden_at IS NULL AND hidden_by IS NULL AND hidden_reason IS NULL)
    OR (hidden_at IS NOT NULL AND hidden_by IS NOT NULL)
  ),
  CONSTRAINT stat_reports_hidden_reason_ck CHECK (hidden_reason IS NULL OR char_length(hidden_reason) BETWEEN 1 AND 500),
  CONSTRAINT stat_reports_nickname_ck   CHECK (char_length(nickname) BETWEEN 1 AND 10),
  CONSTRAINT stat_reports_note_ck       CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT stat_reports_not_empty_ck  CHECK (
    num_nonnulls(q1, q2, q3, q4, average, max_score) > 0
    OR (note IS NOT NULL AND length(btrim(note)) > 0)
  ),
  CONSTRAINT stat_reports_ordered_ck    CHECK (values_non_decreasing(q1, q2, q3, q4)),
  CONSTRAINT stat_reports_within_max_ck CHECK (max_score IS NULL OR greatest(q1, q2, q3, q4, average) <= max_score),
  CONSTRAINT stat_reports_range_ck      CHECK (
    coalesce(least(q1, q2, q3, q4, average), 0) >= 0 AND (max_score IS NULL OR max_score > 0)
  ),
  CONSTRAINT stat_reports_provenance_ck CHECK (
    (source = 'direct' AND source_report_id IS NULL)
    OR (source = 'transcribed' AND source_report_id IS NOT NULL)
  )
);
CREATE INDEX stat_reports_sitting_idx     ON stat_reports (sitting_id, created_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX stat_reports_recent_idx      ON stat_reports (created_at DESC, id DESC);
CREATE INDEX stat_reports_contributor_idx ON stat_reports (contributor_id);
CREATE TRIGGER stat_reports_touch BEFORE UPDATE ON stat_reports
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE comments (
  id         bigint      GENERATED ALWAYS AS IDENTITY,
  course_id  bigint      NOT NULL,
  user_id    bigint      NOT NULL,
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_pk        PRIMARY KEY (id),
  CONSTRAINT comments_course_fk FOREIGN KEY (course_id) REFERENCES courses (id),
  CONSTRAINT comments_user_fk   FOREIGN KEY (user_id)   REFERENCES users (id),
  CONSTRAINT comments_body_ck   CHECK (char_length(btrim(body)) BETWEEN 1 AND 50)
);
CREATE INDEX comments_course_idx ON comments (course_id, created_at DESC, id DESC);
CREATE INDEX comments_recent_idx ON comments (created_at DESC, id DESC);
CREATE INDEX comments_user_idx   ON comments (user_id);

CREATE TABLE favorites (
  user_id    bigint      NOT NULL,
  course_id  bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorites_pk        PRIMARY KEY (user_id, course_id),
  CONSTRAINT favorites_user_fk   FOREIGN KEY (user_id)   REFERENCES users (id),
  CONSTRAINT favorites_course_fk FOREIGN KEY (course_id) REFERENCES courses (id)
);
CREATE INDEX favorites_user_recent_idx ON favorites (user_id, created_at DESC);
CREATE INDEX favorites_course_idx      ON favorites (course_id);

-- ----------------------------------------------------------- operations

CREATE TABLE activity_logs (
  id         bigint          GENERATED ALWAYS AS IDENTITY,
  user_id    bigint,
  action     activity_action NOT NULL,
  metadata   jsonb           NOT NULL DEFAULT '{}',
  ip         inet,
  created_at timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT activity_logs_pk      PRIMARY KEY (id),
  CONSTRAINT activity_logs_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT activity_logs_meta_ck CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX activity_logs_time_idx   ON activity_logs (created_at DESC, id DESC);
CREATE INDEX activity_logs_user_idx   ON activity_logs (user_id, created_at DESC);
CREATE INDEX activity_logs_action_idx ON activity_logs (action, created_at DESC);

CREATE TABLE catalog_imports (
  id               bigint        GENERATED ALWAYS AS IDENTITY,
  started_at       timestamptz   NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           import_status NOT NULL DEFAULT 'running',
  source_label     text,
  courses_total    integer,
  courses_added    integer,
  courses_unlisted integer,
  offerings_total  integer,
  sections_total   integer,
  error            text,
  CONSTRAINT catalog_imports_pk       PRIMARY KEY (id),
  CONSTRAINT catalog_imports_done_ck  CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT catalog_imports_error_ck CHECK (status = 'failed' OR error IS NULL),
  CONSTRAINT catalog_imports_dated_ck CHECK (finished_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX catalog_imports_recent_idx ON catalog_imports (started_at DESC);
CREATE UNIQUE INDEX catalog_imports_one_running ON catalog_imports (status) WHERE status = 'running';

CREATE TABLE log_archive_runs (
  id            bigint         GENERATED ALWAYS AS IDENTITY,
  started_at    timestamptz    NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        archive_status NOT NULL DEFAULT 'running',
  cutoff        timestamptz,
  format        text           NOT NULL,
  row_count     integer,
  first_id      bigint,
  last_id       bigint,
  drive_file_id text,
  error         text,
  CONSTRAINT log_archive_runs_pk        PRIMARY KEY (id),
  CONSTRAINT log_archive_runs_format_ck CHECK (format IN ('json', 'jsonl', 'csv', 'xlsx', 'parquet')),
  CONSTRAINT log_archive_runs_done_ck   CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT log_archive_runs_ok_ck     CHECK (status <> 'succeeded' OR drive_file_id IS NOT NULL),
  CONSTRAINT log_archive_runs_error_ck  CHECK (status = 'failed' OR error IS NULL)
);
CREATE INDEX log_archive_runs_recent_idx ON log_archive_runs (started_at DESC, id DESC);
CREATE UNIQUE INDEX log_archive_runs_one_running ON log_archive_runs (status) WHERE status = 'running';

CREATE TABLE job_runs (
  id          bigint      GENERATED ALWAYS AS IDENTITY,
  name        text        NOT NULL,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  status      job_status  NOT NULL,
  affected    integer     NOT NULL DEFAULT 0,
  error       text,
  CONSTRAINT job_runs_pk       PRIMARY KEY (id),
  CONSTRAINT job_runs_name_ck  CHECK (name IN ('retention', 'archive', 'upload-gc')),
  CONSTRAINT job_runs_error_ck CHECK (status = 'failed' OR error IS NULL),
  CONSTRAINT job_runs_dated_ck CHECK (finished_at >= started_at)
);
CREATE INDEX job_runs_name_idx ON job_runs (name, started_at DESC);

CREATE TABLE content_version (
  singleton boolean NOT NULL DEFAULT true,
  n         bigint  NOT NULL DEFAULT 0,
  CONSTRAINT content_version_pk PRIMARY KEY (singleton),
  CONSTRAINT content_version_ck CHECK (singleton)
);
INSERT INTO content_version DEFAULT VALUES;

CREATE TRIGGER stat_reports_content_version
  AFTER INSERT OR DELETE OR UPDATE OF sitting_id, hidden_at ON stat_reports
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_version();
CREATE TRIGGER exam_sittings_content_version
  AFTER UPDATE OF voting_opened_at, voting_closes_at, voting_ended_at ON exam_sittings
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_version();

-- ---------------------------------------------------------------- views

CREATE VIEW v_sitting_voting AS
SELECT s.id AS sitting_id,
       CASE
         WHEN s.voting_opened_at IS NULL THEN 'never'
         WHEN s.voting_ended_at IS NULL
              AND (s.voting_closes_at IS NULL OR s.voting_closes_at > now()) THEN 'open'
         ELSE 'closed'
       END AS state
FROM exam_sittings s;

CREATE VIEW v_sitting_difficulty AS
SELECT s.id                                    AS sitting_id,
       count(v.id)                             AS vote_count,
       round(avg(v.rating), 1)                 AS average_rating,
       count(v.id) FILTER (WHERE v.rating = 1) AS rating_1,
       count(v.id) FILTER (WHERE v.rating = 2) AS rating_2,
       count(v.id) FILTER (WHERE v.rating = 3) AS rating_3,
       count(v.id) FILTER (WHERE v.rating = 4) AS rating_4,
       count(v.id) FILTER (WHERE v.rating = 5) AS rating_5
FROM      exam_sittings s
LEFT JOIN votes v
       ON v.sitting_id = s.id
      AND (s.votes_counted_from IS NULL OR v.created_at >= s.votes_counted_from)
GROUP BY s.id;

-- +goose Down
DROP VIEW v_sitting_difficulty;
DROP VIEW v_sitting_voting;
DROP TABLE content_version;
DROP TABLE job_runs;
DROP TABLE log_archive_runs;
DROP TABLE catalog_imports;
DROP TABLE activity_logs;
DROP TABLE favorites;
DROP TABLE comments;
DROP TABLE stat_reports;
DROP TABLE upload_intents;
DROP TABLE pending_reports;
DROP TABLE voting_requests;
DROP TABLE votes;
DROP TABLE exam_sittings;
DROP TABLE assessment_kinds;
DROP TABLE users;
DROP TABLE colleges;
DROP TABLE catalog_sections;
DROP TABLE course_offerings;
DROP TABLE courses;
DROP TABLE instructors;
DROP TABLE departments;
DROP FUNCTION bump_content_version();
DROP FUNCTION check_assessment_number();
DROP FUNCTION values_non_decreasing(numeric[]);
DROP FUNCTION touch_updated_at();
DROP TYPE activity_action;
DROP TYPE job_status;
DROP TYPE archive_status;
DROP TYPE voting_request_status;
DROP TYPE import_status;
DROP TYPE stat_source;
DROP TYPE report_status;
