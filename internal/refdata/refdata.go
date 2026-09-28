// Package refdata serves the reference data behind GET /config and holds the
// input limits other packages validate against.
package refdata

import (
	"context"
	"fmt"

	"github.com/snuarchive/snuarchive/internal/calendar"
	"github.com/snuarchive/snuarchive/internal/db/dbq"
)

// Input limits; each matches a CHECK constraint in the schema.
const (
	CommentMaxLength           = 50  // comments_body_ck
	NicknameMaxLength          = 10  // stat_reports_nickname_ck, pending_reports_nickname_ck
	VotingRequestNoteMaxLength = 100 // voting_requests_note_ck
	Anonymous                  = "(익명)"
)

// UploadContentTypes lists what an upload may be, by detected content
// (pending_reports_mime_ck).
var UploadContentTypes = []string{"application/pdf", "image/png", "image/jpeg", "image/webp"}

type Kind struct {
	ID          int64
	Code        string
	Label       string
	LabelFormat string
	Numbered    bool
	MaxNumber   *int
	SortOrder   int
}

type College struct {
	Name      string
	SortOrder int
}

type Semester struct {
	Value int
	Label string
}

type Config struct {
	Kinds          []Kind
	Colleges       []College
	Semesters      []Semester
	UploadMaxBytes int64
}

// Querier is the part of dbq.Queries this package uses.
type Querier interface {
	ListAssessmentKinds(ctx context.Context) ([]dbq.ListAssessmentKindsRow, error)
	ListColleges(ctx context.Context) ([]dbq.ListCollegesRow, error)
}

type Service struct {
	q              Querier
	uploadMaxBytes int64
}

func New(q Querier, uploadMaxBytes int64) *Service {
	return &Service{q: q, uploadMaxBytes: uploadMaxBytes}
}

func (s *Service) Config(ctx context.Context) (Config, error) {
	kindRows, err := s.q.ListAssessmentKinds(ctx)
	if err != nil {
		return Config{}, fmt.Errorf("refdata: kinds: %w", err)
	}
	collegeRows, err := s.q.ListColleges(ctx)
	if err != nil {
		return Config{}, fmt.Errorf("refdata: colleges: %w", err)
	}

	cfg := Config{UploadMaxBytes: s.uploadMaxBytes}
	for _, r := range kindRows {
		k := Kind{
			ID:          int64(r.ID),
			Code:        r.Code,
			Label:       r.LabelKo,
			LabelFormat: r.LabelFormat,
			Numbered:    r.Numbered,
			SortOrder:   int(r.SortOrder),
		}
		if r.MaxNumber != nil {
			n := int(*r.MaxNumber)
			k.MaxNumber = &n
		}
		cfg.Kinds = append(cfg.Kinds, k)
	}
	for _, r := range collegeRows {
		cfg.Colleges = append(cfg.Colleges, College{Name: r.Name, SortOrder: int(r.SortOrder)})
	}
	for _, v := range calendar.Semesters() {
		label, err := calendar.SemesterLabel(v)
		if err != nil {
			return Config{}, err
		}
		cfg.Semesters = append(cfg.Semesters, Semester{Value: v, Label: label})
	}
	return cfg, nil
}
