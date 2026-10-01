package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/refdata"
)

func healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func readyz(db Pinger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

type assessmentKindJSON struct {
	ID          int64  `json:"id"`
	Code        string `json:"code"`
	Label       string `json:"label"`
	Numbered    bool   `json:"numbered"`
	MaxNumber   *int   `json:"maxNumber"`
	LabelFormat string `json:"labelFormat"`
	SortOrder   int    `json:"sortOrder"`
}

type collegeJSON struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
}

type semesterJSON struct {
	Value int    `json:"value"`
	Label string `json:"label"`
}

type configJSON struct {
	AssessmentKinds []assessmentKindJSON `json:"assessmentKinds"`
	Colleges        []collegeJSON        `json:"colleges"`
	Semesters       []semesterJSON       `json:"semesters"`
	Upload          struct {
		MaxBytes int64    `json:"maxBytes"`
		Accepts  []string `json:"accepts"`
	} `json:"upload"`
	Comment struct {
		MaxLength int `json:"maxLength"`
	} `json:"comment"`
	Nickname struct {
		MaxLength int    `json:"maxLength"`
		Anonymous string `json:"anonymous"`
	} `json:"nickname"`
	VotingRequest struct {
		NoteMaxLength int `json:"noteMaxLength"`
	} `json:"votingRequest"`
	DevLoginEnabled bool `json:"devLoginEnabled"`
}

// devLoginEnabled reports whether POST /auth/dev-login exists; never in production.
func devLoginEnabled(c *config.Config) bool {
	return c.Env == config.Development && c.DevLoginEnabled
}

func toConfigJSON(c refdata.Config, devLogin bool) configJSON {
	out := configJSON{
		AssessmentKinds: make([]assessmentKindJSON, 0, len(c.Kinds)),
		Colleges:        make([]collegeJSON, 0, len(c.Colleges)),
		Semesters:       make([]semesterJSON, 0, len(c.Semesters)),
	}
	for _, k := range c.Kinds {
		out.AssessmentKinds = append(out.AssessmentKinds, assessmentKindJSON{
			ID: k.ID, Code: k.Code, Label: k.Label, Numbered: k.Numbered,
			MaxNumber: k.MaxNumber, LabelFormat: k.LabelFormat, SortOrder: k.SortOrder,
		})
	}
	for _, col := range c.Colleges {
		out.Colleges = append(out.Colleges, collegeJSON{Name: col.Name, SortOrder: col.SortOrder})
	}
	for _, s := range c.Semesters {
		out.Semesters = append(out.Semesters, semesterJSON{Value: s.Value, Label: s.Label})
	}
	out.Upload.MaxBytes = c.UploadMaxBytes
	out.Upload.Accepts = refdata.UploadContentTypes
	out.Comment.MaxLength = refdata.CommentMaxLength
	out.Nickname.MaxLength = refdata.NicknameMaxLength
	out.Nickname.Anonymous = refdata.Anonymous
	out.VotingRequest.NoteMaxLength = refdata.VotingRequestNoteMaxLength
	out.DevLoginEnabled = devLogin
	return out
}

func getConfig(d Deps) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cfg, err := d.RefData.Config(r.Context())
		if err != nil {
			writeError(w, r, d.Logger, err)
			return
		}
		// Doesn't change only with a migration: devLoginEnabled depends on
		// the running environment (APP_ENV/DEV_LOGIN_ENABLED), not just the
		// DB. 300s caching is still acceptable here.
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, toConfigJSON(cfg, devLoginEnabled(d.Config)))
	})
}
