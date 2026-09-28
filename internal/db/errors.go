package db

import (
	"errors"
	"slices"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/snuarchive/snuarchive/internal/apperr"
)

// rule says what a constraint violation means to an API client: a field
// error, a whole-request error code, or neither (an internal invariant that
// application code should never trip; it stays a 500). A field error whose
// field is "" concerns the body as a whole or several fields at once.
type rule struct {
	field     string
	fieldCode apperr.FieldCode
	code      apperr.Code
}

var internalInvariant = rule{}

func field(name string, code apperr.FieldCode) rule { return rule{field: name, fieldCode: code} }
func code(c apperr.Code) rule                       { return rule{code: c} }

// constraintRules classifies every named constraint in the schema. A test
// fails when the schema and this map disagree.
var constraintRules = map[string]rule{
	// CHECK
	"departments_name_ck":           internalInvariant,
	"instructors_name_ck":           internalInvariant,
	"courses_title_ck":              internalInvariant,
	"courses_search_ck":             internalInvariant,
	"course_offerings_semester_ck":  internalInvariant,
	"course_offerings_year_ck":      internalInvariant,
	"catalog_sections_semester_ck":  internalInvariant,
	"catalog_sections_year_ck":      internalInvariant,
	"colleges_name_ck":              internalInvariant,
	"users_email_ck":                field("email", apperr.InvalidEmail),
	"users_live_ck":                 internalInvariant,
	"users_scrubbed_ck":             internalInvariant,
	"users_admission_year_ck":       field("admissionYear", apperr.InvalidAdmissionYear),
	"users_epoch_ck":                internalInvariant,
	"assessment_kinds_max_ck":       internalInvariant,
	"assessment_kinds_fmt_ck":       internalInvariant,
	"exam_sittings_semester_ck":     field("semester", apperr.InvalidTerm),
	"exam_sittings_year_ck":         field("year", apperr.InvalidTerm),
	"exam_sittings_voting_ck":       field("closesAt", apperr.ClosesAtInPast),
	"votes_rating_ck":               field("rating", apperr.ValueOutOfRange),
	"voting_requests_note_ck":       field("note", apperr.TooLong),
	"voting_requests_resolved_ck":   internalInvariant,
	"pending_reports_semester_ck":   field("semester", apperr.InvalidTerm),
	"pending_reports_year_ck":       field("year", apperr.InvalidTerm),
	"pending_reports_nickname_ck":   field("nickname", apperr.TooLong),
	"pending_reports_note_ck":       field("reviewNote", apperr.TooLong),
	"pending_reports_size_ck":       code(apperr.FileTooLarge),
	"pending_reports_sha_ck":        internalInvariant,
	"pending_reports_mime_ck":       code(apperr.FileTypeRejected),
	"pending_reports_dated_ck":      internalInvariant,
	"pending_reports_review_ck":     internalInvariant,
	"stat_reports_hidden_ck":        internalInvariant,
	"stat_reports_hidden_reason_ck": field("reason", apperr.TooLong),
	"stat_reports_nickname_ck":      field("nickname", apperr.TooLong),
	"stat_reports_note_ck":          field("note", apperr.TooLong),
	"stat_reports_not_empty_ck":     field("", apperr.NothingSubmitted),
	"stat_reports_ordered_ck":       field("", apperr.QuartilesOutOfOrder),
	"stat_reports_within_max_ck":    field("maxScore", apperr.ValueAboveMaxScore),
	"stat_reports_range_ck":         field("", apperr.ValueOutOfRange),
	"stat_reports_provenance_ck":    internalInvariant,
	"comments_body_ck":              field("body", apperr.TooLong),
	"activity_logs_meta_ck":         internalInvariant,
	"catalog_imports_done_ck":       internalInvariant,
	"catalog_imports_error_ck":      internalInvariant,
	"catalog_imports_dated_ck":      internalInvariant,
	"log_archive_runs_format_ck":    internalInvariant,
	"log_archive_runs_done_ck":      internalInvariant,
	"log_archive_runs_ok_ck":        internalInvariant,
	"log_archive_runs_error_ck":     internalInvariant,
	"job_runs_name_ck":              internalInvariant,
	"job_runs_error_ck":             internalInvariant,
	"job_runs_dated_ck":             internalInvariant,
	"content_version_ck":            internalInvariant,

	// raised by check_assessment_number()
	"exam_sittings_number_ck":   field("number", apperr.InvalidAssessmentNumber),
	"pending_reports_number_ck": field("number", apperr.InvalidAssessmentNumber),

	// UNIQUE constraints and unique indexes
	"departments_name_u":           internalInvariant,
	"instructors_name_u":           internalInvariant,
	"courses_identity_u":           internalInvariant,
	"courses_legacy_u":             internalInvariant,
	"catalog_sections_u":           internalInvariant,
	"colleges_order_u":             internalInvariant,
	"users_email_u":                internalInvariant,
	"assessment_kinds_code_u":      internalInvariant,
	"assessment_kinds_label_u":     internalInvariant,
	"assessment_kinds_order_u":     internalInvariant,
	"exam_sittings_u":              internalInvariant,
	"votes_one_each":               internalInvariant,
	"pending_reports_file_key_u":   internalInvariant,
	"stat_reports_source_u":        code(apperr.ReportAlreadyReviewed),
	"voting_requests_open_u":       code(apperr.VotingRequestExists),
	"catalog_imports_one_running":  code(apperr.JobAlreadyRunning),
	"log_archive_runs_one_running": code(apperr.JobAlreadyRunning),
	"favorites_position_u":         internalInvariant,

	// FOREIGN KEY
	"courses_instructor_fk":       internalInvariant,
	"course_offerings_course_fk":  internalInvariant,
	"course_offerings_dept_fk":    internalInvariant,
	"catalog_sections_course_fk":  internalInvariant,
	"catalog_sections_dept_fk":    internalInvariant,
	"users_college_fk":            field("college", apperr.InvalidCollege),
	"exam_sittings_course_fk":     code(apperr.NotFound),
	"exam_sittings_kind_fk":       field("kindId", apperr.UnknownAssessmentKind),
	"votes_sitting_fk":            code(apperr.NotFound),
	"votes_user_fk":               internalInvariant,
	"voting_requests_sitting_fk":  code(apperr.NotFound),
	"voting_requests_user_fk":     internalInvariant,
	"voting_requests_resolver_fk": internalInvariant,
	"pending_reports_course_fk":   code(apperr.NotFound),
	"pending_reports_kind_fk":     field("kindId", apperr.UnknownAssessmentKind),
	"pending_reports_uploader_fk": internalInvariant,
	"pending_reports_reviewer_fk": internalInvariant,
	"stat_reports_sitting_fk":     code(apperr.NotFound),
	"stat_reports_contributor_fk": internalInvariant,
	"stat_reports_source_fk":      internalInvariant,
	"stat_reports_hidden_by_fk":   internalInvariant,
	"comments_course_fk":          code(apperr.NotFound),
	"comments_user_fk":            internalInvariant,
	"favorites_user_fk":           internalInvariant,
	"favorites_course_fk":         code(apperr.NotFound),
	"activity_logs_user_fk":       internalInvariant,
}

// ClassifiedConstraints lists every constraint name MapError knows.
func ClassifiedConstraints() []string {
	names := make([]string, 0, len(constraintRules))
	for name := range constraintRules {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// MapError turns constraint violations into API errors. Anything else,
// including violations of internal invariants, is returned unchanged and
// ends up as a 500.
func MapError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23514", "23505", "23503": // check, unique, foreign key
	default:
		return err
	}
	r, ok := constraintRules[pgErr.ConstraintName]
	switch {
	case !ok || r == internalInvariant:
		return err
	case r.code != "":
		return apperr.New(r.code).Wrap(err)
	default:
		return apperr.Validation(apperr.FieldError{Field: r.field, Code: r.fieldCode}).Wrap(err)
	}
}
