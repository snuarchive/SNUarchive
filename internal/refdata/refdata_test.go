package refdata_test

import (
	"context"
	"testing"

	"github.com/snuarchive/snuarchive/internal/db/dbq"
	"github.com/snuarchive/snuarchive/internal/refdata"
	"github.com/snuarchive/snuarchive/internal/testutil/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

func TestConfig(t *testing.T) {
	pool := pgtest.New(t)
	cfg, err := refdata.New(dbq.New(pool), 3<<20).Config(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	codes := []string{}
	for _, k := range cfg.Kinds {
		codes = append(codes, k.Code)
	}
	if got := join(codes); got != "midterm,final,exam,quiz,assignment,other" {
		t.Fatalf("kinds = %s", got)
	}
	exam := cfg.Kinds[2]
	if !exam.Numbered || exam.MaxNumber == nil || *exam.MaxNumber != 6 || exam.LabelFormat != "{n}차 시험" || exam.Label != "시험" {
		t.Fatalf("exam = %+v", exam)
	}
	if cfg.Kinds[0].MaxNumber != nil || cfg.Kinds[0].Numbered {
		t.Fatalf("midterm = %+v", cfg.Kinds[0])
	}

	if len(cfg.Colleges) != 18 || cfg.Colleges[0].Name != "인문대학" || cfg.Colleges[17].Name != "대학원/기타" {
		t.Fatalf("colleges = %+v", cfg.Colleges)
	}

	labels := []string{}
	for _, s := range cfg.Semesters {
		labels = append(labels, s.Label)
	}
	if got := join(labels); got != "1학기,여름학기,2학기,겨울학기" {
		t.Fatalf("semesters = %s", got)
	}
	if cfg.UploadMaxBytes != 3<<20 {
		t.Fatalf("upload max = %d", cfg.UploadMaxBytes)
	}
}

func join(items []string) string {
	out := ""
	for i, s := range items {
		if i > 0 {
			out += ","
		}
		out += s
	}
	return out
}
