// Package telemetry sets up structured logging and, when enabled,
// OpenTelemetry tracing and metrics configured through the standard OTEL_*
// environment variables.
package telemetry

import (
	"context"
	"errors"
	"io"
	"log/slog"

	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

type Options struct {
	Format  string // "json" or "text"
	Level   slog.Level
	OTel    bool
	Service string
	Version string
}

// Setup returns the process logger and a shutdown func that flushes telemetry.
func Setup(ctx context.Context, w io.Writer, o Options) (*slog.Logger, func(context.Context) error, error) {
	handlerOpts := &slog.HandlerOptions{Level: o.Level}
	var h slog.Handler
	if o.Format == "text" {
		h = slog.NewTextHandler(w, handlerOpts)
	} else {
		h = slog.NewJSONHandler(w, handlerOpts)
	}
	logger := slog.New(h)
	if o.Service != "" {
		logger = logger.With("service", o.Service)
	}
	if o.Version != "" {
		logger = logger.With("version", o.Version)
	}
	noop := func(context.Context) error { return nil }
	if !o.OTel {
		return logger, noop, nil
	}

	// OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES win over our defaults.
	var attrs []attribute.KeyValue
	if o.Service != "" {
		attrs = append(attrs, attribute.String("service.name", o.Service))
	}
	if o.Version != "" {
		attrs = append(attrs, attribute.String("service.version", o.Version))
	}
	ours := resource.NewSchemaless(attrs...)
	res, err := resource.Merge(resource.Default(), ours)
	if err == nil {
		res, err = resource.Merge(res, resource.Environment())
	}
	if err != nil {
		return nil, noop, err
	}
	spans, err := autoexport.NewSpanExporter(ctx)
	if err != nil {
		return nil, noop, err
	}
	reader, err := autoexport.NewMetricReader(ctx)
	if err != nil {
		return nil, noop, errors.Join(err, spans.Shutdown(ctx))
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(spans), sdktrace.WithResource(res))
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithResource(res))
	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return logger, func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx))
	}, nil
}
