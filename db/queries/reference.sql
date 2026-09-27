-- name: ListAssessmentKinds :many
SELECT id, code, label_ko, label_format, numbered, max_number, sort_order
FROM assessment_kinds
WHERE is_active
ORDER BY sort_order;

-- name: ListColleges :many
SELECT name, sort_order
FROM colleges
WHERE is_active
ORDER BY sort_order;
