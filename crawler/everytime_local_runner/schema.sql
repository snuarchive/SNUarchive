-- SNU Archive — complete schema. PostgreSQL 14+.
-- Postgres-specific constructs are listed in note 8. Rationale is in NOTES.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE report_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TYPE stat_source AS ENUM ('direct', 'transcribed');

CREATE TYPE import_status AS ENUM ('running', 'succeeded', 'failed');

CREATE TYPE activity_action AS ENUM (
  'login',
  'stat_report_create', 'stat_report_update',
  'pending_report_create', 'pending_report_approve', 'pending_report_reject',
  'voting_open', 'vote_cast',
  'comment_create', 'comment_delete',
  'favorite_add', 'favorite_remove',
  'admin_grant', 'admin_revoke',
  'assessment_merge', 'votes_moved', 'vote_cutoff_set',
  'stat_report_hide', 'stat_report_unhide', 'stat_report_move'
);


-- keeps updated_at honest; attached to every table that has the column
CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- true when no earlier value exceeds a later one, see note 5
CREATE FUNCTION values_non_decreasing(VARIADIC v numeric[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM   unnest(v) WITH ORDINALITY AS a(av, ao)
    JOIN   unnest(v) WITH ORDINALITY AS b(bv, bo) ON ao < bo
    WHERE  av > bv
  );
$$;


-- one row per academic department
CREATE TABLE departments (
  id   INTEGER GENERATED ALWAYS AS IDENTITY,
  name TEXT    NOT NULL,

  CONSTRAINT departments_pk      PRIMARY KEY (id),
  CONSTRAINT departments_name_u  UNIQUE (name),
  CONSTRAINT departments_name_ck CHECK (length(trim(name)) > 0)
);


-- one row per instructor name; names are not unique to people, see note 1
CREATE TABLE instructors (
  id              INTEGER  GENERATED ALWAYS AS IDENTITY,
  name            TEXT     NOT NULL,
  department_span SMALLINT NOT NULL DEFAULT 1,     -- distinct departments seen under this name
  is_placeholder  BOOLEAN  NOT NULL DEFAULT FALSE, -- true for '미정' and similar

  CONSTRAINT instructors_pk      PRIMARY KEY (id),
  CONSTRAINT instructors_name_u  UNIQUE (name),
  CONSTRAINT instructors_name_ck CHECK (length(trim(name)) > 0)
);


-- the course catalog; identity is title plus instructor, merged across terms
CREATE TABLE courses (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY,
  title         TEXT        NOT NULL,
  instructor_id INTEGER     NOT NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,   -- false once absent from imports
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT courses_pk            PRIMARY KEY (id),
  CONSTRAINT courses_identity_u    UNIQUE (title, instructor_id),
  CONSTRAINT courses_title_ck      CHECK (length(trim(title)) > 0),
  CONSTRAINT courses_instructor_fk FOREIGN KEY (instructor_id) REFERENCES instructors (id)
);

CREATE INDEX courses_instructor_idx ON courses (instructor_id);

CREATE TRIGGER courses_touch BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- every term and department a course has been taught under, see note 2
CREATE TABLE course_offerings (
  course_id     BIGINT   NOT NULL,
  year          SMALLINT NOT NULL,
  semester      SMALLINT NOT NULL,                  -- 1 spring, 2 summer, 3 fall, 4 winter
  department_id INTEGER  NOT NULL,

  CONSTRAINT course_offerings_pk PRIMARY KEY (course_id, year, semester, department_id),
  CONSTRAINT course_offerings_course_fk   FOREIGN KEY (course_id)     REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT course_offerings_dept_fk     FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT course_offerings_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT course_offerings_year_ck     CHECK (year BETWEEN 1980 AND 2200)
);

-- (year, semester) also serves recency ordering, via a backward index scan
CREATE INDEX course_offerings_term_idx ON course_offerings (year, semester);
CREATE INDEX course_offerings_dept_idx ON course_offerings (department_id);


-- one row per signed-in account; rows are scrubbed, never deleted, see note 10
CREATE TABLE users (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY,
  email          TEXT,                              -- null once the account is deleted
  display_name   TEXT,                              -- from Google; cleared on deletion
  is_admin       BOOLEAN     NOT NULL DEFAULT FALSE,
  college        TEXT,
  admission_year SMALLINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,                       -- set when the account is scrubbed

  CONSTRAINT users_pk       PRIMARY KEY (id),
  CONSTRAINT users_email_u  UNIQUE (email),
  CONSTRAINT users_email_ck CHECK (
    email IS NULL OR (email LIKE '%@snu.ac.kr' AND email = lower(email))
  ),
  CONSTRAINT users_live_ck CHECK (deleted_at IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT users_scrubbed_ck CHECK (
    deleted_at IS NULL
    OR (email IS NULL AND display_name IS NULL AND college IS NULL
        AND admission_year IS NULL AND is_admin = FALSE)
  ),
  CONSTRAINT users_admission_year_ck CHECK (admission_year IS NULL OR admission_year BETWEEN 1980 AND 2100),
  CONSTRAINT users_college_ck CHECK (college IS NULL OR college IN (
    '인문대학', '사회과학대학', '자연과학대학', '간호대학', '경영대학',
    '공과대학', '농업생명과학대학', '미술대학', '사범대학', '생활과학대학',
    '수의과대학', '약학대학', '음악대학', '의과대학', '자유전공학부',
    '법학전문대학원', '치의학대학원', '대학원/기타'
  ))
);


-- the fixed assessment vocabulary; eight seeded rows, no free text, see note 3
CREATE TABLE assessment_types (
  id         SMALLINT GENERATED ALWAYS AS IDENTITY,
  label_ko   TEXT     NOT NULL,                     -- shown to students, and the natural key
  sort_order SMALLINT NOT NULL,

  CONSTRAINT assessment_types_pk      PRIMARY KEY (id),
  -- both deferrable so two rows can be renamed or reordered in one statement
  CONSTRAINT assessment_types_label_u UNIQUE (label_ko)   DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT assessment_types_order_u UNIQUE (sort_order) DEFERRABLE INITIALLY IMMEDIATE
);

INSERT INTO assessment_types (label_ko, sort_order) VALUES
  ('중간', 1),
  ('기말', 2),
  ('1차',  3),
  ('2차',  4),
  ('3차',  5),
  ('퀴즈', 6),
  ('과제', 7),
  ('기타', 8);


-- one assessment of one course, e.g. this course's midterm, see note 4
CREATE TABLE course_assessments (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY,
  course_id        BIGINT      NOT NULL,
  type_id          SMALLINT    NOT NULL,
  voting_closes_at TIMESTAMPTZ,                     -- null means never opened
  votes_counted_from TIMESTAMPTZ,                   -- earlier votes kept, not counted, see note 11
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT course_assessments_pk        PRIMARY KEY (id),
  CONSTRAINT course_assessments_u         UNIQUE (course_id, type_id),
  CONSTRAINT course_assessments_course_fk FOREIGN KEY (course_id) REFERENCES courses (id),
  CONSTRAINT course_assessments_type_fk   FOREIGN KEY (type_id)   REFERENCES assessment_types (id),
  CONSTRAINT course_assessments_voting_ck CHECK (
    voting_closes_at IS NULL OR voting_closes_at > created_at
  )
);

CREATE INDEX course_assessments_course_idx ON course_assessments (course_id);
CREATE INDEX course_assessments_voting_idx ON course_assessments (voting_closes_at)
  WHERE voting_closes_at IS NOT NULL;


-- uploaded slides and their review state; files are kept for later re-verification
CREATE TABLE pending_reports (
  id           BIGINT        GENERATED ALWAYS AS IDENTITY,
  course_id    BIGINT        NOT NULL,
  type_id      SMALLINT      NOT NULL,              -- claimed, not yet an assessment row
  year         SMALLINT      NOT NULL,
  semester     SMALLINT      NOT NULL,
  uploader_id  BIGINT        NOT NULL,
  nickname     TEXT          NOT NULL DEFAULT '(익명)',
  file_key     TEXT          NOT NULL,              -- object storage handle
  file_name    TEXT          NOT NULL,
  content_type TEXT          NOT NULL,
  byte_size    INTEGER       NOT NULL,
  status       report_status NOT NULL DEFAULT 'pending',
  reviewer_id  BIGINT,
  reviewed_at  TIMESTAMPTZ,
  review_note  TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT pending_reports_pk          PRIMARY KEY (id),
  CONSTRAINT pending_reports_course_fk   FOREIGN KEY (course_id)   REFERENCES courses (id),
  CONSTRAINT pending_reports_type_fk     FOREIGN KEY (type_id)     REFERENCES assessment_types (id),
  CONSTRAINT pending_reports_uploader_fk FOREIGN KEY (uploader_id) REFERENCES users (id),
  CONSTRAINT pending_reports_reviewer_fk FOREIGN KEY (reviewer_id) REFERENCES users (id),
  CONSTRAINT pending_reports_file_key_u  UNIQUE (file_key),
  CONSTRAINT pending_reports_semester_ck CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT pending_reports_year_ck     CHECK (year BETWEEN 1980 AND 2200),
  CONSTRAINT pending_reports_nickname_ck CHECK (length(nickname) BETWEEN 1 AND 10),
  CONSTRAINT pending_reports_note_ck     CHECK (review_note IS NULL OR length(review_note) <= 500),
  CONSTRAINT pending_reports_size_ck     CHECK (byte_size > 0 AND byte_size <= 3 * 1024 * 1024),
  -- an explicit allowlist, not image/%: SVG carries script and is opened by an
  -- admin in a browser during review
  CONSTRAINT pending_reports_mime_ck     CHECK (content_type IN (
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic'
  )),
  CONSTRAINT pending_reports_dated_ck    CHECK (reviewed_at IS NULL OR reviewed_at >= created_at),
  CONSTRAINT pending_reports_review_ck   CHECK (
    (status =  'pending' AND reviewer_id IS NULL     AND reviewed_at IS NULL)
    OR
    (status <> 'pending' AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX pending_reports_queue_idx ON pending_reports (created_at DESC)
  WHERE status = 'pending';
CREATE INDEX pending_reports_course_idx   ON pending_reports (course_id);
CREATE INDEX pending_reports_uploader_idx ON pending_reports (uploader_id);
CREATE INDEX pending_reports_reviewer_idx ON pending_reports (reviewer_id);

-- no updated_at here on purpose: a row changes exactly once, at review, and
-- reviewed_at records that


-- one contributed score distribution for one assessment in one term, see note 5
CREATE TABLE stat_reports (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY,
  assessment_id    BIGINT      NOT NULL,
  year             SMALLINT    NOT NULL,            -- term the exam was held in
  semester         SMALLINT    NOT NULL,
  q1               NUMERIC(6,2),                    -- q0 is never collected, by design
  q2               NUMERIC(6,2),
  q3               NUMERIC(6,2),
  q4               NUMERIC(6,2),
  average          NUMERIC(6,2),
  max_score        NUMERIC(6,2),                    -- maximum possible, not highest scored
  note             TEXT,
  nickname         TEXT        NOT NULL DEFAULT '(익명)',
  contributor_id   BIGINT      NOT NULL,            -- always the student, never the admin
  source           stat_source NOT NULL,
  source_report_id BIGINT,                          -- upload this was transcribed from

  -- withdrawn from public view without losing the row, see note 12
  hidden_at        TIMESTAMPTZ,
  hidden_by        BIGINT,
  hidden_reason    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT stat_reports_pk             PRIMARY KEY (id),
  CONSTRAINT stat_reports_assessment_fk  FOREIGN KEY (assessment_id)    REFERENCES course_assessments (id),
  CONSTRAINT stat_reports_contributor_fk FOREIGN KEY (contributor_id)   REFERENCES users (id),
  CONSTRAINT stat_reports_source_fk      FOREIGN KEY (source_report_id) REFERENCES pending_reports (id),
  CONSTRAINT stat_reports_hidden_by_fk   FOREIGN KEY (hidden_by)        REFERENCES users (id),
  CONSTRAINT stat_reports_hidden_ck      CHECK (
    (hidden_at IS     NULL AND hidden_by IS     NULL AND hidden_reason IS NULL)
    OR
    (hidden_at IS NOT NULL AND hidden_by IS NOT NULL)
  ),
  CONSTRAINT stat_reports_hidden_reason_ck CHECK (
    hidden_reason IS NULL OR length(hidden_reason) BETWEEN 1 AND 500
  ),
  CONSTRAINT stat_reports_semester_ck    CHECK (semester BETWEEN 1 AND 4),
  CONSTRAINT stat_reports_year_ck        CHECK (year BETWEEN 1980 AND 2200),
  CONSTRAINT stat_reports_nickname_ck    CHECK (length(nickname) BETWEEN 1 AND 10),
  CONSTRAINT stat_reports_note_ck        CHECK (note IS NULL OR length(note) <= 500),
  CONSTRAINT stat_reports_not_empty_ck   CHECK (
    num_nonnulls(q1, q2, q3, q4, average, max_score) > 0
    OR (note IS NOT NULL AND length(trim(note)) > 0)
  ),
  CONSTRAINT stat_reports_ordered_ck     CHECK (values_non_decreasing(q1, q2, q3, q4)),
  CONSTRAINT stat_reports_within_max_ck  CHECK (greatest(q1, q2, q3, q4, average) <= max_score),
  CONSTRAINT stat_reports_range_ck       CHECK (
    least(q1, q2, q3, q4, average) >= 0 AND (max_score IS NULL OR max_score > 0)
  ),
  CONSTRAINT stat_reports_provenance_ck  CHECK (
    (source = 'direct'      AND source_report_id IS NULL)
    OR
    (source = 'transcribed' AND source_report_id IS NOT NULL)
  )
);

-- partial: the course page only ever wants visible rows, and hidden ones are rare
CREATE INDEX stat_reports_assessment_idx  ON stat_reports (assessment_id, year DESC, semester DESC)
  WHERE hidden_at IS NULL;
CREATE INDEX stat_reports_recent_idx      ON stat_reports (created_at DESC);
CREATE INDEX stat_reports_contributor_idx ON stat_reports (contributor_id);
CREATE INDEX stat_reports_source_idx      ON stat_reports (source_report_id);

CREATE TRIGGER stat_reports_touch BEFORE UPDATE ON stat_reports
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- one standing difficulty rating per person per assessment, editable
CREATE TABLE votes (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY,
  assessment_id BIGINT      NOT NULL,
  user_id       BIGINT      NOT NULL,
  rating        SMALLINT    NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT votes_pk            PRIMARY KEY (id),
  CONSTRAINT votes_one_each      UNIQUE (assessment_id, user_id),
  CONSTRAINT votes_assessment_fk FOREIGN KEY (assessment_id) REFERENCES course_assessments (id),
  CONSTRAINT votes_user_fk       FOREIGN KEY (user_id)       REFERENCES users (id),
  CONSTRAINT votes_rating_ck     CHECK (rating BETWEEN 1 AND 5)
);

CREATE INDEX votes_user_time_idx  ON votes (user_id, created_at DESC);
CREATE INDEX votes_assessment_idx ON votes (assessment_id);

CREATE TRIGGER votes_touch BEFORE UPDATE ON votes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- short course reviews, hard deleted by admins, byline masked at read time
CREATE TABLE comments (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY,
  course_id  BIGINT      NOT NULL,                  -- per course, not per assessment
  user_id    BIGINT      NOT NULL,
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT comments_pk        PRIMARY KEY (id),
  CONSTRAINT comments_course_fk FOREIGN KEY (course_id) REFERENCES courses (id),
  CONSTRAINT comments_user_fk   FOREIGN KEY (user_id)   REFERENCES users (id),
  CONSTRAINT comments_body_ck   CHECK (length(trim(body)) BETWEEN 1 AND 50)
);

CREATE INDEX comments_course_idx ON comments (course_id, created_at DESC);
CREATE INDEX comments_user_idx   ON comments (user_id);


-- pinned courses
CREATE TABLE favorites (
  user_id    BIGINT      NOT NULL,
  course_id  BIGINT      NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT favorites_pk        PRIMARY KEY (user_id, course_id),
  CONSTRAINT favorites_user_fk   FOREIGN KEY (user_id)   REFERENCES users (id),
  CONSTRAINT favorites_course_fk FOREIGN KEY (course_id) REFERENCES courses (id)
);

CREATE INDEX favorites_course_idx ON favorites (course_id);


-- append-only audit trail, see note 6
CREATE TABLE activity_logs (
  id         BIGINT          GENERATED ALWAYS AS IDENTITY,
  user_id    BIGINT,                                -- null for system entries
  action     activity_action NOT NULL,
  metadata   JSONB           NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ     NOT NULL DEFAULT now(),

  CONSTRAINT activity_logs_pk      PRIMARY KEY (id),
  CONSTRAINT activity_logs_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX activity_logs_user_idx   ON activity_logs (user_id, created_at DESC);
CREATE INDEX activity_logs_action_idx ON activity_logs (action, created_at DESC);
CREATE INDEX activity_logs_time_idx   ON activity_logs (created_at DESC);


-- one row per catalog import run; written by the importer, read by the console
CREATE TABLE catalog_imports (
  id                  BIGINT        GENERATED ALWAYS AS IDENTITY,
  started_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  status              import_status NOT NULL DEFAULT 'running',
  source_label        TEXT,                        -- which terms were loaded
  courses_total       INTEGER,
  courses_added       INTEGER,
  courses_deactivated INTEGER,
  offerings_total     INTEGER,
  search_refreshed_at TIMESTAMPTZ,                 -- when mv_course_search was rebuilt
  error               TEXT,
  started_by          BIGINT,                      -- null when run unattended

  CONSTRAINT catalog_imports_pk       PRIMARY KEY (id),
  CONSTRAINT catalog_imports_by_fk    FOREIGN KEY (started_by) REFERENCES users (id),
  CONSTRAINT catalog_imports_done_ck  CHECK (
    (status =  'running' AND finished_at IS NULL)
    OR
    (status <> 'running' AND finished_at IS NOT NULL)
  ),
  CONSTRAINT catalog_imports_error_ck CHECK (status = 'failed' OR error IS NULL),
  CONSTRAINT catalog_imports_dated_ck CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX catalog_imports_recent_idx ON catalog_imports (started_at DESC);

-- at most one import may be in flight; the predicate pins status to one value,
-- so this unique index allows a single running row
CREATE UNIQUE INDEX catalog_imports_one_running ON catalog_imports (status)
  WHERE status = 'running';


-- most recent offering per course
CREATE VIEW v_course_latest AS
SELECT DISTINCT ON (course_id)
       course_id,
       year          AS latest_year,
       semester      AS latest_semester,
       department_id AS latest_department_id
FROM   course_offerings
ORDER  BY course_id, year DESC, semester DESC;


-- every department a course has run under
CREATE VIEW v_course_departments AS
SELECT   o.course_id, d.id AS department_id, d.name AS department_name
FROM     course_offerings o
JOIN     departments d ON d.id = o.department_id
GROUP BY o.course_id, d.id, d.name;


-- an assessment with its label resolved
CREATE VIEW v_assessment AS
SELECT a.id, a.course_id, a.voting_closes_at,
       t.label_ko AS label, t.sort_order
FROM   course_assessments a
JOIN   assessment_types t ON t.id = a.type_id;


-- difficulty summary per assessment, excluding votes before the cutoff
CREATE VIEW v_assessment_difficulty AS
SELECT a.id                                   AS assessment_id,
       count(v.id)                            AS vote_count,
       round(avg(v.rating), 1)                AS average_rating,
       count(v.id) FILTER (WHERE v.rating = 1) AS rating_1,
       count(v.id) FILTER (WHERE v.rating = 2) AS rating_2,
       count(v.id) FILTER (WHERE v.rating = 3) AS rating_3,
       count(v.id) FILTER (WHERE v.rating = 4) AS rating_4,
       count(v.id) FILTER (WHERE v.rating = 5) AS rating_5
FROM      course_assessments a
LEFT JOIN votes v
       ON v.assessment_id = a.id
      AND (a.votes_counted_from IS NULL OR v.created_at >= a.votes_counted_from)
GROUP  BY a.id;
-- LEFT JOIN so an assessment with no counted votes still yields a zero row
-- rather than vanishing. count(v.id) rather than count(*) for the same reason.


-- flattened search row; materialized so it can be indexed, see note 7
CREATE MATERIALIZED VIEW mv_course_search AS
SELECT c.id,
       c.title,
       i.name AS instructor,
       lower(c.title || ' ' || i.name || ' ' ||
             coalesce(string_agg(DISTINCT d.name, ' '), '')) AS search_text,
       l.latest_year,
       l.latest_semester
FROM      courses c
JOIN      instructors i      ON i.id = c.instructor_id
JOIN      course_offerings o ON o.course_id = c.id   -- inner: a course with no
JOIN      v_course_latest l  ON l.course_id = c.id   -- offering is not real
JOIN      departments d      ON d.id = o.department_id
WHERE     c.is_active
GROUP BY  c.id, c.title, i.name, l.latest_year, l.latest_semester;

-- required for REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX mv_course_search_pk ON mv_course_search (id);
CREATE INDEX mv_course_search_trgm ON mv_course_search USING gin (search_text gin_trgm_ops);
CREATE INDEX mv_course_search_recent ON mv_course_search (latest_year DESC, latest_semester DESC);


-- ===========================================================================
-- NOTES
-- ===========================================================================
--
-- Catalog sizes, measured from nine semesters of source timetable data:
-- 19,155 courses · 37,890 offerings · 4,142 instructors · 176 departments.
--
-- 1. INSTRUCTOR NAMES ARE NOT UNIQUE TO PEOPLE
--    The source timetable carries no instructor identifier, only a name. 1,653
--    of 4,142 names (39.9%) appear under more than one department, and the
--    widest spans are common names — 김지현 and 김소연 in ten departments each.
--    Most of those are different people, and nothing in the data distinguishes
--    them. Courses are keyed on (title, instructor_id) regardless, because a
--    name is the only identity the source provides. department_span keeps the
--    ambiguous ones findable. The cost: "every course by this professor" would
--    be wrong for ~40% of names, so do not build that feature on this table as
--    it stands.
--
-- 2. SEMESTER CODES ARE CHRONOLOGICAL
--    1=spring (Mar-Jun), 2=summer (Jul-Aug), 3=fall (Sep-Dec), 4=winter
--    (Dec-Feb), so ORDER BY (year, semester) is calendar order and no rank
--    column is needed.
--
--    This is the encoding the university timetable uses, confirmed by row
--    counts in the source data: semesters 1 and 3 carry ~7,500-8,500 courses
--    each, semesters 2 and 4 carry ~250-340. The two large ones are the main
--    semesters; the two small ones are the short summer and winter sessions.
--
--    Application code must use the same encoding. Swapping 2 and 3 is an easy
--    mistake and a silent one: every fall offering renders as summer, every
--    summer offering as fall, and contributions attach to the wrong term.
--
--    The composite primary key is also the deduplication: imports are
--    idempotent, and the 2,416 section-level repeats in the source collapse on
--    their own, because sections are deliberately not modelled.
--
-- 3. THE ASSESSMENT VOCABULARY IS CLOSED
--    Eight seeded types, a foreign key, no free-text path. A free-text label
--    would be matched by string equality, so 중간 and 중간고사 would become
--    separate groups with separate averages and nothing able to notice. A
--    closed set makes that impossible.
--
--    It also means a course has at most eight assessments, so every quiz pools
--    into one 퀴즈 row: one difficulty rating covering all of them, and two
--    quizzes from one term appearing as two stat rows distinguishable only by
--    their notes. If that matters, give an assessment a sequence number:
--
--      ALTER TABLE course_assessments
--        ADD COLUMN ordinal SMALLINT NOT NULL DEFAULT 1;
--      ALTER TABLE course_assessments
--        DROP CONSTRAINT course_assessments_u;
--      ALTER TABLE course_assessments
--        ADD CONSTRAINT course_assessments_u UNIQUE (course_id, type_id, ordinal);
--
-- 4. VOTING IS A TIMESTAMP, NOT A TABLE
--    A voting round holds no fact of its own, and it does not group results:
--    an assessment's difficulty is every vote ever cast on it, across rounds.
--    So a round is just "voting is open until X" on the assessment row, which
--    also makes at-most-one-open-round-per-assessment structural rather than a
--    read-then-write race.
--
--    The partial index uses IS NOT NULL rather than > now(), because an index
--    predicate must be immutable; queries still add AND voting_closes_at >
--    now().
--
-- 5. STATISTIC VALIDATION
--    Quartiles non-decreasing, nothing above max_score, nothing below zero,
--    every row carrying a figure or a note.
--
--    The ordering check calls values_non_decreasing() rather than writing
--    q1 <= q2 AND q2 <= q3 AND q3 <= q4, because that pairwise form goes NULL
--    whenever a middle value is missing, and a CHECK treats NULL as passing —
--    so q1 = 90 with q3 = 10 and no q2 would be accepted. A partially filled
--    row is the normal case for a transcribed slide, so the naive form fails
--    exactly where it is needed. The function instead requires that no earlier
--    value exceeds a later one, skipping the gaps. A CHECK cannot contain a
--    subquery, but it can call an IMMUTABLE function; note that Postgres will
--    not re-validate existing rows if that function is ever redefined.
--
--    greatest() and least() ignore NULLs, so the bound checks cover all four
--    quartiles and the average rather than just q4. Drop the ordering
--    constraint if q4 turns out to mean something other than the top quartile.
--
--    contributor_id is the student who supplied the figures, including on rows
--    transcribed from an upload — never the admin who transcribed them. The
--    link to pending_reports runs one way only, which keeps both questions
--    answerable ("what produced this number", "did this upload produce
--    anything") without a circular foreign key.
--
-- 6. THE AUDIT TRAIL CARRIES user_id, NOT AN EMAIL
--    An admin can still resolve a row to a person, but through one deliberate
--    join rather than by reading addresses off a list, which is what keeps the
--    log consistent with the pseudonymity the rest of the schema implements.
--    `action` is an enum so the set is declared rather than implied. Adding one
--    takes no table lock:
--
--      ALTER TYPE activity_action ADD VALUE 'comment_flag';
--
-- 7. SEARCH IS A MATERIALIZED VIEW
--    Korean has no word boundaries a plain index can use, so course search is
--    infix LIKE, which needs a trigram index — and an index needs a real
--    relation, not a view. mv_course_search is refreshed after each catalog
--    import:
--      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_course_search;
--    CONCURRENTLY keeps it readable during the refresh and is why the unique
--    index on id exists. The catalog changes a few times a year, so staleness
--    between refreshes is not a concern.
--
-- 8. POSTGRES-SPECIFIC CONSTRUCTS USED HERE
--    Recorded for whoever maintains this, not as a portability warning —
--    Postgres is a settled decision.
--      GENERATED ALWAYS AS IDENTITY   standard SQL, but not MySQL's spelling
--      ENUM TYPES                     report_status, stat_source, import_status,
--                                     activity_action
--      TIMESTAMPTZ                    all timestamps; never naive local time
--      JSONB                          activity_logs.metadata
--      TEXT everywhere                no varchar(n); real limits are CHECKs
--      DISTINCT ON                    v_course_latest
--      FILTER (WHERE ...)             v_assessment_difficulty
--      num_nonnulls()                 stat_reports_not_empty_ck
--      partial indexes                open voting, pending review queue
--      MATERIALIZED VIEW + pg_trgm    course search
--
-- 8b. THE IMPORTER RUNS OUTSIDE THE API
--    catalog_imports is a record, not a queue. The importer is a script or a
--    scheduled job: it reads the timetable data, upserts departments,
--    instructors, courses and offerings, refreshes mv_course_search, and writes
--    one row here. The console reads that row and never starts an import
--    itself — a multi-megabyte load triggered by a browser click is a request
--    that either times out or holds a connection for a minute.
--
--    The partial unique index on status is what stops two importers running at
--    once, whether they were started by cron, by hand, or both.
--
-- 9. RULES THAT STAY IN APPLICATION CODE
--    The vote quota — twenty per semester per account — is counted at write time
--    against votes_user_time_idx. Which semester a timestamp falls in is a
--    calendar policy rather than a data constraint, so it does not belong here.
--    Exam periods are deliberately not modelled at all: they move too much year
--    to year to be stated as boundaries anything could rely on.
--
--    A vote counts against the quota when it is cast, regardless of whether it
--    is later excluded by votes_counted_from or moved to another assessment.
--    The allowance limits how often someone votes, not how many of their votes
--    survive moderation.
--
--    course_assessments rows are created on demand, so the write path must
--    expect two submissions for the same course and type to arrive at once.
--    One statement handles both cases:
--
--      INSERT INTO course_assessments (course_id, type_id)
--      VALUES (42, 1)
--      ON CONFLICT (course_id, type_id) DO UPDATE
--        SET course_id = EXCLUDED.course_id
--      RETURNING id;
--
--    The no-op DO UPDATE is there so RETURNING yields a row on conflict;
--    DO NOTHING returns nothing and forces a second round trip.
--
-- 10. ACCOUNT DELETION IS A SCRUB, NOT A DELETE
--    A user row is never removed. Deletion clears every identifying field and
--    stamps deleted_at:
--
--      UPDATE users
--         SET email          = NULL,
--             display_name   = NULL,
--             college        = NULL,
--             admission_year = NULL,
--             is_admin       = FALSE,
--             deleted_at     = now()
--       WHERE id = 42
--         AND deleted_at IS NULL;
--
--    users_scrubbed_ck enforces that a row with deleted_at set carries none of
--    those fields, so a partial scrub is rejected rather than silently leaving
--    a name behind. users_live_ck enforces the reverse: a live row has an email.
--    UNIQUE (email) permits many NULLs, so any number of accounts can be
--    scrubbed.
--
--    Everything the person contributed survives, still attached to their user
--    id, now pointing at a row that identifies nobody. The archive keeps its
--    data and the audit trail keeps its shape.
--
--    Three consequences for application code:
--
--    a) Signing in again with the same address creates a NEW user row. The old
--       contributions stay with the tombstone. That is the correct reading of a
--       deletion request — re-linking would undo it — but it means a returning
--       student cannot recover their history.
--
--    b) The masked comment byline derives from users.display_name, which is now
--       NULL. Comments from scrubbed accounts need a fallback label; they
--       cannot render a mask of nothing.
--
--    c) stat_reports.nickname and pending_reports.nickname are free text the
--       contributor chose, and are NOT touched by a scrub. If someone typed
--       their real name there, it survives. Either clear the nicknames on those
--       rows too, or accept that the scrub is incomplete — but decide, rather
--       than assuming the email was the only identifying field.
--
-- 11. EXCLUDING VOTES WITHOUT DELETING THEM
--    course_assessments.votes_counted_from is a cutoff: v_assessment_difficulty
--    ignores votes cast before it. The rows stay, so the decision is reversible
--    by clearing the column, and the audit trail still shows the vote happened.
--
--    It exists for votes cast before an exam was actually sat — a rating with
--    nothing behind it. An admin sets the cutoff to the confirmed exam time and
--    the earlier ratings stop counting.
--
--    ONE CUTOFF PER ASSESSMENT IS BLUNT, AND DELIBERATELY SO. Votes are not
--    term-scoped: a single course_assessments row covers every sitting of that
--    exam, across years. So the cutoff means "ignore everything before this
--    moment", which fits the most recent sitting and cannot express a separate
--    cutoff per term. Making it per-sitting means giving votes a year and
--    semester, which is a larger change to how difficulty is aggregated.
--
--    A vote excluded this way still consumed its author's quota (note 9).
--
-- 12. HIDING A STATISTIC INSTEAD OF DELETING IT
--    hidden_at, hidden_by and hidden_reason withdraw a row from public view
--    while keeping it. Reads that serve students filter on hidden_at IS NULL;
--    administrative reads do not, so a hidden row stays inspectable and the
--    decision stays reversible.
--
--    This exists for rows that are not wrong but do not belong: spam, a test
--    submission, a duplicate, or a figure filed against the wrong course. A
--    wrong figure is corrected in place instead, and a misfiled one can be
--    moved to the right assessment — neither needs hiding.
--
--    stat_reports_hidden_ck keeps the three columns consistent: either all
--    empty, or at least a time and an admin. A reason is optional, because the
--    activity log records who did it and when regardless.
--
--    There is deliberately no hard delete. Hiding covers every case a delete
--    would, and leaves the row available if the judgement is later disputed.
-- ===========================================================================
