package telemetry_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"go.opentelemetry.io/contrib/exporters/autoexport"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

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

func TestOTelSetupWithEmptyService(t *testing.T) {
	t.Setenv("OTEL_TRACES_EXPORTER", "none")
	t.Setenv("OTEL_METRICS_EXPORTER", "none")
	var buf bytes.Buffer
	_, shutdown, err := telemetry.Setup(context.Background(), &buf, telemetry.Options{
		Format: "json", Level: slog.LevelInfo, OTel: true, Service: "", Version: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}

type probeExporter struct{ shutdown atomic.Bool }

func (*probeExporter) ExportSpans(context.Context, []sdktrace.ReadOnlySpan) error { return nil }
func (e *probeExporter) Shutdown(context.Context) error {
	e.shutdown.Store(true)
	return nil
}

var (
	probe         = &probeExporter{}
	registerProbe sync.Once
)

func TestSetupShutsDownSpanExporterWhenMetricReaderFails(t *testing.T) {
	registerProbe.Do(func() {
		autoexport.RegisterSpanExporter("probe", func(context.Context) (sdktrace.SpanExporter, error) { return probe, nil })
		autoexport.RegisterMetricReader("failing", func(context.Context) (sdkmetric.Reader, error) {
			return nil, errors.New("metric reader failed")
		})
	})
	probe.shutdown.Store(false)
	t.Setenv("OTEL_TRACES_EXPORTER", "probe")
	t.Setenv("OTEL_METRICS_EXPORTER", "failing")
	var buf bytes.Buffer
	_, _, err := telemetry.Setup(context.Background(), &buf, telemetry.Options{Format: "json", OTel: true})
	if err == nil {
		t.Fatal("Setup must fail when the metric reader cannot be created")
	}
	if !probe.shutdown.Load() {
		t.Fatal("span exporter was not shut down")
	}
}
