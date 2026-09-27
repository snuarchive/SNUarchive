package telemetry_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/snuarchive/snuarchive/internal/telemetry"
)

func TestJSONLoggerFiltersByLevel(t *testing.T) {
	var buf bytes.Buffer
	log, shutdown, err := telemetry.Setup(context.Background(), &buf, telemetry.Options{
		Format: "json", Level: slog.LevelInfo, Service: "snuarchive", Version: "test",
	})
	if err != nil {
		t.Fatal(err)
	}
	log.Debug("hidden")
	log.Info("shown", "k", "v")
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d lines: %q", len(lines), buf.String())
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &m); err != nil {
		t.Fatal(err)
	}
	for k, want := range map[string]string{"msg": "shown", "k": "v", "service": "snuarchive", "version": "test"} {
		if m[k] != want {
			t.Errorf("%s = %v, want %s", k, m[k], want)
		}
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestTextLogger(t *testing.T) {
	var buf bytes.Buffer
	log, _, err := telemetry.Setup(context.Background(), &buf, telemetry.Options{Format: "text", Level: slog.LevelDebug})
	if err != nil {
		t.Fatal(err)
	}
	log.Debug("shown")
	if !strings.Contains(buf.String(), "msg=shown") {
		t.Fatalf("output = %q", buf.String())
	}
}

func TestOTelSetupWithoutExporters(t *testing.T) {
	t.Setenv("OTEL_TRACES_EXPORTER", "none")
	t.Setenv("OTEL_METRICS_EXPORTER", "none")
	var buf bytes.Buffer
	_, shutdown, err := telemetry.Setup(context.Background(), &buf, telemetry.Options{
		Format: "json", Level: slog.LevelInfo, OTel: true, Service: "snuarchive", Version: "test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
