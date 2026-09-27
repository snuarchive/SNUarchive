// Package httpapi is the HTTP surface: routing, middleware, and translation
// between domain results and the contract in docs/api/openapi.yaml.
package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"slices"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/refdata"
)

const apiPrefix = "/api/v1"

type Pinger interface{ Ping(ctx context.Context) error }

type ConfigSource interface {
	Config(ctx context.Context) (refdata.Config, error)
}

type Deps struct {
	Config  *config.Config
	Logger  *slog.Logger
	DB      Pinger
	RefData ConfigSource
}

type Route struct {
	Method string
	Path   string
}

type Server struct {
	handler http.Handler
	routes  []Route
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.handler.ServeHTTP(w, r) }

// Routes lists every registered method and path, for contract checks.
func (s *Server) Routes() []Route { return slices.Clone(s.routes) }

func New(d Deps) *Server {
	rt := newRouter(d)
	rt.handle(http.MethodGet, "/healthz", http.HandlerFunc(healthz))
	rt.handle(http.MethodGet, "/readyz", readyz(d.DB))
	rt.handle(http.MethodGet, apiPrefix+"/config", getConfig(d))

	var h http.Handler = rt.mux
	h = withRecover(d.Logger)(h)
	h = withAccessLog(d.Logger)(h)
	h = withClientIP(d.Config.TrustedProxies)(h)
	h = withRequestID(d.Config.TrustedProxies)(h)
	if d.Config.OTelEnabled {
		h = otelhttp.NewHandler(h, "snuarchive")
	}
	return &Server{handler: h, routes: rt.routes}
}
